// The builder's LEVELS page as logic (7d1; approved mockup docs/mockups/level-up.html, 2026-11-07): how a
// system's characters advance, the highest level, and the XP table, filled from what level 2 costs and a
// multiplier for each range of levels, any of it typed over. Pure, so the page only draws it. The server's
// copy of the table is backend systemBuilder/levels.js, held to this by the test.

import type { Definition } from './systemsApi';
import { toggleAdvancement } from './setup';

export interface LevelRange { to: number; x: number }
export interface LevelsSet { top: number; first: number; ranges: LevelRange[]; typed: Record<string, number> }

export const MOST_LEVEL = 30;
const MOST_XP = 1000000000000;
/** What each range can multiply by, as the page offers it. */
export const MULTIPLIERS = [1.5, 2, 3];
const DEFAULTS: LevelsSet = { top: 10, first: 300, ranges: [{ to: 10, x: 2 }], typed: {} };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What is stored, as it is: a highest level being typed may not read yet. */
const stored = (d: Definition): Partial<LevelsSet> => (isObject(d.levels) ? d.levels as Partial<LevelsSet> : {});
/** The highest level the table reaches: what is stored, or the default while that doesn't read. */
const topOf = (top: unknown): number => (Number.isInteger(top) && (top as number) >= 2 && (top as number) <= MOST_LEVEL ? top as number : DEFAULTS.top);

/** The first range starts at level 1, each after the one before ends, and the last reaches the highest level. */
export const tidyRanges = (ranges: LevelRange[], top: number): LevelRange[] => {
  const out: LevelRange[] = [];
  let from = 1;
  for (const r of ranges) {
    if (from > top) break;
    out.push({ to: Math.max(from, 2, r.to), x: r.x });
    from = out[out.length - 1].to + 1;
  }
  if (!out.length) return [{ to: top, x: 2 }];
  out[out.length - 1] = { ...out[out.length - 1], to: top };
  return out;
};

/** A system's levels, with what it leaves unsaid filled in, its ranges tidied. */
export const levelsSet = (d: Definition): LevelsSet => {
  const s = stored(d);
  const top = topOf(s.top);
  return {
    top,
    first: Number.isInteger(s.first) && (s.first as number) >= 1 ? s.first as number : DEFAULTS.first,
    ranges: tidyRanges(Array.isArray(s.ranges) && s.ranges.length ? s.ranges : DEFAULTS.ranges, top),
    typed: isObject(s.typed) ? s.typed as Record<string, number> : {},
  };
};

/** The running total of XP to reach each level from 2 (backend levels.js levelTable). */
export const levelTable = (d: Definition): Record<number, number> => {
  const { top, first, ranges, typed } = levelsSet(d);
  const table: Record<number, number> = {};
  let cost = first;
  let total = 0;
  for (let level = 2; level <= top; level += 1) {
    if (level > 2) cost *= (ranges.find((r) => level <= r.to) ?? ranges[ranges.length - 1]).x;
    total = Math.min(MOST_XP, total + Math.round(cost));
    table[level] = Number.isInteger(typed[level]) ? typed[level] : total;
  }
  return table;
};

/** Levels typed over that don't climb, in the server's words (backend levels.js checkLevels). */
export const levelNotes = (d: Definition): string[] => {
  const { top, typed } = levelsSet(d);
  const table = levelTable(d);
  const notes: string[] = [];
  for (let level = 3; level <= top; level += 1) {
    const touched = typed[level] !== undefined || typed[level - 1] !== undefined;
    if (touched && table[level] <= table[level - 1]) notes.push(`Level ${level} needs more than level ${level - 1}, ${table[level - 1]}`);
  }
  return notes;
};

/** MAX HEALTH (7d4; backend levels.js healthOf): AS IT IS, the token's own number, A FORMULA, or PER LEVEL (7d5a). */
export type HealthHow = 'as_is' | 'formula' | 'level';
export type HealthDieOn = 'class' | 'all';
export type HealthGainBy = 'average' | 'roll' | 'choose' | 'reroll';
export interface HealthSet { how: HealthHow; formula: string; dieOn: HealthDieOn; die: number | null; adds: string; gain: HealthGainBy }
const GAINS: HealthGainBy[] = ['average', 'roll', 'choose', 'reroll'];
/** What each way of gaining says, under GAINED BY (7d5b). */
export const GAIN_WORDS: Record<HealthGainBy, string> = {
  average: 'Half the die, rounded up, every time. Nothing to roll.',
  roll: 'Rolled each level in the tray, for the table to see, and kept once rolled. Only the GM clears it.',
  choose: 'Each level, the player takes the average or rolls and keeps what comes up.',
  reroll: 'Each level, every level is rolled again with what each level adds; over the current maximum, that is the new maximum, otherwise +1. As Cities Without Number does.',
};
const HOWS: HealthHow[] = ['as_is', 'formula', 'level'];
export const healthSet = (d: Definition): HealthSet => {
  const raw = (isObject(d.levels) ? d.levels : {}) as Record<string, unknown>;
  const h = isObject(raw.health) ? raw.health : {};
  return {
    how: HOWS.includes(h.how as HealthHow) ? h.how as HealthHow : 'as_is',
    formula: typeof h.formula === 'string' ? h.formula : '',
    dieOn: h.die_on === 'all' ? 'all' : 'class',
    die: Number.isInteger(h.die) ? h.die as number : null,
    adds: typeof h.adds === 'string' ? h.adds : '',
    gain: GAINS.includes(h.gain as HealthGainBy) ? h.gain as HealthGainBy : 'average',
  };
};
const withHealthSet = (d: Definition, h: HealthSet): Definition => {
  const levels = { ...(isObject(d.levels) ? d.levels as Record<string, unknown> : {}) };
  const kept = {
    ...(h.formula ? { formula: h.formula } : {}), ...(h.dieOn === 'all' ? { die_on: 'all' } : {}),
    ...(h.die !== null ? { die: h.die } : {}), ...(h.adds ? { adds: h.adds } : {}), ...(h.gain !== 'average' ? { gain: h.gain } : {}),
  };
  if (h.how === 'as_is' && !Object.keys(kept).length) delete levels.health;
  else levels.health = { how: h.how, ...kept };
  return { ...d, levels };
};
/** How max health is set. What the others had is kept, for going back to them. */
export const withHealth = (d: Definition, how: HealthHow): Definition => withHealthSet(d, { ...healthSet(d), how });
export const withHealthFormula = (d: Definition, formula: string): Definition => withHealthSet(d, { ...healthSet(d), formula });
/** PER LEVEL (7d5a): the die is each class's HIT DIE, or one for all, which then starts at a d8. */
export const withHealthDieOn = (d: Definition, dieOn: HealthDieOn): Definition => withHealthSet(d, { ...healthSet(d), dieOn, die: dieOn === 'all' ? healthSet(d).die ?? 8 : healthSet(d).die });
export const withHealthDie = (d: Definition, die: number): Definition => withHealthSet(d, { ...healthSet(d), die });
export const withHealthAdds = (d: Definition, adds: string): Definition => withHealthSet(d, { ...healthSet(d), adds });
/** How a level's health is gained (7d5b). */
export const withHealthGain = (d: Definition, gain: HealthGainBy): Definition => withHealthSet(d, { ...healthSet(d), gain });

/** Each class's HIT DIE, for ON EACH CLASS: [{ name, die }], die null where it has none. */
export const classDice = (d: Definition): { name: string; die: number | null }[] =>
  (Array.isArray(d.choices) ? d.choices as Array<{ levelled?: unknown; options?: Array<{ id?: unknown; label?: unknown; die?: unknown }> }> : [])
    .filter((l) => l?.levelled === true)
    .flatMap((l) => (Array.isArray(l.options) ? l.options : []).map((o) => ({ name: String(o.label || o.id || ''), die: Number.isInteger(o.die) ? o.die as number : null })));

/** Said when going up has nothing to show it on: no levelled list, and no stat or formula called level (7d2b). */
export const levelHomeNote = (d: Definition): string | null => {
  const lists = Array.isArray(d.choices) ? d.choices as Array<{ levelled?: unknown }> : [];
  const groups = Array.isArray(d.stats) ? d.stats as Array<{ stats?: Array<{ id?: unknown }> }> : [];
  const derived = Array.isArray(d.derived) ? d.derived as Array<{ id?: unknown }> : [];
  const has = lists.some((l) => l?.levelled === true) || groups.some((g) => (g?.stats ?? []).some((s) => s?.id === 'level')) || derived.some((f) => f?.id === 'level');
  return has || !(advancesBy(d, 'levels') || advancesBy(d, 'milestone')) ? null
    : 'Nothing on the sheet shows a level yet. It is still counted: make a list in CHOICES levelled, or add a stat called level, to see it.';
};

const write = (d: Definition, next: Partial<LevelsSet>): Definition => {
  const now = levelsSet(d);
  const raw = stored(d);
  // Whatever else levels holds (MAX HEALTH, 7d4) is kept as it is.
  const merged = { ...raw, top: raw.top ?? now.top, first: raw.first ?? now.first, ranges: now.ranges, typed: now.typed, ...next };
  const { typed, ...rest } = merged;
  return { ...d, levels: { ...rest, ranges: tidyRanges(rest.ranges, topOf(rest.top)), ...(Object.keys(typed).length ? { typed } : {}) } };
};

/** What the boxes show: what was typed, while it may not read yet, or what it comes to. */
export const topAsTyped = (d: Definition): number => (Number.isInteger(stored(d).top) ? stored(d).top as number : levelsSet(d).top);
export const firstAsTyped = (d: Definition): number => (Number.isInteger(stored(d).first) ? stored(d).first as number : levelsSet(d).first);

/** The highest level, as typed: the ranges follow once it reads. */
export const withTop = (d: Definition, top: number): Definition => write(d, { top });
export const withFirst = (d: Definition, first: number): Definition => write(d, { first });

export const withRangeTo = (d: Definition, i: number, to: number): Definition =>
  write(d, { ranges: levelsSet(d).ranges.map((r, n) => (n === i ? { ...r, to } : r)) });
export const withRangeX = (d: Definition, i: number, x: number): Definition =>
  write(d, { ranges: levelsSet(d).ranges.map((r, n) => (n === i ? { ...r, x } : r)) });
/** Taken off: the one after it starts earlier, or the one before reaches the top. */
export const withRangeOff = (d: Definition, i: number): Definition =>
  write(d, { ranges: levelsSet(d).ranges.filter((_, n) => n !== i) });

/** Whether the last range has room to give to a new one. */
export const canAddRange = (d: Definition): boolean => {
  const { ranges } = levelsSet(d);
  const before = ranges.length > 1 ? ranges[ranges.length - 2].to : 0;
  return ranges[ranges.length - 1].to - Math.max(before, 1) >= 2;
};
/** A new range: the top half of the last one, at the same multiplier. */
export const withRangeAdded = (d: Definition): Definition => {
  if (!canAddRange(d)) return d;
  const { ranges } = levelsSet(d);
  const last = ranges[ranges.length - 1];
  const before = ranges.length > 1 ? ranges[ranges.length - 2].to : 0;
  return write(d, { ranges: [...ranges.slice(0, -1), { to: Math.floor((before + last.to) / 2), x: last.x }, last] });
};

/** One level's total typed over. */
export const withTyped = (d: Definition, level: number, total: number): Definition =>
  write(d, { typed: { ...levelsSet(d).typed, [level]: total } });
export const isTyped = (d: Definition, level: number): boolean => levelsSet(d).typed[level] !== undefined;
export const anyTyped = (d: Definition): boolean => Object.keys(levelsSet(d).typed).length > 0;
/** The table filled again from the cost and the ranges, keeping nothing typed over. */
export const withFilledAgain = (d: Definition): Definition => write(d, { typed: {} });

const advancement = (d: Definition): string[] => {
  const core = d.core as { advancement?: unknown } | undefined;
  return Array.isArray(core?.advancement) ? core.advancement as string[] : [];
};
/** Whether this system advances this way: the setup question's answer. */
export const advancesBy = (d: Definition, id: string): boolean => advancement(d).includes(id);
export const withAdvancement = (d: Definition, id: string): Definition => ({
  ...d, core: { ...(d.core as object | undefined), advancement: toggleAdvancement(advancement(d), id) },
});

/** What this system calls XP: renamed on WORDS. */
export const xpWord = (d: Definition): string => {
  const words = d.words as { xp?: { short?: unknown } } | undefined;
  return typeof words?.xp?.short === 'string' && words.xp.short.trim() ? words.xp.short : 'XP';
};
