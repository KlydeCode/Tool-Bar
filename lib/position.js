// Position de la barre : centrée en haut de la zone de travail (hors barre des tâches Windows).
function topCenter(workArea, width) {
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: workArea.y };
}

module.exports = { topCenter };
