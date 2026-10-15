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
  if (body.classList.contains('is-open') === open) return;
  if (open) refreshBackdrop();
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
pill.addEventListener('mouseleave', () => { if (!body.classList.contains('is-open')) clearTimeout(timer); });
pill.addEventListener('click', () => setOpen(true));
panel.addEventListener('mouseenter', () => clearTimeout(timer));
panel.addEventListener('mouseleave', () => later(false, CLOSE_DELAY));
document.getElementById('collapse').addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
// Alt+Maj+Espace (raccourci global, main.js) et perte du focus.
window.bar.onToggle(() => setOpen(!body.classList.contains('is-open')));
window.bar.onClose(() => setOpen(false));

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
// Sans musique, la pilule n'affiche que l'heure (classe « has-music » posée en phase 8).
// Lecture/pause : visuel seulement pour l'instant.
const play = document.getElementById('play');
play.addEventListener('click', () => {
  const playing = body.classList.toggle('is-playing');
  play.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
});

// ---------- Volume ----------
// Remplissage du curseur et chiffre (le vrai volume système arrive en phase 7).
const volume = document.getElementById('volume');
const volumeValue = document.getElementById('volume-value');
function renderVolume() {
  volume.style.setProperty('--fill', `${volume.value}%`);
  volumeValue.textContent = volume.value;
}
volume.addEventListener('input', renderVolume);
renderVolume();
