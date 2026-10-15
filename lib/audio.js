// Conversions entre l'interface (pourcentage entier) et le script Windows (niveau de 0 à 1).
// Une valeur invalide est refusée plutôt que corrigée : un volume deviné peut faire mal aux oreilles.

function levelArg(percent) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null;
  return String(percent / 100);
}

function percentFromLevel(answer) {
  const level = Number.parseFloat(answer);
  if (!Number.isFinite(level) || level < 0 || level > 1) return null;
  return Math.round(level * 100);
}

function micFromAnswer(answer) {
  if (answer === '1') return true;
  if (answer === '0') return false;
  return null;
}

module.exports = { levelArg, percentFromLevel, micFromAnswer };
