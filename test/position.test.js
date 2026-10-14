const { test } = require('node:test');
const assert = require('node:assert/strict');
const { topCenter } = require('../lib/position');

test('centre la fenêtre en haut de l\'écran', () => {
  assert.deepEqual(topCenter({ x: 0, y: 0, width: 1920, height: 1040 }, 720), { x: 600, y: 0 });
});

test('tient compte d\'une zone de travail décalée (écran à gauche)', () => {
  assert.deepEqual(topCenter({ x: -1920, y: 0, width: 1920, height: 1080 }, 720), { x: -1320, y: 0 });
});

test('arrondit à un pixel entier', () => {
  assert.deepEqual(topCenter({ x: 0, y: 48, width: 1367, height: 720 }, 720), { x: 324, y: 48 });
});
