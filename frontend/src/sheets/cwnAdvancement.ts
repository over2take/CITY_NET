// Experience and levelling (CWN p44-45).
//
// The book prints two columns and tells the table to pick one: a "fast" rate for campaigns
// that want to see advancement, and a "slow" one for long-running games. Neither is the
// default, so the sheet asks rather than choosing.
//
// XP is cumulative and the cap is level 10.

export type XpRate = 'fast' | 'slow';

export const CWN_XP_RATES: { value: XpRate; label: string }[] = [
  { value: 'fast', label: 'FAST' },
  { value: 'slow', label: 'SLOW' },
];

/** Total XP needed to REACH each level, indexed by level. Level 1 costs nothing. */
const THRESHOLDS: Record<XpRate, number[]> = {
  //        L1 L2  L3  L4  L5  L6  L7  L8   L9  L10
  fast: [0, 0, 3, 6, 12, 18, 27, 39, 54, 72, 93],
  slow: [0, 0, 6, 15, 24, 36, 51, 69, 87, 105, 139],
};

/** The highest level the book prints a cost for. */
export const CWN_MAX_LEVEL = 10;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const rateOf = (v: unknown): XpRate => (String(v ?? '').trim().toLowerCase() === 'slow' ? 'slow' : 'fast');

/**
 * A character's level, as the thresholds should read it.
 *
 * The book starts operators at level one. A sheet nobody has filled in says 0, which is
 * not a level anyone plays at - so it reads as 1 rather than inventing a level below the
 * one the game begins with.
 */
const levelOf = (v: unknown): number => Math.min(CWN_MAX_LEVEL, Math.max(1, num(v)));

/** Total XP needed to reach a level, or null past the printed table. */
export const xpForLevel = (level: number, rate: unknown): number | null => {
  const table = THRESHOLDS[rateOf(rate)];
  return level >= 1 && level < table.length ? table[level] : null;
};

export interface XpProgress {
  /** The level the sheet claims, floored at 1 and capped at 10. */
  level: number;
  /** XP earned so far. */
  xp: number;
  /** The next level up, or null at the cap. */
  nextLevel: number | null;
  /** Total XP that next level needs, or null at the cap. */
  nextAt: number | null;
  /** How many more XP to earn, never below zero. Null at the cap. */
  remaining: number | null;
  /** How far along this level is, 0 to 1. 1 at the cap. */
  fraction: number;
  /** Enough XP earned to advance. Advancement is a choice, so this only says so. */
  ready: boolean;
  /** At the top of the printed table. */
  capped: boolean;
}

/**
 * Where a character is between levels.
 *
 * The bar measures from what THIS level cost to what the next one costs, not from zero -
 * otherwise a level-9 character's bar barely moves for the whole of level 9.
 *
 * Nothing here advances anyone. Levelling grants three skill points and sometimes a Focus,
 * both of which are choices a player makes, so the sheet says "ready" and leaves the level
 * field to the person who picked the skills.
 */
export const xpProgress = (data: Record<string, unknown> | undefined | null): XpProgress => {
  const rate = rateOf(data?.xp_rate);
  const level = levelOf(data?.level);
  const xp = Math.max(0, num(data?.xp));
  const nextLevel = level >= CWN_MAX_LEVEL ? null : level + 1;
  const nextAt = nextLevel === null ? null : xpForLevel(nextLevel, rate);
  const thisAt = xpForLevel(level, rate) ?? 0;

  if (nextAt === null) {
    return { level, xp, nextLevel: null, nextAt: null, remaining: null, fraction: 1, ready: false, capped: true };
  }
  const span = Math.max(1, nextAt - thisAt);
  const done = Math.max(0, Math.min(span, xp - thisAt));
  return {
    level, xp, nextLevel, nextAt,
    remaining: Math.max(0, nextAt - xp),
    fraction: done / span,
    ready: xp >= nextAt,
    capped: false,
  };
};

/**
 * The line under the bar.
 *
 * Just the level while there is climbing left to do: the numbers on the end of the bar
 * already say how far, and repeating them under it was the same fact twice. What the bar
 * cannot say is that the climbing is over, so those two states still get words.
 */
export const describeXp = (p: XpProgress): string => {
  if (p.capped) return `LEVEL ${p.level} · MAX`;
  if (p.ready) return `LEVEL ${p.level} · READY FOR ${p.nextLevel}`;
  return `LEVEL ${p.level}`;
};
