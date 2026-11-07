import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FONTS, THEMES } from '../ui/js/themes.js';

const defaults = JSON.parse(readFileSync(new URL('../config.default.json', import.meta.url), 'utf8'));

const COLOR_KEYS = ['bg', 'surface', 'c1', 'c2'];

// Luminance relative (WCAG) pour vérifier que le texte clair reste lisible sur le fond.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('chaque thème : 4 couleurs, au format accepté par les réglages (#rrggbb en minuscules)', () => {
  for (const theme of THEMES) {
    const colors = Object.keys(theme).filter((k) => !['id', 'name'].includes(k));
    assert.deepEqual(colors, COLOR_KEYS, theme.id);
    for (const key of COLOR_KEYS) assert.match(theme[key], /^#[0-9a-f]{6}$/, `${theme.id}.${key}`);
  }
});

test('texte clair lisible sur le fond de chaque thème (contraste ≥ 7:1)', () => {
  const text = luminance('#f4f4f5');
  for (const theme of THEMES) {
    const ratio = (text + 0.05) / (luminance(theme.bg) + 0.05);
    assert.ok(ratio >= 7, `${theme.id} : ${ratio.toFixed(1)}`);
  }
});

test('le thème Minimal correspond aux réglages par défaut', () => {
  const minimal = THEMES.find((t) => t.id === 'minimal');
  for (const key of COLOR_KEYS) assert.equal(defaults[key], minimal[key], key);
});

test('polices : mêmes identifiants que ceux acceptés par Rust (settings.rs)', () => {
  const rust = readFileSync(new URL('../src-tauri/src/settings.rs', import.meta.url), 'utf8');
  const accepted = /const FONTS: \[&str; \d\] = \[(.*?)\];/.exec(rust)[1].match(/"[^"]+"/g).map((f) => f.slice(1, -1));
  assert.deepEqual(FONTS.map((f) => f.id), accepted);
});
