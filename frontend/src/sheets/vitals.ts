// The vitals strip's rules (8s3b; mockup docs/mockups/vitals-strip.html, approved 2026-11-17). The strip changes the
// player's token through the HEALTH window's own route (PUT /api/locations/:id/health), so the token, the map and every
// open sheet move together; the component (components/VitalsStrip.tsx) only draws this.

import type { SheetToken } from './types';

/** What a sheet surface hands the strip, from usePlayerSheet's sheetProps: the same in SHEET.EXE and the tab. */
export interface SheetVitals {
  /** The player's own token, null with none on the map (sheets/types.ts SheetToken). */
  token: SheetToken | null;
  /** Whose sheet: with no token, CREATE HEALTH RECORD makes theirs. */
  owner: string;
  system: string;
  /** The sign-in the HEALTH window sends: the GM's or the player's, empty in Simple Mode. */
  authToken: string;
  /** The sheet's live connection, for a custom model's detail (useHealthView), as HEALTH has it. */
  socket: { emit: (event: string, ...args: unknown[]) => unknown; on: (event: string, fn: (...args: never[]) => void) => unknown; off: (event: string, fn: (...args: never[]) => void) => unknown } | null;
  /** Ask for the sheet again, the token with it. */
  reload: () => void;
}

export type VitalsAction = 'damage' | 'heal' | 'set_temp' | 'stim_heal';

/**
 * Whether the strip offers STIM: CWN's field healing (stims, medkits), which heals and adds +1 System Strain, refused
 * once strain is maxed. As the HEALTH window's STIM_HEAL; the strip has it since the panel under it leaves it out.
 */
export const hasStim = (system: string): boolean => system === 'cities_without_number';

/** The amount typed, as a whole number from 0 to 9999; anything else is 0. */
export const amountOf = (text: string): number => {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) ? Math.min(9999, Math.max(0, n)) : 0;
};

/** The body the health route takes for each, as HitPointsPanel sends it. */
export const healthBody = (action: VitalsAction, amount: number) =>
  (action === 'set_temp' ? { action, amount, hp_temp: amount } : { action, amount });

/**
 * Whether the strip offers its own amount, DAMAGE, HEAL and TEMP: one pool of hit points, as every built-in game has and a
 * custom system's `pool` model. Another model (tracks, wounds, harm, locations, typed) is changed in HEALTH ▾, its own
 * editor; a system with no health shows no strip at all.
 */
export const takesAnAmount = (model: string | null | undefined): boolean => !model || model === 'pool';
export const hasHealth = (model: string | null | undefined): boolean => model !== 'none';
