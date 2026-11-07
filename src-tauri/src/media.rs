// Musique en cours : réponse JSON du script Windows → morceau sûr à afficher (voir ui/ts/media.ts).
use serde_json::{json, Value};

const MAX_TEXT: usize = 200;

fn text(value: &Value) -> String {
    value.as_str().unwrap_or("").chars().take(MAX_TEXT).collect()
}

fn seconds(value: &Value) -> f64 {
    value.as_f64().filter(|s| s.is_finite() && *s > 0.0).unwrap_or(0.0)
}

// None s'il n'y a rien (ou une réponse abîmée).
pub fn parse_media(line: &str) -> Option<Value> {
    let raw: Value = serde_json::from_str(line).ok()?;
    raw.as_object()?;
    let title = text(&raw["title"]);
    if title.is_empty() {
        return None;
    }
    Some(json!({
        "app": text(&raw["app"]),
        "title": title,
        "artist": text(&raw["artist"]),
        "playing": raw["status"] == "Playing",
        "position": seconds(&raw["position"]),
        "duration": seconds(&raw["duration"]),
        "updated": raw["updated"].as_f64().filter(|u| u.is_finite()).unwrap_or(0.0),
        "canPrev": raw["canPrev"] == true,
        "canNext": raw["canNext"] == true,
        "hasArt": raw["hasArt"] == true,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reponse_du_script_vers_morceau() {
        let line = r#"{"app":"Spotify.exe","title":"Titre","artist":"Artiste","status":"Playing","position":102.4,"duration":208,"updated":1000,"canPrev":true,"canNext":true,"hasArt":true}"#;
        let media = parse_media(line).unwrap();
        assert_eq!(media["playing"], true);
        assert_eq!(media["position"], 102.4);
        assert_eq!(media["duration"], 208.0);
        assert_eq!(media["canNext"], true);
    }

    #[test]
    fn rien_ou_abime_none() {
        for line in ["{}", "", "{pas du json", "[1,2]", r#"{"title":""}"#] {
            assert_eq!(parse_media(line), None, "{line}");
        }
    }

    #[test]
    fn valeurs_bizarres_remises_a_des_valeurs_sures() {
        let line = format!(r#"{{"title":"{}","artist":42,"status":"Paused","position":"abc","duration":-5,"canNext":"oui"}}"#, "x".repeat(500));
        let media = parse_media(&line).unwrap();
        assert_eq!(media["title"].as_str().unwrap().len(), 200);
        assert_eq!(media["artist"], "");
        assert_eq!(media["playing"], false);
        assert_eq!(media["position"], 0.0);
        assert_eq!(media["duration"], 0.0);
        assert_eq!(media["canNext"], false);
    }
}
