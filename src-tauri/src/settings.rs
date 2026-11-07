// Réglages venant de l'interface ou du fichier : chaque champ invalide reprend sa valeur par défaut.
// C'est la seule porte d'entrée vers la config enregistrée.
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::Path;

use crate::launch::is_package_name;

pub const MAX_TILES: usize = 18; // Réglages compris (3 rangées de 6)
pub const MAX_CALENDARS: usize = 10;
const FONTS: [&str; 3] = ["minimal", "pixel", "literary"]; // mêmes identifiants que ui/ts/themes.ts
const MODIFIERS: [&str; 4] = ["Control", "Alt", "Shift", "Super"];

pub fn settings_tile() -> Value {
    json!({ "name": "Réglages", "type": "settings" })
}

fn is_color(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
    })
}

// Raccourci clavier global : 1 à 3 touches de modification (dont Ctrl, Alt ou Win) + une touche simple.
pub fn is_accelerator(value: &str) -> bool {
    let mut parts: Vec<&str> = value.split('+').collect();
    let key = parts.pop().unwrap_or_default();
    let simple_key = key.len() == 1 && key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    let key_ok = simple_key || key == "Space" || (1..=12).any(|n| key == format!("F{n}"));
    let mods: HashSet<&str> = parts.iter().copied().collect();
    key_ok
        && (1..=3).contains(&parts.len())
        && mods.len() == parts.len()
        && parts.iter().all(|m| MODIFIERS.contains(m))
        && ["Control", "Alt", "Super"].iter().any(|m| mods.contains(m))
}

pub fn is_url(value: Option<&Value>, schemes: &[&str]) -> bool {
    let Some(text) = value.and_then(Value::as_str) else { return false };
    text.len() <= 500 && url::Url::parse(text).is_ok_and(|u| schemes.contains(&u.scheme()))
}

fn is_text(value: Option<&Value>, max: usize) -> bool {
    value.and_then(Value::as_str).is_some_and(|s| {
        !s.is_empty() && s.chars().count() <= max && !s.chars().any(|c| c < '\u{20}')
    })
}

// Nom affiché : espaces retirés, 40 caractères au plus, sinon « fallback ».
fn clean_name(value: Option<&Value>, fallback: &str) -> String {
    let name: String = value.and_then(Value::as_str).unwrap_or("").trim().chars().take(40).collect();
    if name.is_empty() { fallback.to_string() } else { name }
}

// Lien collé par l'utilisateur → adresse https à télécharger, ou None.
// webcal:// (iCloud, Outlook) est le même lien en https.
pub fn calendar_url(input: Option<&Value>) -> Option<String> {
    let text = input?.as_str()?.trim();
    let text = match text.get(..9) {
        Some(head) if head.eq_ignore_ascii_case("webcal://") => format!("https://{}", &text[9..]),
        _ => text.to_string(),
    };
    (text.len() <= 2000 && url::Url::parse(&text).is_ok_and(|u| u.scheme() == "https")).then_some(text)
}

fn clean_tile(tile: &Value) -> Option<Value> {
    let t = tile.as_object()?;
    let kind = t.get("type").and_then(Value::as_str).unwrap_or("");
    if kind == "settings" {
        return Some(settings_tile());
    }
    let name = clean_name(t.get("name"), "Raccourci");
    match kind {
        "url" => is_url(t.get("url"), &["https", "http"]).then(|| json!({ "name": name, "type": "url", "url": t["url"] })),
        // Appli du menu Démarrer (trouvée par la recherche) : lancée par son identifiant Windows.
        "startapp" => is_text(t.get("appId"), 300).then(|| json!({ "name": name, "type": "startapp", "appId": t["appId"] })),
        "app" | "file" | "folder" => {
            let paths = t.get("paths")?.as_array()?;
            if paths.is_empty() || paths.len() > 5 || !paths.iter().all(|p| is_text(Some(p), 300)) {
                return None;
            }
            let mut clean = Map::new();
            clean.insert("name".into(), name.into());
            clean.insert("type".into(), kind.into());
            clean.insert("paths".into(), Value::Array(paths.clone()));
            if is_url(t.get("fallbackUrl"), &["https"]) {
                clean.insert("fallbackUrl".into(), t["fallbackUrl"].clone());
            }
            let icon = t.get("icon");
            let package = icon.and_then(|i| i.get("package")).and_then(Value::as_str);
            if package.is_some_and(is_package_name) && is_text(icon.and_then(|i| i.get("file")), 300) {
                clean.insert("icon".into(), json!({ "package": package, "file": icon.unwrap()["file"] }));
            }
            Some(Value::Object(clean))
        }
        _ => None,
    }
}

// Tuiles dans l'ordre choisi ; la tuile Réglages existe toujours, une seule fois.
fn clean_tiles(tiles: &[Value]) -> Vec<Value> {
    let mut seen_settings = false;
    let mut list: Vec<Value> = tiles
        .iter()
        .filter_map(clean_tile)
        .filter(|t| t["type"] != "settings" || !std::mem::replace(&mut seen_settings, true))
        .collect();
    if !seen_settings {
        list.push(settings_tile());
    }
    // Trop de tuiles : on retire les dernières, jamais la tuile Réglages.
    while list.len() > MAX_TILES {
        let last = list.iter().rposition(|t| t["type"] != "settings").unwrap_or(0);
        list.remove(last);
    }
    list
}

// Agenda : un lien (https) relu régulièrement, ou un fichier .ics importé (copié dans calendars/<id>.ics).
// L'identifiant sert de nom de fichier : lettres minuscules et chiffres seulement.
pub fn is_calendar_id(id: &str) -> bool {
    (8..=32).contains(&id.len()) && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn clean_calendar(calendar: &Value) -> Option<Value> {
    let id = calendar.get("id")?.as_str().filter(|id| is_calendar_id(id))?;
    let name = clean_name(calendar.get("name"), "Agenda");
    if calendar.get("file") == Some(&Value::Bool(true)) {
        return Some(json!({ "id": id, "name": name, "file": true }));
    }
    calendar_url(calendar.get("url")).map(|url| json!({ "id": id, "name": name, "url": url }))
}

pub fn clean_settings(input: &Value, defaults: &Value) -> Value {
    let empty = Map::new();
    let raw = input.as_object().unwrap_or(&empty);
    let pick = |key: &str, ok: &dyn Fn(&Value) -> bool| match raw.get(key) {
        Some(v) if ok(v) => v.clone(),
        _ => defaults[key].clone(),
    };
    let color = |key: &str| Value::from(pick(key, &is_color).as_str().unwrap_or_default().to_lowercase());
    let shortcuts = match raw.get("shortcuts").and_then(Value::as_array) {
        Some(tiles) => Value::Array(clean_tiles(tiles)),
        None => defaults["shortcuts"].clone(),
    };
    let calendars = match raw.get("calendars").and_then(Value::as_array) {
        Some(list) => Value::Array(list.iter().filter_map(clean_calendar).take(MAX_CALENDARS).collect()),
        None => defaults["calendars"].clone(),
    };
    json!({
        "bg": color("bg"),
        "surface": color("surface"),
        "c1": color("c1"),
        "c2": color("c2"),
        "transparency": pick("transparency", &|v| v.as_u64().is_some_and(|n| n <= 70)),
        "font": pick("font", &|v| v.as_str().is_some_and(|f| FONTS.contains(&f))),
        "autoHide": pick("autoHide", &Value::is_boolean),
        "toggleShortcut": pick("toggleShortcut", &|v| v.as_str().is_some_and(is_accelerator)),
        "shortcuts": shortcuts,
        "calendars": calendars,
    })
}

// Config de l'utilisateur, nettoyée. Un fichier absent ou abîmé ne doit jamais empêcher la barre de démarrer.
pub fn load_config(file: &Path, defaults: &Value) -> Value {
    let user = match std::fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
            eprintln!("Config illisible, valeurs par défaut utilisées : {error}");
            Value::Null
        }),
        Err(_) => Value::Null,
    };
    clean_settings(&user, defaults)
}

// Écrit dans un fichier temporaire puis le renomme : une coupure en plein enregistrement
// ne peut pas laisser un fichier à moitié écrit (et donc tous les réglages perdus).
pub fn save_config(file: &Path, config: &Value) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(config)?)?;
    std::fs::rename(&tmp, file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> Value {
        json!({
            "bg": "#0a0a0b", "surface": "#2c2c31", "c1": "#8ab4ff", "c2": "#ffb86b",
            "transparency": 30, "font": "minimal", "autoHide": false, "toggleShortcut": "Alt+Shift+Space",
            "shortcuts": [
                { "name": "VS Code", "type": "app", "paths": ["%LOCALAPPDATA%\\Code.exe"] },
                { "name": "Site", "type": "url", "url": "https://www.google.com" },
                { "name": "Réglages", "type": "settings" }
            ],
            "calendars": []
        })
    }

    fn with(changes: Value) -> Value {
        let mut input = defaults();
        for (k, v) in changes.as_object().unwrap() {
            input[k] = v.clone();
        }
        clean_settings(&input, &defaults())
    }

    fn names(settings: &Value) -> Vec<&str> {
        settings["shortcuts"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect()
    }

    #[test]
    fn valides_gardes_couleurs_en_minuscules() {
        let clean = with(json!({ "c1": "#AABBCC", "transparency": 0, "autoHide": true, "toggleShortcut": "Control+Alt+B" }));
        assert_eq!(clean["c1"], "#aabbcc");
        assert_eq!(clean["transparency"], 0);
        assert_eq!(clean["autoHide"], true);
        assert_eq!(clean["toggleShortcut"], "Control+Alt+B");
    }

    #[test]
    fn invalides_valeur_par_defaut_champ_par_champ() {
        let d = defaults();
        let clean = clean_settings(&json!({ "c1": "red", "c2": "#12345", "transparency": 71, "autoHide": "oui", "toggleShortcut": "A" }), &d);
        for key in ["c1", "c2", "transparency", "autoHide", "toggleShortcut"] {
            assert_eq!(clean[key], d[key], "{key}");
        }
        assert_eq!(clean_settings(&Value::Null, &d), d);
        assert_eq!(clean_settings(&json!({ "transparency": 12.5 }), &d)["transparency"], 30);
    }

    #[test]
    fn raccourci_clavier() {
        for ok in ["Alt+Shift+Space", "Control+Alt+B", "Super+Alt+1", "Control+F12"] {
            assert!(is_accelerator(ok), "{ok}");
        }
        for bad in ["Space", "Shift+A", "Control+", "Control+Alt", "Control+Alt+Delete", "Control+Alt+B; rm", "", "Control+F01", "Alt+Alt+A"] {
            assert!(!is_accelerator(bad), "{bad}");
        }
    }

    #[test]
    fn tuiles_18_au_plus_reglages_toujours_present() {
        let many: Vec<Value> = (0..25).map(|i| json!({ "name": format!("T{i}"), "type": "url", "url": "https://exemple.fr" })).collect();
        let clean = with(json!({ "shortcuts": many }));
        let tiles = clean["shortcuts"].as_array().unwrap();
        assert_eq!(tiles.len(), 18);
        assert_eq!(tiles.iter().filter(|t| t["type"] == "settings").count(), 1);
        assert_eq!(tiles[17], settings_tile());
    }

    #[test]
    fn tuiles_ordre_garde_doublons_de_reglages_retires() {
        let clean = with(json!({ "shortcuts": [
            { "name": "Réglages", "type": "settings" },
            { "name": "B", "type": "url", "url": "https://b.fr" },
            { "name": "Réglages", "type": "settings" },
            { "name": "A", "type": "url", "url": "http://a.fr" }
        ] }));
        assert_eq!(names(&clean), ["Réglages", "B", "A"]);
    }

    #[test]
    fn tuiles_fichier_et_appli_du_menu_demarrer() {
        let clean = with(json!({ "shortcuts": [
            { "name": "Doc", "type": "file", "paths": ["C:\\Docs\\cv.pdf"] },
            { "name": "Spotify", "type": "startapp", "appId": "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" },
            { "name": "Vide", "type": "startapp", "appId": "" },
            { "name": "Bizarre", "type": "startapp", "appId": "a\u{7}b" }
        ] }));
        assert_eq!(clean["shortcuts"][0], json!({ "name": "Doc", "type": "file", "paths": ["C:\\Docs\\cv.pdf"] }));
        assert_eq!(clean["shortcuts"][1]["appId"], "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify");
        assert_eq!(names(&clean).len(), 3);
    }

    #[test]
    fn tuiles_invalides_retirees_noms_coupes() {
        let long = "x".repeat(80);
        let clean = with(json!({ "shortcuts": [
            { "name": "Ok", "type": "app", "paths": ["C:\\Apps\\x.exe"] },
            { "name": "Mauvais lien", "type": "url", "url": "javascript:alert(1)" },
            { "name": "Commande", "type": "shell", "command": "del *" },
            { "name": "Chemin bizarre", "type": "app", "paths": ["C:\\a\u{0}.exe"] },
            { "name": long, "type": "folder", "paths": ["D:\\Musique"] },
            { "name": "Réglages", "type": "settings" }
        ] }));
        assert_eq!(names(&clean), ["Ok", &"x".repeat(40), "Réglages"]);
        let no_settings = with(json!({ "shortcuts": [{ "name": "Ok", "type": "app", "paths": ["C:\\Apps\\x.exe"] }] }));
        assert_eq!(no_settings["shortcuts"][1]["type"], "settings");
    }

    #[test]
    fn tuile_sans_nom_et_champs_inconnus() {
        let clean = with(json!({ "shortcuts": [{ "name": "  ", "type": "url", "url": "https://a.fr", "evil": 1 }] }));
        assert_eq!(clean["shortcuts"][0], json!({ "name": "Raccourci", "type": "url", "url": "https://a.fr" }));
    }

    #[test]
    fn tuile_par_defaut_icone_de_paquet_gardee() {
        let tile = json!({ "name": "Claude", "type": "app", "paths": ["C:\\x.exe"], "fallbackUrl": "https://claude.ai", "icon": { "package": "Claude", "file": "app\\Claude.exe" } });
        assert_eq!(with(json!({ "shortcuts": [tile.clone()] }))["shortcuts"][0], tile);
    }

    #[test]
    fn agendas() {
        let clean = with(json!({ "calendars": [
            { "id": "abcd1234", "name": "Perso", "url": "webcal://exemple.fr/a.ics" },
            { "id": "efgh5678", "name": "", "file": true },
            { "id": "../../x", "name": "Mauvais id", "file": true },
            { "id": "ijkl9012", "name": "Lien http", "url": "http://exemple.fr/a.ics" }
        ] }));
        assert_eq!(clean["calendars"], json!([
            { "id": "abcd1234", "name": "Perso", "url": "https://exemple.fr/a.ics" },
            { "id": "efgh5678", "name": "Agenda", "file": true }
        ]));
        let many: Vec<Value> = (0..15).map(|i| json!({ "id": format!("cal{i:05}"), "name": "A", "file": true })).collect();
        assert_eq!(with(json!({ "calendars": many }))["calendars"].as_array().unwrap().len(), 10);
    }

    #[test]
    fn lien_agenda() {
        assert_eq!(calendar_url(Some(&json!(" WEBCAL://a.fr/x.ics "))), Some("https://a.fr/x.ics".into()));
        let long = format!("https://a.fr/{}", "x".repeat(3000));
        for bad in [json!("http://a.fr/x.ics"), json!("file:///C:/a.ics"), json!("javascript:alert(1)"), json!("pas un lien"), json!(""), json!(42), json!(long)] {
            assert_eq!(calendar_url(Some(&bad)), None, "{bad}");
        }
    }

    #[test]
    fn enregistrement_puis_relecture() {
        let dir = std::env::temp_dir().join(format!("island-test-{}", std::process::id()));
        let file = dir.join("sous-dossier").join("config.json");
        save_config(&file, &defaults()).unwrap();
        assert_eq!(load_config(&file, &defaults()), defaults());
        let files: Vec<_> = std::fs::read_dir(file.parent().unwrap()).unwrap().collect();
        assert_eq!(files.len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
