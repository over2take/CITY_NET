// Which window is in front - the one that is focused, the way a desktop OS has one.
//
// Every open window registers how high it is stacked. The highest is the focused one: it
// keeps the solid title bar and answers Esc; the rest show an outlined, inactive bar. Kept
// outside React so every window can read it without a provider wrapped round the app.

import { useSyncExternalStore } from 'react';

const stacked = new Map<symbol, number>();
const listeners = new Set<() => void>();

let top = 0;
const recompute = () => {
  top = stacked.size ? Math.max(...stacked.values()) : 0;
  listeners.forEach((l) => l());
};

/** A window is at this height now (it opened, or it was brought to the front). */
export const setStacked = (id: symbol, z: number) => { stacked.set(id, z); recompute(); };

/** A window closed; whichever is highest of the rest becomes the focused one. */
export const unstack = (id: symbol) => { stacked.delete(id); recompute(); };

/** How high the focused window is. */
export const focusedZ = () => top;

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Whether the window stacked at `z` is the focused one. */
export const useIsFocused = (z: number) => useSyncExternalStore(subscribe, () => top === z);

/**
 * Where each kind of window was last left, per browser.
 *
 * Keyed by the program name at the front of the title - "SHOP.EXE · VIC'S ARMS" is kept as
 * SHOP.EXE - so every shop opens where the last one was, whichever building it is.
 * Wrapped because storage can be refused (private windows); then nothing is remembered.
 */
export const windowKey = (title: string) => title.split(/ · | — /)[0].trim();

const STORAGE = 'citynet_window_pos';

const readAll = (): Record<string, { x: number; y: number }> => {
  try { return JSON.parse(localStorage.getItem(STORAGE) || '{}') ?? {}; } catch { return {}; }
};

export const rememberedPos = (key: string): { x: number; y: number } | null => {
  const p = readAll()[key];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
};

export const rememberPos = (key: string, pos: { x: number; y: number }) => {
  try {
    const all = readAll();
    all[key] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    localStorage.setItem(STORAGE, JSON.stringify(all));
  } catch { /* storage refused: nothing is remembered */ }
};
