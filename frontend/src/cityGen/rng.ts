import type { Rng } from './types';

/**
 * Seeded randomness for city generation.
 *
 * This is deliberately *not* crypto-backed. 1.7.1 moved every roll that decides an
 * outcome onto OS entropy and left cosmetic randomness alone — a city layout is
 * cosmetic, and here determinism is the whole point, so a plain PRNG is correct rather
 * than a regression. Do not "fix" this to crypto.random.
 */

/** mulberry32 — small, fast, and even enough for layout work. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed to generate with, in the range the UI displays. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * Read a seed the admin typed. Anything unparseable becomes a fresh one rather than
 * silently generating from NaN.
 */
export function parseSeed(input: string | number | null | undefined): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  if (typeof input !== 'string') return randomSeed();
  const trimmed = input.trim();
  if (trimmed === '') return randomSeed();
  const n = Number(trimmed);
  return Number.isFinite(n) ? n >>> 0 : randomSeed();
}
