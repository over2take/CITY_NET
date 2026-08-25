// What a character's chrome does to their numbers, for showing on the sheet.
//
// Mirrored from `backend/sheets/cyberwareEffects.js`, which is authoritative: the server
// resolves every roll and a client cannot inflate one. This exists so the sheet shows the
// same number the dice will use — a skill that rolls at 9 but reads 3 on the page is worse
// than no display at all.
//
// The two must agree, so the matching rules are the same on both sides and the drift is
// covered by tests rather than by hoping. What differs is where the names come from: the
// server has its own roll table, and this reads the sheet template it is already drawing.
//
// Cyberpunk RED only. The systems differ enough that one shared implementation would be a
// worse lie than three honest ones; everything here is empty for another system.

import type { SheetTemplate } from './types';
import { statFields, skillFields } from './modTargets';
import { readRows, isSetKind, type CyberMod } from './cyberwareRows';

export const EFFECTS_SYSTEM = 'cyberpunk_red';

/**
 * What the Companion calls each CP:R stat.
 *
 * The sheet's own labels come from the template, but an import stores the names from the
 * Companion's pickers, which are the words rather than the abbreviations. Both have to
 * land on the same field.
 *
 * "Combat #" is theirs alone — a number they derive that this sheet has no field for — so
 * it is deliberately absent and a modifier naming it stays unmatched.
 */
const COMPANION_STAT_NAMES: Record<string, string> = {
  Intelligence: 'int',
  Reflexes: 'ref',
  Dexterity: 'dex',
  Technique: 'tech',
  Cool: 'cool',
  Willpower: 'will',
  Body: 'body',
  Empathy: 'emp',
  Luck: 'luck',
  Movement: 'move',
};

/**
 * A target name reduced to what it is really saying.
 *
 * The two vocabularies disagree on punctuation as well as wording — "Conceal & Reveal
 * Object" against "Conceal/Reveal Object", and the "(x2)" that marks a double-cost skill
 * is dropped by one and kept by the other. Spelling, not meaning.
 */
export const norm = (s: string): string => String(s || '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** The same, plus the trailing "Roll" the Companion appends to its roll types. */
export const normRoll = (s: string): string => norm(s).replace(/\s*\broll$/, '').trim();

/** Every name that means a stat or a skill on this sheet, pointing at its field id. */
function buildIndex(template: SheetTemplate): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of statFields(template)) index.set(norm(f.label), f.id);
  for (const f of skillFields(template)) index.set(norm(f.label), f.id);
  for (const [name, id] of Object.entries(COMPANION_STAT_NAMES)) index.set(norm(name), id);
  return index;
}

export interface ModSource {
  /** The piece of chrome responsible. */
  name: string;
  value: number;
  kind: CyberMod['kind'];
}

export interface FieldEffect {
  id: string;
  /** What the player typed. */
  base: number;
  /** What it reads as with the chrome in. */
  value: number;
  /** The difference, which is what a badge shows. */
  delta: number;
  sources: ModSource[];
}

export interface SheetEffects {
  fields: Record<string, FieldEffect>;
  /** Modifiers naming something this sheet has no field for. */
  unmatched: { name: string; target: string }[];
}

const EMPTY: SheetEffects = { fields: {}, unmatched: [] };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What the equipped chrome is doing to this sheet's fields.
 *
 * A set is applied before the adjustments, so a piece setting COOL to 3 and another adding
 * 2 leaves 5 — the other order lets the +2 piece do nothing, which reads as a bug. Two
 * pieces both setting is a real conflict with no right answer, so the highest wins and
 * both are named.
 *
 * Only equipped chrome counts, or the flag would mean nothing.
 */
export function sheetEffects(
  data: Record<string, unknown> | undefined | null,
  template: SheetTemplate | undefined,
): SheetEffects {
  if (!template || template.id !== EFFECTS_SYSTEM || !data) return EMPTY;

  const rows = readRows(data).filter((r) => r.equipped);
  if (!rows.length) return EMPTY;

  const index = buildIndex(template);
  const fields: Record<string, FieldEffect> = {};
  // Sets and adjustments are gathered apart because they combine in a fixed order, not in
  // the order the chrome happens to be listed in.
  const sets: Record<string, number> = {};
  const adds: Record<string, number> = {};
  const unmatched: SheetEffects['unmatched'] = [];

  for (const row of rows) {
    for (const mod of row.mods) {
      // Roll types are not fields, so they change no number on the page. The augmentation
      // window shows them; the sheet has nowhere to put them.
      if (mod.kind === 'roll') continue;

      const id = index.get(norm(mod.target));
      if (!id) {
        unmatched.push({ name: row.name, target: mod.target });
        continue;
      }

      const entry = fields[id] || (fields[id] = {
        id, base: num(data[id]), value: 0, delta: 0, sources: [],
      });
      if (isSetKind(mod.kind)) {
        sets[id] = sets[id] === undefined ? mod.value : Math.max(sets[id], mod.value);
      } else {
        adds[id] = (adds[id] ?? 0) + mod.value;
      }
      entry.sources.push({ name: row.name, value: mod.value, kind: mod.kind });
    }
  }

  for (const entry of Object.values(fields)) {
    const from = sets[entry.id] === undefined ? entry.base : sets[entry.id];
    entry.value = from + (adds[entry.id] ?? 0);
    entry.delta = entry.value - entry.base;
  }
  return { fields, unmatched };
}

/** The effective value of one field, or its stored value when no chrome touches it. */
export const effectiveValue = (effects: SheetEffects, id: string, stored: unknown): number =>
  (effects.fields[id]?.value ?? num(stored));

/** `Kerenzikov +2, Sandevistan +1` — what to put in a tooltip. */
export const describeSources = (effect: FieldEffect): string =>
  effect.sources
    .map((s) => (isSetKind(s.kind) ? `${s.name} = ${s.value}` : `${s.name} ${s.value >= 0 ? '+' : ''}${s.value}`))
    .join(', ');
