// The vitals strip's rules (8s3b; mockup docs/mockups/vitals-strip.html, approved 2026-11-17). The strip changes the
// player's token through the HEALTH window's own route (PUT /api/locations/:id/health), so the token, the map and every
// open sheet move together; the component (components/VitalsStrip.tsx) only draws this.

import type { SheetToken, SheetTemplate } from './types';
import { partOn } from './parts';

/** The armor class the box shows: its name; a ranged one's, shown always or (`rangedWhenSet`) only when it differs. */
export interface Defense { label: string; ranged?: string; rangedWhenSet?: boolean }

/**
 * The token's armor class as this game has it, for the vitals box (8s3c; the user, 2026-11-17: "dynamic to the system",
 * one AC, two, or none), as the token menu has it:
 * - a sheet field linked to it names it, in the game's own words (Shadowrun's ARMOR, a built system's field), and a
 *   second linked to the ranged one (CWN's MELEE AC and RANGED AC) shows both, always;
 * - else none where the game keeps its defense on the sheet (Cyberpunk's SP) or a built system has combat off;
 * - else the token's own, as its menu shows it (MELEE_AC, RANGED_AC): the game's word for it, AC unless it says, and the
 *   ranged one only where the GM set it apart from the melee one.
 */
export const defenseOf = (template: SheetTemplate): Defense | null => {
  const fields = template.sections.flatMap((s) => s.fields ?? []);
  const melee = fields.find((f) => f.source === 'token_ac');
  const ranged = fields.find((f) => f.source === 'token_ac_ranged');
  if (melee) return { label: melee.label.toUpperCase(), ...(ranged ? { ranged: ranged.label.toUpperCase() } : {}) };
  if (template.tokenDefense?.editOnToken === false || !partOn(template.id, 'combat')) return null;
  const label = (template.tokenDefense?.label ?? 'AC').toUpperCase();
  return { label, ranged: `RANGED ${label}`, rangedWhenSet: true };
};

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
 * custom system's `pool` model, and two tracks with a picker for which (8s3d1). Another model (wounds, harm, locations,
 * typed) shows its summary and is changed in HEALTH ▾, its own editor; a system with no health shows no strip at all.
 */
export const takesAnAmount = (model: string | null | undefined): boolean => !model || model === 'pool' || model === 'tracks';
export const hasHealth = (model: string | null | undefined): boolean => model !== 'none';
