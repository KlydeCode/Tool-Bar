// Clic droit sur le panneau : quitter (provisoire, tant qu'il n'y a pas de réglages).
document.getElementById('panel').addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.bar.quit();
});

// Horloge : « 23:20 » et « MER. 14 OCT. », mises à jour au changement de minute.
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function renderClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.innerHTML = `${hh}<span class="colon">:</span>${mm}`;
  dateEl.textContent = dateFormat.format(now).toUpperCase();
  setTimeout(renderClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}
renderClock();

// Lecture/pause : visuel seulement pour l'instant (la vraie musique arrive en phase 8).
const music = document.getElementById('music');
const play = document.getElementById('play');
play.addEventListener('click', () => {
  const playing = music.classList.toggle('is-playing');
  play.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
});

// Curseur de volume : remplissage et chiffre (le vrai volume système arrive en phase 7).
const volume = document.getElementById('volume');
const volumeValue = document.getElementById('volume-value');
function renderVolume() {
  volume.style.setProperty('--fill', `${volume.value}%`);
  volumeValue.textContent = volume.value;
}
volume.addEventListener('input', renderVolume);
renderVolume();
