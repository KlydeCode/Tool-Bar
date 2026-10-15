const { test } = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, FONTS } = require('../lib/themes');
const { cleanSettings } = require('../lib/settings');
const defaults = require('../config.default.json');

const COLOR_KEYS = ['bg', 'surface', 'c1', 'c2'];

// Luminance relative (WCAG) pour vérifier que le texte clair reste lisible sur le fond.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('chaque thème : 4 couleurs au plus, toutes valides et acceptées par les réglages', () => {
  for (const theme of THEMES) {
    const colors = Object.keys(theme).filter((k) => !['id', 'name'].includes(k));
    assert.deepEqual(colors, COLOR_KEYS, theme.id);
    const clean = cleanSettings({ ...defaults, ...theme }, defaults);
    for (const key of COLOR_KEYS) assert.equal(clean[key], theme[key], `${theme.id}.${key}`);
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

test('police : valeur connue gardée, sinon celle par défaut', () => {
  for (const font of FONTS) assert.equal(cleanSettings({ font: font.id }, defaults).font, font.id);
  assert.equal(cleanSettings({ font: 'comic-sans' }, defaults).font, defaults.font);
});
