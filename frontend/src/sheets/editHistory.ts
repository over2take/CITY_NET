// Undo and redo for the graph view (5b1; approved mockup docs/mockups/builder-graph.html,
// 2026-10-17: "undo/redo" in the map's toolbar). Pure: what came before each edit made on the map
// or in its node panel, and what was undone. The map keeps one while it is open; FORMS has its
// boxes' own undo.
//
// Typing is one step, not one a keystroke: an edit in the same box (`key`) within SETTLE_MS of the
// one before, with nothing undone in between, joins its step. Anything else (a fold, a drag,
// AUTO-LAYOUT, or typing in another box) is a step of its own, however quick.

export interface History<T> { past: T[]; future: T[]; at: number; key: string | null }

/** How long after an edit the next one in the same box still joins it. */
export const SETTLE_MS = 800;
/** The most steps kept back. */
export const DEPTH = 100;

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], at: -Infinity, key: null });

/**
 * `before` is what an edit made at `now` replaced; `key` names the box typed in, or null for an
 * edit that is a step by itself. Anything undone is gone once a new edit is made.
 */
export const recorded = <T>(h: History<T>, before: T, now: number, key: string | null = null): History<T> => {
  if (key !== null && key === h.key && now - h.at < SETTLE_MS && h.past.length && !h.future.length) return { ...h, at: now };
  return { past: [...h.past, before].slice(-DEPTH), future: [], at: now, key };
};

/** One step back from `current`: what to show, and the history after; null with nothing to undo. */
export const undone = <T>(h: History<T>, current: T): { show: T; history: History<T> } | null => {
  if (!h.past.length) return null;
  return { show: h.past[h.past.length - 1], history: { past: h.past.slice(0, -1), future: [current, ...h.future], at: -Infinity, key: null } };
};

/** One step forward again; null with nothing undone. */
export const redone = <T>(h: History<T>, current: T): { show: T; history: History<T> } | null => {
  if (!h.future.length) return null;
  return { show: h.future[0], history: { past: [...h.past, current], future: h.future.slice(1), at: -Infinity, key: null } };
};
