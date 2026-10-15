const body = document.body;
const pill = document.getElementById('pill');
const panel = document.getElementById('panel');

// ---------- Pilule ↔ panneau ----------
const OPEN_DELAY = 120; // évite d'ouvrir quand la souris ne fait que passer
const CLOSE_DELAY = 400; // laisse le temps de revenir sur le panneau
let timer = null;

function setOpen(open) {
  clearTimeout(timer);
  if (open) showBar();
  else scheduleHide(HIDE_DELAY);
  if (body.classList.contains('is-open') === open) return;
  if (open) {
    refreshBackdrop();
    refreshAudio();
  }
  body.classList.toggle('is-open', open);
  pill.setAttribute('aria-expanded', String(open));
  // Replié : le fond redevient sombre tout de suite (styles.css), on oublie la capture
  // et on revient à la vue normale si les réglages étaient ouverts.
  if (!open) {
    setTimeout(() => {
      if (body.classList.contains('is-open')) return;
      panel.classList.remove('has-backdrop');
      closeSettings();
    }, 600);
  }
}

// La découpe du panneau replié doit faire exactement la largeur de la pilule.
function syncPillWidth() {
  panel.style.setProperty('--pill-w', `${pill.offsetWidth}px`);
}
document.fonts.ready.then(syncPillWidth);

function later(open, delay) {
  clearTimeout(timer);
  timer = setTimeout(() => setOpen(open), delay);
}

pill.addEventListener('mouseenter', () => { refreshBackdrop(); later(true, OPEN_DELAY); });
pill.addEventListener('mouseleave', () => {
  if (body.classList.contains('is-open')) return;
  clearTimeout(timer);
  scheduleHide(HIDE_DELAY);
});
pill.addEventListener('click', () => setOpen(true));
panel.addEventListener('mouseenter', () => clearTimeout(timer));
// Dans les réglages, la souris peut sortir (fenêtre de choix de fichier…) sans tout refermer.
panel.addEventListener('mouseleave', () => {
  if (!body.classList.contains('is-settings')) later(false, CLOSE_DELAY);
});
document.getElementById('collapse').addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !recordingShortcut) setOpen(false);
});
// Alt+Maj+Espace (raccourci global, main.js) et perte du focus.
window.bar.onToggle(() => setOpen(!body.classList.contains('is-open')));
window.bar.onClose(() => setOpen(false));

// ---------- Auto-masquage (option de la config) ----------
// La barre glisse hors de l'écran ; elle revient quand la souris touche le haut de l'écran
// (dans la largeur de la fenêtre, au centre) ou avec le raccourci clavier.
const HIDE_DELAY = 800; // après la fermeture ou le départ de la souris
const PEEK_DELAY = 1500; // revenue sans être survolée : repart après ce délai
const TOP_EDGE = 2; // pixels en haut de l'écran qui font revenir la barre
let autoHide = false;
let hideTimer = null;

function showBar() {
  clearTimeout(hideTimer);
  body.classList.remove('is-hidden');
}

function scheduleHide(delay) {
  if (!autoHide) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    // Toujours utilisée (ouverte ou survolée) : on réessaie plus tard.
    if (body.classList.contains('is-open') || interactive) scheduleHide(delay);
    else body.classList.add('is-hidden');
  }, delay);
}

document.addEventListener('mousemove', (event) => {
  if (autoHide && body.classList.contains('is-hidden') && event.clientY <= TOP_EDGE) {
    showBar();
    scheduleHide(PEEK_DELAY);
  }
});

// Clics traversants : la fenêtre ne capte la souris que sur la pilule ou le panneau visibles.
// Les mouvements de souris continuent d'arriver (option « forward » côté main.js).
let interactive = false;
document.addEventListener('mousemove', (event) => {
  const over = Boolean(event.target.closest('.pill, .panel'));
  if (over !== interactive) {
    interactive = over;
    window.bar.setInteractive(over);
  }
});

// Flou derrière le panneau : capture de l'écran prise juste avant l'ouverture (barre fermée),
// floutée une fois dans un canvas (le flou CSS « filter » n'est pas appliqué à l'écran
// dans une fenêtre transparente sous Windows).
const backdrop = document.getElementById('backdrop');
const BLUR = 7; // en pixels du canvas, qui fait 1/4 de la fenêtre (agrandi en CSS)
let backdropPending = false;

async function drawBackdrop(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const ctx = backdrop.getContext('2d');
  ctx.clearRect(0, 0, backdrop.width, backdrop.height);
  ctx.filter = `blur(${BLUR}px) saturate(1.3)`;
  // Dessinée un peu plus grande que le canvas pour que le flou ne s'éclaircisse pas sur les bords.
  const m = BLUR * 1.5;
  ctx.drawImage(img, -m, -m, backdrop.width + 2 * m, backdrop.height + 2 * m);
  panel.classList.add('has-backdrop');
}

function refreshBackdrop() {
  if (backdropPending || body.classList.contains('is-open')) return;
  backdropPending = true;
  window.bar.getBackdrop()
    .then((url) => url && drawBackdrop(url))
    .catch((error) => console.error('Flou du fond impossible :', error))
    .finally(() => { backdropPending = false; });
}

// ---------- Raccourcis d'applis ----------
// Les tuiles prennent le nom et la vraie icône de la config (main.js) ; sinon un pictogramme selon le type.
const tiles = [...document.querySelectorAll('.tile')];
const SYMBOLS = {
  app: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  url: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  settings: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
};

function tileIcon(shortcut) {
  if (shortcut.icon) {
    const img = document.createElement('img');
    img.className = 'icon';
    img.src = shortcut.icon;
    img.alt = '';
    return img;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = SYMBOLS[shortcut.type] ?? SYMBOLS.app; // pictogrammes fixes ci-dessus, jamais du texte de la config
  return svg;
}

async function refreshTiles() {
  const shortcuts = await window.bar.getShortcuts();
  tiles.forEach((tile, index) => {
    const shortcut = shortcuts[index];
    tile.hidden = !shortcut;
    if (!shortcut) return;
    tile.dataset.type = shortcut.type;
    tile.querySelector('.name').textContent = shortcut.name;
    tile.querySelector('.icon').replaceWith(tileIcon(shortcut));
  });
  document.getElementById('tile-count').textContent = String(shortcuts.length).padStart(2, '0');
}

tiles.forEach((tile, index) => {
  tile.addEventListener('click', async () => {
    if (tile.dataset.type === 'settings') openSettings();
    else if (await window.bar.launch(index)) setOpen(false);
  });
});

refreshTiles();

// ---------- Réglages ----------
// Chaque changement est envoyé à main.js, qui vérifie, enregistre et renvoie les réglages retenus.
const KEY_NAMES = { Control: 'Ctrl', Shift: 'Maj', Super: 'Win', Space: 'Espace' };
const TYPE_NAMES = { app: 'Appli', folder: 'Dossier', url: 'Site web' };
const SAVE_DELAY = 250; // ms : regroupe les changements rapides (curseur, couleur)
const setC1 = document.getElementById('set-c1');
const setC2 = document.getElementById('set-c2');
const setTransparency = document.getElementById('set-transparency');
const setTransparencyValue = document.getElementById('set-transparency-value');
const setAutoHide = document.getElementById('set-autohide');
const setShortcut = document.getElementById('set-shortcut');
const setTiles = document.getElementById('set-tiles');
const settingsStatus = document.getElementById('settings-status');
let settings = null;
let saveTimer = null;
let recordingShortcut = false;

// Couleurs, transparence et auto-masquage appliqués à toute la barre.
function applyLook() {
  const root = document.documentElement.style;
  root.setProperty('--c1', settings.c1);
  root.setProperty('--c2', settings.c2);
  root.setProperty('--open-transparency', String(settings.transparency / 100));
  autoHide = settings.autoHide;
  if (!autoHide) showBar();
  else if (!body.classList.contains('is-open')) scheduleHide(HIDE_DELAY);
}

function shortcutLabel(accelerator) {
  return accelerator.split('+').map((k) => KEY_NAMES[k] ?? k).join(' + ');
}

function setStatus(text, isError = false) {
  settingsStatus.textContent = text;
  settingsStatus.classList.toggle('is-error', isError);
}

function fileName(fullPath) {
  return fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// Ligne d'une tuile : nom, type (appli, dossier, site web) et cible.
function tileRow(tile, index) {
  const row = document.createElement('div');
  row.className = 'tile-row';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(index + 1).padStart(2, '0');

  const name = document.createElement('input');
  name.className = 'field';
  name.maxLength = 40;
  name.value = tile.name;
  name.setAttribute('aria-label', `Nom de la tuile ${index + 1}`);
  name.addEventListener('change', () => {
    tile.name = name.value.trim() || 'Raccourci';
    save();
  });

  const type = document.createElement('select');
  type.className = 'field';
  type.setAttribute('aria-label', `Type de la tuile ${index + 1}`);
  for (const [value, label] of Object.entries(TYPE_NAMES)) type.add(new Option(label, value, false, value === tile.type));
  type.addEventListener('change', async () => {
    if (type.value === 'url') {
      // Le site n'est enregistré qu'une fois l'adresse saisie (sinon la tuile serait refusée).
      row.replaceChild(urlInput(index, tile.name, ''), row.lastChild);
      return;
    }
    const picked = await window.bar.pickTarget(type.value);
    if (!picked) {
      type.value = tile.type;
      return;
    }
    replaceTile(index, { name: tile.name, type: type.value, paths: [picked] });
  });

  row.append(num, name, type, tile.type === 'url' ? urlInput(index, tile.name, tile.url) : pickButton(tile, index));
  return row;
}

function pickButton(tile, index) {
  const button = document.createElement('button');
  button.className = 'field target';
  button.textContent = tile.paths[0].includes('%') ? 'Par défaut' : fileName(tile.paths[0]);
  button.title = tile.paths[0];
  button.addEventListener('click', async () => {
    const picked = await window.bar.pickTarget(tile.type);
    if (picked) replaceTile(index, { name: tile.name, type: tile.type, paths: [picked] });
  });
  return button;
}

function urlInput(index, name, value) {
  const input = document.createElement('input');
  input.className = 'field target';
  input.type = 'url';
  input.placeholder = 'https://…';
  input.value = value;
  input.setAttribute('aria-label', `Adresse du site de la tuile ${index + 1}`);
  input.addEventListener('change', () => {
    const url = input.value.trim();
    const ok = isHttps(url);
    input.classList.toggle('is-invalid', !ok);
    if (ok) replaceTile(index, { name, type: 'url', url });
    else setStatus('Adresse refusée : elle doit commencer par https://', true);
  });
  return input;
}

function replaceTile(index, tile) {
  settings.shortcuts[index] = tile;
  renderSettings();
  save();
}

function renderTransparency() {
  setTransparency.value = settings.transparency;
  setTransparency.style.setProperty('--fill', `${(settings.transparency / 70) * 100}%`);
  setTransparencyValue.textContent = `${settings.transparency} %`;
}

function renderSettings() {
  setC1.value = settings.c1;
  setC2.value = settings.c2;
  renderTransparency();
  setAutoHide.checked = settings.autoHide;
  setShortcut.textContent = shortcutLabel(settings.toggleShortcut);
  setTiles.replaceChildren(...settings.shortcuts
    .filter((tile) => tile.type !== 'settings')
    .map((tile, index) => tileRow(tile, index)));
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const result = await window.bar.saveSettings(settings);
    settings = result.settings;
    applyLook();
    if (result.ok) setStatus('Enregistré.');
    else {
      setStatus(result.error, true);
      renderSettings();
    }
    refreshTiles();
  }, SAVE_DELAY);
}

function openSettings() {
  renderSettings();
  setStatus('');
  body.classList.add('is-settings');
}

function closeSettings() {
  stopRecording();
  body.classList.remove('is-settings');
}

setC1.addEventListener('input', () => { settings.c1 = setC1.value; applyLook(); save(); });
setC2.addEventListener('input', () => { settings.c2 = setC2.value; applyLook(); save(); });
setTransparency.addEventListener('input', () => {
  settings.transparency = Number(setTransparency.value);
  renderTransparency();
  applyLook();
  save();
});
setAutoHide.addEventListener('change', () => { settings.autoHide = setAutoHide.checked; save(); });

// Raccourci clavier : on clique, puis on appuie sur la combinaison voulue (Échap pour annuler).
setShortcut.addEventListener('click', () => {
  recordingShortcut = true;
  setShortcut.classList.add('is-recording');
  setShortcut.textContent = 'Appuie sur les touches…';
});

function stopRecording() {
  if (!recordingShortcut) return;
  recordingShortcut = false;
  setShortcut.classList.remove('is-recording');
  setShortcut.textContent = shortcutLabel(settings.toggleShortcut);
}

document.addEventListener('keydown', (event) => {
  if (!recordingShortcut) return;
  event.preventDefault();
  if (event.key === 'Escape') return stopRecording();
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return; // on attend la touche principale
  let key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key === ' ') key = 'Space';
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space)$/.test(key) || !(event.ctrlKey || event.altKey || event.metaKey)) {
    setStatus('Il faut Ctrl, Alt ou Win, puis une lettre, un chiffre, F1 à F12 ou Espace.', true);
    return;
  }
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
  settings.toggleShortcut = [...mods, key].join('+');
  stopRecording();
  save();
});

document.getElementById('settings-back').addEventListener('click', closeSettings);
document.getElementById('settings-quit').addEventListener('click', () => window.bar.quit());
document.getElementById('settings-reset').addEventListener('click', async () => {
  const result = await window.bar.resetSettings();
  settings = result.settings;
  applyLook();
  renderSettings();
  refreshTiles();
  setStatus(result.ok ? 'Réglages par défaut remis.' : result.error, !result.ok);
});

window.bar.getSettings().then((loaded) => {
  settings = loaded;
  applyLook();
  if (autoHide && !body.classList.contains('is-open')) body.classList.add('is-hidden');
});

// ---------- Horloge ----------
// « 23:20 » et « MER. 14 OCT. », mises à jour au changement de minute.
const timeEl = document.getElementById('time');
const pillTimeEl = document.getElementById('pill-time');
const dateEl = document.getElementById('date');
const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function renderClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.innerHTML = `${hh}<span class="colon">:</span>${mm}`;
  pillTimeEl.textContent = `${hh}:${mm}`;
  dateEl.textContent = dateFormat.format(now).toUpperCase();
  syncPillWidth();
  setTimeout(renderClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}
renderClock();

// ---------- Musique ----------
// Morceau en cours (Spotify, Deezer, Apple Music, YouTube dans un navigateur…), relu chaque seconde.
// Sans musique, la pilule n'affiche que l'heure.
const MEDIA_POLL = 1000;
const play = document.getElementById('play');
const prev = document.getElementById('prev');
const next = document.getElementById('next');
const cover = document.getElementById('cover');
const coverArt = document.getElementById('cover-art');
const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const pillTitle = document.getElementById('pill-title');
const progressFill = document.getElementById('progress-fill');
const timePos = document.getElementById('time-pos');
const timeTotal = document.getElementById('time-total');
let media = null;
let artFor = ''; // morceau dont la pochette est affichée
let artPending = false;

// Nom lisible de l'appli quand il n'y a pas d'artiste (« Spotify.exe » → « Spotify »).
function appName(id) {
  return id.split(/[\\!]/).pop().replace(/\.exe$/i, '');
}

function renderTimeline() {
  const position = media && currentPosition(media, Date.now());
  body.classList.toggle('no-timeline', position === null || !media);
  if (position === null || !media) return;
  progressFill.style.width = `${(position / media.duration) * 100}%`;
  timePos.textContent = formatTime(position);
  timeTotal.textContent = formatTime(media.duration);
}

function showArt(url) {
  coverArt.onload = () => {
    // Miniature de vidéo (plus large que haute) : case élargie au format 16:9.
    cover.classList.toggle('is-wide', coverArt.naturalWidth > coverArt.naturalHeight * 1.2);
    cover.classList.add('has-art');
  };
  coverArt.src = url;
}

function clearArt() {
  artFor = '';
  cover.classList.remove('has-art', 'is-wide');
  coverArt.removeAttribute('src');
}

async function loadArt(key) {
  if (artPending) return;
  artPending = true;
  try {
    const url = await window.bar.getMediaArt();
    if (url && media && key === trackKey(media)) {
      artFor = key;
      showArt(url);
    }
  } finally {
    artPending = false;
  }
}

function trackKey(m) {
  return `${m.app}|${m.title}|${m.artist}`;
}

function renderMedia() {
  body.classList.toggle('has-music', Boolean(media));
  body.classList.toggle('is-playing', Boolean(media?.playing));
  play.setAttribute('aria-label', media?.playing ? 'Pause' : 'Lecture');
  play.disabled = !media;
  prev.disabled = !media?.canPrev;
  next.disabled = !media?.canNext;
  if (!media) {
    trackTitle.textContent = 'Aucune musique';
    trackArtist.textContent = 'Rien en cours de lecture';
    pillTitle.textContent = '';
    clearArt();
  } else {
    const artist = media.artist || appName(media.app);
    trackTitle.textContent = media.title;
    trackArtist.textContent = artist;
    pillTitle.textContent = `${media.title} · ${artist}`;
    const key = trackKey(media);
    if (artFor !== key) {
      if (artFor) clearArt();
      // Les navigateurs donnent parfois la miniature un peu après le titre : on réessaie à chaque relecture.
      if (media.hasArt) loadArt(key);
    }
  }
  renderTimeline();
  if (!body.classList.contains('is-open')) syncPillWidth();
}

async function refreshMedia() {
  media = await window.bar.getMedia();
  renderMedia();
}

async function control(action) {
  if (await window.bar.mediaControl(action)) setTimeout(refreshMedia, 300);
}

play.addEventListener('click', () => control('play'));
prev.addEventListener('click', () => control('prev'));
next.addEventListener('click', () => control('next'));

refreshMedia();
setInterval(refreshMedia, MEDIA_POLL);

// ---------- Volume et micro ----------
// Vrai volume du système et vrai micro (via main.js). Relus à chaque ouverture du panneau,
// car ils peuvent changer ailleurs (touches du clavier, réglages Windows).
const volume = document.getElementById('volume');
const volumeValue = document.getElementById('volume-value');
const mic = document.getElementById('mic');
const VOLUME_THROTTLE = 60; // ms entre deux envois pendant qu'on fait glisser le curseur
let volumeTimer = null;
let micMuted = false;

function renderVolume() {
  volume.style.setProperty('--fill', `${volume.value}%`);
  volumeValue.textContent = volume.value;
}

function renderMic() {
  mic.classList.toggle('is-muted', micMuted);
  mic.setAttribute('aria-pressed', String(micMuted));
  mic.setAttribute('aria-label', micMuted ? 'Rétablir le micro' : 'Couper le micro');
}

async function refreshAudio() {
  const audio = await window.bar.getAudio();
  if (audio.volume !== null) {
    volume.value = audio.volume;
    renderVolume();
  }
  if (audio.micMuted !== null) {
    micMuted = audio.micMuted;
    renderMic();
  }
}

volume.addEventListener('input', () => {
  renderVolume();
  // Un envoi toutes les 60 ms au plus ; la dernière position part toujours.
  if (volumeTimer) return;
  volumeTimer = setTimeout(() => {
    volumeTimer = null;
    window.bar.setVolume(Number(volume.value));
  }, VOLUME_THROTTLE);
});

mic.addEventListener('click', async () => {
  if (await window.bar.setMicMuted(!micMuted)) {
    micMuted = !micMuted;
    renderMic();
  }
});

renderVolume();
refreshAudio();
