// Clic droit sur la pilule : quitter (provisoire, tant qu'il n'y a pas de réglages).
document.getElementById('pill').addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.bar.quit();
});
