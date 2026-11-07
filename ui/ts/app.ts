import { bar, type AppNotification, type Rect, type SaveResult, type Settings, type Tile, type TileInfo } from './bar.js';
import { eventsBetween, weekStart, type CalendarEvent } from './calendar.js';
import { currentPosition, formatTime, type Media } from './media.js';
import { searchApps, type StartApp } from './search.js';
import { FONTS, THEMES } from './themes.js';

// Élément de index.html (il existe toujours : sinon c'est une erreur du code, qu'on veut voir tout de suite).
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} absent de index.html`);
  return el as T;
}

const body = document.body;
const pill = $<HTMLButtonElement>('pill');
const panel = $('panel');
const agenda = $('agenda');

// ---------- Pilule ↔ panneau ----------
const OPEN_DELAY = 120; // évite d'ouvrir quand la souris ne fait que passer
const CLOSE_DELAY = 400; // laisse le temps de revenir sur le panneau
let timer: number | undefined;

function setOpen(open: boolean) {
  clearTimeout(timer);
  if (open) showBar();
  else scheduleHide(HIDE_DELAY);
  if (body.classList.contains('is-open') === open) return;
  if (open) {
    refreshBackdrop();
    refreshAudio();
  }
  body.classList.toggle('is-open', open);
  if (!open) body.classList.remove('is-agenda');
  pill.setAttribute('aria-expanded', String(open));
  // Replié : le fond redevient sombre tout de suite (styles.css), on oublie la capture
  // et on revient à la vue normale si les réglages étaient ouverts.
  if (!open) {
    setTimeout(() => {
      if (body.classList.contains('is-open')) return;
      panel.classList.remove('has-backdrop');
      agenda.classList.remove('has-backdrop');
      closeSettings();
      clearSearch();
    }, 600);
  }
}

// La découpe du panneau replié doit faire exactement la largeur de la pilule.
function syncPillWidth() {
  panel.style.setProperty('--pill-w', `${pill.offsetWidth}px`);
}
document.fonts.ready.then(syncPillWidth);

function later(open: boolean, delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => setOpen(open), delay);
}

pill.addEventListener('mouseenter', () => { refreshBackdrop(); later(true, OPEN_DELAY); });
pill.addEventListener('mouseleave', () => {
  if (body.classList.contains('is-open')) return;
  clearTimeout(timer);
  scheduleHide(HIDE_DELAY);
});
pill.addEventListener('click', () => setOpen(true));
panel.addEventListener('mouseenter', () => clearTimeout(timer));
agenda.addEventListener('mouseenter', () => clearTimeout(timer));
agenda.addEventListener('mouseleave', () => {
  if (!body.classList.contains('is-settings')) later(false, CLOSE_DELAY);
});
// Dans les réglages, la souris peut sortir (fenêtre de choix de fichier…) sans tout refermer.
panel.addEventListener('mouseleave', () => {
  if (!body.classList.contains('is-settings') && !menuOpen) later(false, CLOSE_DELAY);
});
$('collapse').addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || recordingShortcut) return;
  if (menu.isConnected) closeMenu();
  else setOpen(false);
});
// Alt+Maj+Espace (raccourci global, Rust) et perte du focus.
bar.onToggle(() => {
  const open = !body.classList.contains('is-open');
  setOpen(open);
  if (open && !body.classList.contains('is-settings')) searchInput.focus();
});
bar.onClose(() => setOpen(false));

// ---------- Auto-masquage (option de la config) ----------
// La barre glisse hors de l'écran ; elle revient quand la souris touche le haut de l'écran
// (dans la largeur de la fenêtre, au centre) ou avec le raccourci clavier.
const HIDE_DELAY = 800; // après la fermeture ou le départ de la souris
const PEEK_DELAY = 1500; // revenue sans être survolée : repart après ce délai
const TOP_EDGE = 2; // pixels en haut de l'écran qui font revenir la barre
const TOP_ZONE = 1400; // largeur (au centre) de cette zone : la fenêtre fait tout l'écran
let autoHide = false;
let hideTimer: number | undefined;
let hovered = false; // souris sur la pilule, le panneau ou l'agenda

function showBar() {
  clearTimeout(hideTimer);
  body.classList.remove('is-hidden');
}

function scheduleHide(delay: number) {
  if (!autoHide) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    // Toujours utilisée (ouverte ou survolée) : on réessaie plus tard.
    if (body.classList.contains('is-open') || hovered) scheduleHide(delay);
    else body.classList.add('is-hidden');
  }, delay);
}

document.addEventListener('mousemove', (event) => {
  hovered = Boolean((event.target as Element).closest('.pill, .panel, .agenda'));
  if (autoHide && body.classList.contains('is-hidden') && event.clientY <= TOP_EDGE) {
    showBar();
    scheduleHide(PEEK_DELAY);
  }
});
document.addEventListener('mouseleave', () => { hovered = false; });

// Clics traversants : Rust suit la souris et ne la capte que dans ces zones
// (pilule, ou panneau et agenda ouverts ; barre masquée : le bord haut de l'écran).
function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height];
}

function sendHitRects() {
  let rects: Rect[];
  if (body.classList.contains('is-hidden')) rects = [[(window.innerWidth - TOP_ZONE) / 2, 0, TOP_ZONE, TOP_EDGE + 1]];
  else if (!body.classList.contains('is-open')) rects = [rectOf(pill)];
  else rects = body.classList.contains('is-agenda') ? [rectOf(panel), rectOf(agenda)] : [rectOf(panel)];
  bar.setHitRects(rects);
}

new MutationObserver(sendHitRects).observe(body, { attributes: true, attributeFilter: ['class'] });
new ResizeObserver(sendHitRects).observe(panel);
new ResizeObserver(sendHitRects).observe(pill);
// La barre qui revient (auto-masquage) glisse : zones remesurées à la fin du mouvement.
document.querySelector('.bar')?.addEventListener('transitionend', sendHitRects);

// Flou derrière le panneau : capture de l'écran prise juste avant l'ouverture (barre fermée),
// floutée une fois dans un canvas (le flou CSS « filter » n'est pas appliqué à l'écran
// dans une fenêtre transparente sous Windows).
const backdrop = $<HTMLCanvasElement>('backdrop');
const agendaBackdrop = $<HTMLCanvasElement>('agenda-backdrop');
for (const canvas of [backdrop, agendaBackdrop]) {
  canvas.width = Math.round(window.innerWidth / 4);
  canvas.height = Math.round(window.innerHeight / 4);
}
const BLUR = 7; // en pixels du canvas, qui fait 1/4 de la fenêtre (agrandi en CSS)
let backdropPending = false;

async function drawBackdrop(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const ctx = backdrop.getContext('2d');
  const agendaCtx = agendaBackdrop.getContext('2d');
  if (!ctx || !agendaCtx) return;
  ctx.clearRect(0, 0, backdrop.width, backdrop.height);
  ctx.filter = `blur(${BLUR}px) saturate(1.3)`;
  // Dessinée un peu plus grande que le canvas pour que le flou ne s'éclaircisse pas sur les bords.
  const m = BLUR * 1.5;
  ctx.drawImage(img, -m, -m, backdrop.width + 2 * m, backdrop.height + 2 * m);
  agendaCtx.drawImage(backdrop, 0, 0);
  panel.classList.add('has-backdrop');
  agenda.classList.add('has-backdrop');
}

function refreshBackdrop() {
  if (backdropPending || body.classList.contains('is-open')) return;
  backdropPending = true;
  bar.getBackdrop()
    .then((url) => (url ? drawBackdrop(url) : undefined))
    .catch((error) => console.error('Flou du fond impossible :', error))
    .finally(() => { backdropPending = false; });
}

// ---------- Raccourcis d'applis ----------
// Tuiles construites depuis la config (Rust) : nom, vraie icône des applis, sinon un pictogramme.
// On les déplace par glisser-déposer ; le nouvel ordre est enregistré.
const tilesEl = $('tiles');
const tileCount = $('tile-count');
const SYMBOLS: Record<string, string> = {
  app: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  url: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  settings: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  remove: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

// Pictogramme fixe (jamais du texte de la config dans innerHTML).
function symbol(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SYMBOLS[name] ?? SYMBOLS.app;
  return svg;
}

function iconImage(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'icon';
  img.src = src;
  img.alt = '';
  return img;
}

function makeTile(number: number, name: string, icon: Element): HTMLButtonElement {
  const tile = document.createElement('button');
  tile.className = 'tile';
  tile.title = name; // nom complet au survol, s'il est coupé (…)
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(number).padStart(2, '0');
  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;
  tile.append(num, icon, label);
  return tile;
}

let dragFrom: number | null = null;

function moveTile(from: number, to: number) {
  if (from === to || !settings) return;
  const [tile] = settings.shortcuts.splice(from, 1);
  settings.shortcuts.splice(to, 0, tile);
  save();
}

async function refreshTiles() {
  const shortcuts = await bar.getShortcuts();
  tilesEl.replaceChildren(...shortcuts.map((shortcut: TileInfo, index) => {
    const tile = makeTile(index + 1, shortcut.name, shortcut.icon ? iconImage(shortcut.icon) : symbol(shortcut.type));
    tile.draggable = true;
    tile.addEventListener('click', async () => {
      if (shortcut.type === 'settings') openSettings();
      else if (await bar.launch(index)) setOpen(false);
    });
    tile.addEventListener('dragstart', (event) => {
      dragFrom = index;
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      tile.classList.add('is-dragging');
    });
    tile.addEventListener('dragend', () => {
      dragFrom = null;
      tile.classList.remove('is-dragging');
    });
    tile.addEventListener('dragover', (event) => {
      if (dragFrom === null) return;
      event.preventDefault();
      tile.classList.add('is-drop-target');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('is-drop-target'));
    tile.addEventListener('drop', (event) => {
      event.preventDefault();
      tile.classList.remove('is-drop-target');
      if (dragFrom !== null) moveTile(dragFrom, index);
    });
    return tile;
  }));
  if (!body.classList.contains('is-searching')) tileCount.textContent = String(shortcuts.length).padStart(2, '0');
  if (!body.classList.contains('is-open')) syncPillWidth();
}

refreshTiles();

// ---------- Recherche d'applis du PC ----------
// On tape, les applis trouvées remplacent les tuiles. Entrée lance la sélection, flèches pour choisir,
// Échap efface. L'épingle ajoute l'appli aux tuiles.
const searchInput = $<HTMLInputElement>('search');
const resultsEl = $('results');
const tilesLabel = $('tiles-label');
const SEARCH_DELAY = 80; // ms : laisse finir la frappe avant de chercher
let searchTimer: number | undefined;
let menuOpen = false;

// Petit message dans la barre de recherche, puis retour au texte d'aide.
function flashSearch(text: string) {
  searchInput.placeholder = text;
  setTimeout(() => { searchInput.placeholder = 'Rechercher une appli…'; }, 2500);
}
let results: StartApp[] = [];
let selected = 0;
let searchId = 0;

function clearSearch() {
  closeMenu();
  searchInput.value = '';
  results = [];
  resultsEl.replaceChildren();
  body.classList.remove('is-searching');
  tilesLabel.textContent = 'Raccourcis';
  tileCount.textContent = String(tilesEl.children.length).padStart(2, '0');
}

function selectResult(index: number) {
  selected = index;
  [...resultsEl.children].forEach((item, i) => item.firstElementChild?.classList.toggle('is-selected', i === index));
}

function launchResult(index: number) {
  if (!results[index]) return;
  bar.launchApp(results[index].id);
  clearSearch();
  setOpen(false);
}

// Clic droit sur un résultat : petit menu (ouvrir, raccourci dans la barre ou sur le Bureau, emplacement).
const menu = document.createElement('div');
menu.className = 'menu';
menu.setAttribute('role', 'menu');

function closeMenu() {
  menu.remove();
  menuOpen = false;
}

function menuItem(label: string, action: () => Promise<string | null>): HTMLButtonElement {
  const item = document.createElement('button');
  item.className = 'menu-item';
  item.setAttribute('role', 'menuitem');
  item.textContent = label;
  item.addEventListener('click', async () => {
    closeMenu();
    const message = await action();
    if (message) flashSearch(message);
  });
  return item;
}

function openMenu(app: StartApp, x: number, y: number) {
  const separator = () => Object.assign(document.createElement('hr'), { className: 'menu-sep' });
  menu.replaceChildren(
    menuItem('Ouvrir', async () => {
      // Comme un clic sur le résultat : la barre se replie.
      bar.launchApp(app.id);
      clearSearch();
      setOpen(false);
      return null;
    }),
    separator(),
    menuItem('Créer un raccourci dans la barre', async () => {
      const answer = await bar.pinApp(app.id);
      settings = answer.settings;
      if (answer.ok) refreshTiles();
      return answer.ok ? 'Raccourci créé dans la barre.' : answer.error ?? '';
    }),
    menuItem('Créer un raccourci sur le Bureau', async () => (
      (await bar.desktopShortcut(app.id)) ? 'Raccourci créé sur le Bureau.' : 'Raccourci impossible à créer.')),
    separator(),
    menuItem("Ouvrir l'emplacement du fichier", async () => (
      (await bar.revealApp(app.id)) ? null : 'Emplacement introuvable.')),
  );
  panel.append(menu);
  menuOpen = true;
  // Dans le panneau, sans déborder (il coupe ce qui dépasse).
  const box = panel.getBoundingClientRect();
  const left = Math.min(x - box.left, box.width - menu.offsetWidth - 8);
  const top = Math.min(y - box.top, box.height - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.querySelector('button')?.focus();
}

document.addEventListener('pointerdown', (event) => {
  if (menu.isConnected && !menu.contains(event.target as Node)) closeMenu();
});

function renderResults() {
  closeMenu();
  resultsEl.replaceChildren(...results.map((result, i) => {
    const icon = symbol('app');
    const tile = makeTile(i + 1, result.name, icon);
    tile.addEventListener('click', () => launchResult(i));
    tile.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectResult(i);
      openMenu(result, event.clientX, event.clientY);
    });
    bar.getAppIcon(result.id).then((src) => {
      if (src) icon.replaceWith(iconImage(src));
    });
    const pin = document.createElement('button');
    pin.className = 'pin';
    pin.title = 'Ajouter aux raccourcis';
    pin.setAttribute('aria-label', `Ajouter ${result.name} aux raccourcis`);
    pin.append(symbol('pin'));
    pin.addEventListener('click', async () => {
      const answer = await bar.pinApp(result.id);
      settings = answer.settings;
      if (!answer.ok) {
        pin.title = answer.error ?? '';
        return;
      }
      pin.classList.add('is-done');
      pin.replaceChildren(symbol('check'));
      refreshTiles();
    });
    const item = document.createElement('div');
    item.className = 'result-item';
    item.append(tile, pin);
    return item;
  }));
  selectResult(0);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (!query) return clearSearch();
  body.classList.add('is-searching');
  tilesLabel.textContent = 'Applis';
  searchTimer = setTimeout(async () => {
    const id = ++searchId;
    const apps = await bar.listApps();
    if (id !== searchId) return; // une frappe plus récente a déjà relancé la recherche
    results = searchApps(apps, query);
    renderResults();
    tileCount.textContent = String(results.length).padStart(2, '0');
  }, SEARCH_DELAY);
});

searchInput.addEventListener('keydown', (event) => {
  const columns = 6;
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
  if (event.key === 'Escape' && searchInput.value) {
    event.stopPropagation(); // efface la recherche sans fermer la barre
    clearSearch();
  } else if (event.key === 'Enter') {
    launchResult(selected);
  } else if (moves[event.key] && results.length) {
    event.preventDefault();
    selectResult(Math.min(results.length - 1, Math.max(0, selected + moves[event.key])));
  }
});

// ---------- Réglages ----------
// Chaque changement est envoyé à Rust, qui vérifie, enregistre et renvoie les réglages retenus.
const KEY_NAMES: Record<string, string> = { Control: 'Ctrl', Shift: 'Maj', Super: 'Win', Space: 'Espace' };
const TYPE_NAMES = { app: 'Appli', file: 'Fichier', folder: 'Dossier', url: 'Site web' };
const MAX_TILES = 18;
const SAVE_DELAY = 250; // ms : regroupe les changements rapides (curseur, couleur)
const setThemes = $('set-themes');
const setBg = $<HTMLInputElement>('set-bg');
const setSurface = $<HTMLInputElement>('set-surface');
const setFont = $<HTMLSelectElement>('set-font');
const THEME_COLORS = ['bg', 'surface', 'c1', 'c2'] as const;
const setC1 = $<HTMLInputElement>('set-c1');
const setC2 = $<HTMLInputElement>('set-c2');
const setTransparency = $<HTMLInputElement>('set-transparency');
const setTransparencyValue = $('set-transparency-value');
const setAutoHide = $<HTMLInputElement>('set-autohide');
const setShortcut = $<HTMLButtonElement>('set-shortcut');
const setTiles = $('set-tiles');
const settingsStatus = $('settings-status');
// Chargés au démarrage (fin de cette partie) ; les fonctions qui peuvent tourner avant vérifient.
let settings: Settings = null!;
let saveTimer: number | undefined;
let recordingShortcut = false;

// Couleurs du thème, police, transparence et auto-masquage appliqués à toute la barre.
function applyLook() {
  const root = document.documentElement.style;
  for (const key of THEME_COLORS) root.setProperty(`--${key}`, settings[key]);
  body.dataset.font = settings.font;
  root.setProperty('--open-transparency', String(settings.transparency / 100));
  autoHide = settings.autoHide;
  if (!autoHide) showBar();
  else if (!body.classList.contains('is-open')) scheduleHide(HIDE_DELAY);
}

function shortcutLabel(accelerator: string): string {
  return accelerator.split('+').map((k) => KEY_NAMES[k] ?? k).join(' + ');
}

function setStatus(text: string, isError = false) {
  settingsStatus.textContent = text;
  settingsStatus.classList.toggle('is-error', isError);
}

function fileName(fullPath: string): string {
  return fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;
}

function isWebUrl(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function iconButton(name: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'icon-btn';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  button.append(symbol(name));
  button.addEventListener('click', onClick);
  return button;
}

// Ligne d'une tuile : nom, type, cible, puis monter / descendre / supprimer.
function tileRow(tile: Tile, index: number, count: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(index + 1).padStart(2, '0');
  const moveUp = iconButton('up', 'Monter', () => { moveTile(index, index - 1); renderSettings(); }, index === 0);
  const moveDown = iconButton('down', 'Descendre', () => { moveTile(index, index + 1); renderSettings(); }, index === count - 1);

  if (tile.type === 'settings') {
    // La tuile Réglages se déplace mais ne se modifie pas et ne se supprime pas.
    const fixed = document.createElement('span');
    fixed.className = 'fixed';
    fixed.textContent = 'Réglages (cette page)';
    fixed.style.gridColumn = 'span 3';
    row.append(num, fixed, moveUp, moveDown, document.createElement('span'));
    return row;
  }

  const name = document.createElement('input');
  name.className = 'field';
  name.maxLength = 40;
  name.value = tile.name;
  name.setAttribute('aria-label', `Nom de la tuile ${index + 1}`);
  name.addEventListener('change', () => {
    tile.name = name.value.trim() || 'Raccourci';
    save();
  });

  const type = document.createElement('select');
  type.className = 'field';
  type.setAttribute('aria-label', `Type de la tuile ${index + 1}`);
  if (tile.type === 'startapp') type.add(new Option('Appli du PC', 'startapp', false, true));
  for (const [value, label] of Object.entries(TYPE_NAMES)) type.add(new Option(label, value, false, value === tile.type));
  type.addEventListener('change', async () => {
    if (type.value === 'url') {
      // Le site n'est enregistré qu'une fois l'adresse saisie (sinon la tuile serait refusée).
      row.replaceChild(urlInput(index, tile.name, ''), row.children[3]);
      return;
    }
    const picked = await bar.pickTarget(type.value);
    if (!picked) {
      type.value = tile.type;
      return;
    }
    replaceTile(index, { name: tile.name, type: type.value as Tile['type'], paths: [picked] });
  });

  const remove = iconButton('remove', 'Supprimer la tuile', () => {
    settings.shortcuts.splice(index, 1);
    renderSettings();
    save();
  });
  row.append(num, name, type, targetField(tile, index), moveUp, moveDown, remove);
  return row;
}

function targetField(tile: Tile, index: number): HTMLElement {
  if (tile.type === 'url') return urlInput(index, tile.name, tile.url ?? '');
  if (tile.type === 'startapp') {
    const label = document.createElement('span');
    label.className = 'fixed';
    label.textContent = 'Depuis la recherche';
    return label;
  }
  const button = document.createElement('button');
  button.className = 'field target';
  const target = tile.paths?.[0] ?? '';
  button.textContent = target.includes('%') ? 'Par défaut' : fileName(target);
  button.title = target;
  button.addEventListener('click', async () => {
    const picked = await bar.pickTarget(tile.type);
    if (picked) replaceTile(index, { name: tile.name, type: tile.type, paths: [picked] });
  });
  return button;
}

function urlInput(index: number, name: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'field target';
  input.type = 'url';
  input.placeholder = 'https://…';
  input.value = value;
  input.setAttribute('aria-label', `Adresse du site de la tuile ${index + 1}`);
  input.addEventListener('change', () => {
    const url = input.value.trim();
    const ok = isWebUrl(url);
    input.classList.toggle('is-invalid', !ok);
    if (ok) replaceTile(index, { name, type: 'url', url });
    else setStatus('Adresse refusée : elle doit commencer par https:// ou http://', true);
  });
  return input;
}

function replaceTile(index: number, tile: Tile) {
  settings.shortcuts[index] = tile;
  renderSettings();
  save();
}

// Nouvelle tuile : on choisit d'abord l'appli ; le type se change ensuite sur la ligne.
async function addTile() {
  if (settings.shortcuts.length >= MAX_TILES) return setStatus(`${MAX_TILES} tuiles au maximum.`, true);
  const picked = await bar.pickTarget('app');
  if (!picked) return;
  const name = fileName(picked).replace(/\.(exe|lnk|appref-ms)$/i, '');
  settings.shortcuts.push({ name, type: 'app', paths: [picked] });
  renderSettings();
  save();
}

function renderTransparency() {
  setTransparency.value = String(settings.transparency);
  setTransparency.style.setProperty('--fill', `${(settings.transparency / 70) * 100}%`);
  setTransparencyValue.textContent = `${settings.transparency} %`;
}

// Pastilles de thèmes (prêts à l'emploi, lib/themes.js) : un clic remplace les 4 couleurs.
function renderThemes() {
  setThemes.replaceChildren(...THEMES.map((theme) => {
    const chip = document.createElement('button');
    chip.className = 'theme-chip';
    chip.title = theme.name;
    chip.setAttribute('aria-label', `Thème ${theme.name}`);
    chip.classList.toggle('is-active', THEME_COLORS.every((key) => settings[key] === theme[key]));
    for (const key of THEME_COLORS) {
      const stripe = document.createElement('span');
      stripe.style.background = theme[key];
      chip.append(stripe);
    }
    chip.addEventListener('click', () => {
      for (const key of THEME_COLORS) settings[key] = theme[key];
      applyLook();
      renderSettings();
      save();
    });
    return chip;
  }));
}

function renderSettings() {
  renderThemes();
  setBg.value = settings.bg;
  setSurface.value = settings.surface;
  setFont.replaceChildren(...FONTS.map((font) => new Option(font.name, font.id, false, font.id === settings.font)));
  setC1.value = settings.c1;
  setC2.value = settings.c2;
  renderTransparency();
  setAutoHide.checked = settings.autoHide;
  setShortcut.textContent = shortcutLabel(settings.toggleShortcut);
  const count = settings.shortcuts.length;
  const add = document.createElement('button');
  add.className = 'field add-tile';
  add.textContent = '+ Ajouter une tuile';
  add.disabled = count >= MAX_TILES;
  add.addEventListener('click', addTile);
  setTiles.replaceChildren(...settings.shortcuts.map((tile, index) => tileRow(tile, index, count)), add);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const result = await bar.saveSettings(settings);
    settings = result.settings;
    applyLook();
    if (result.ok) setStatus('Enregistré.');
    else {
      setStatus(result.error ?? '', true);
      renderSettings();
    }
    refreshTiles();
  }, SAVE_DELAY);
}

// Lancement au démarrage : réglé par Windows (pas dans la config), et seulement dans la version installée.
const setStartupInput = $<HTMLInputElement>('set-startup');

async function renderStartup() {
  const startup = await bar.getStartup();
  setStartupInput.checked = startup.enabled;
  setStartupInput.disabled = !startup.available;
  $('startup-row').title = startup.available ? '' : 'Disponible dans la version installée';
}

setStartupInput.addEventListener('change', async () => {
  const startup = await bar.setStartup(setStartupInput.checked);
  setStartupInput.checked = startup.enabled;
  setStatus(startup.enabled ? 'Island se lancera au démarrage de Windows.' : 'Lancement au démarrage désactivé.');
});

function openSettings() {
  renderSettings();
  renderStartup();
  setStatus('');
  body.classList.add('is-settings');
}

function closeSettings() {
  stopRecording();
  body.classList.remove('is-settings');
}

// Couleur changée à la main : appliquée tout de suite ; la pastille du thème se met à jour.
for (const [input, key] of [[setBg, 'bg'], [setSurface, 'surface'], [setC1, 'c1'], [setC2, 'c2']] as const) {
  input.addEventListener('input', () => {
    settings[key] = input.value;
    applyLook();
    renderThemes();
    save();
  });
}
setFont.addEventListener('change', () => {
  settings.font = setFont.value;
  applyLook();
  save();
  // La largeur de la pilule dépend de la police.
  document.fonts.ready.then(syncPillWidth);
});
setTransparency.addEventListener('input', () => {
  settings.transparency = Number(setTransparency.value);
  renderTransparency();
  applyLook();
  save();
});
setAutoHide.addEventListener('change', () => { settings.autoHide = setAutoHide.checked; save(); });

// Raccourci clavier : on clique, puis on appuie sur la combinaison voulue (Échap pour annuler).
setShortcut.addEventListener('click', () => {
  recordingShortcut = true;
  setShortcut.classList.add('is-recording');
  setShortcut.textContent = 'Appuie sur les touches…';
});

function stopRecording() {
  if (!recordingShortcut) return;
  recordingShortcut = false;
  setShortcut.classList.remove('is-recording');
  setShortcut.textContent = shortcutLabel(settings.toggleShortcut);
}

document.addEventListener('keydown', (event) => {
  if (!recordingShortcut) return;
  event.preventDefault();
  if (event.key === 'Escape') return stopRecording();
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return; // on attend la touche principale
  let key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key === ' ') key = 'Space';
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space)$/.test(key) || !(event.ctrlKey || event.altKey || event.metaKey)) {
    setStatus('Il faut Ctrl, Alt ou Win, puis une lettre, un chiffre, F1 à F12 ou Espace.', true);
    return;
  }
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
  settings.toggleShortcut = [...mods, key].join('+');
  stopRecording();
  save();
});

$('settings-back').addEventListener('click', closeSettings);
$('settings-quit').addEventListener('click', () => bar.quit());
$('settings-reset').addEventListener('click', async () => {
  const result = await bar.resetSettings();
  settings = result.settings;
  applyLook();
  renderSettings();
  refreshTiles();
  setStatus(result.ok ? 'Réglages par défaut remis.' : result.error ?? '', !result.ok);
});

bar.getSettings().then((loaded) => {
  settings = loaded;
  applyLook();
  document.fonts.ready.then(syncPillWidth); // la police choisie peut changer la largeur de la pilule
  if (autoHide && !body.classList.contains('is-open')) body.classList.add('is-hidden');
});

// ---------- Agenda ----------
// Clic sur l'horloge : l'agenda se déplie à droite du panneau. Une semaine à la fois (‹ › pour changer),
// le bouton + montre les agendas (liens iCal, fichiers .ics). Tout le texte des agendas est affiché
// avec textContent : un agenda venu d'Internet ne peut pas injecter de code.
const weekEl = $('week');
const weekLabel = $('week-label');
const weekRange = $('week-range');
const manageButton = $('agenda-manage');
const sourceList = $('source-list');
const sourceForm = $<HTMLFormElement>('source-add');
const sourceUrl = $<HTMLInputElement>('source-url');
const agendaStatus = $('agenda-status');
const DAY_MS = 24 * 60 * 60 * 1000;
const dayName = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const rangeDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const hourMinute = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
let shownWeek = Date.now(); // un instant de la semaine affichée

function element(tag: string, className?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Numéro de semaine ISO (lundi = début de semaine).
function weekNumber(monday: Date): number {
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / DAY_MS / 7 - ((firstThursday.getDay() + 6) % 7 - 3) / 7);
}

type WeekEvent = CalendarEvent & { calendar: number };

function eventRow(event: WeekEvent, dayStart: number): HTMLElement {
  const row = element('div', event.calendar % 2 ? 'event alt' : 'event');
  const startsToday = event.start >= dayStart;
  const time = event.allDay ? 'Journée' : startsToday ? hourMinute.format(event.start) : 'Suite';
  const info = element('div');
  info.append(element('div', 'event-title', event.title));
  if (event.location) info.append(element('div', 'event-place', event.location));
  row.append(element('span', 'event-time', time), info);
  return row;
}

// Événements de la semaine qui commence à « monday », tous agendas confondus.
async function weekEvents(monday: Date): Promise<WeekEvent[]> {
  const to = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const texts = await bar.calendarTexts();
  return texts
    .flatMap((text, calendar) => eventsBetween(text, monday, to).map((e) => ({ ...e, calendar })))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

async function renderWeek() {
  const monday = weekStart(new Date(shownWeek));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const week = { events: await weekEvents(monday) };
  weekLabel.textContent = `Semaine ${weekNumber(monday)}`;
  // « 9 – 15 nov. », ou « 28 sept. – 4 oct. » quand la semaine change de mois.
  weekRange.textContent = monday.getMonth() === sunday.getMonth()
    ? `${monday.getDate()} – ${rangeDay.format(sunday)}`
    : `${rangeDay.format(monday)} – ${rangeDay.format(sunday)}`;
  if (!settings?.calendars.length) {
    weekEl.replaceChildren(element('p', 'agenda-empty', 'Aucun agenda.\nAjoute un lien iCal ou un fichier .ics avec le bouton +.'));
    return;
  }
  const today = new Date();
  weekEl.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
    // Jours calculés par la date (et non + 24 h) pour rester justes aux changements d'heure.
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i + 1);
    const day = element('div', 'day');
    day.classList.toggle('is-today', start.toDateString() === today.toDateString());
    day.append(element('div', 'label day-name', dayName.format(start)));
    const events = week.events.filter((e) => e.start < end.getTime() && Math.max(e.end, e.start + 1) > start.getTime());
    if (!events.length) day.append(element('div', 'day-empty', '—'));
    for (const event of events) day.append(eventRow(event, start.getTime()));
    return day;
  }));
  weekEl.querySelector('.is-today')?.scrollIntoView({ block: 'start' });
}

function setAgendaStatus(text: string, isError = false) {
  agendaStatus.textContent = text;
  agendaStatus.classList.toggle('is-error', isError);
}

async function renderSources() {
  const calendars = await bar.getCalendars();
  sourceList.replaceChildren(...calendars.map((calendar) => {
    const row = element('div', 'source');
    const info = element('div', 'source-info');
    info.append(element('div', 'source-name', calendar.name));
    const meta = element('div', calendar.error ? 'source-meta is-error' : 'source-meta',
      calendar.error || (calendar.type === 'url' ? 'Lien, mis à jour toutes les 15 min' : 'Fichier importé'));
    info.append(meta);
    row.append(info, iconButton('remove', `Retirer l'agenda ${calendar.name}`, async () => {
      applyCalendarResult(await bar.removeCalendar(calendar.id), 'Agenda retiré.');
    }));
    return row;
  }));
  if (!calendars.length) sourceList.append(element('div', 'day-empty', 'Aucun agenda pour l\'instant.'));
}

function applyCalendarResult(result: SaveResult, okText: string) {
  settings = result.settings;
  setAgendaStatus(result.ok ? okText : result.error ?? '', !result.ok);
  renderSources();
  renderWeek();
}

function setManaging(on: boolean) {
  agenda.classList.toggle('is-managing', on);
  manageButton.setAttribute('aria-pressed', String(on));
  if (on) renderSources();
  else renderWeek();
}

function openAgenda() {
  agenda.style.setProperty('--agenda-h', `${panel.offsetHeight}px`);
  shownWeek = Date.now();
  setAgendaStatus('');
  renderWeek();
  setManaging(!settings?.calendars.length); // sans agenda, on commence par en ajouter un
  body.classList.add('is-agenda');
}

$('clock').addEventListener('click', (event) => {
  if ((event.target as Element).closest('#collapse')) return;
  if (body.classList.contains('is-agenda')) body.classList.remove('is-agenda');
  else openAgenda();
});
$('week-prev').addEventListener('click', () => { shownWeek -= 7 * DAY_MS; renderWeek(); });
$('week-next').addEventListener('click', () => { shownWeek += 7 * DAY_MS; renderWeek(); });
$('week-today').addEventListener('click', () => {
  shownWeek = Date.now();
  setManaging(false);
});
manageButton.addEventListener('click', () => setManaging(!agenda.classList.contains('is-managing')));
sourceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAgendaStatus('Chargement de l\'agenda…');
  const result = await bar.addCalendar(sourceUrl.value);
  if (result.ok) sourceUrl.value = '';
  applyCalendarResult(result, 'Agenda ajouté.');
});
$('source-import').addEventListener('click', async () => {
  applyCalendarResult(await bar.importCalendar(), '');
});

// ---------- Horloge ----------
// « 23:20 » et « MER. 14 OCT. », mises à jour au changement de minute.
const timeEl = $('time');
const pillTimeEl = $('pill-time');
const dateEl = $('date');
const dateFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function renderClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeEl.innerHTML = `${hh}<span class="colon">:</span>${mm}`;
  pillTimeEl.textContent = `${hh}:${mm}`;
  dateEl.textContent = dateFormat.format(now).toUpperCase();
  syncPillWidth();
  setTimeout(renderClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}
renderClock();

// ---------- Musique ----------
// Morceau en cours (Spotify, Deezer, Apple Music, YouTube dans un navigateur…), relu chaque seconde.
// Sans musique, la pilule n'affiche que l'heure.
const MEDIA_POLL = 1000;
const play = $<HTMLButtonElement>('play');
const prev = $<HTMLButtonElement>('prev');
const next = $<HTMLButtonElement>('next');
const cover = $('cover');
const coverArt = $<HTMLImageElement>('cover-art');
const trackTitle = $('track-title');
const trackArtist = $('track-artist');
const pillTitle = $('pill-title');
const progressFill = $('progress-fill');
const timePos = $('time-pos');
const timeTotal = $('time-total');
let media: Media | null = null;
let artFor = ''; // morceau dont la pochette est affichée
let artPending = false;

// Nom lisible de l'appli quand il n'y a pas d'artiste (« Spotify.exe » → « Spotify »).
function appName(id: string): string {
  return (id.split(/[\\!]/).pop() ?? id).replace(/\.exe$/i, '');
}

function renderTimeline() {
  const position = media && currentPosition(media, Date.now());
  body.classList.toggle('no-timeline', position == null || !media);
  if (position == null || !media) return;
  progressFill.style.width = `${(position / media.duration) * 100}%`;
  timePos.textContent = formatTime(position);
  timeTotal.textContent = formatTime(media.duration);
}

function showArt(url: string) {
  coverArt.onload = () => {
    // Miniature de vidéo (plus large que haute) : case élargie au format 16:9.
    cover.classList.toggle('is-wide', coverArt.naturalWidth > coverArt.naturalHeight * 1.2);
    cover.classList.add('has-art');
  };
  coverArt.src = url;
}

function clearArt() {
  artFor = '';
  cover.classList.remove('has-art', 'is-wide');
  coverArt.removeAttribute('src');
}

async function loadArt(key: string) {
  if (artPending) return;
  artPending = true;
  try {
    const url = await bar.getMediaArt();
    if (url && media && key === trackKey(media)) {
      artFor = key;
      showArt(url);
    }
  } finally {
    artPending = false;
  }
}

function trackKey(m: Media): string {
  return `${m.app}|${m.title}|${m.artist}`;
}

function renderMedia() {
  body.classList.toggle('has-music', Boolean(media));
  body.classList.toggle('is-playing', Boolean(media?.playing));
  play.setAttribute('aria-label', media?.playing ? 'Pause' : 'Lecture');
  play.disabled = !media;
  prev.disabled = !media?.canPrev;
  next.disabled = !media?.canNext;
  if (!media) {
    trackTitle.textContent = 'Aucune musique';
    trackArtist.textContent = 'Rien en cours de lecture';
    pillTitle.textContent = '';
    clearArt();
  } else {
    const artist = media.artist || appName(media.app);
    trackTitle.textContent = media.title;
    trackArtist.textContent = artist;
    pillTitle.textContent = `${media.title} · ${artist}`;
    const key = trackKey(media);
    if (artFor !== key) {
      if (artFor) clearArt();
      // Les navigateurs donnent parfois la miniature un peu après le titre : on réessaie à chaque relecture.
      if (media.hasArt) loadArt(key);
    }
  }
  renderTimeline();
  if (!body.classList.contains('is-open')) syncPillWidth();
}

async function refreshMedia() {
  media = await bar.getMedia();
  renderMedia();
}

async function control(action: 'play' | 'next' | 'prev') {
  if (await bar.mediaControl(action)) setTimeout(refreshMedia, 300);
}

play.addEventListener('click', () => control('play'));
prev.addEventListener('click', () => control('prev'));
next.addEventListener('click', () => control('next'));

refreshMedia();
setInterval(refreshMedia, MEDIA_POLL);

// ---------- Notifications des applis ----------
// Une nouvelle notification (Discord, Outlook, Teams…) s'affiche quelques secondes dans la pilule,
// et la ligne du haut repart de la pilule vers les bords. Les notifications déjà là au démarrage sont ignorées.
const NOTIF_POLL = 2000; // ms
const NOTIF_SHOW = 6000; // ms
const edge = $('edge');
const notifIcon = $<HTMLImageElement>('notif-icon');
const notifApp = $('notif-app');
const notifText = $('notif-text');
const notifIcons = new Map<string, string>(); // nom de l'appli → icône
let seenNotifs: Set<number> | null = null;
let notifTimer: number | undefined;

// La ligne part de la pilule et s'étend jusqu'aux bords de l'écran.
function spreadEdge() {
  edge.classList.remove('is-spreading');
  void edge.offsetWidth; // relance l'animation
  edge.classList.add('is-spreading');
}

async function showNotification(notif: AppNotification) {
  const icon = notifIcons.get(notif.app) ?? await bar.getNotificationIcon(notif.id);
  if (icon) notifIcons.set(notif.app, icon);
  notifIcon.hidden = !icon;
  if (icon) notifIcon.src = icon;
  notifApp.textContent = notif.app;
  notifText.textContent = notif.body ? `${notif.title} · ${notif.body}` : notif.title;
  body.classList.add('has-notif');
  showBar();
  spreadEdge();
  syncPillWidth();
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => {
    body.classList.remove('has-notif');
    syncPillWidth();
    scheduleHide(HIDE_DELAY);
  }, NOTIF_SHOW);
}

async function pollNotifications() {
  const list = await bar.getNotifications();
  const fresh = seenNotifs ? list.filter((n) => !seenNotifs?.has(n.id)) : [];
  seenNotifs = new Set(list.map((n) => n.id));
  if (fresh.length) showNotification(fresh.reduce((a, b) => (b.time > a.time ? b : a)));
}

spreadEdge();
pollNotifications();
setInterval(pollNotifications, NOTIF_POLL);

// ---------- Volume et micro ----------
// Vrai volume du système et vrai micro (via Rust). Relus à chaque ouverture du panneau,
// car ils peuvent changer ailleurs (touches du clavier, réglages Windows).
const volume = $<HTMLInputElement>('volume');
const volumeValue = $('volume-value');
const mic = $('mic');
const VOLUME_THROTTLE = 60; // ms entre deux envois pendant qu'on fait glisser le curseur
let volumeTimer: number | undefined;
let micMuted = false;

function renderVolume() {
  volume.style.setProperty('--fill', `${volume.value}%`);
  volumeValue.textContent = volume.value;
}

function renderMic() {
  mic.classList.toggle('is-muted', micMuted);
  mic.setAttribute('aria-pressed', String(micMuted));
  mic.setAttribute('aria-label', micMuted ? 'Rétablir le micro' : 'Couper le micro');
}

async function refreshAudio() {
  const audio = await bar.getAudio();
  if (audio.volume !== null) {
    volume.value = String(audio.volume);
    renderVolume();
  }
  if (audio.micMuted !== null) {
    micMuted = audio.micMuted;
    renderMic();
  }
}

volume.addEventListener('input', () => {
  renderVolume();
  // Un envoi toutes les 60 ms au plus ; la dernière position part toujours.
  if (volumeTimer) return;
  volumeTimer = setTimeout(() => {
    volumeTimer = undefined;
    bar.setVolume(Number(volume.value));
  }, VOLUME_THROTTLE);
});

mic.addEventListener('click', async () => {
  if (await bar.setMicMuted(!micMuted)) {
    micMuted = !micMuted;
    renderMic();
  }
});

renderVolume();
refreshAudio();
