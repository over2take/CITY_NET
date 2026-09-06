// Cyberware mods (CWN p71), for the parts of them the sheet owns.
//
// backend/sheets/cwnCyberMods.js is authoritative: it holds the whole table and every
// number that lands in an attack roll or a token's AC. This mirror exists for two jobs the
// browser cannot ask the server to do:
//
//   1. DRAW the picker. Fitting a mod means listing all ten with what they do and what
//      they may be fitted to, which is text, not rules.
//   2. COMPUTE the two effects the client owns - System Strain, which gates installing and
//      is summed in cyberwareRows, and concealment.
//
// So `sheet` carries only those two effects. Monoblade, Targeting Processor and Hardened
// Weave's +2 all land on the server and are deliberately NOT duplicated here: a second
// copy of a number is a second place for it to be wrong. `fit` is mirrored for all ten,
// because the picker has to grey out a mod that will not take - see cwnCyberMods.test.ts,
// which walks both copies rather than trusting this comment.

import { CWN_CYBER_WEAPONS } from './cwnCyberWeapons';

/** Concealment, least obvious last - the order the book steps along. */
export const CONC_ORDER = ['obvious', 'sight', 'touch', 'medical'];

/**
 * What a mod may be fitted to.
 *
 * The book restricts most of these to a kind of system, and the server drops one that does
 * not fit rather than applying it. The picker needs the same rule so it can say so BEFORE
 * a player fits it - `note` is the reason, written to complete "needs ...".
 */
export interface FitRule {
  /** Strain the system must cost for the mod to do anything. */
  minStrain?: number;
  /** Needs the implant to grant a base AC. */
  needsBaseAc?: boolean;
  /** Needs the implant to be something you attack with. */
  needsCyberWeapon?: boolean;
  note: string;
}

/** The effects the SHEET computes. Absent where the server owns every number a mod changes. */
export interface SheetEffect {
  strain?: number;
  concSteps?: number;
  setConc?: string;
}

export interface CwnCyberMod {
  id: string;
  label: string;
  /** What it does, as the book prints it - shown in the picker and on the chip's tooltip. */
  effect: string;
  fit?: FitRule;
  sheet?: SheetEffect;
}

/** All ten, in the book's order. */
export const CWN_CYBER_MODS: CwnCyberMod[] = [
  {
    id: 'biocapacitors', label: 'BIOCAPACITORS',
    effect: 'Ignore first System Strain trigger cost per day',
  },
  {
    id: 'durable_system', label: 'DURABLE SYSTEM',
    effect: 'Sacrifice mod to negate a Major Injury',
  },
  {
    id: 'firewalled', label: 'FIREWALLED',
    effect: '-2 penalty to all rolls to hack this cybersystem',
  },
  {
    id: 'hardened_weave', label: 'HARDENED WEAVE',
    effect: '+2 AC, but Obvious and +1 Readied enc.',
    fit: { needsBaseAc: true, note: 'skin cyber that grants a base AC' },
    // The +2 itself is the server's, applied in cwnEffectiveAc. What the sheet owns is the
    // price: bolting plating on makes the system Obvious, and that is a column here.
    sheet: { setConc: 'obvious' },
  },
  {
    id: 'low_maintenance', label: 'LOW MAINTENANCE',
    effect: 'The cyber system has zero maintenance costs',
  },
  {
    id: 'monoblade', label: 'MONOBLADE',
    effect: '+1 to weapon Trauma Die, -2 dmg/Shock',
    fit: { needsCyberWeapon: true, note: 'a bladed cyber system' },
  },
  {
    id: 'profile_adjustment', label: 'PROFILE ADJUSTMENT',
    effect: 'Makes cybersystem one step less obvious',
    sheet: { concSteps: 1 },
  },
  {
    id: 'quick_detach', label: 'QUICK DETACH',
    effect: 'Detach or re-attach with 5 minutes of work',
  },
  {
    id: 'tailored_interface', label: 'TAILORED INTERFACE',
    effect: '-1 System Strain for systems with 2+ Strain',
    fit: { minStrain: 2, note: 'a system costing 2 or more Strain' },
    sheet: { strain: -1 },
  },
  {
    id: 'targeting_processor', label: 'TARGETING PROCESSOR',
    effect: '+1 to hit with Gunlink or cyber weapon',
    fit: { needsCyberWeapon: true, note: 'a cyber weapon or a Gunlink' },
  },
];

export const CWN_CYBER_MOD_BY_ID: Record<string, CwnCyberMod> =
  Object.fromEntries(CWN_CYBER_MODS.map((m) => [m.id, m]));

/**
 * Kept as its own export because it is what the cross-check test pins: the mirror carries
 * exactly three sheet-side effects, and adding a fourth should have to be deliberate.
 */
export const CWN_CYBER_MOD_SHEET_EFFECTS: Record<string, SheetEffect> =
  Object.fromEntries(CWN_CYBER_MODS.filter((m) => m.sheet).map((m) => [m.id, m.sheet!]));

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The base AC an implant grants, read the way the server reads it. */
const baseAcOf = (row: { mods?: unknown }): number => {
  let mods: unknown = row?.mods;
  if (typeof mods === 'string') { try { mods = JSON.parse(mods); } catch { return 0; } }
  if (!Array.isArray(mods)) return 0;
  let best = 0;
  for (const m of mods) {
    if (!m || typeof m !== 'object') continue;
    const mod = m as { target?: unknown; value?: unknown };
    if (String(mod.target ?? '').trim().toLowerCase() !== 'base ac') continue;
    const v = num(mod.value);
    if (v > best) best = v;
  }
  return best;
};

/** Whether this row is an implant you attack with - the same names the server matches. */
const isCyberWeapon = (row: { name?: unknown }): boolean =>
  Object.hasOwn(CWN_CYBER_WEAPONS, String(row?.name ?? '').trim().toLowerCase());

/** A row's fitted mod ids, defensively - the field is free-form JSON. */
export const fittedModIds = (row: { cyberMods?: unknown }): string[] => {
  let value: unknown = row?.cyberMods;
  if (typeof value === 'string') {
    if (value.trim() === '') return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.map(String) : [];
};

/** A row, as much of one as any of this needs. */
type ModdableRow = { name?: unknown; hl?: unknown; mods?: unknown; cyberMods?: unknown };

/** Whether a mod will actually do anything on this row. */
export const modFits = (mod: CwnCyberMod, row: ModdableRow): boolean => {
  const fit = mod.fit;
  if (!fit) return true;
  if (fit.minStrain !== undefined && num(row?.hl) < fit.minStrain) return false;
  if (fit.needsBaseAc && baseAcOf(row) <= 0) return false;
  if (fit.needsCyberWeapon && !isCyberWeapon(row)) return false;
  return true;
};

/**
 * Why a mod cannot go on this row, or null when it can.
 *
 * The picker lists every mod and greys out the ones that will not take, rather than hiding
 * them: a Monoblade missing from the list reads as the app not having it, where a greyed
 * one with "needs a bladed cyber system" beside it teaches the rule.
 */
export const unfitReason = (mod: CwnCyberMod, row: ModdableRow): string | null =>
  modFits(mod, row) ? null : `needs ${mod.fit!.note}`;

/** Only the mods that fit this row, in the order they were fitted. */
const activeSheetEffects = (row: ModdableRow): SheetEffect[] =>
  fittedModIds(row)
    .map((id) => CWN_CYBER_MOD_BY_ID[id])
    .filter((m): m is CwnCyberMod => Boolean(m) && modFits(m, row))
    .map((m) => m.sheet)
    .filter((e): e is SheetEffect => Boolean(e));

/**
 * What one implant costs in System Strain once its mods are counted.
 *
 * Tailored Interface is the reason this exists: it lowers a system's strain by a point,
 * which changes how much chrome fits, and strain is enforced when installing.
 */
export const rowStrain = (row: ModdableRow): number =>
  Math.max(0, num(row?.hl) + activeSheetEffects(row).reduce((n, e) => n + (e.strain ?? 0), 0));

/**
 * A row's concealment after its mods.
 *
 * Hardened Weave bolts plating on and forces Obvious; Profile Adjustment steps the other
 * way. Applied in that order, so a system with both is Obvious stepped down rather than
 * its original rating stepped down.
 */
export const rowConc = (row: ModdableRow & { conc?: unknown }): string => {
  const effects = activeSheetEffects(row);
  const forced = effects.reduce<string | null>((c, e) => e.setConc ?? c, null);
  const steps = effects.reduce((n, e) => n + (e.concSteps ?? 0), 0);
  const start = forced ?? String(row?.conc ?? '').trim().toLowerCase();
  const i = CONC_ORDER.indexOf(start);
  if (i < 0) return String(row?.conc ?? '');
  return CONC_ORDER[Math.min(CONC_ORDER.length - 1, i + steps)];
};
