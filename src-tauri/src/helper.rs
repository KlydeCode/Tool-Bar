// Script Windows (windows.ps1) : lancé une fois et resté ouvert, il fait la capture du fond, le volume,
// le micro, la musique, la liste des applis et leurs icônes. Chaque demande porte un numéro que la réponse
// reprend : une réponse arrivée trop tard ne peut pas être prise pour celle de la demande suivante.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const SCRIPT: &str = include_str!("../windows.ps1");
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
// Large : au démarrage, le script met une ou deux secondes à se préparer.
const TIMEOUT: Duration = Duration::from_secs(4);

struct Process {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

pub struct Helper {
    script: PathBuf,
    process: Mutex<Option<Process>>,
    next_id: AtomicU64,
}

// Texte passé au script : encodé en base64 (« - » si vide), jamais interprété comme commande.
pub fn arg(text: &str) -> String {
    if text.is_empty() { "-".into() } else { STANDARD.encode(text) }
}

impl Helper {
    // Le script est écrit dans « dir » (dossier de l'appli) : il est inclus dans l'exécutable.
    pub fn new(dir: PathBuf) -> Self {
        Helper { script: dir.join("windows.ps1"), process: Mutex::new(None), next_id: AtomicU64::new(1) }
    }

    fn start(&self) -> Option<Process> {
        std::fs::create_dir_all(self.script.parent()?).ok()?;
        std::fs::write(&self.script, SCRIPT).ok()?;
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&self.script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| eprintln!("Script Windows impossible à lancer : {error}"))
            .ok()?;
        let stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Some(Process { child, stdin, lines })
    }

    // Prépare le script tout de suite (prêt avant le premier survol).
    pub fn warm_up(&self) {
        self.ask("volume");
    }

    // Envoie une demande ; réponse '' en cas d'erreur ou sans réponse à temps.
    // Une demande à la fois : le script les traite de toute façon l'une après l'autre.
    pub fn ask(&self, request: &str) -> String {
        let mut guard = self.process.lock().unwrap_or_else(|e| e.into_inner());
        let alive = guard.as_mut().is_some_and(|p| matches!(p.child.try_wait(), Ok(None)));
        if !alive {
            *guard = self.start();
        }
        let Some(process) = guard.as_mut() else { return String::new() };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if writeln!(process.stdin, "{id} {request}").and_then(|_| process.stdin.flush()).is_err() {
            *guard = None;
            return String::new();
        }
        let prefix = format!("{id} ");
        let deadline = Instant::now() + TIMEOUT;
        loop {
            match process.lines.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(line) => {
                    if let Some(answer) = line.strip_prefix(&prefix) {
                        return answer.to_string();
                    }
                    // Réponse d'une demande déjà abandonnée : ignorée.
                }
                Err(RecvTimeoutError::Timeout) => return String::new(),
                Err(RecvTimeoutError::Disconnected) => {
                    *guard = None;
                    return String::new();
                }
            }
        }
    }

    pub fn stop(&self) {
        if let Some(mut process) = self.process.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = process.child.kill();
        }
    }
}
