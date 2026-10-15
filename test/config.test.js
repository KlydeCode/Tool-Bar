const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/config');

const defaults = { shortcuts: [{ name: 'A', type: 'url', url: 'https://a.test' }], other: 1 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'barre-'));

test('sans fichier utilisateur : valeurs par défaut', () => {
  assert.deepEqual(loadConfig(path.join(tmp(), 'absent.json'), defaults), defaults);
});

test('le fichier utilisateur remplace les valeurs qu\'il contient', () => {
  const file = path.join(tmp(), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ shortcuts: [{ name: 'B', type: 'url', url: 'https://b.test' }] }));
  const config = loadConfig(file, defaults);
  assert.equal(config.shortcuts[0].name, 'B');
  assert.equal(config.other, 1);
});

test('fichier abîmé ou raccourcis invalides : on garde les défauts', () => {
  const dir = tmp();
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ pas du json');
  assert.deepEqual(loadConfig(broken, defaults), defaults);
  const wrong = path.join(dir, 'wrong.json');
  fs.writeFileSync(wrong, JSON.stringify({ shortcuts: 'nope' }));
  assert.deepEqual(loadConfig(wrong, defaults).shortcuts, defaults.shortcuts);
  const array = path.join(dir, 'array.json');
  fs.writeFileSync(array, '[1, 2]');
  assert.deepEqual(loadConfig(array, defaults), defaults);
});
