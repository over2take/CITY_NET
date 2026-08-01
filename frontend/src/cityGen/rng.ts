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

/** FNV-1a, so any text at all can be a seed. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Turn what the admin typed into a seed.
 *
 * Anything goes — a number, or a word like NIGHTCITY. Text is hashed rather than
 * rejected, which means the field never has to be corrected and whatever is typed can
 * stay exactly as typed.
 *
 * An earlier version coerced the input to a 32-bit number, so a long number silently
 * wrapped to a different one. Writing that back looked like the field being cleared
 * and replaced.
 */
export function seedFrom(input: string | number): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.abs(Math.trunc(input)) >>> 0 : randomSeed();
  }
  const trimmed = input.trim();
  if (trimmed === '') return randomSeed();
  // Short whole numbers are used directly, so a written-down seed reads back as itself.
  const n = Number(trimmed);
  if (Number.isSafeInteger(n) && n >= 0 && n < 4294967296) return n >>> 0;
  return hashString(trimmed);
}
