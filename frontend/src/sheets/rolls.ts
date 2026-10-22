// STATS & RULES' ROLLS tab as logic (Phase 6, 6b1a; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19): a system's own rolls, read from its definition and written back. Pure, so the tab
// only draws it. The server checks every roll (backend/systemBuilder/rollStyles.js checkRolls) and
// makes them (tableRolls.js, and POST /api/systems/test-roll for TEST ROLL).
//
// A new roll starts from a preset and takes its id from its first name, kept after; its five steps
// can be replaced by another preset's, or changed one by one (6b1b1: the dice, how they are read,
// what is added, a target and the bands; 6b1b2: the special results; 6b1b3: the changes a player
// picks before rolling). ROLLED BY lists the stats, stats groups and formulas
// whose die button on the sheet rolls it. Each change keeps a roll the server takes: switching how
// the dice are read drops what only the old way used, and the last band always catches the rest.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { statGroups, formulaList } from './statsRules';

export type Sides = number | 'F';
/** A kind of dice: how many, and its size and name, or one of the system's own dice (`die`, 6c3), which brings both. */
export interface RollDice { count: string; sides?: Sides; name?: string; die?: string }
export interface RollBand { upTo?: number; label: string }
/** A change a player picks before rolling; its cost taken from a stat, or with `adds` added to it (6b3a). */
export interface RollChange { id: string; label: string; extra?: { dice: number; keep?: 'highest' | 'lowest' }; add?: string; cost?: { from: string; amount: number; adds?: boolean } }
export interface Roll {
  id: string; label?: string;
  dice: RollDice[]; read?: 'sum' | 'highest' | 'lowest' | 'count' | 'symbols'; keep?: string; at?: number; on?: string;
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
      changes: [{ id: 'push', label: 'Push yourself', extra: { dice: 1 }, cost: { from: 'stress', amount: 2, adds: true } }],
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

/**
 * One kind of dice changed: how many (formula text), its size, its name (blank for none), or one of
 * the system's own dice (6c3), which has its own faces and name, so a size or name goes with it.
 */
export const withRollDice = (def: Definition, id: string, index: number, patch: { count?: string; sides?: Sides; name?: string; die?: string }): Definition =>
  changed(def, id, (r) => ({
    ...r,
    dice: r.dice.map((d, i) => {
      if (i !== index) return d;
      const next: RollDice = { ...d, ...(patch.count !== undefined ? { count: patch.count } : {}), ...(patch.sides !== undefined ? { sides: patch.sides } : {}) };
      if (patch.sides !== undefined) delete next.die;
      if (patch.die !== undefined) {
        next.die = patch.die;
        delete next.sides;
        delete next.name;
        return next;
      }
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
 * said), successes counted at a face (5 unless said), or the symbols counted (6c3), reading what is
 * left of one (null: the numbers). What only another way used goes: a keep count, a success face,
 * cancelling, the symbol read, and a die taken away (only a sum can).
 */
export const withRollRead = (def: Definition, id: string, read: 'sum' | 'highest' | 'lowest' | 'count' | 'symbols', opts: { keep?: string; at?: number; on?: string | null } = {}): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r };
    if (read === 'symbols') {
      const on = opts.on === undefined ? r.on : opts.on;
      if (on) next.on = on; else delete next.on;
    } else delete next.on;
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

// ─── SPECIAL RESULTS (6b1b2) ───────────────────────────────────────────────

/** The highest face of a roll's first kind of dice (1 for Fate dice), what new special results start on. */
const topFace = (r: Roll): number => {
  const sides = r.dice[0]?.sides ?? 6;
  return sides === 'F' ? 1 : sides;
};
type ExplodePatch = { on?: number | null; once?: boolean; first?: boolean; low?: number | null };

/**
 * Exploding turned on (the highest face, again and again), changed, or off (null). `on` and `low`
 * take null to go back to the highest face and to no die taken away; a die is only taken away from
 * a sum.
 */
export const withRollExplode = (def: Definition, id: string, patch: ExplodePatch | null): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r };
    if (patch === null) { delete next.explode; return next; }
    const x: NonNullable<Roll['explode']> = { ...(r.explode ?? {}) };
    if (patch.on === null) delete x.on; else if (patch.on !== undefined) x.on = patch.on;
    if (patch.low === null) delete x.low; else if (patch.low !== undefined && (r.read ?? 'sum') === 'sum') x.low = patch.low;
    for (const key of ['once', 'first'] as const) {
      if (patch[key] === false) delete x[key]; else if (patch[key]) x[key] = true;
    }
    next.explode = x;
    return next;
  });

type Natural = NonNullable<Roll['natural']>[number];
type Match = NonNullable<Roll['matches']>[number];
type Effect = NonNullable<Roll['effects']>[number];
type ListOf = { natural: Natural; matches: Match; effects: Effect };

/**
 * A natural, a match or a named die's effect added (each starting on the roll's highest face, an
 * effect on its first named kind), one changed, or one taken away; an empty list goes. At most ten
 * of each (backend LIMITS.naturals); an effect needs a named kind of dice.
 */
export const withRollList = <K extends keyof ListOf>(def: Definition, id: string, key: K, change: { add: true } | { remove: number } | { set: number; patch: Partial<ListOf[K]> }): Definition =>
  changed(def, id, (r) => {
    let list = [...((r[key] ?? []) as ListOf[K][])];
    if ('add' in change) {
      if (list.length >= 10) return r;
      const face = topFace(r);
      const named = r.dice.find((d) => d.name);
      if (key === 'natural') list.push({ face, label: 'Critical', critical: 'success' } as ListOf[K]);
      else if (key === 'matches') list.push({ face, count: 2, label: 'Critical', critical: 'success' } as ListOf[K]);
      else {
        if (!named) return r;
        list.push({ name: named.name!, face: named.sides === 'F' ? 1 : named.sides, when: 'critical', label: 'Effect' } as ListOf[K]);
      }
    } else if ('remove' in change) {
      list = list.filter((_, i) => i !== change.remove);
    } else {
      list = list.map((item, i) => {
        if (i !== change.set) return item;
        const next = { ...item, ...change.patch } as Record<string, unknown>;
        // Left out, not stored empty: a match on any face, no critical, nothing added. Words stay
        // as typed, empty too, for the server to say they can't be blank.
        for (const [k, v] of Object.entries(change.patch)) if (v === undefined || v === null) delete next[k];
        if (typeof next.label === 'string') next.label = (next.label as string).slice(0, 40);
        return next as unknown as ListOf[K];
      });
    }
    const next: Roll = { ...r };
    if (list.length) (next as unknown as Record<string, unknown>)[key] = list; else delete next[key];
    return next;
  });

/** Cancelling on (each 1 takes a success away), on another face, or off; only counted successes are cancelled. */
export const withRollCancel = (def: Definition, id: string, face: number | null): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r };
    if (face === null || r.read !== 'count') delete next.cancel; else next.cancel = { face };
    return next;
  });

/** A glitch on (1s on half the dice), changed, or off. The worse one's words left blank go. */
export const withRollGlitch = (def: Definition, id: string, patch: Partial<NonNullable<Roll['glitch']>> | null): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r };
    if (patch === null) { delete next.glitch; return next; }
    const g = { ...(r.glitch ?? { face: 1, share: 0.5, label: 'Glitch' }), ...patch };
    if (typeof g.label === 'string') g.label = g.label.slice(0, 40);
    if (g.none !== undefined) { g.none = g.none.slice(0, 40); if (!g.none.trim()) delete g.none; }
    next.glitch = g;
    return next;
  });

/** The zero-dice rule on (roll 2, keep the lowest), changed, or off. */
export const withRollZero = (def: Definition, id: string, patch: Partial<NonNullable<Roll['zero']>> | null): Definition =>
  changed(def, id, (r) => {
    const next: Roll = { ...r };
    if (patch === null) delete next.zero; else next.zero = { ...(r.zero ?? { count: 2, read: 'lowest' }), ...patch };
    return next;
  });

// ─── CHANGES (6b1b3) ───────────────────────────────────────────────────────

export type ChangePatch = {
  label?: string;
  /** Extra dice, or null for none. */
  extra?: { dice: number; keep?: 'highest' | 'lowest' } | null;
  /** Formula text added to the total, or null for nothing. */
  add?: string | null;
  /** What it costs, taken from a stat or (`adds`) added to it, or null for nothing. */
  cost?: { from: string; amount: number; adds?: boolean } | null;
};

/**
 * A change a player picks before rolling: a new one (a bonus of 1, its id from its first name, kept
 * after), one changed, or one taken away. Ten at most (backend LIMITS.naturals). A change keeps at
 * least one thing it does: taking away its last leaves it adding 1.
 */
export const withRollChange = (def: Definition, id: string, change: { add: true } | { remove: number } | { set: number; patch: ChangePatch }): Definition =>
  changed(def, id, (r) => {
    let list = [...(r.changes ?? [])];
    if ('add' in change) {
      if (list.length >= 10) return r;
      list.push({ id: idFor('Bonus', list.map((c) => c.id)), label: 'Bonus', add: '1' });
    } else if ('remove' in change) {
      list = list.filter((_, i) => i !== change.remove);
    } else {
      const p = change.patch;
      list = list.map((c, i) => {
        if (i !== change.set) return c;
        const next: RollChange = { ...c };
        if (p.label !== undefined) next.label = p.label.slice(0, 40);
        if (p.extra === null) delete next.extra; else if (p.extra) next.extra = { dice: Math.max(1, Math.min(10, p.extra.dice)), ...(p.extra.keep ? { keep: p.extra.keep } : {}) };
        if (p.add === null) delete next.add; else if (p.add !== undefined) next.add = p.add;
        if (p.cost === null) delete next.cost; else if (p.cost) next.cost = { from: p.cost.from, amount: Math.max(1, Math.min(100, p.cost.amount)), ...(p.cost.adds ? { adds: true } : {}) };
        if (next.extra === undefined && next.add === undefined) next.add = '1';
        return next;
      });
    }
    const next: Roll = { ...r };
    if (list.length) next.changes = list; else delete next.changes;
    return next;
  });

/** What a change can cost: each stat, by id, in players' names. */
export const costables = (def: Definition): { id: string; label: string }[] =>
  statGroups(def).flatMap((g) => g.stats).map((st) => ({ id: st.id, label: (st.label || st.id).toUpperCase() }));

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

const die = (sides: Sides | undefined) => (sides === 'F' ? 'dF' : `d${sides ?? '?'}`);
/** A kind of dice in words: its size, or the system's own die by name. */
const diceName = (d: RollDice, def?: Definition) => {
  if (d.die === undefined) return die(d.sides);
  const own = Array.isArray(def?.dice) ? (def!.dice as { id?: string; name?: string }[]).find((x) => x && x.id === d.die) : undefined;
  return upper(own?.name ?? d.die);
};
/** A symbol's name, for what a roll reads. */
const symbolName = (id: string, def?: Definition) => upper((Array.isArray(def?.symbols) ? (def!.symbols as { id?: string; name?: string }[]).find((x) => x && x.id === id)?.name : undefined) ?? id);
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

/** A roll's five steps in the tab's words (6b1a shows them; 6b1b edits them); the system's own dice and symbols by name (6c3). */
export const stepsOf = (r: Roll, def?: Definition) => ({
  dice: r.dice.map((d) => `${d.count} × ${diceName(d, def)}${d.name ? ` · ${upper(d.name)}` : ''}`),
  read: r.read === 'highest' ? `KEEP HIGHEST ${r.keep ?? '1'}` : r.read === 'lowest' ? `KEEP LOWEST ${r.keep ?? '1'}`
    : r.read === 'count' ? `COUNT AT ${r.at}+` : r.read === 'symbols' ? `COUNT THE SYMBOLS${r.on ? ` · ${symbolName(r.on, def)} LEFT` : ''}` : 'SUM',
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
    ...(c.cost ? [c.cost.adds ? `ADDS ${c.cost.amount} ${upper(c.cost.from)}` : `COSTS ${c.cost.amount} ${upper(c.cost.from)}`] : []),
  ].join(' · ')),
});
