import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchApps } from '../ui/js/search.js';

const apps = [
  { name: 'Calculatrice', id: 'calc' },
  { name: 'Paramètres', id: 'settings' },
  { name: 'Spotify', id: 'spotify' },
  { name: 'Visual Studio Code', id: 'code' },
  { name: 'Outil Capture d\'écran', id: 'snip' },
  { name: 'Microsoft Edge', id: 'edge' },
];
const names = (results) => results.map((r) => r.name);

test('recherche sans accents ni majuscules', () => {
  assert.deepEqual(names(searchApps(apps, 'parametres')), ['Paramètres']);
  assert.deepEqual(names(searchApps(apps, 'ÉCRAN')), ['Outil Capture d\'écran']);
});

test('ordre : début du nom, puis début d\'un mot, puis ailleurs', () => {
  const extra = [...apps, { name: 'Codec Pack', id: 'codec' }, { name: 'Barcode', id: 'barcode' }];
  const results = names(searchApps(extra, 'code'));
  assert.deepEqual(results, ['Codec Pack', 'Visual Studio Code', 'Barcode']);
});

test('recherche vide : rien ; limite du nombre de résultats', () => {
  assert.deepEqual(searchApps(apps, '   '), []);
  assert.equal(searchApps(apps, 'e', 2).length, 2);
});
