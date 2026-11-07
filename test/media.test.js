import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, currentPosition } from '../ui/js/media.js';

// Réponse déjà vérifiée par Rust (media.rs).
const song = {
  app: 'Spotify.exe', title: 'Titre', artist: 'Artiste', playing: true,
  position: 102.4, duration: 208, updated: 1000, canPrev: true, canNext: true, hasArt: true,
};

test('temps affiché m:ss, et h:mm:ss au-delà d\'une heure', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(102.9), '1:42');
  assert.equal(formatTime(208), '3:28');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
});

test('position actuelle : avance avec le temps pendant la lecture, bornée à la durée', () => {
  const media = song;
  assert.equal(currentPosition(media, 1000), 102.4);
  assert.equal(currentPosition(media, 3000), 104.4);
  assert.equal(currentPosition(media, 1000 + 108 * 1000), 208);
  // Position trop ancienne (le navigateur ne l'a pas remise à jour) : inconnue plutôt que fausse.
  assert.equal(currentPosition(media, 1000 + 500 * 1000), null);
  assert.equal(currentPosition({ ...media, playing: false }, 9000), 102.4);
  assert.equal(currentPosition({ ...media, duration: 0 }, 1000), null);
});
