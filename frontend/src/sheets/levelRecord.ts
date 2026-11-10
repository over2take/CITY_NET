// What each level gained (7d7b2; approved mockup docs/mockups/level-record.html, 2026-11-09): the record on the
// CHARACTER tab, under the class picks, that the player and the GM both read. Each level's health, as the server
// worked it out on the last save (backend healthLevels.js, under HEALTH_SHOWN_KEY), and each INCREASE unlocked:
// spent, open to spend, or a pick taken in its place. The GM puts it right (CLEAR THE ROLL, SET TO, CLEAR); the
// player rolls a cleared level again and spends an increase left open. Nothing here works a number out: the
// server does (backend levelUp.js), and this only says what it kept, in the sheet's words.

import { workedOn, type IncreaseShown } from './choicesShown';
import { characterLevel, HEALTH_SHOWN_KEY } from './xpMeter';
import type { SheetTemplate } from './types';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * How a level was kept: level 1's full die, a roll, the average, set by the GM, cleared for another roll, a reroll
 * of every level (7d5c), a roll to beat (7d5d), or a level up with nothing gained (the GM's, with no roll to beat).
 */
export type LevelKept = 'first' | 'rolled' | 'average' | 'set' | 'cleared' | 'reroll' | 'beat' | 'none';

/** One level of the record: its die, the die's part, what it gained in all, how, and in words. */
export interface RecordLevel { level: number; die: number | null; took: number; gained: number; kept: LevelKept; words: string }

/** One INCREASE unlocked: spent (and on what), open to spend, or a pick taken instead, in words. */
export interface RecordIncrease {
  feature: string; label: string; from: string; increase: IncreaseShown;
  kept: 'spent' | 'open' | 'instead'; words: string;
}

export interface LevelRecord {
  level: number;
  /** The health part: null where health isn't per level. */
  health: { max: number; adds: number; levels: RecordLevel[] } | null;
  increases: RecordIncrease[];
}

const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

/** What a level's line says of how it was kept. */
const wordsOf = (kept: LevelKept, took: number, die: number | null, adds: number, gained: number): string => {
  const each = adds ? `, ${signed(adds)} EACH LEVEL` : '';
  // Never less than 1 in a level (backend healthLevels.js).
  const least = took + adds < 1 ? ', AT LEAST 1' : '';
  if (kept === 'reroll') return `REROLLED EVERY LEVEL: ${took}`;
  if (kept === 'beat') return `ROLLED ${took} TO BEAT, ${gained > 0 ? 'BEATEN' : 'NOT BEATEN'}`;
  if (kept === 'none') return 'NOTHING GAINED';
  if (kept === 'set') return `SET TO ${took} BY THE GM${each}${least}`;
  if (kept === 'rolled') return `ROLLED ${took}${each}${least}`;
  if (!die) return `NO DIE${each}${least}`;
  if (kept === 'first') return `THE FULL D${die}${each}${least}`;
  if (kept === 'cleared') return `${took} AVERAGE TILL IT'S ROLLED AGAIN${each}${least}`;
  return `${took} AVERAGE${each}${least}`;
};

const keptOf = (l: Obj, beat: boolean): LevelKept => {
  if (l.level === 1) return l.set === true ? 'set' : 'first';
  if (l.cleared === true) return 'cleared';
  if (l.set === true) return 'set';
  if (typeof l.gained === 'number') return l.rolled === true ? (beat ? 'beat' : 'reroll') : 'none';
  return l.rolled === true ? 'rolled' : 'average';
};

/** The health part of the record, as the last save worked it out. Null where health isn't per level. */
const healthOf = (template: SheetTemplate | null | undefined, data: Obj | null | undefined): LevelRecord['health'] => {
  const shown = data?.[HEALTH_SHOWN_KEY];
  if (!template?.levels?.health || !isObject(shown) || !Array.isArray(shown.levels)) return null;
  const adds = typeof shown.adds === 'number' ? shown.adds : 0;
  const beat = template.levels.health.gain === 'beat';
  const levels = (shown.levels as unknown[]).filter((l): l is Obj => isObject(l) && Number.isInteger(l.level) && typeof l.took === 'number').map((l) => {
    const die = Number.isInteger(l.die) ? l.die as number : null;
    const took = l.took as number;
    const kept = keptOf(l, beat);
    const gained = typeof l.gained === 'number' ? l.gained : Math.max(1, took + adds);
    return { level: l.level as number, die, took, gained, kept, words: wordsOf(kept, took, die, adds, gained) };
  });
  return { max: typeof shown.max === 'number' ? shown.max : levels.reduce((n, l) => n + l.gained, 0), adds, levels };
};

/** A spread in words: +1 MIGHT, +1 WITS, each stat by the name the increase gives it. */
export const spreadWords = (inc: IncreaseShown, spread: Obj): string => Object.entries(spread)
  .filter(([, p]) => typeof p === 'number' && p > 0)
  .map(([stat, p]) => `+${p} ${(inc.stats.find((s) => s.id === stat)?.label ?? stat).toUpperCase()}`).join(', ');

/** Each INCREASE unlocked, in the order the system lists them: spent, open, or taken as a pick instead. */
const increasesOf = (template: SheetTemplate | null | undefined, data: Obj | null | undefined): RecordIncrease[] => {
  const lists = template?.choices ?? [];
  const worked = workedOn(data);
  const spent = isObject(data?._increases) ? data._increases as Obj : {};
  const out: RecordIncrease[] = [];
  for (const list of lists) {
    for (const option of list.options) {
      for (const f of option.features) {
        const inc = f.increase;
        if (!inc) continue;
        const base = { feature: f.id, label: f.label, from: option.label, increase: inc };
        const instead = inc.instead ? worked.picks.find((p) => p.from === f.id && p.list === inc.instead && !p.waiting) : undefined;
        if (instead) {
          const other = lists.find((l) => l.id === instead.list);
          const name = other?.options.find((o) => o.id === instead.option)?.label ?? instead.option;
          out.push({ ...base, kept: 'instead', words: `${(other?.one ?? 'pick').toUpperCase()} · ${name.toUpperCase()}, IN PLACE OF THE POINTS` });
        } else if (isObject(spent[f.id])) {
          out.push({ ...base, kept: 'spent', words: spreadWords(inc, spent[f.id] as Obj) });
        } else if (worked.increasesOpen.includes(f.id)) {
          out.push({ ...base, kept: 'open', words: `${inc.points} ${inc.points === 1 ? 'POINT' : 'POINTS'} TO SPEND` });
        }
      }
    }
  }
  return out;
};

/** The record: null where levels are typed in, or with nothing to show (no health per level, no increase). */
export const levelRecord = (template: SheetTemplate | null | undefined, data: Obj | null | undefined): LevelRecord | null => {
  if (!template?.levels) return null;
  const health = healthOf(template, data);
  const increases = increasesOf(template, data);
  if (!health && !increases.length) return null;
  return { level: characterLevel(data), health, increases };
};

/** What can be done to a level, by whom: the GM's CLEAR THE ROLL, SET TO and CLEAR (back), the player's ROLL. */
export interface LevelTools { clear: boolean; set: boolean; back: boolean; roll: boolean }
export const levelTools = (l: RecordLevel, gm: boolean): LevelTools => ({
  // Level 1 is the full die, or set: never rolled.
  clear: gm && l.level > 1 && (l.kept === 'rolled' || l.kept === 'reroll' || l.kept === 'beat'),
  set: gm && l.die !== null,
  back: gm && l.kept === 'set',
  roll: !gm && l.kept === 'cleared' && l.die !== null,
});

/** The record's head: LEVELS · 5 · MAX HEALTH 37. */
export const recordHead = (r: LevelRecord): string => `LEVELS · ${r.level}${r.health ? ` · MAX HEALTH ${r.health.max}` : ''}`;
