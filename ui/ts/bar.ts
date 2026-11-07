// Pont vers la partie Rust (src-tauri/src/main.rs) : seules ces commandes existent,
// et Rust vérifie chaque valeur reçue (numéros, identifiants, réglages).
import type { Media } from './media.js';
import type { StartApp } from './search.js';

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
      event: { listen(event: string, handler: () => void): Promise<unknown> };
    };
  }
}

export type TileType = 'app' | 'file' | 'folder' | 'url' | 'startapp' | 'settings';
export interface Tile {
  name: string;
  type: TileType;
  paths?: string[];
  url?: string;
  appId?: string;
}
export interface CalendarSource { id: string; name: string; url?: string; file?: boolean }
export interface Settings {
  bg: string;
  surface: string;
  c1: string;
  c2: string;
  transparency: number;
  font: string;
  autoHide: boolean;
  toggleShortcut: string;
  shortcuts: Tile[];
  calendars: CalendarSource[];
}
// Réponse à tout changement de réglages : les réglages retenus, et l'erreur s'il y en a une.
export interface SaveResult { ok: boolean; error?: string; settings: Settings }
export interface Startup { available: boolean; enabled: boolean }
export interface TileInfo { name: string; type: TileType; icon: string | null }
export interface Audio { volume: number | null; micMuted: boolean | null }
export interface CalendarInfo { id: string; name: string; type: 'url' | 'file'; error: string }
// Rectangle (x, y, largeur, hauteur) en pixels CSS de la fenêtre.
export type Rect = [number, number, number, number];

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export const bar = {
  quit: () => invoke<void>('quit'),
  // Zones où la souris est captée ; partout ailleurs, les clics traversent la fenêtre.
  setHitRects: (rects: Rect[]) => invoke<void>('set_hit_rects', { rects }),
  getBackdrop: () => invoke<string | null>('get_backdrop'),
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings: Settings) => invoke<SaveResult>('save_settings', { settings }),
  resetSettings: () => invoke<SaveResult>('reset_settings'),
  getStartup: () => invoke<Startup>('get_startup'),
  setStartup: (on: boolean) => invoke<Startup>('set_startup', { on }),
  // « app », « file » ou « folder » : fenêtre de choix de Windows ; chemin choisi ou null.
  pickTarget: (kind: string) => invoke<string | null>('pick_target', { kind }),
  getShortcuts: () => invoke<TileInfo[]>('get_shortcuts'),
  getAudio: () => invoke<Audio>('get_audio'),
  setVolume: (percent: number) => invoke<boolean>('set_volume', { percent }),
  setMicMuted: (muted: boolean) => invoke<boolean>('set_mic_muted', { muted }),
  getMedia: () => invoke<Media | null>('get_media'),
  getMediaArt: () => invoke<string | null>('get_media_art'),
  // « play » (lecture/pause), « next » ou « prev » seulement.
  mediaControl: (action: 'play' | 'next' | 'prev') => invoke<boolean>('media_control', { action }),
  // Seulement le numéro de la tuile : Rust retrouve la cible dans la config.
  launch: (index: number) => invoke<boolean>('launch', { index }),
  // Applis du PC (menu Démarrer) ; ensuite tout se fait avec l'identifiant Windows de l'appli.
  listApps: () => invoke<StartApp[]>('list_apps'),
  getAppIcon: (id: string) => invoke<string | null>('get_app_icon', { id }),
  launchApp: (id: string) => invoke<boolean>('launch_app', { id }),
  pinApp: (id: string) => invoke<SaveResult>('pin_app', { id }),
  desktopShortcut: (id: string) => invoke<boolean>('desktop_shortcut', { id }),
  revealApp: (id: string) => invoke<boolean>('reveal_app', { id }),
  // Agenda : texte iCal de chaque agenda (dans l'ordre des réglages), liste, ajout, import, suppression.
  calendarTexts: () => invoke<string[]>('calendar_texts'),
  getCalendars: () => invoke<CalendarInfo[]>('get_calendars'),
  addCalendar: (url: string) => invoke<SaveResult>('add_calendar', { url }),
  importCalendar: () => invoke<SaveResult>('import_calendar'),
  removeCalendar: (id: string) => invoke<SaveResult>('remove_calendar', { id }),
  // Signaux sans données venant de Rust : raccourci clavier global, perte du focus.
  onToggle: (callback: () => void) => listen('bar:toggle', callback),
  onClose: (callback: () => void) => listen('bar:close', callback),
};
