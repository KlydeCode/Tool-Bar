const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMedia, formatTime, currentPosition } = require('../lib/media');

const line = JSON.stringify({
  app: 'Spotify.exe', title: 'Titre', artist: 'Artiste', status: 'Playing',
  position: 102.4, duration: 208, updated: 1000, canPrev: true, canNext: true, hasArt: true,
});

test('réponse du script → morceau', () => {
  assert.deepEqual(parseMedia(line), {
    app: 'Spotify.exe', title: 'Titre', artist: 'Artiste', playing: true,
    position: 102.4, duration: 208, updated: 1000, canPrev: true, canNext: true, hasArt: true,
  });
});

test('rien en cours, réponse vide ou abîmée : null', () => {
  assert.equal(parseMedia('{}'), null);
  assert.equal(parseMedia(''), null);
  assert.equal(parseMedia('{pas du json'), null);
  assert.equal(parseMedia('[1,2]'), null);
  assert.equal(parseMedia(JSON.stringify({ title: '' })), null);
});

test('valeurs bizarres : remises à des valeurs sûres', () => {
  const media = parseMedia(JSON.stringify({ title: 'x'.repeat(500), artist: 42, status: 'Paused', position: 'abc', duration: -5, canNext: 'oui' }));
  assert.equal(media.title.length, 200);
  assert.equal(media.artist, '');
  assert.equal(media.playing, false);
  assert.equal(media.position, 0);
  assert.equal(media.duration, 0);
  assert.equal(media.canNext, false);
});

test('temps affiché m:ss, et h:mm:ss au-delà d\'une heure', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(102.9), '1:42');
  assert.equal(formatTime(208), '3:28');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
});

test('position actuelle : avance avec le temps pendant la lecture, bornée à la durée', () => {
  const media = parseMedia(line);
  assert.equal(currentPosition(media, 1000), 102.4);
  assert.equal(currentPosition(media, 3000), 104.4);
  assert.equal(currentPosition(media, 1000 + 108 * 1000), 208);
  // Position trop ancienne (le navigateur ne l'a pas remise à jour) : inconnue plutôt que fausse.
  assert.equal(currentPosition(media, 1000 + 500 * 1000), null);
  assert.equal(currentPosition({ ...media, playing: false }, 9000), 102.4);
  assert.equal(currentPosition({ ...media, duration: 0 }, 1000), null);
});
