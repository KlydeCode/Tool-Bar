// Island : la partie Rust. Fenêtre, raccourci clavier global, et toutes les actions Windows
// (lancer une appli, volume, musique, agendas…). L'interface (ui/) n'appelle que les commandes
// listées dans main(), et chaque valeur qu'elle envoie est vérifiée ici.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod helper;
mod launch;
mod media;
mod settings;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, RunEvent, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

use helper::{arg, Helper};
use launch::{resolve_shortcut, Target};

// La fenêtre couvre tout l'écran (hors barre des tâches) et reste presque entièrement transparente :
// les clics la traversent. Pilule, panneau et agenda sont dessinés en haut au centre, la recherche au milieu.
const DEFAULTS: &str = include_str!("../../config.default.json");
const BACKDROP_SCALE: f64 = 0.25; // l'image est floutée : une petite capture suffit
const MOUSE_POLL: Duration = Duration::from_millis(25);
const APPS_MAX_AGE: Duration = Duration::from_secs(5 * 60);
const CALENDAR_REFRESH: Duration = Duration::from_secs(15 * 60);
const CALENDAR_MAX_SIZE: u64 = 5 * 1024 * 1024; // un agenda plus gros est refusé

#[derive(Clone)]
struct StartApp {
    name: String,
    id: String,
}

struct Bar {
    dir: PathBuf, // réglages et agendas de l'utilisateur
    defaults: Value,
    config: Mutex<Value>,
    helper: Helper,
    picking: AtomicBool, // une fenêtre de choix de fichier est ouverte
    hit_rects: Mutex<Vec<[f64; 4]>>,
    apps: Mutex<(Vec<StartApp>, Option<Instant>)>,
    app_icons: Mutex<HashMap<String, String>>, // identifiant de l'appli → icône
    calendar_errors: Mutex<HashMap<String, String>>, // identifiant → message de la dernière mise à jour ratée
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

// Les commandes qui attendent Windows (script, fichiers, réseau) tournent hors du fil de l'interface.
async fn run<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppHandle, &Bar) -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(move || f(&app, &app.state::<Bar>()))
        .await
        .expect("commande interrompue")
}

fn data_url(kind: &str, base64: String) -> Option<String> {
    (!base64.is_empty()).then(|| format!("data:image/{kind};base64,{base64}"))
}

// ---------- Fenêtre ----------
// Toute la zone de travail (hors barre des tâches) de l'écran principal.
fn place_window(win: &WebviewWindow) {
    let Ok(Some(monitor)) = win.primary_monitor() else { return };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let _ = win.set_size(LogicalSize::new(f64::from(area.size.width) / scale, f64::from(area.size.height) / scale));
    let _ = win.set_position(PhysicalPosition::new(area.position.x, area.position.y));
}

#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(key: i32) -> i16;
}
const VK_CONTROL: i32 = 0x11;

// Touche Ctrl enfoncée en ce moment (n'importe quelle appli au premier plan).
fn ctrl_down() -> bool {
    // SAFETY : fonction Windows sans pointeur, qui lit seulement l'état d'une touche.
    unsafe { GetAsyncKeyState(VK_CONTROL) < 0 }
}

// Clics traversants : Tauri ne transmet plus la souris à une fenêtre qui l'ignore. On suit donc le curseur ici
// et la fenêtre ne capte la souris que dans les zones envoyées par l'interface (pilule, panneau, agenda).
// Ctrl enfoncé, souris sur la barre : les clics la traversent (l'interface pâlit pour le montrer).
fn follow_mouse(app: AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let mut ignoring = true;
    let mut passthrough = false;
    loop {
        std::thread::sleep(MOUSE_POLL);
        let (Ok(cursor), Ok(origin), Ok(scale)) = (win.cursor_position(), win.inner_position(), win.scale_factor()) else { continue };
        let x = (cursor.x - f64::from(origin.x)) / scale;
        let y = (cursor.y - f64::from(origin.y)) / scale;
        let on_bar = lock(&app.state::<Bar>().hit_rects)
            .iter()
            .any(|[left, top, w, h]| x >= *left && x < left + w && y >= *top && y < top + h);
        // Seulement souris sur la barre : un Ctrl+C dans une autre appli ne doit pas la faire pâlir.
        let ctrl = on_bar && ctrl_down();
        if ctrl != passthrough {
            passthrough = ctrl;
            let _ = win.emit("bar:passthrough", ctrl);
        }
        let over = on_bar && !ctrl;
        if over == ignoring {
            ignoring = !over;
            let _ = win.set_ignore_cursor_events(ignoring);
        }
    }
}

#[tauri::command]
fn set_hit_rects(rects: Vec<[f64; 4]>, bar: State<'_, Bar>) {
    let valid = rects.len() <= 4 && rects.iter().flatten().all(|n| n.is_finite());
    *lock(&bar.hit_rects) = if valid { rects } else { Vec::new() };
}

// Raccourci global (Alt+Maj+Espace par défaut) : ouvre ou ferme la barre depuis n'importe quelle appli.
// Le focus permet de fermer avec Échap ; la barre se referme si on clique ailleurs.
fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
        let _ = win.emit("bar:toggle", ());
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// Capture de l'écran derrière la fenêtre, floutée ensuite sous le panneau (voir app.ts).
// (Windows ne floute pas ce qui est derrière une fenêtre transparente.) La barre s'exclut de la capture.
#[tauri::command]
async fn get_backdrop(app: AppHandle) -> Option<String> {
    run(app, |app, bar| {
        let win = app.get_webview_window("main")?;
        let (origin, size, scale) = (win.outer_position().ok()?, win.outer_size().ok()?, win.scale_factor().ok()?);
        let logical = |n: f64| (n / scale).round();
        let _ = win.set_content_protected(true);
        let request = format!(
            "capture {} {} {} {} {BACKDROP_SCALE}",
            logical(f64::from(origin.x)), logical(f64::from(origin.y)), logical(f64::from(size.width)), logical(f64::from(size.height))
        );
        let base64 = bar.helper.ask(&request);
        let _ = win.set_content_protected(false);
        data_url("jpeg", base64)
    })
    .await
}

// ---------- Réglages ----------
// config.default.json + config.json de l'utilisateur, toujours nettoyés par settings::clean_settings.
fn answer(ok: bool, error: &str, config: &Value) -> Value {
    json!({ "ok": ok, "error": error, "settings": config })
}

// Enregistre de nouveaux réglages, après vérification. Le raccourci clavier n'est changé que s'il est libre ;
// en cas d'échec, les anciens réglages restent en place.
fn save(app: &AppHandle, bar: &Bar, input: &Value) -> Value {
    let mut config = lock(&bar.config);
    let next = settings::clean_settings(input, &bar.defaults);
    let old_key = config["toggleShortcut"].as_str().unwrap_or_default().to_string();
    let new_key = next["toggleShortcut"].as_str().unwrap_or_default().to_string();
    let changed = old_key != new_key;
    let shortcuts = app.global_shortcut();
    if changed {
        let _ = shortcuts.unregister(old_key.as_str());
        if shortcuts.register(new_key.as_str()).is_err() {
            let _ = shortcuts.register(old_key.as_str());
            return answer(false, "Ce raccourci clavier est déjà utilisé par une autre appli.", &config);
        }
    }
    if let Err(error) = settings::save_config(&bar.dir.join("config.json"), &next) {
        eprintln!("Réglages non enregistrés : {error}");
        if changed {
            let _ = shortcuts.unregister(new_key.as_str());
            let _ = shortcuts.register(old_key.as_str());
        }
        return answer(false, "Impossible d'enregistrer les réglages.", &config);
    }
    *config = next;
    answer(true, "", &config)
}

#[tauri::command]
fn get_settings(bar: State<'_, Bar>) -> Value {
    lock(&bar.config).clone()
}

#[tauri::command]
async fn save_settings(app: AppHandle, settings: Value) -> Value {
    run(app, move |app, bar| save(app, bar, &settings)).await
}

#[tauri::command]
async fn reset_settings(app: AppHandle) -> Value {
    run(app, |app, bar| save(app, bar, &bar.defaults)).await
}

// Lancement au démarrage de Windows : seulement pour la version installée
// (en développement, Windows lancerait un exécutable de test).
#[tauri::command]
fn get_startup(app: AppHandle) -> Value {
    let available = !cfg!(debug_assertions);
    json!({ "available": available, "enabled": available && app.autolaunch().is_enabled().unwrap_or(false) })
}

#[tauri::command]
fn set_startup(app: AppHandle, on: bool) -> Value {
    if !cfg!(debug_assertions) {
        let result = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
        if let Err(error) = result {
            eprintln!("Lancement au démarrage : {error}");
        }
    }
    get_startup(app)
}

// Fenêtre de choix de Windows. Pendant qu'elle est ouverte, la barre ne se referme pas.
fn pick(app: &AppHandle, bar: &Bar, kind: &str) -> Option<String> {
    let mut dialog = app.dialog().file();
    if let Some(win) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&win);
    }
    bar.picking.store(true, Ordering::SeqCst);
    let picked = match kind {
        "app" => dialog.set_title("Choisir une appli").add_filter("Applis et raccourcis", &["exe", "lnk", "appref-ms"]).blocking_pick_file(),
        "file" => dialog.set_title("Choisir un fichier").blocking_pick_file(),
        "folder" => dialog.set_title("Choisir un dossier").blocking_pick_folder(),
        "calendar" => dialog.set_title("Importer un agenda").add_filter("Agenda iCal", &["ics"]).blocking_pick_file(),
        _ => None,
    };
    bar.picking.store(false, Ordering::SeqCst);
    Some(picked?.into_path().ok()?.to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_target(app: AppHandle, kind: String) -> Option<String> {
    run(app, move |app, bar| if kind == "calendar" { None } else { pick(app, bar, &kind) }).await
}

// ---------- Volume et micro ----------
// Une valeur invalide est refusée plutôt que corrigée : un volume deviné peut faire mal aux oreilles.
#[tauri::command]
async fn get_audio(app: AppHandle) -> Value {
    run(app, |_, bar| {
        let level = bar.helper.ask("volume").parse::<f64>().ok().filter(|l| (0.0..=1.0).contains(l));
        let mic = match bar.helper.ask("mic").as_str() {
            "1" => Some(true),
            "0" => Some(false),
            _ => None,
        };
        json!({ "volume": level.map(|l| (l * 100.0).round() as u8), "micMuted": mic })
    })
    .await
}

#[tauri::command]
async fn set_volume(app: AppHandle, percent: u8) -> bool {
    percent <= 100 && run(app, move |_, bar| bar.helper.ask(&format!("volume-set {}", f64::from(percent) / 100.0)) == "ok").await
}

#[tauri::command]
async fn set_mic_muted(app: AppHandle, muted: bool) -> bool {
    run(app, move |_, bar| bar.helper.ask(&format!("mic-set {}", u8::from(muted))) == "ok").await
}

// ---------- Musique ----------
// Morceau en cours de n'importe quelle appli qui se déclare à Windows (Spotify, Deezer, navigateurs…).
#[tauri::command]
async fn get_media(app: AppHandle) -> Option<Value> {
    run(app, |_, bar| media::parse_media(&bar.helper.ask("media"))).await
}

#[tauri::command]
async fn get_media_art(app: AppHandle) -> Option<String> {
    run(app, |_, bar| data_url("jpeg", bar.helper.ask("media-art"))).await
}

#[tauri::command]
async fn media_control(app: AppHandle, action: String) -> bool {
    ["play", "next", "prev"].contains(&action.as_str())
        && run(app, move |_, bar| bar.helper.ask(&format!("media-{action}")) == "ok").await
}

// ---------- Notifications des applis ----------
// Affichées un instant dans la pilule. Texte venu d'autres applis : vérifié et coupé ici, affiché en textContent.
fn parse_notifications(line: &str) -> Vec<Value> {
    let Ok(Value::Array(list)) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    let text = |v: &Value, max: usize| -> String { v.as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(max).collect() };
    list.iter()
        .filter_map(|n| {
            let id = n["id"].as_u64().filter(|id| *id <= u64::from(u32::MAX))?;
            let title = text(&n["title"], 120);
            (!title.is_empty()).then(|| {
                json!({ "id": id, "app": text(&n["app"], 60), "title": title, "body": text(&n["body"], 200), "time": n["time"].as_f64().unwrap_or(0.0) })
            })
        })
        .collect()
}

#[tauri::command]
async fn get_notifications(app: AppHandle) -> Vec<Value> {
    run(app, |_, bar| parse_notifications(&bar.helper.ask("notifs"))).await
}

#[tauri::command]
async fn get_notification_icon(app: AppHandle, id: u32) -> Option<String> {
    run(app, move |_, bar| data_url("png", bar.helper.ask(&format!("notif-icon {id}")))).await
}

// ---------- Raccourcis d'applis ----------
fn resolve_target(app: &AppHandle, tile: &Value) -> Option<Target> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    if let Ok(downloads) = app.path().download_dir() {
        env.insert("DOWNLOADS".into(), downloads.to_string_lossy().into_owned());
    }
    // symlink_metadata et non metadata : les alias d'applis Windows (wt.exe, claude-desktop.exe) sont des liens.
    resolve_shortcut(tile, &env, |p| std::fs::symlink_metadata(p).is_ok())
}

fn file_icon(bar: &Bar, path: &str) -> Option<String> {
    data_url("png", bar.helper.ask(&format!("file-icon {}", arg(path))))
}

// Vraie icône d'une tuile « app » : celle du paquet Microsoft Store si elle est indiquée, sinon celle du fichier.
fn tile_icon(app: &AppHandle, bar: &Bar, tile: &Value) -> Option<String> {
    let package = tile["icon"]["package"].as_str().filter(|p| launch::is_package_name(p));
    if let (Some(package), Some(file)) = (package, tile["icon"]["file"].as_str()) {
        let dir = bar.helper.ask(&format!("package-dir {}", arg(package)));
        if let Some(icon) = launch::package_icon_file(&dir, file).and_then(|f| file_icon(bar, &f)) {
            return Some(icon);
        }
    }
    match resolve_target(app, tile)? {
        Target::Path(path) => file_icon(bar, &path),
        Target::Url(_) => None,
    }
}

// Nom, type et vraie icône (applis uniquement) de chaque tuile, pour l'interface.
#[tauri::command]
async fn get_shortcuts(app: AppHandle) -> Vec<Value> {
    run(app, |app, bar| {
        let tiles = lock(&bar.config)["shortcuts"].as_array().cloned().unwrap_or_default();
        tiles
            .iter()
            .map(|tile| {
                let icon = match tile["type"].as_str() {
                    Some("startapp") => find_app(bar, tile["appId"].as_str().unwrap_or_default()).and_then(|(i, a)| app_icon(bar, i, &a)),
                    Some("app") => tile_icon(app, bar, tile),
                    _ => None, // dossiers, fichiers et sites gardent un pictogramme simple
                };
                json!({ "name": tile["name"], "type": tile["type"], "icon": icon })
            })
            .collect()
    })
    .await
}

// Lance une appli du menu Démarrer par son identifiant Windows (argument unique, pas de commande).
fn open_start_app(id: &str) -> bool {
    std::process::Command::new("explorer.exe").arg(format!("shell:AppsFolder\\{id}")).spawn().is_ok()
}

// Seulement le numéro de la tuile : la cible est relue dans la config.
#[tauri::command]
async fn launch(app: AppHandle, index: usize) -> bool {
    run(app, move |app, bar| {
        let Some(tile) = lock(&bar.config)["shortcuts"].get(index).cloned() else { return false };
        if tile["type"] == "startapp" {
            return find_app(bar, tile["appId"].as_str().unwrap_or_default()).is_some_and(|(_, a)| open_start_app(&a.id));
        }
        let result = match resolve_target(app, &tile) {
            Some(Target::Url(url)) => app.opener().open_url(url, None::<&str>),
            Some(Target::Path(path)) => app.opener().open_path(path, None::<&str>),
            None => {
                eprintln!("Raccourci {} : cible introuvable ou refusée.", index + 1);
                return false;
            }
        };
        result.map_err(|error| eprintln!("Raccourci {} : {error}", index + 1)).is_ok()
    })
    .await
}

// ---------- Applis du PC (recherche) ----------
// Liste du menu Démarrer, gardée ici et dans le script (mêmes numéros), relue toutes les 5 minutes au plus.
fn parse_apps(line: &str) -> Vec<StartApp> {
    let Ok(Value::Array(list)) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    list.iter()
        .filter_map(|a| {
            let (name, id) = (a["name"].as_str().filter(|s| !s.is_empty())?, a["id"].as_str().filter(|s| !s.is_empty())?);
            Some(StartApp { name: name.chars().take(100).collect(), id: id.chars().take(300).collect() })
        })
        .collect()
}

fn load_apps(bar: &Bar, force: bool) -> Vec<StartApp> {
    let mut apps = lock(&bar.apps);
    if force || apps.0.is_empty() || apps.1.is_none_or(|at| at.elapsed() > APPS_MAX_AGE) {
        let list = parse_apps(&bar.helper.ask("apps"));
        if !list.is_empty() {
            *apps = (list, Some(Instant::now()));
        }
    }
    apps.0.clone()
}

// L'interface désigne une appli par son identifiant Windows : sa position dans la liste peut changer
// quand la liste est relue (appli installée ou désinstallée entre-temps).
fn find_app(bar: &Bar, id: &str) -> Option<(usize, StartApp)> {
    let find = |list: Vec<StartApp>| list.into_iter().enumerate().find(|(_, a)| a.id == id);
    find(load_apps(bar, false)).or_else(|| find(load_apps(bar, true)))
}

fn app_icon(bar: &Bar, index: usize, app: &StartApp) -> Option<String> {
    if let Some(icon) = lock(&bar.app_icons).get(&app.id) {
        return Some(icon.clone());
    }
    let icon = data_url("png", bar.helper.ask(&format!("app-icon {index}")))?;
    lock(&bar.app_icons).insert(app.id.clone(), icon.clone());
    Some(icon)
}

// Fichier de l'appli : son .exe (applis classiques) ou son dossier (Microsoft Store), sinon ''.
fn app_file(bar: &Bar, index: usize) -> String {
    let found = bar.helper.ask(&format!("app-path {index}"));
    if Path::new(&found).is_absolute() && Path::new(&found).exists() { found } else { String::new() }
}

fn is_store_file(file: &str) -> bool {
    file.to_ascii_lowercase().contains("\\windowsapps\\")
}

#[tauri::command]
async fn list_apps(app: AppHandle) -> Vec<Value> {
    run(app, |_, bar| load_apps(bar, false).iter().map(|a| json!({ "name": a.name, "id": a.id })).collect()).await
}

#[tauri::command]
async fn get_app_icon(app: AppHandle, id: String) -> Option<String> {
    run(app, move |_, bar| find_app(bar, &id).and_then(|(i, a)| app_icon(bar, i, &a))).await
}

#[tauri::command]
async fn launch_app(app: AppHandle, id: String) -> bool {
    run(app, move |_, bar| find_app(bar, &id).is_some_and(|(_, a)| open_start_app(&a.id))).await
}

// Ajoute l'appli trouvée en tuile (juste avant la tuile Réglages si elle est en dernier).
#[tauri::command]
async fn pin_app(app: AppHandle, id: String) -> Value {
    run(app, move |app, bar| {
        let config = lock(&bar.config).clone();
        let Some((_, found)) = find_app(bar, &id) else { return answer(false, "Appli introuvable.", &config) };
        let mut tiles = config["shortcuts"].as_array().cloned().unwrap_or_default();
        if tiles.len() >= settings::MAX_TILES {
            return answer(false, &format!("{} tuiles au maximum.", settings::MAX_TILES), &config);
        }
        let at = if tiles.last().is_some_and(|t| t["type"] == "settings") { tiles.len() - 1 } else { tiles.len() };
        let name: String = found.name.chars().take(40).collect();
        tiles.insert(at, json!({ "name": name, "type": "startapp", "appId": found.id }));
        let mut next = config;
        next["shortcuts"] = Value::Array(tiles);
        save(app, bar, &next)
    })
    .await
}

// Raccourci .lnk sur le Bureau ; « Spotify (2).lnk » si « Spotify.lnk » existe déjà.
#[tauri::command]
async fn desktop_shortcut(app: AppHandle, id: String) -> bool {
    run(app, move |app, bar| {
        let (Some((index, found)), Ok(desktop)) = (find_app(bar, &id), app.path().desktop_dir()) else { return false };
        let file = app_file(bar, index);
        let base = launch::shortcut_file_name(&found.name);
        let mut lnk = desktop.join(format!("{base}.lnk"));
        for n in 2.. {
            if !lnk.exists() {
                break;
            }
            lnk = desktop.join(format!("{base} ({n}).lnk"));
        }
        // Un .exe classique se lance directement ; ceux du Microsoft Store passent par leur identifiant.
        let (target, args, icon) = if file.to_ascii_lowercase().ends_with(".exe") && !is_store_file(&file) {
            (file.clone(), String::new(), file)
        } else {
            let windows = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
            (format!("{windows}\\explorer.exe"), format!("shell:AppsFolder\\{}", found.id), String::new())
        };
        let request = format!("lnk {} {} {} {}", arg(&lnk.to_string_lossy()), arg(&target), arg(&args), arg(&icon));
        bar.helper.ask(&request) == "ok"
    })
    .await
}

#[tauri::command]
async fn reveal_app(app: AppHandle, id: String) -> bool {
    run(app, move |app, bar| {
        let Some((index, _)) = find_app(bar, &id) else { return false };
        let file = app_file(bar, index);
        !file.is_empty() && !is_store_file(&file) && app.opener().reveal_item_in_dir(&file).is_ok()
    })
    .await
}

// ---------- Agenda ----------
// Agendas iCal : liens (Google, Outlook, iCloud…) relus toutes les 15 minutes, ou fichiers .ics importés.
// Une copie de chaque agenda est gardée dans calendars/<id>.ics (marche aussi hors ligne) ;
// l'interface la lit avec ical.js (ui/ts/calendar.ts).
fn calendar_file(bar: &Bar, id: &str) -> PathBuf {
    bar.dir.join("calendars").join(format!("{id}.ics"))
}

fn write_calendar(bar: &Bar, id: &str, text: &str) -> Result<(), String> {
    let file = calendar_file(bar, id);
    std::fs::create_dir_all(file.parent().unwrap_or(&bar.dir))
        .and_then(|_| std::fs::write(&file, text))
        .map_err(|_| "Impossible d'enregistrer l'agenda.".to_string())
}

fn check_calendar_text(text: String) -> Result<String, String> {
    if text.len() as u64 > CALENDAR_MAX_SIZE {
        return Err("Agenda trop gros (plus de 5 Mo).".into());
    }
    if !text.to_ascii_uppercase().contains("BEGIN:VCALENDAR") {
        return Err("Ce n'est pas un agenda iCal.".into());
    }
    Ok(text)
}

fn download_calendar(url: &str) -> Result<String, String> {
    let response = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build().get(url).call().map_err(|error| match error {
        ureq::Error::Status(code, _) => format!("Le lien répond « {code} »."),
        ureq::Error::Transport(_) => "Lien impossible à charger.".to_string(),
    })?;
    let mut text = String::new();
    response
        .into_reader()
        .take(CALENDAR_MAX_SIZE + 1)
        .read_to_string(&mut text)
        .map_err(|_| "Agenda illisible.".to_string())?;
    check_calendar_text(text)
}

// Nom donné par l'agenda lui-même (Google, Outlook, iCloud le fournissent), sinon ''.
fn calendar_name(text: &str) -> String {
    let line = text.lines().find_map(|l| l.strip_prefix("X-WR-CALNAME:")).unwrap_or_default();
    line.trim().chars().take(40).collect()
}

// Identifiant d'un nouvel agenda (nom de son fichier) : lettres minuscules et chiffres.
fn new_calendar_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    format!("{:x}{:x}", nanos as u64, std::process::id())
}

fn refresh_calendars(bar: &Bar) {
    let calendars = lock(&bar.config)["calendars"].as_array().cloned().unwrap_or_default();
    for calendar in calendars {
        let (Some(id), Some(url)) = (calendar["id"].as_str(), calendar["url"].as_str()) else { continue };
        match download_calendar(url).and_then(|text| write_calendar(bar, id, &text)) {
            Ok(()) => lock(&bar.calendar_errors).remove(id),
            Err(error) => lock(&bar.calendar_errors).insert(id.to_string(), error),
        };
    }
}

fn add_to_calendars(app: &AppHandle, bar: &Bar, calendar: Value) -> Value {
    let mut next = lock(&bar.config).clone();
    if let Some(list) = next["calendars"].as_array_mut() {
        list.push(calendar);
    }
    save(app, bar, &next)
}

#[tauri::command]
async fn calendar_texts(app: AppHandle) -> Vec<String> {
    run(app, |_, bar| {
        let calendars = lock(&bar.config)["calendars"].as_array().cloned().unwrap_or_default();
        calendars
            .iter()
            .map(|c| std::fs::read_to_string(calendar_file(bar, c["id"].as_str().unwrap_or_default())).unwrap_or_default())
            .collect()
    })
    .await
}

#[tauri::command]
fn get_calendars(bar: State<'_, Bar>) -> Vec<Value> {
    let errors = lock(&bar.calendar_errors);
    let calendars = lock(&bar.config)["calendars"].as_array().cloned().unwrap_or_default();
    calendars
        .iter()
        .map(|c| {
            let error = c["id"].as_str().and_then(|id| errors.get(id)).cloned().unwrap_or_default();
            json!({ "id": c["id"], "name": c["name"], "type": if c["url"].is_string() { "url" } else { "file" }, "error": error })
        })
        .collect()
}

#[tauri::command]
async fn add_calendar(app: AppHandle, url: String) -> Value {
    run(app, move |app, bar| {
        let config = lock(&bar.config).clone();
        let Some(url) = settings::calendar_url(Some(&Value::from(url))) else {
            return answer(false, "Lien refusé : il doit commencer par https:// ou webcal://", &config);
        };
        if config["calendars"].as_array().map_or(0, Vec::len) >= settings::MAX_CALENDARS {
            return answer(false, "10 agendas au maximum.", &config);
        }
        let id = new_calendar_id();
        let text = match download_calendar(&url).and_then(|text| write_calendar(bar, &id, &text).map(|_| text)) {
            Ok(text) => text,
            Err(error) => return answer(false, &error, &config),
        };
        let mut name = calendar_name(&text);
        if name.is_empty() {
            let host = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
            name = host.trim_start_matches("www.").to_string();
        }
        add_to_calendars(app, bar, json!({ "id": id, "name": name, "url": url }))
    })
    .await
}

#[tauri::command]
async fn import_calendar(app: AppHandle) -> Value {
    run(app, |app, bar| {
        let config = lock(&bar.config).clone();
        if config["calendars"].as_array().map_or(0, Vec::len) >= settings::MAX_CALENDARS {
            return answer(false, "10 agendas au maximum.", &config);
        }
        let Some(file) = pick(app, bar, "calendar") else { return answer(true, "", &config) };
        let read = || -> Result<String, String> {
            let size = std::fs::metadata(&file).map_err(|_| "Fichier illisible.")?.len();
            if size > CALENDAR_MAX_SIZE {
                return Err("Agenda trop gros (plus de 5 Mo).".into());
            }
            check_calendar_text(std::fs::read_to_string(&file).map_err(|_| "Fichier illisible.")?)
        };
        let id = new_calendar_id();
        let text = match read().and_then(|text| write_calendar(bar, &id, &text).map(|_| text)) {
            Ok(text) => text,
            Err(error) => return answer(false, &error, &config),
        };
        let mut name = calendar_name(&text);
        if name.is_empty() {
            name = Path::new(&file).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        }
        add_to_calendars(app, bar, json!({ "id": id, "name": name, "file": true }))
    })
    .await
}

#[tauri::command]
async fn remove_calendar(app: AppHandle, id: String) -> Value {
    run(app, move |app, bar| {
        let mut next = lock(&bar.config).clone();
        let Some(list) = next["calendars"].as_array_mut() else { return answer(false, "Agenda introuvable.", &next) };
        let before = list.len();
        list.retain(|c| c["id"] != id.as_str());
        if list.len() == before {
            let config = lock(&bar.config).clone();
            return answer(false, "Agenda introuvable.", &config);
        }
        if settings::is_calendar_id(&id) {
            let _ = std::fs::remove_file(calendar_file(bar, &id)); // notre copie seulement, jamais le fichier d'origine
        }
        lock(&bar.calendar_errors).remove(&id);
        save(app, bar, &next)
    })
    .await
}

// ---------- Démarrage ----------
// Réglages et agendas d'avant sont repris une fois : Island 1.x (Electron) et, avant, « Ma Barre ».
fn migrate_old_settings(app: &AppHandle, dir: &Path) {
    let Ok(roaming) = app.path().config_dir() else { return };
    if dir.join("config.json").exists() {
        return;
    }
    let Some(old) = ["Island", "ma-barre"].iter().map(|name| roaming.join(name)).find(|old| old.join("config.json").exists()) else { return };
    let copy = || -> std::io::Result<()> {
        std::fs::create_dir_all(dir.join("calendars"))?;
        std::fs::copy(old.join("config.json"), dir.join("config.json"))?;
        for entry in std::fs::read_dir(old.join("calendars")).into_iter().flatten().flatten() {
            std::fs::copy(entry.path(), dir.join("calendars").join(entry.file_name()))?;
        }
        Ok(())
    };
    if let Err(error) = copy() {
        eprintln!("Anciens réglages non repris : {error}");
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_config_dir()?;
    migrate_old_settings(app.handle(), &dir);
    let defaults: Value = serde_json::from_str(DEFAULTS)?;
    let config = settings::load_config(&dir.join("config.json"), &defaults);
    let shortcut = config["toggleShortcut"].as_str().unwrap_or_default().to_string();
    app.manage(Bar {
        helper: Helper::new(app.path().app_local_data_dir()?),
        dir,
        defaults,
        config: Mutex::new(config),
        picking: AtomicBool::new(false),
        hit_rects: Mutex::new(Vec::new()),
        apps: Mutex::new((Vec::new(), None)),
        app_icons: Mutex::new(HashMap::new()),
        calendar_errors: Mutex::new(HashMap::new()),
    });
    if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
        eprintln!("Raccourci {shortcut} déjà utilisé par une autre appli : {error}");
    }

    let win = app.get_webview_window("main").ok_or("fenêtre absente")?;
    place_window(&win);
    // Au départ, les clics traversent la fenêtre (voir follow_mouse).
    win.set_ignore_cursor_events(true)?;
    win.show()?;

    let handle = app.handle().clone();
    std::thread::spawn(move || follow_mouse(handle));
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let bar = handle.state::<Bar>();
        bar.helper.warm_up(); // prêt avant le premier survol
        load_apps(&bar, false); // liste des applis prête pour la première recherche
        loop {
            refresh_calendars(&bar);
            std::thread::sleep(CALENDAR_REFRESH);
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Une seule barre à la fois : relancer Island ouvre la barre déjà là.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| toggle(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(setup)
        .on_window_event(|window, event| match event {
            // Panneau ouvert au clavier puis clic ailleurs : on le referme (sauf pendant le choix d'un fichier).
            WindowEvent::Focused(false) if !window.state::<Bar>().picking.load(Ordering::SeqCst) => {
                let _ = window.emit("bar:close", ());
            }
            WindowEvent::ScaleFactorChanged { .. } => {
                if let Some(win) = window.app_handle().get_webview_window("main") {
                    place_window(&win);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            quit, set_hit_rects, get_backdrop, get_settings, save_settings, reset_settings, get_startup, set_startup,
            pick_target, get_audio, set_volume, set_mic_muted, get_media, get_media_art, media_control, get_shortcuts,
            launch, list_apps, get_app_icon, launch_app, pin_app, desktop_shortcut, reveal_app, calendar_texts,
            get_calendars, add_calendar, import_calendar, remove_calendar, get_notifications, get_notification_icon
        ])
        .build(tauri::generate_context!())
        .expect("Island n'a pas pu démarrer")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Bar>().helper.stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liste_des_applis_verifiee() {
        let apps = parse_apps(r#"[{"name":"Ok","id":"a!b"},{"name":"","id":"x"},{"name":"Sans id"},"texte"]"#);
        assert_eq!(apps.len(), 1);
        assert_eq!((apps[0].name.as_str(), apps[0].id.as_str()), ("Ok", "a!b"));
        assert!(parse_apps("pas du json").is_empty());
        assert!(parse_apps(r#"{"name":"seul"}"#).is_empty());
    }

    #[test]
    fn notifications_verifiees() {
        let line = r#"[{"id":12,"app":"Discord","title":"Léa","body":"Salut\u0007 !","time":5},{"id":-1,"title":"x"},{"id":3,"title":""},"texte"]"#;
        let list = parse_notifications(line);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["body"], "Salut !");
        assert_eq!(list[0]["app"], "Discord");
        assert!(parse_notifications("pas du json").is_empty());
    }

    #[test]
    fn agenda_verifie_et_nomme() {
        assert!(check_calendar_text("BEGIN:VCALENDAR\nEND:VCALENDAR".into()).is_ok());
        assert!(check_calendar_text("<html>".into()).is_err());
        assert_eq!(calendar_name("BEGIN:VCALENDAR\nX-WR-CALNAME: Perso \nEND:VCALENDAR"), "Perso");
        assert!(settings::is_calendar_id(&new_calendar_id()));
    }
}
