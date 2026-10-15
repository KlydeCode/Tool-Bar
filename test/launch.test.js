const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPackageName, packageIconFile, resolveShortcut } = require('../lib/launch');

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

test('adresse web : http et https seulement', () => {
  assert.deepEqual(resolveShortcut({ type: 'url', url: 'https://www.google.com' }, ctx), { url: 'https://www.google.com' });
  assert.deepEqual(resolveShortcut({ type: 'url', url: 'http://exemple.com' }, ctx), { url: 'http://exemple.com' });
  assert.equal(resolveShortcut({ type: 'url', url: 'javascript:alert(1)' }, ctx), null);
  assert.equal(resolveShortcut({ type: 'url', url: 'file:///C:/Windows/x.exe' }, ctx), null);
});

test('appli : raccourci .lnk accepté ; fichier : n\'importe quel fichier existant', () => {
  const ctxAll = { env, exists: () => true };
  assert.deepEqual(resolveShortcut({ type: 'app', paths: ['C:\\Menu\\Spotify.lnk'] }, ctxAll), { path: 'C:\\Menu\\Spotify.lnk' });
  assert.deepEqual(resolveShortcut({ type: 'file', paths: ['C:\\Docs\\cv.pdf'] }, ctxAll), { path: 'C:\\Docs\\cv.pdf' });
  assert.equal(resolveShortcut({ type: 'file', paths: ['C:\\absent.pdf'] }, ctx), null);
});

test('icône dans un paquet Windows : fichier relatif, sans sortir du dossier', () => {
  const dir = 'C:\\Program Files\\WindowsApps\\Claude_1_x64';
  assert.equal(packageIconFile(dir, 'app\\Claude.exe'), 'C:\\Program Files\\WindowsApps\\Claude_1_x64\\app\\Claude.exe');
  assert.equal(packageIconFile(dir, '..\\Autre\\x.exe'), null);
  assert.equal(packageIconFile(dir, 'C:\\Windows\\x.exe'), null);
  assert.equal(packageIconFile('', 'x.exe'), null);
  assert.equal(packageIconFile(dir, 42), null);
});

test('nom de paquet : lettres, chiffres et points seulement', () => {
  assert.equal(isPackageName('Microsoft.WindowsTerminal'), true);
  assert.equal(isPackageName('Claude'), true);
  assert.equal(isPackageName('x; Remove-Item C:\\'), false);
  assert.equal(isPackageName(''), false);
  assert.equal(isPackageName(undefined), false);
});

test('types inconnus et entrées vides : rien', () => {
  assert.equal(resolveShortcut({ type: 'settings' }, ctx), null);
  assert.equal(resolveShortcut(null, ctx), null);
  assert.equal(resolveShortcut({ type: 'shell', command: 'del *' }, ctx), null);
});
