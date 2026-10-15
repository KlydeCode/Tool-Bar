const { test } = require('node:test');
const assert = require('node:assert/strict');
const { levelArg, percentFromLevel, micFromAnswer } = require('../lib/audio');

test('pourcentage → argument pour le script (0 à 1, point décimal)', () => {
  assert.equal(levelArg(65), '0.65');
  assert.equal(levelArg(0), '0');
  assert.equal(levelArg(100), '1');
});

test('pourcentage invalide : refusé (jamais deviné)', () => {
  for (const bad of [-1, 101, 12.5, NaN, '50', null, undefined, Infinity]) {
    assert.equal(levelArg(bad), null, String(bad));
  }
});

test('réponse du script → pourcentage arrondi', () => {
  assert.equal(percentFromLevel('0.43'), 43);
  assert.equal(percentFromLevel('0.6499999'), 65);
  assert.equal(percentFromLevel('1'), 100);
  assert.equal(percentFromLevel(''), null);
  assert.equal(percentFromLevel('abc'), null);
  assert.equal(percentFromLevel('1.5'), null);
});

test('réponse micro : 1 coupé, 0 actif, sinon inconnu', () => {
  assert.equal(micFromAnswer('1'), true);
  assert.equal(micFromAnswer('0'), false);
  assert.equal(micFromAnswer(''), null);
});
