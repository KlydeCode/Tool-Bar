const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchApps, parseApps } = require('../lib/search');

const apps = [
  { name: 'Calculatrice', id: 'calc' },
  { name: 'Paramètres', id: 'settings' },
  { name: 'Spotify', id: 'spotify' },
  { name: 'Visual Studio Code', id: 'code' },
  { name: 'Outil Capture d\'écran', id: 'snip' },
  { name: 'Microsoft Edge', id: 'edge' },
];
const names = (results) => results.map((r) => apps[r.index].name);

test('recherche sans accents ni majuscules', () => {
  assert.deepEqual(names(searchApps(apps, 'parametres')), ['Paramètres']);
  assert.deepEqual(names(searchApps(apps, 'ÉCRAN')), ['Outil Capture d\'écran']);
});

test('ordre : début du nom, puis début d\'un mot, puis ailleurs', () => {
  const extra = [...apps, { name: 'Codec Pack', id: 'codec' }, { name: 'Barcode', id: 'barcode' }];
  const results = searchApps(extra, 'code').map((r) => extra[r.index].name);
  assert.deepEqual(results, ['Codec Pack', 'Visual Studio Code', 'Barcode']);
});

test('recherche vide : rien ; limite du nombre de résultats', () => {
  assert.deepEqual(searchApps(apps, '   '), []);
  assert.equal(searchApps(apps, 'e', 2).length, 2);
});

test('liste du script : vérifiée, entrées invalides retirées', () => {
  const line = JSON.stringify([{ name: 'Ok', id: 'a!b' }, { name: '', id: 'x' }, { name: 'Sans id' }, 'texte']);
  assert.deepEqual(parseApps(line), [{ name: 'Ok', id: 'a!b' }]);
  assert.deepEqual(parseApps('pas du json'), []);
  assert.deepEqual(parseApps('{"name":"seul"}'), []);
});
