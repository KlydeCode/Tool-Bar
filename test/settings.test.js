const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanSettings, isAccelerator } = require('../lib/settings');
const { saveConfig, loadConfig } = require('../lib/config');

const defaults = {
  c1: '#8ab4ff',
  c2: '#ffb86b',
  transparency: 30,
  autoHide: false,
  toggleShortcut: 'Alt+Shift+Space',
  shortcuts: [
    { name: 'VS Code', type: 'app', paths: ['%LOCALAPPDATA%\\Code.exe'] },
    { name: 'Site', type: 'url', url: 'https://www.google.com' },
    { name: 'Réglages', type: 'settings' },
  ],
};

test('réglages valides : gardés (couleurs en minuscules)', () => {
  const clean = cleanSettings({ ...defaults, c1: '#AABBCC', transparency: 0, autoHide: true, toggleShortcut: 'Control+Alt+B' }, defaults);
  assert.equal(clean.c1, '#aabbcc');
  assert.equal(clean.transparency, 0);
  assert.equal(clean.autoHide, true);
  assert.equal(clean.toggleShortcut, 'Control+Alt+B');
});

test('réglages invalides : valeur par défaut, champ par champ', () => {
  const clean = cleanSettings({ c1: 'red', c2: '#12345', transparency: 71, autoHide: 'oui', toggleShortcut: 'A' }, defaults);
  assert.equal(clean.c1, defaults.c1);
  assert.equal(clean.c2, defaults.c2);
  assert.equal(clean.transparency, defaults.transparency);
  assert.equal(clean.autoHide, false);
  assert.equal(clean.toggleShortcut, defaults.toggleShortcut);
  assert.deepEqual(cleanSettings(null, defaults), defaults);
  assert.equal(cleanSettings({ transparency: 12.5 }, defaults).transparency, defaults.transparency);
});

test('raccourci clavier : au moins Ctrl, Alt ou Win, puis une touche', () => {
  for (const ok of ['Alt+Shift+Space', 'Control+Alt+B', 'Super+Alt+1', 'Control+F12']) assert.equal(isAccelerator(ok), true, ok);
  for (const bad of ['Space', 'Shift+A', 'Control+', 'Control+Alt', 'Control+Alt+Delete', 'Control+Alt+B; rm', 42, '']) {
    assert.equal(isAccelerator(bad), false, String(bad));
  }
});

test('tuiles : 18 au plus, la tuile Réglages toujours présente une seule fois', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `T${i}`, type: 'url', url: 'https://exemple.fr' }));
  const clean = cleanSettings({ shortcuts: many }, defaults);
  assert.equal(clean.shortcuts.length, 18);
  assert.equal(clean.shortcuts.filter((t) => t.type === 'settings').length, 1);
  assert.deepEqual(clean.shortcuts[17], { name: 'Réglages', type: 'settings' });
});

test('tuiles : l\'ordre choisi est gardé, Réglages compris ; doublons de Réglages retirés', () => {
  const clean = cleanSettings({
    shortcuts: [
      { name: 'Réglages', type: 'settings' },
      { name: 'B', type: 'url', url: 'https://b.fr' },
      { name: 'Réglages', type: 'settings' },
      { name: 'A', type: 'url', url: 'http://a.fr' },
    ],
  }, defaults);
  assert.deepEqual(clean.shortcuts.map((t) => t.name), ['Réglages', 'B', 'A']);
});

test('tuiles : fichier, dossier, appli du menu Démarrer', () => {
  const clean = cleanSettings({
    shortcuts: [
      { name: 'Doc', type: 'file', paths: ['C:\\Docs\\cv.pdf'] },
      { name: 'Spotify', type: 'startapp', appId: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
      { name: 'Vide', type: 'startapp', appId: '' },
      { name: 'Bizarre', type: 'startapp', appId: 'a\u0007b' },
    ],
  }, defaults);
  assert.deepEqual(clean.shortcuts.slice(0, 2), [
    { name: 'Doc', type: 'file', paths: ['C:\\Docs\\cv.pdf'] },
    { name: 'Spotify', type: 'startapp', appId: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
  ]);
  assert.equal(clean.shortcuts.length, 3);
});

test('tuiles invalides : retirées ; noms trop longs coupés', () => {
  const clean = cleanSettings({
    shortcuts: [
      { name: 'Ok', type: 'app', paths: ['C:\\Apps\\x.exe'] },
      { name: 'Mauvais lien', type: 'url', url: 'javascript:alert(1)' },
      { name: 'Commande', type: 'shell', command: 'del *' },
      { name: 'Chemin bizarre', type: 'app', paths: ['C:\\a\u0000.exe'] },
      { name: 'x'.repeat(80), type: 'folder', paths: ['D:\\Musique'] },
      { name: 'Réglages', type: 'settings' },
    ],
  }, defaults);
  assert.deepEqual(clean.shortcuts.map((s) => s.name), ['Ok', 'x'.repeat(40), 'Réglages']);
  const noSettings = cleanSettings({ shortcuts: [{ name: 'Ok', type: 'app', paths: ['C:\\Apps\\x.exe'] }] }, defaults);
  assert.deepEqual(noSettings.shortcuts.map((s) => s.type), ['app', 'settings']);
});

test('tuile sans nom : nom par défaut ; champs inconnus ignorés', () => {
  const clean = cleanSettings({ shortcuts: [{ name: '  ', type: 'url', url: 'https://a.fr', evil: 1 }] }, defaults);
  assert.deepEqual(clean.shortcuts[0], { name: 'Raccourci', type: 'url', url: 'https://a.fr' });
});

test('tuile par défaut : icône de paquet et adresse de secours gardées', () => {
  const tile = { name: 'Claude', type: 'app', paths: ['C:\\x.exe'], fallbackUrl: 'https://claude.ai', icon: { package: 'Claude', file: 'app\\Claude.exe' } };
  assert.deepEqual(cleanSettings({ shortcuts: [tile] }, defaults).shortcuts[0], tile);
});

test('enregistrement puis relecture : identique, sans fichier temporaire restant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barre-'));
  const file = path.join(dir, 'sous-dossier', 'config.json');
  saveConfig(file, defaults);
  assert.deepEqual(loadConfig(file, {}), defaults);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['config.json']);
});
