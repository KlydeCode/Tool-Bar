// Tuile de la config → cible sûre à ouvrir. Rien n'est exécuté ici : main.rs ouvre la cible
// avec le module « opener » de Tauri (pas de commande shell). Les applis du menu Démarrer
// (type « startapp ») sont lancées à part par main.rs.
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Component, Path};

use crate::settings::is_url;

#[derive(Debug, PartialEq)]
pub enum Target {
    Path(String),
    Url(String),
}

// Extensions acceptées pour une tuile « Appli » (programme ou raccourci Windows).
const APP_EXTENSIONS: [&str; 3] = ["exe", "lnk", "appref-ms"];

// Remplace %VARIABLE% par sa valeur (sans tenir compte de la casse, comme Windows).
// Une variable inconnue reste telle quelle : le chemin sera refusé.
fn expand_env(text: &str, env: &HashMap<String, String>) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        let Some(len) = rest[start + 1..].find('%') else { break };
        let name = &rest[start + 1..start + 1 + len];
        out.push_str(&rest[..start]);
        match env.iter().find(|(k, _)| !name.is_empty() && k.eq_ignore_ascii_case(name)) {
            Some((_, value)) => out.push_str(value),
            None => out.push_str(&rest[start..start + len + 2]),
        }
        rest = &rest[start + len + 2..];
    }
    out + rest
}

pub fn resolve_shortcut(shortcut: &Value, env: &HashMap<String, String>, exists: impl Fn(&Path) -> bool) -> Option<Target> {
    let kind = shortcut.get("type")?.as_str()?;
    if kind == "url" {
        return web(shortcut.get("url"), &["https", "http"]);
    }
    if !["app", "file", "folder"].contains(&kind) {
        return None;
    }
    let paths = shortcut.get("paths").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    for raw in paths.iter().filter_map(Value::as_str) {
        let candidate = expand_env(raw, env);
        let path = Path::new(&candidate);
        if candidate.contains('%') || !path.is_absolute() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if kind == "app" && !APP_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        if exists(path) {
            return Some(Target::Path(candidate));
        }
    }
    web(shortcut.get("fallbackUrl"), &["https"])
}

fn web(value: Option<&Value>, schemes: &[&str]) -> Option<Target> {
    is_url(value, schemes).then(|| Target::Url(value.and_then(Value::as_str).unwrap_or_default().to_string()))
}

// Applis du Microsoft Store (Claude, Terminal) : l'alias lancé n'a qu'une icône générique,
// la vraie est dans le dossier d'installation du paquet.
pub fn is_package_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

// Fichier relatif au dossier du paquet, sans « .. » ni chemin absolu : il ne peut pas en sortir.
pub fn package_icon_file(install_dir: &str, file: &str) -> Option<String> {
    let relative = Path::new(file);
    let inside = relative.components().all(|c| matches!(c, Component::Normal(_)));
    (!install_dir.is_empty() && !file.is_empty() && inside)
        .then(|| Path::new(install_dir).join(relative).to_string_lossy().into_owned())
}

// Nom de fichier sûr pour un raccourci créé sur le Bureau (sans dossier, sans caractère interdit par Windows).
pub fn shortcut_file_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| !"<>:\"/\\|?*".contains(*c) && *c >= '\u{20}').collect();
    let clean: String = clean.trim_matches(|c: char| c == '.' || c.is_whitespace()).chars().take(80).collect();
    let lower = clean.to_ascii_lowercase();
    let reserved = ["con", "prn", "aux", "nul"].contains(&lower.as_str())
        || (lower.len() == 4 && (lower.starts_with("com") || lower.starts_with("lpt")) && lower.as_bytes()[3].is_ascii_digit());
    if clean.is_empty() || reserved { "Appli".into() } else { clean }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env() -> HashMap<String, String> {
        HashMap::from([
            ("LOCALAPPDATA".into(), "C:\\Users\\me\\AppData\\Local".into()),
            ("DOWNLOADS".into(), "D:\\Téléchargements".into()),
        ])
    }
    fn existing(p: &Path) -> bool {
        ["C:\\Users\\me\\AppData\\Local\\Programs\\Code.exe", "D:\\Téléchargements"].contains(&p.to_str().unwrap())
    }
    fn resolve(sc: Value) -> Option<Target> {
        resolve_shortcut(&sc, &env(), existing)
    }
    fn resolve_all(sc: Value) -> Option<Target> {
        resolve_shortcut(&sc, &env(), |_| true)
    }
    fn path(p: &str) -> Option<Target> {
        Some(Target::Path(p.into()))
    }
    fn url(u: &str) -> Option<Target> {
        Some(Target::Url(u.into()))
    }

    #[test]
    fn appli_premier_chemin_existant_variables_remplacees() {
        let code = "C:\\Users\\me\\AppData\\Local\\Programs\\Code.exe";
        assert_eq!(resolve(json!({ "type": "app", "paths": ["C:\\absent\\x.exe", "%LOCALAPPDATA%\\Programs\\Code.exe"] })), path(code));
        assert_eq!(resolve(json!({ "type": "app", "paths": ["%LocalAppData%\\Programs\\Code.exe"] })), path(code));
    }

    #[test]
    fn appli_refuse_non_exe_relatif_ou_variable_inconnue() {
        assert_eq!(resolve_all(json!({ "type": "app", "paths": ["C:\\script.bat"] })), None);
        assert_eq!(resolve_all(json!({ "type": "app", "paths": ["relatif\\x.exe"] })), None);
        assert_eq!(resolve_all(json!({ "type": "app", "paths": ["%INCONNU%\\x.exe"] })), None);
        assert_eq!(resolve_all(json!({ "type": "app", "paths": "C:\\x.exe" })), None);
    }

    #[test]
    fn adresse_de_secours_en_https_seulement() {
        assert_eq!(resolve(json!({ "type": "app", "paths": ["C:\\absent.exe"], "fallbackUrl": "https://claude.ai" })), url("https://claude.ai"));
        assert_eq!(resolve(json!({ "type": "app", "paths": ["C:\\absent.exe"], "fallbackUrl": "file:///C:/x.exe" })), None);
    }

    #[test]
    fn dossier_fichier_lnk_et_sites() {
        assert_eq!(resolve(json!({ "type": "folder", "paths": ["%DOWNLOADS%"] })), path("D:\\Téléchargements"));
        assert_eq!(resolve_all(json!({ "type": "app", "paths": ["C:\\Menu\\Spotify.lnk"] })), path("C:\\Menu\\Spotify.lnk"));
        assert_eq!(resolve_all(json!({ "type": "file", "paths": ["C:\\Docs\\cv.pdf"] })), path("C:\\Docs\\cv.pdf"));
        assert_eq!(resolve(json!({ "type": "file", "paths": ["C:\\absent.pdf"] })), None);
        assert_eq!(resolve(json!({ "type": "url", "url": "http://exemple.com" })), url("http://exemple.com"));
        assert_eq!(resolve(json!({ "type": "url", "url": "javascript:alert(1)" })), None);
        assert_eq!(resolve(json!({ "type": "url", "url": "file:///C:/Windows/x.exe" })), None);
    }

    #[test]
    fn types_inconnus_rien() {
        assert_eq!(resolve(json!({ "type": "settings" })), None);
        assert_eq!(resolve(Value::Null), None);
        assert_eq!(resolve(json!({ "type": "shell", "command": "del *" })), None);
    }

    #[test]
    fn icone_de_paquet_sans_sortir_du_dossier() {
        let dir = "C:\\Program Files\\WindowsApps\\Claude_1_x64";
        assert_eq!(package_icon_file(dir, "app\\Claude.exe").as_deref(), Some("C:\\Program Files\\WindowsApps\\Claude_1_x64\\app\\Claude.exe"));
        assert_eq!(package_icon_file(dir, "..\\Autre\\x.exe"), None);
        assert_eq!(package_icon_file(dir, "C:\\Windows\\x.exe"), None);
        assert_eq!(package_icon_file("", "x.exe"), None);
    }

    #[test]
    fn nom_de_paquet() {
        assert!(is_package_name("Microsoft.WindowsTerminal"));
        assert!(!is_package_name("x; Remove-Item C:\\"));
        assert!(!is_package_name(""));
    }

    #[test]
    fn nom_de_raccourci_sur_le_bureau() {
        assert_eq!(shortcut_file_name("Visual Studio Code"), "Visual Studio Code");
        assert_eq!(shortcut_file_name("a<b>c:d\"e/f\\g|h?i*j"), "abcdefghij");
        assert_eq!(shortcut_file_name("..\\..\\Windows\\evil"), "Windowsevil");
        assert_eq!(shortcut_file_name("  fin avec points... "), "fin avec points");
        assert_eq!(shortcut_file_name("???"), "Appli");
        assert_eq!(shortcut_file_name("CON"), "Appli");
        assert_eq!(shortcut_file_name(&"x".repeat(200)).len(), 80);
    }
}
