// Musique en cours : calcul du temps affiché. (La réponse de Windows est vérifiée côté Rust, media.rs.)

export interface Media {
  app: string;
  title: string;
  artist: string;
  playing: boolean;
  position: number; // secondes
  duration: number; // secondes, 0 si inconnue
  updated: number; // ms depuis 1970 : moment où Windows a donné la position
  canPrev: boolean;
  canNext: boolean;
  hasArt: boolean;
}

function seconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// 102 → « 1:42 » ; 3725 → « 1:02:05 ».
export function formatTime(total: number): string {
  const s = Math.floor(seconds(total));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

// Les applis ne donnent la position que de temps en temps : on la fait avancer entre deux mises à jour.
// null si la durée est inconnue, ou si la position est trop ancienne pour être juste
// (les navigateurs ne la remettent pas toujours à jour).
const STALE_MARGIN = 5; // secondes au-delà de la fin

export function currentPosition(media: Media, now: number): number | null {
  if (!media.duration) return null;
  const elapsed = media.playing ? (now - media.updated) / 1000 : 0;
  const position = media.position + elapsed;
  if (position > media.duration + STALE_MARGIN) return null;
  return Math.min(media.duration, Math.max(0, position));
}
