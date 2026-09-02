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
// One profile per system, mirroring the engine on the server. Most of the matching comes
// from the template this is already drawing, so a profile only has to supply the names the
// sheet does not print itself — the long attribute names a catalogue entry or an import
// would use. A system with no profile gets no effects, which is what Shadowrun does.

import type { SheetTemplate } from './types';
import { statFields, skillFields } from './modTargets';
import { readRows, isSetKind, needsPlacing, type CyberMod } from './cyberwareRows';

export const EFFECTS_SYSTEM = 'cyberpunk_red';
export const CWN_SYSTEM = 'cities_without_number';

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
const CPR_LONG_NAMES: Record<string, string> = {
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
  // Only the cost marker, not every bracket. Stripping all of them collapsed
  // "Language (Streetslang)" and "Language (Other)" onto the same skill, so a modifier on
  // one silently landed on the other — there the bracket is the whole distinction.
  .replace(/\(\s*x\s*\d+\s*\)/gi, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** The same, plus the trailing "Roll" the Companion appends to its roll types. */
export const normRoll = (s: string): string => norm(s).replace(/\s*\broll$/, '').trim();

/**
 * The attributes as Cities Without Number writes them out.
 *
 * The sheet prints the three-letter form, which the template already supplies. A modifier
 * copied off the book's cyberware table says "Dexterity", so both have to land on `dex`.
 */
const CWN_LONG_NAMES: Record<string, string> = {
  Strength: 'str',
  Dexterity: 'dex',
  Constitution: 'con',
  Intelligence: 'int',
  Wisdom: 'wis',
  Charisma: 'cha',
};

const LONG_NAMES: Record<string, Record<string, string>> = {
  [EFFECTS_SYSTEM]: CPR_LONG_NAMES,
  [CWN_SYSTEM]: CWN_LONG_NAMES,
};

/**
 * Fields chrome can move that are neither an attribute nor a skill.
 *
 * Trauma Target is one: the recompute owns its base - 6 plus the armour's mod - and a
 * piece of dermal armour adds on top. Mirrors `extraFields` on the server profile.
 */
const EXTRA_FIELDS: Record<string, Record<string, string>> = {
  [CWN_SYSTEM]: { 'Trauma Target': 'trauma_target', 'TRAUMA TGT': 'trauma_target' },
};

/** Of those, the ones the recompute rewrites, so a modifier lands after it, not before. */
const DERIVED_TARGETS: Record<string, string[]> = {
  [CWN_SYSTEM]: ['trauma_target'],
};

/**
 * CWN's attribute modifier table. 3 -> -2, 4-7 -> -1, 8-13 -> 0, 14-17 -> +1, 18+ -> +2.
 *
 * An unset attribute reads 0 and is neutral rather than "attribute 3", so a half-filled
 * sheet does not roll at -2 everywhere.
 */
const cwnMod = (stat: unknown): number => {
  const v = num(stat);
  if (v <= 0) return 0;
  if (v <= 3) return -2;
  if (v <= 7) return -1;
  if (v <= 13) return 0;
  if (v <= 17) return 1;
  return 2;
};

/**
 * What CWN recomputes from what.
 *
 * Written out rather than inferred so a derived field can name the chrome responsible: a
 * DEX MOD that moved because of a Coordination Augment should say so, the same as DEX
 * does. Mirrors the reads in cwnRecompute on the server.
 */
const CWN_DERIVED_FROM: Record<string, string[]> = {
  str_mod: ['str'], dex_mod: ['dex'], con_mod: ['con'],
  int_mod: ['int'], wis_mod: ['wis'], cha_mod: ['cha'],
  save_physical: ['str', 'con'],
  save_evasion: ['dex', 'int'],
  save_mental: ['wis', 'cha'],
  system_strain_max: ['con', 'strain_mod'],
  trauma_target: ['armor_trauma_mod'],
  mage_effort_max: ['int', 'wis', 'cast_skill'],
  spells_prepared_max: ['cast_skill'],
  summoner_effort_max: ['con', 'cha', 'summon_skill'],
};

/**
 * CWN's derived fields, computed from a sheet the chrome has already been applied to.
 *
 * Mirrors cwnRecompute in backend/sheets/templates.js, and the tests cross-check the two
 * by running the real server module over the same data. `save_luck` is deliberately absent
 * from the dependency map above: it comes from level alone, so no implant can move it.
 */
function cwnDerive(effective: Record<string, unknown>): Record<string, number> {
  const level = num(effective.level);
  const m = {
    str: cwnMod(effective.str), dex: cwnMod(effective.dex), con: cwnMod(effective.con),
    int: cwnMod(effective.int), wis: cwnMod(effective.wis), cha: cwnMod(effective.cha),
  };
  return {
    str_mod: m.str, dex_mod: m.dex, con_mod: m.con,
    int_mod: m.int, wis_mod: m.wis, cha_mod: m.cha,
    trauma_target: 6 + num(effective.armor_trauma_mod),
    save_physical: 16 - (level + Math.max(m.str, m.con)),
    save_evasion: 16 - (level + Math.max(m.dex, m.int)),
    save_mental: 16 - (level + Math.max(m.wis, m.cha)),
    system_strain_max: Math.max(0, num(effective.con) + num(effective.strain_mod)),
    mage_effort_max: Math.max(1, Math.max(m.int, m.wis) + num(effective.cast_skill)),
    spells_prepared_max: Math.ceil(level / 2) + num(effective.cast_skill),
    summoner_effort_max: Math.max(1, Math.max(m.con, m.cha) + num(effective.summon_skill)),
  };
}

const DERIVERS: Record<string, (d: Record<string, unknown>) => Record<string, number>> = {
  [CWN_SYSTEM]: cwnDerive,
};

/** Every name that means a stat or a skill on this sheet, pointing at its field id. */
function buildIndex(template: SheetTemplate): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of statFields(template)) index.set(norm(f.label), f.id);
  for (const f of skillFields(template)) index.set(norm(f.label), f.id);
  for (const [name, id] of Object.entries(LONG_NAMES[template.id] ?? {})) index.set(norm(name), id);
  for (const [name, id] of Object.entries(EXTRA_FIELDS[template.id] ?? {})) index.set(norm(name), id);
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
 * Only chrome that is both equipped and actually placed counts. Switched off is obvious;
 * unplaced matters because every import arrives that way, and eight pieces silently
 * rewriting a character's stats before anyone said where they went is not an import, it is
 * a surprise.
 */
export function sheetEffects(
  data: Record<string, unknown> | undefined | null,
  template: SheetTemplate | undefined,
): SheetEffects {
  if (!template || !LONG_NAMES[template.id] || !data) return EMPTY;

  // Installed, not merely owned. A piece still waiting for somewhere to go is in a list
  // on a sheet, not in anybody's body — a sheet reading "0 INSTALLED" beside a stat that
  // piece claims to set is the same fact contradicting itself.
  const rows = installedRows(data);
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
      // window shows them; the sheet has nowhere to put them. A note is the same, on
      // purpose: it is a number to be read rather than applied, so it is not a target that
      // failed to match and must not be reported as one.
      if (mod.kind === 'roll' || mod.kind === 'note') continue;

      const id = index.get(norm(mod.target));
      if (!id) {
        unmatched.push({ name: row.name, target: mod.target });
        continue;
      }

      const entry = fields[id] || (fields[id] = {
        id, base: num(data[id]), value: 0, delta: 0, sources: [],
      });
      if (mod.kind === 'statFloor') {
        // "Dex 14, or +2 if higher". The comparison is against the stored stat rather than
        // against what other chrome has already done to it, so two floor pieces cannot
        // bootstrap each other into paying out both the floor and the bonus.
        if (entry.base >= mod.value) adds[id] = (adds[id] ?? 0) + (mod.bonus ?? 0);
        else sets[id] = sets[id] === undefined ? mod.value : Math.max(sets[id], mod.value);
      } else if (isSetKind(mod.kind)) {
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

  applyDerived(template.id, data, fields);
  return { fields, unmatched };
}

/**
 * Add the fields a system recomputes from the ones the chrome just moved.
 *
 * Without this the page contradicts itself on CWN: DEX reads 14 with a badge while DEX MOD
 * still reads the modifier for the DEX that was typed, and every skill roll built on that
 * modifier looks wrong even though the server rolls it correctly.
 *
 * Each derived field is attributed to the chrome behind the attribute it came from, so the
 * badge on DEX MOD names the same piece the badge on DEX does. Nothing is written to the
 * sheet: this reads a copy and reports, exactly like the rest of the overlay.
 */
function applyDerived(
  system: string,
  data: Record<string, unknown>,
  fields: Record<string, FieldEffect>,
): void {
  const derive = DERIVERS[system];
  if (!derive) return;

  const moved = Object.keys(fields);
  if (!moved.length) return;

  const effective: Record<string, unknown> = { ...data };
  for (const id of moved) effective[id] = fields[id].value;

  const derivedTargets = DERIVED_TARGETS[system] ?? [];

  for (const [id, value] of Object.entries(derive(effective))) {
    // A field the chrome names directly *and* the recompute owns - Trauma Target - takes
    // the recomputed base with the modifier on top, rather than the stored value the
    // recompute just replaced.
    if (fields[id] && derivedTargets.includes(id)) {
      const entry = fields[id];
      entry.value = value + entry.delta;
      entry.base = value;
      continue;
    }
    // Only the ones that actually moved, and never one the chrome already names directly.
    const base = num(data[id]);
    if (fields[id] || value === base) continue;

    const from = (CWN_DERIVED_FROM[id] ?? []).filter((src) => fields[src]);
    if (!from.length) continue;

    const seen = new Set<string>();
    const sources: ModSource[] = [];
    for (const src of from) {
      for (const s of fields[src].sources) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        sources.push(s);
      }
    }
    fields[id] = { id, base, value, delta: value - base, sources };
  }
}

/**
 * The chrome that is actually installed and running.
 *
 * Equipped and placed, which is what "installed" means everywhere else. Shared so the
 * field effects and the roll bonuses cannot drift into answering it differently.
 */
const installedRows = (data: Record<string, unknown> | undefined | null) =>
  readRows(data).filter((r) => r.equipped && !needsPlacing(r));

/**
 * What a roll type is modified by — Initiative, Attack, Damage.
 *
 * Separate from the field effects because a roll type is not a field: no number on the
 * sheet holds it, so it can only be applied where that roll is actually made.
 *
 * Matches however it was spelled, so an imported "Initiative Roll" answers to Initiative.
 */
export function rollBonus(
  data: Record<string, unknown> | undefined | null,
  rollType: string,
  template: SheetTemplate | undefined,
): number {
  if (!template || !LONG_NAMES[template.id]) return 0;
  const wanted = normRoll(rollType);
  if (!wanted) return 0;

  return installedRows(data).reduce((sum, row) => sum + row.mods.reduce(
    (n, m) => (m.kind === 'roll' && normRoll(m.target) === wanted ? n + m.value : n),
    0,
  ), 0);
}

/** The effective value of one field, or its stored value when no chrome touches it. */
export const effectiveValue = (effects: SheetEffects, id: string, stored: unknown): number =>
  (effects.fields[id]?.value ?? num(stored));

/** `Kerenzikov +2, Sandevistan +1` — what to put in a tooltip. */
export const describeSources = (effect: FieldEffect): string =>
  effect.sources
    .map((s) => {
      if (isSetKind(s.kind)) return `${s.name} = ${s.value}`;
      // A floor's number is the floor, not what it contributed: printing "+14" beside a
      // modifier that moved a stat by two, or a derived box by one, states a total nobody
      // recognises. The name alone is the honest version, and the arrow already shows the
      // move.
      if (s.kind === 'statFloor') return `${s.name} → ${s.value}`;
      return `${s.name} ${s.value >= 0 ? '+' : ''}${s.value}`;
    })
    .join(', ');
