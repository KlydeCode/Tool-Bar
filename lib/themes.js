// Thèmes prêts à l'emploi (4 couleurs chacun) et polices au choix.
// Couleurs tirées des palettes envoyées par l'utilisateur (Lospec). Chargé aussi par src/index.html.

const THEMES = [
  // fond du panneau, cartes, couleur 1, couleur 2
  { id: 'minimal', name: 'Minimal', bg: '#0a0a0b', surface: '#2c2c31', c1: '#8ab4ff', c2: '#ffb86b' },
  { id: 'pastel', name: 'Pastel Landscape', bg: '#1b1a26', surface: '#3d3657', c1: '#7ba898', c2: '#d3836f' },
  { id: 'retro', name: 'Mighty Retro Zero', bg: '#000000', surface: '#3a3a3a', c1: '#33d6ff', c2: '#ff3fbd' },
  { id: 'spaceship', name: 'Spaceship 25', bg: '#12102d', surface: '#2e2742', c1: '#3ef0a0', c2: '#ff2f7e' },
  { id: 'apollo', name: 'Apollo', bg: '#151d28', surface: '#253a5e', c1: '#73bed3', c2: '#de9e41' },
];

// Police de toute l'appli : titres et horloge, texte courant, petites étiquettes.
const FONTS = [
  { id: 'minimal', name: 'Minimal' },
  { id: 'pixel', name: 'Pixel art' },
  { id: 'literary', name: 'Littéraire' },
];

if (typeof module !== 'undefined') module.exports = { THEMES, FONTS };
