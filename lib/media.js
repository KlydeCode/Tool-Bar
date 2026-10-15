// Musique en cours : lecture de la réponse du script Windows (main.js) et calcul du temps (interface).
// Chargé aussi par src/index.html : pas de require ici.

const MAX_TEXT = 200;

function text(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

function seconds(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Réponse JSON du script → morceau sûr à afficher, ou null s'il n'y a rien.
function parseMedia(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = text(raw.title);
  if (!title) return null;
  return {
    app: text(raw.app),
    title,
    artist: text(raw.artist),
    playing: raw.status === 'Playing',
    position: seconds(raw.position),
    duration: seconds(raw.duration),
    updated: Number.isFinite(raw.updated) ? raw.updated : 0,
    canPrev: raw.canPrev === true,
    canNext: raw.canNext === true,
    hasArt: raw.hasArt === true,
  };
}

// 102 → « 1:42 » ; 3725 → « 1:02:05 ».
function formatTime(total) {
  const s = Math.floor(seconds(total));
  const two = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

// Les applis ne donnent la position que de temps en temps : on la fait avancer entre deux mises à jour.
// null si la durée est inconnue, ou si la position est trop ancienne pour être juste
// (les navigateurs ne la remettent pas toujours à jour).
const STALE_MARGIN = 5; // secondes au-delà de la fin

function currentPosition(media, now) {
  if (!media.duration) return null;
  const elapsed = media.playing ? (now - media.updated) / 1000 : 0;
  const position = media.position + elapsed;
  if (position > media.duration + STALE_MARGIN) return null;
  return Math.min(media.duration, Math.max(0, position));
}

if (typeof module !== 'undefined') module.exports = { parseMedia, formatTime, currentPosition };
