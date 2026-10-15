const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveShortcut } = require('../lib/launch');

const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', DOWNLOADS: 'D:\\Téléchargements' };
const existing = new Set(['C:\\Users\\me\\AppData\\Local\\Programs\\Code.exe', 'D:\\Téléchargements']);
const ctx = { env, exists: (p) => existing.has(p) };

test('appli : premier chemin existant, variables remplacées', () => {
  const sc = { type: 'app', paths: ['C:\\absent\\x.exe', '%LOCALAPPDATA%\\Programs\\Code.exe'] };
  assert.deepEqual(resolveShortcut(sc, ctx), { path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Code.exe' });
});

test('variable d\'environnement insensible à la casse', () => {
  const sc = { type: 'app', paths: ['%LocalAppData%\\Programs\\Code.exe'] };
  assert.deepEqual(resolveShortcut(sc, ctx), { path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Code.exe' });
});

test('appli : refuse ce qui n\'est pas un .exe absolu, ou une variable inconnue', () => {
  const ctxAll = { env, exists: () => true };
  assert.equal(resolveShortcut({ type: 'app', paths: ['C:\\script.bat'] }, ctxAll), null);
  assert.equal(resolveShortcut({ type: 'app', paths: ['relatif\\x.exe'] }, ctxAll), null);
  assert.equal(resolveShortcut({ type: 'app', paths: ['%INCONNU%\\x.exe'] }, ctxAll), null);
  assert.equal(resolveShortcut({ type: 'app', paths: 'C:\\x.exe' }, ctxAll), null);
});

test('appli introuvable : adresse de secours en https seulement', () => {
  assert.deepEqual(resolveShortcut({ type: 'app', paths: ['C:\\absent.exe'], fallbackUrl: 'https://claude.ai' }, ctx), { url: 'https://claude.ai' });
  assert.equal(resolveShortcut({ type: 'app', paths: ['C:\\absent.exe'], fallbackUrl: 'file:///C:/x.exe' }, ctx), null);
});

test('dossier : chemin existant', () => {
  assert.deepEqual(resolveShortcut({ type: 'folder', paths: ['%DOWNLOADS%'] }, ctx), { path: 'D:\\Téléchargements' });
});

test('adresse web : https seulement', () => {
  assert.deepEqual(resolveShortcut({ type: 'url', url: 'https://www.google.com' }, ctx), { url: 'https://www.google.com' });
  assert.equal(resolveShortcut({ type: 'url', url: 'javascript:alert(1)' }, ctx), null);
  assert.equal(resolveShortcut({ type: 'url', url: 'http://exemple.com' }, ctx), null);
});

test('types inconnus et entrées vides : rien', () => {
  assert.equal(resolveShortcut({ type: 'settings' }, ctx), null);
  assert.equal(resolveShortcut(null, ctx), null);
  assert.equal(resolveShortcut({ type: 'shell', command: 'del *' }, ctx), null);
});
