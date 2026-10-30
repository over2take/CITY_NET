// The builder's formula box, as logic (formula box 1; approved mockup docs/mockups/formula-box.html,
// 2026-10-29): what a formula says in words, the line its sample value is told in, the SHAPES that
// write a common one for you, and the names INSERT offers. The server reads the formula itself
// (POST /api/systems/preview-formulas, the game's own parser) and says what it reads; nothing here
// parses. Pure, so the box (hooks/useFormulaBox.tsx) only draws.
//
// Formula box 2 adds a roll's ADD and AGAINST, which read the stat being rolled too (@this,
// @this_mod, @tie, @tie_mod), and a rest's refill amounts, which may hold dice: the sample line says
// what dice decide as a range, the least to the most.

import type { Definition } from './systemsApi';
import { allStats, formulaList, tableList, FUNCTIONS } from './statsRules';
import { choiceLists } from './choices';

/** What a box holds: a modifier's amount, an option's requirement, a feature's uses; a roll's ADD and AGAINST; a rest's amount. */
export type FormulaKind = 'amount' | 'requires' | 'uses' | 'add' | 'against' | 'refill';

/** One name a formula reads, as the server worked it out for the sample. */
export interface FormulaReads { id: string; label: string; value: number }
/** What the server made of a formula (backend systemBuilder/formulaPreview.js). */
export type FormulaRead =
  | {
    ok: true; value: number; reads: FormulaReads[];
    /** With dice (a rest's amount), the most it comes to; `value` is then the least. */
    most?: number;
    /** A roll's box: the stat the sample rolls. */
    rolling?: string;
  }
  | { ok: false; problem: string; name?: string; suggest?: string };

const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);
const word = (id: string, reads: FormulaReads[]) => reads.find((r) => r.id === id)?.label ?? id;

/**
 * A formula in words: a few common shapes said plainly (+2 for each level, + half your level,
 * needs Strength 13 or more), anything else by what it is worked out from. Empty for an empty box.
 */
export const wordsOf = (kind: FormulaKind, text: string, reads: FormulaReads[] = []): string => {
  const t = text.trim();
  if (!t) return '';
  let m: RegExpMatchArray | null;
  const named = () => {
    // By label once the server has said; until then, the @names as written.
    const names = [...new Set(reads.length ? reads.map((r) => r.label) : [...t.matchAll(/@([a-z][a-z0-9_]*)/g)].map((x) => x[1]))];
    return names.length ? `worked out from ${names.join(', ')}` : 'a fixed number';
  };
  // A rest's amount, dice and all, said with names in place of the @ids: 1d8 + CON modifier.
  if (kind === 'refill') return t.replace(/@([a-z][a-z0-9_]*)/g, (_, id: string) => word(id, reads)).replace(/\s+/g, ' ');
  if (kind === 'against') {
    if ((m = t.match(/^(-?\d+)$/))) return `against ${m[1]}`;
    if ((m = t.match(/^@([a-z][a-z0-9_]*)$/))) return `against your ${word(m[1], reads)}`;
    return `against a target ${named()}`;
  }
  if (kind === 'requires') {
    if ((m = t.match(/^@([a-z][a-z0-9_]*)\s*>=\s*(-?\d+)$/))) return `needs ${word(m[1], reads)} ${m[2]} or more`;
    if ((m = t.match(/^@([a-z][a-z0-9_]*)\s*>\s*(-?\d+)$/))) return `needs ${word(m[1], reads)} over ${m[2]}`;
    return `needs ${t.replace(/@([a-z][a-z0-9_]*)/g, (_, id: string) => word(id, reads))}`;
  }
  const unit = kind === 'uses' ? (n: string) => `${n} use${n === '1' ? '' : 's'}` : (n: string) => signed(Number(n));
  if ((m = t.match(/^(-?\d+)$/))) return `${unit(m[1])}, always`;
  // N * @name, or @name * N.
  const per = t.match(/^(\d+)\s*\*\s*@([a-z][a-z0-9_]*)$/) ?? t.match(/^@([a-z][a-z0-9_]*)\s*\*\s*(\d+)$/);
  if (per) {
    const [n, id] = /^\d+$/.test(per[1]) ? [per[1], per[2]] : [per[2], per[1]];
    return `${kind === 'uses' ? n : signed(Number(n))} for each ${word(id, reads).toLowerCase()}`;
  }
  if ((m = t.match(/^@([a-z][a-z0-9_]*)$/))) return `${kind === 'uses' ? 'as many as' : '+'} your ${word(m[1], reads)}`;
  if ((m = t.match(/^floor\(\s*@([a-z][a-z0-9_]*)\s*\/\s*2\s*\)$/))) return `${kind === 'uses' ? 'half' : '+ half'} your ${word(m[1], reads).toLowerCase()}, rounded down`;
  return named();
};

/**
 * What it comes to for the sample: `sample Level 3: +6`, `the sample (Strength 16) meets it`,
 * `sample: 3 uses`, `sample, rolling Strength, rolled stat 16: target 16`, `sample CON modifier 2: 3 to 10`.
 */
export const sampleLine = (kind: FormulaKind, read: FormulaRead & { ok: true }): string => {
  const names = [...new Map(read.reads.map((r) => [r.id, `${r.label} ${r.value}`])).values()].join(', ');
  if (kind === 'requires') return `the sample${names ? ` (${names})` : ''} ${read.value !== 0 ? 'meets it' : 'doesn\'t meet it'}`;
  const round = (n: number) => Math.round(n * 100) / 100;
  const v = round(read.value);
  const said = kind === 'uses' ? `${v} use${v === 1 ? '' : 's'}`
    : kind === 'against' ? `target ${v}`
    : kind === 'refill' ? (read.most !== undefined ? `${v} to ${round(read.most)}` : String(v))
    : signed(v);
  const sample = read.rolling ? `sample, rolling ${read.rolling}${names ? ',' : ''}` : 'sample';
  return names || read.rolling ? `${sample}${names ? ` ${names}` : ''}: ${said}` : said;
};

/** One list of names INSERT offers, under a title. */
export interface InsertGroup { title: string; items: { token: string; label: string }[] }

/** The level names formulas read: @level (unless a stat or formula has that id), each levelled list's sum, each option's. */
export const levelTokens = (def: Definition): { token: string; label: string }[] => {
  const levelled = choiceLists(def).filter((c) => c.levelled === true);
  if (!levelled.length) return [];
  const taken = new Set([...allStats(def).map((s) => s.id), ...formulaList(def).map((f) => f.id)]);
  return [
    ...(taken.has('level') ? [] : [{ token: '@level', label: 'LEVEL' }]),
    ...levelled.flatMap((c) => [
      { token: `@${c.id}_level`, label: `${(c.many || c.id).toUpperCase()} LEVEL` },
      ...c.options.map((o) => ({ token: `@${o.id}_level`, label: `${(o.label || o.id).toUpperCase()} LEVEL` })),
    ]),
  ];
};

/** WORKINGS: the functions, with what each does. */
const WORKINGS: Record<string, string> = {
  floor: 'ROUNDED DOWN', ceil: 'ROUNDED UP', round: 'ROUNDED', min: 'THE SMALLER', max: 'THE LARGER', abs: 'WITHOUT ITS SIGN', clamp: 'KEPT BETWEEN', if: 'ONE OR THE OTHER',
};

/** What a roll's box reads of the stat being rolled. */
export const ROLL_TOKENS = [
  { token: '@this', label: 'THE STAT ROLLED' }, { token: '@this_mod', label: 'ITS MODIFIER' },
  { token: '@tie', label: 'ITS TIED STAT' }, { token: '@tie_mod', label: 'THE TIED STAT\'S MODIFIER' },
];

/**
 * What INSERT offers a box: the stat being rolled (a roll's), its levels, stats, formulas (never for
 * an amount, which reads the sheet as typed and levels), tables and the workings. A rest's amount
 * reads no levels or tables. Empty groups left out.
 */
export const insertGroups = (def: Definition, kind: FormulaKind): InsertGroup[] => [
  { title: 'THIS ROLL', items: kind === 'add' || kind === 'against' ? ROLL_TOKENS : [] },
  { title: 'LEVELS', items: kind === 'refill' ? [] : levelTokens(def) },
  { title: 'STATS', items: allStats(def).map((s) => ({ token: `@${s.id}`, label: (s.label || s.id).toUpperCase() })) },
  { title: 'FORMULAS', items: kind === 'amount' ? [] : formulaList(def).map((f) => ({ token: `@${f.id}`, label: (f.label || f.id).toUpperCase() })) },
  { title: 'TABLES', items: kind === 'refill' ? [] : tableList(def).map((t) => ({ token: `${t.id}()`, label: 'A TABLE' })) },
  { title: 'WORKINGS', items: FUNCTIONS.map((fn) => ({ token: `${fn}()`, label: WORKINGS[fn] ?? '' })) },
].filter((g) => g.items.length);

/** A SHAPE: a common formula written for you from a number, and a name where it needs one. */
export interface Shape {
  id: string; label: string;
  /** What it asks before writing: a number, a number and which level or stat, or nothing. */
  asks: 'number' | 'none' | 'number-and-level' | 'number-and-stat' | 'dice' | 'dice-and-stat';
  /** Why it can't be used yet, when it can't. */
  needs?: string;
}

/**
 * The shapes a box offers. Amounts and uses: A NUMBER, PER LEVEL, PER CLASS LEVEL, HALF LEVEL;
 * requirements: AT LEAST (a stat) and LEVEL AT LEAST; a roll's ADD: A NUMBER, THE STAT ROLLED, ITS
 * MODIFIER, PER LEVEL; its AGAINST: A NUMBER, THE STAT ROLLED; a rest's amount: A NUMBER, DICE, DICE
 * AND A STAT. A shape needing levels or stats says so when the system has none.
 */
export const shapesOf = (def: Definition, kind: FormulaKind): Shape[] => {
  const levels = levelTokens(def).length ? undefined : 'No levels yet: make a list levelled on CHOICES';
  const stats = allStats(def).length ? undefined : 'No stats yet: make them on STATS & RULES';
  if (kind === 'add' || kind === 'against') {
    return [
      { id: 'number', label: 'A NUMBER', asks: 'number' },
      { id: 'rolled', label: 'THE STAT ROLLED', asks: 'none' },
      ...(kind === 'add' ? [
        { id: 'rolled_mod', label: 'ITS MODIFIER', asks: 'none' as const },
        { id: 'per_level', label: 'PER LEVEL', asks: 'number' as const, needs: levels },
      ] : []),
    ];
  }
  if (kind === 'refill') {
    return [
      { id: 'number', label: 'A NUMBER', asks: 'number' },
      { id: 'dice', label: 'DICE', asks: 'dice' },
      { id: 'dice_and_stat', label: 'DICE AND A STAT', asks: 'dice-and-stat', needs: stats },
    ];
  }
  if (kind === 'requires') {
    return [
      { id: 'at_least', label: 'AT LEAST', asks: 'number-and-stat', needs: stats },
      { id: 'level_at_least', label: 'LEVEL AT LEAST', asks: 'number-and-level', needs: levels },
    ];
  }
  return [
    { id: 'number', label: 'A NUMBER', asks: 'number' },
    { id: 'per_level', label: 'PER LEVEL', asks: 'number', needs: levels },
    { id: 'per_class_level', label: 'PER CLASS LEVEL', asks: 'number-and-level', needs: levels },
    { id: 'half_level', label: 'HALF LEVEL', asks: 'none', needs: levels },
  ];
};

/** The dice a shape offers. */
export const DIE_SIDES = [4, 6, 8, 10, 12, 20];

/** The text a shape writes, from its number, the name picked (a level or a stat, `@id` form) and a die's sides. */
export const writeShape = (shape: string, n: number, name = '@level', sides = 8): string => {
  const k = Number.isFinite(n) ? Math.trunc(n) : 0;
  switch (shape) {
    case 'rolled': return '@this';
    case 'rolled_mod': return '@this_mod';
    case 'dice': return `${Math.max(1, k)}d${sides}`;
    case 'dice_and_stat': return `${Math.max(1, k)}d${sides} + ${name}`;
    case 'number': return String(k);
    case 'per_level': return `${k} * @level`;
    case 'per_class_level': return `${k} * ${name}`;
    case 'half_level': return 'floor(@level / 2)';
    case 'at_least': return `${name} >= ${k}`;
    case 'level_at_least': return `${name} >= ${k}`;
    default: return '';
  }
};
