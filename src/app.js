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
  body.classList.toggle('is-open', open);
  pill.setAttribute('aria-expanded', String(open));
}

function later(open, delay) {
  clearTimeout(timer);
  timer = setTimeout(() => setOpen(open), delay);
}

pill.addEventListener('mouseenter', () => later(true, OPEN_DELAY));
pill.addEventListener('mouseleave', () => { if (!body.classList.contains('is-open')) clearTimeout(timer); });
pill.addEventListener('click', () => setOpen(true));
panel.addEventListener('mouseenter', () => clearTimeout(timer));
panel.addEventListener('mouseleave', () => later(false, CLOSE_DELAY));
document.getElementById('collapse').addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });

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
  setTimeout(renderClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}
renderClock();

// ---------- Musique ----------
// Lecture/pause : visuel seulement pour l'instant (la vraie musique arrive en phase 8).
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
