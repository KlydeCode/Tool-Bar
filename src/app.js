const body = document.body;
const pill = document.getElementById('pill');
const panel = document.getElementById('panel');

// Clic droit sur la barre : quitter (provisoire, tant qu'il n'y a pas de réglages).
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (event.target.closest('.pill, .panel')) window.bar.quit();
});

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
  // Replié : le fond redevient sombre tout de suite (styles.css) et on oublie la capture.
  if (!open) setTimeout(() => body.classList.contains('is-open') || panel.classList.remove('has-backdrop'), 600);
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
panel.addEventListener('mouseleave', () => later(false, CLOSE_DELAY));
document.getElementById('collapse').addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
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

window.bar.getSettings().then((settings) => {
  autoHide = settings.autoHide;
  if (autoHide && !body.classList.contains('is-open')) body.classList.add('is-hidden');
});

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
// Les tuiles prennent le nom et la vraie icône de la config (main.js) ; le pictogramme reste si pas d'icône.
const tiles = [...document.querySelectorAll('.tile')];

window.bar.getShortcuts().then((shortcuts) => {
  tiles.forEach((tile, index) => {
    const shortcut = shortcuts[index];
    tile.hidden = !shortcut;
    if (!shortcut) return;
    tile.dataset.type = shortcut.type;
    tile.querySelector('.name').textContent = shortcut.name;
    if (shortcut.icon) {
      const img = document.createElement('img');
      img.className = 'icon';
      img.src = shortcut.icon;
      img.alt = '';
      tile.querySelector('.icon').replaceWith(img);
    }
  });
  document.getElementById('tile-count').textContent = String(shortcuts.length).padStart(2, '0');
});

tiles.forEach((tile, index) => {
  tile.addEventListener('click', async () => {
    if (tile.dataset.type === 'settings') return; // panneau de réglages en phase 9
    if (await window.bar.launch(index)) setOpen(false);
  });
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
