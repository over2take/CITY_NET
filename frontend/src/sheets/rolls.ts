// STATS & RULES' ROLLS tab as logic (Phase 6, 6b1a; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19): a system's own rolls, read from its definition and written back. Pure, so the tab
// only draws it. The server checks every roll (backend/systemBuilder/rollStyles.js checkRolls) and
// makes them (tableRolls.js, and POST /api/systems/test-roll for TEST ROLL).
//
// A new roll starts from a preset and takes its id from its first name, kept after; its five steps
// can be replaced by another preset's, or changed one by one (6b1b: the dice, how they are read,
// what is added, a target and the bands here). ROLLED BY lists the stats, stats groups and formulas
// whose die button on the sheet rolls it. Each change keeps a roll the server takes: switching how
// the dice are read drops what only the old way used, and the last band always catches the rest.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { statGroups, formulaList } from './statsRules';

export type Sides = number | 'F';
export interface RollDice { count: string; sides: Sides; name?: string }
export interface RollBand { upTo?: number; label: string }
export interface RollChange { id: string; label: string; extra?: { dice: number; keep?: 'highest' | 'lowest' }; add?: string; cost?: { from: string; amount: number } }
export interface Roll {
  id: string; label?: string;
  dice: RollDice[]; read?: 'sum' | 'highest' | 'lowest' | 'count'; keep?: string; at?: number;
  add?: string; against?: string; under?: boolean; bands?: RollBand[];
  explode?: { on?: number; once?: boolean; low?: number; first?: boolean };
  natural?: { face: number; label: string; critical?: 'success' | 'failure' }[];
  matches?: { face?: number; count: number; adds?: number; label: string; critical?: 'success' | 'failure' }[];
  cancel?: { face: number };
  glitch?: { face: number; share: number; label: string; none?: string };
  effects?: { name: string; face: number; when: 'critical' | 'success' | 'failure' | 'any'; label: string }[];
  zero?: { count: number; read: 'highest' | 'lowest' };
  changes?: RollChange[];
  by?: string[];
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The presets a roll starts from: backend rollStyles.js PRESETS, held equal by a test. */
export const PRESETS: Record<string, { label: string; roll: Omit<Roll, 'id'> }> = {
  dnd: {
    label: 'D&D check',
    roll: {
      dice: [{ count: '1', sides: 20 }], add: '@this_mod',
      natural: [{ face: 20, label: 'Natural 20', critical: 'success' }, { face: 1, label: 'Natural 1', critical: 'failure' }],
      changes: [{ id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } }, { id: 'disadvantage', label: 'Disadvantage', extra: { dice: 1, keep: 'lowest' } }],
    },
  },
  pbta: {
    label: 'PbtA move',
    roll: {
      dice: [{ count: '2', sides: 6 }], add: '@this',
      bands: [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Success at a cost' }, { label: 'Full success' }],
      changes: [{ id: 'forward', label: 'Forward +1', add: '1' }],
    },
  },
  blades: {
    label: 'Blades action',
    roll: {
      dice: [{ count: '@this', sides: 6 }], read: 'highest', zero: { count: 2, read: 'lowest' },
      matches: [{ face: 6, count: 2, label: 'Critical', critical: 'success' }],
      bands: [{ upTo: 3, label: 'Bad outcome' }, { upTo: 5, label: 'Partial success' }, { label: 'Full success' }],
      changes: [{ id: 'push', label: 'Push yourself', extra: { dice: 1 }, cost: { from: 'stress', amount: 2 } }],
    },
  },
  vampire: {
    label: 'Vampire pool',
    roll: {
      dice: [{ count: 'max(0, @this + @tie - @hunger)', sides: 10 }, { count: 'min(@hunger, @this + @tie)', sides: 10, name: 'Hunger' }],
      read: 'count', at: 6,
      matches: [{ face: 10, count: 2, adds: 2, label: 'Critical', critical: 'success' }],
      effects: [{ name: 'Hunger', face: 10, when: 'critical', label: 'Messy critical' }, { name: 'Hunger', face: 1, when: 'failure', label: 'Bestial failure' }],
    },
  },
  fate: {
    label: 'Fate check',
    roll: {
      dice: [{ count: '4', sides: 'F' }], add: '@this',
      bands: [
        { upTo: -2, label: 'Terrible' }, { upTo: -1, label: 'Poor' }, { upTo: 0, label: 'Mediocre' }, { upTo: 1, label: 'Average' },
        { upTo: 2, label: 'Fair' }, { upTo: 3, label: 'Good' }, { upTo: 4, label: 'Great' }, { upTo: 5, label: 'Superb' },
        { upTo: 6, label: 'Fantastic' }, { upTo: 7, label: 'Epic' }, { label: 'Legendary' },
      ],
      changes: [{ id: 'invoke', label: 'Invoke an aspect', add: '2', cost: { from: 'fate_points', amount: 1 } }],
    },
  },
  cwn_skill: { label: 'CWN skill check', roll: { dice: [{ count: '2', sides: 6 }], add: '@this + @tie_mod' } },
  cwn_save: { label: 'CWN save', roll: { dice: [{ count: '1', sides: 20 }], against: '@this' } },
  cpr: {
    label: 'CP:R check',
    roll: {
      dice: [{ count: '1', sides: 10 }], add: '@this + @tie',
      explode: { on: 10, low: 1, once: true, first: true },
      natural: [{ face: 10, label: 'Critical success', critical: 'success' }, { face: 1, label: 'Critical failure', critical: 'failure' }],
    },
  },
  sr6: {
    label: 'SR6 pool',
    roll: {
      dice: [{ count: 'max(1, @this + @tie)', sides: 6 }], read: 'count', at: 5,
      glitch: { face: 1, share: 0.5, label: 'Glitch', none: 'Critical glitch' },
    },
  },
};

/** A system's rolls, as stored. */
export const rollList = (def: Definition): Roll[] =>
  (Array.isArray(def.rolls) ? def.rolls.filter((r) => isObject(r) && typeof (r as Obj).id === 'string') as unknown as Roll[] : []);

const withRolls = (def: Definition, rolls: Roll[]): Definition => {
  const next: Definition = { ...def };
  if (rolls.length) next.rolls = rolls; else delete next.rolls;
  return next;
};
const changed = (def: Definition, id: string, change: (r: Roll) => Roll): Definition =>
  withRolls(def, rollList(def).map((r) => (r.id === id ? change(r) : r)));

/** A new roll from a preset, named after it: the system after, and the new roll's id. */
export const withNewRoll = (def: Definition, preset: string): { definition: Definition; id: string } | null => {
  const p = PRESETS[preset];
  if (!p) return null;
  const id = idFor(p.label, rollList(def).map((r) => r.id));
  return { definition: withRolls(def, [...rollList(def), { id, label: p.label, ...clone(p.roll) }]), id };
};

/** A roll's five steps replaced by a preset's; its id, name and ROLLED BY kept. */
export const withRollPreset = (def: Definition, id: string, preset: string): Definition => {
  const p = PRESETS[preset];
  if (!p) return def;
  return changed(def, id, (r) => ({ id: r.id, ...(r.label !== undefined ? { label: r.label } : {}), ...clone(p.roll), ...(r.by ? { by: r.by } : {}) }));
};

/** A roll renamed; its id stays. A blank name shows its id, so it isn't stored. */
export const withRollLabel = (def: Definition, id: string, label: string): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r, label: label.slice(0, 40) };
    if (!label.trim()) delete next.label;
    return next;
  });

/** A stat, stats group or formula added to what a roll is ROLLED BY, or taken off it. */
export const withRolledBy = (def: Definition, id: string, target: string, on: boolean): Definition =>
  changed(def, id, (r) => {
    const by = (r.by ?? []).filter((b) => b !== target);
    const next: Roll = { ...r, by: on ? [...by, target] : by };
    if (!next.by?.length) delete next.by;
    return next;
  });

/** A roll removed. */
export const withoutRoll = (def: Definition, id: string): Definition => withRolls(def, rollList(def).filter((r) => r.id !== id));

// ─── THE STEPS, ONE BY ONE (6b1b) ───────────────────────────────────────────

/** The die sizes the picker offers; any other 2 to 100 can still be typed (backend LIMITS.sides). */
export const SIDES: Sides[] = [2, 3, 4, 6, 8, 10, 12, 20, 100, 'F'];

/** One kind of dice changed: how many (formula text), its size, its name (blank for none). */
export const withRollDice = (def: Definition, id: string, index: number, patch: { count?: string; sides?: Sides; name?: string }): Definition =>
  changed(def, id, (r) => ({
    ...r,
    dice: r.dice.map((d, i) => {
      if (i !== index) return d;
      const next: RollDice = { ...d, ...(patch.count !== undefined ? { count: patch.count } : {}), ...(patch.sides !== undefined ? { sides: patch.sides } : {}) };
      if (patch.name !== undefined) {
        if (patch.name.trim()) next.name = patch.name.slice(0, 40); else delete next.name;
      }
      return next;
    }),
  }));

/** Another kind of dice, one d6 to start; at most six kinds (backend LIMITS.groups). */
export const withRollDiceAdded = (def: Definition, id: string): Definition =>
  changed(def, id, (r) => (r.dice.length >= 6 ? r : { ...r, dice: [...r.dice, { count: '1', sides: 6 }] }));

/**
 * A kind of dice taken away; a roll keeps at least one. A named die's effects go with it, since
 * they would name dice the roll no longer has.
 */
export const withRollDiceRemoved = (def: Definition, id: string, index: number): Definition =>
  changed(def, id, (r) => {
    if (r.dice.length <= 1 || !r.dice[index]) return r;
    const gone = r.dice[index].name;
    const next: Roll = { ...r, dice: r.dice.filter((_, i) => i !== index) };
    if (gone && !next.dice.some((d) => d.name === gone) && next.effects) {
      next.effects = next.effects.filter((e) => e.name !== gone);
      if (!next.effects.length) delete next.effects;
    }
    return next;
  });

/**
 * How the dice are read: summed, the highest or lowest kept (how many, formula text, 1 unless
 * said), or successes counted at a face (5 unless said). What only another way used goes: a keep
 * count, a success face, cancelling, and a die taken away (only a sum can).
 */
export const withRollRead = (def: Definition, id: string, read: 'sum' | 'highest' | 'lowest' | 'count', opts: { keep?: string; at?: number } = {}): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r };
    if (read === 'sum') delete next.read; else next.read = read;
    if (read === 'highest' || read === 'lowest') {
      const keep = opts.keep ?? r.keep;
      if (keep !== undefined && keep !== '1') next.keep = keep; else delete next.keep;
    } else delete next.keep;
    if (read === 'count') next.at = opts.at ?? r.at ?? 5;
    else { delete next.at; delete next.cancel; }
    if (read !== 'sum' && next.explode?.low !== undefined) {
      next.explode = { ...next.explode };
      delete next.explode.low;
    }
    return next;
  });

/** What is added to the dice (formula text); blank for nothing. */
export const withRollAdd = (def: Definition, id: string, text: string): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r, add: text };
    if (!text.trim()) delete next.add;
    return next;
  });

/** A target to meet (formula text), at or over it, or at or under with `under`; blank for none. */
export const withRollAgainst = (def: Definition, id: string, text: string, under?: boolean): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r, against: text };
    if (under !== undefined) next.under = under;
    if (!next.under) delete next.under;
    if (!text.trim()) { delete next.against; delete next.under; }
    return next;
  });

/**
 * The bands, as a table's (statsRules.ts withBands): bands to start, one under the last that
 * catches the rest, one taken away (never that last one), one's top or words changed, or none.
 */
export const withRollBands = (def: Definition, id: string, change: { start: true } | { add: true } | { remove: number } | { set: number; upTo?: number; label?: string } | { none: true }): Definition =>
  changed(def, id, (r) => {
    let bands = [...(r.bands ?? [])];
    if ('none' in change) {
      const next: Roll = { ...r };
      delete next.bands;
      return next;
    }
    if ('start' in change) {
      if (bands.length) return r;
      bands = [{ upTo: 6, label: 'Miss' }, { label: 'Hit' }];
    } else if ('add' in change) {
      if (bands.length >= 20) return r;
      const closed = bands.filter((b) => b.upTo !== undefined);
      const upTo = closed.length ? closed[closed.length - 1].upTo! + 1 : 0;
      bands.splice(Math.max(0, bands.length - 1), 0, { upTo, label: 'New band' });
    } else if ('remove' in change) {
      if (change.remove >= bands.length - 1) return r;
      bands = bands.filter((_, i) => i !== change.remove);
    } else {
      bands = bands.map((b, i) => (i === change.set ? {
        ...b, ...(change.upTo !== undefined && i < bands.length - 1 ? { upTo: change.upTo } : {}), ...(change.label !== undefined ? { label: change.label.slice(0, 40) } : {}),
      } : b));
    }
    return { ...r, bands };
  });

/** What a roll can be ROLLED BY: the stats groups, then each stat, then the formulas. */
export const rollables = (def: Definition): { id: string; label: string; kind: 'group' | 'stat' | 'formula' }[] => [
  ...statGroups(def).map((g) => ({ id: g.id, label: (g.label || g.id).toUpperCase(), kind: 'group' as const })),
  ...statGroups(def).flatMap((g) => g.stats).map((s) => ({ id: s.id, label: (s.label || s.id).toUpperCase(), kind: 'stat' as const })),
  ...formulaList(def).map((f) => ({ id: f.id, label: (f.label || f.id).toUpperCase(), kind: 'formula' as const })),
];

/** The fields a roll is ROLLED BY, in its order: a stats group as its stats (backend tableRolls.js fieldsRolledBy). */
export const fieldsRolledBy = (def: Definition, r: Roll): string[] => {
  const out: string[] = [];
  for (const id of r.by ?? []) {
    const group = statGroups(def).find((g) => g.id === id);
    for (const f of group ? group.stats.map((s) => s.id) : [id]) if (!out.includes(f)) out.push(f);
  }
  return out;
};

const die = (sides: Sides) => (sides === 'F' ? 'dF' : `d${sides}`);
const upper = (s: string) => s.toUpperCase();
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** A number as the tab writes it, with a real minus sign. */
const num = (n: number) => (n < 0 ? `−${-n}` : String(n));

/**
 * A band's range in words, as PbtA writes them (6− · 7–9 · 10+): up to its own top, from just over
 * the last one's. A range with a negative number is spelled out (−2 OR LESS, −1 TO 0), so no two
 * minus signs meet.
 */
const bandWhen = (bands: RollBand[], i: number): string => {
  const b = bands[i];
  const from = i > 0 ? bands[i - 1].upTo : undefined;
  if (b.upTo === undefined) return from === undefined ? 'ANY' : from + 1 < 0 ? `${num(from + 1)} OR MORE` : `${from + 1}+`;
  if (from === undefined) return b.upTo < 0 ? `${num(b.upTo)} OR LESS` : `${b.upTo}−`;
  if (from + 1 === b.upTo) return num(b.upTo);
  return from + 1 < 0 ? `${num(from + 1)} TO ${num(b.upTo)}` : `${from + 1}–${b.upTo}`;
};

/** A roll's five steps in the tab's words (6b1a shows them; 6b1b edits them). */
export const stepsOf = (r: Roll) => ({
  dice: r.dice.map((d) => `${d.count} × ${die(d.sides)}${d.name ? ` · ${upper(d.name)}` : ''}`),
  read: r.read === 'highest' ? `KEEP HIGHEST ${r.keep ?? '1'}` : r.read === 'lowest' ? `KEEP LOWEST ${r.keep ?? '1'}`
    : r.read === 'count' ? `COUNT AT ${r.at}+` : 'SUM',
  add: r.add ?? null,
  against: r.against !== undefined ? `${r.against} · ${r.under ? 'AT OR UNDER SUCCEEDS' : 'AT OR OVER SUCCEEDS'}` : null,
  bands: (r.bands ?? []).map((b, i, all) => [bandWhen(all, i), upper(b.label)] as [string, string]),
  special: [
    ...(r.explode ? [`EXPLODES ON ${r.explode.on ?? 'THE HIGHEST FACE'}${r.explode.once ? ', ONCE' : ''}${r.explode.low !== undefined ? ` · ${r.explode.low} TAKES ONE AWAY` : ''}${r.explode.first ? ' · FIRST DIE ONLY' : ''}`] : []),
    ...(r.natural ?? []).map((n) => `NATURAL ${n.face} · ${upper(n.label)}`),
    ...(r.matches ?? []).map((m) => `${m.count} × ${m.face ?? 'ANY ONE FACE'} · ${upper(m.label)}${m.adds ? ` · ${signed(m.adds)}` : ''}`),
    ...(r.cancel ? [`EACH ${r.cancel.face} CANCELS A SUCCESS`] : []),
    ...(r.glitch ? [`${r.glitch.face}s ON ${Math.round(r.glitch.share * 100)}% OF THE DICE · ${upper(r.glitch.label)}${r.glitch.none ? ` (${upper(r.glitch.none)} WITH NO SUCCESS)` : ''}`] : []),
    ...(r.effects ?? []).map((e) => `${upper(e.name)} ${e.face} ${e.when === 'any' ? 'ON ANY ROLL' : `ON A ${upper(e.when)}`} · ${upper(e.label)}`),
    ...(r.zero ? [`NO DICE · ROLL ${r.zero.count}, KEEP THE ${upper(r.zero.read)}`] : []),
  ],
  changes: (r.changes ?? []).map((c) => [
    upper(c.label),
    ...(c.extra ? [`+${c.extra.dice} ${c.extra.dice === 1 ? 'DIE' : 'DICE'}${c.extra.keep ? `, KEEP THE ${upper(c.extra.keep)}` : ''}`] : []),
    ...(c.add ? [`+ ${c.add}`] : []),
    ...(c.cost ? [`COSTS ${c.cost.amount} ${upper(c.cost.from)}`] : []),
  ].join(' · ')),
});
