import { describe, it, expect } from 'vitest';
import { seededRng, randomSeed, seedFrom, generateCity } from '../index';

/**
 * Seeded generation.
 *
 * The layout was always reproducible — every draw in cityGen goes through the injected
 * rng. The buildings were not: `generateThemedBuildingsForPlot` made its own
 * `Math.random` calls, so the same seed gave the same streets with different buildings
 * standing in them. These cover the whole thing being reproducible now.
 */

const bounds = (half: number) => ({
  min: { x: -half, z: -half },
  max: { x: half, z: half },
});

const freshContext = () => ({ locations: [], roads: [], waterBodies: [] });

const cityFrom = (seed: number, over = {}) =>
  generateCity(
    bounds(250),
    { sectionType: 'MIXED', ...over },
    freshContext(),
    seededRng(seed),
  );

describe('seededRng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = seededRng(12345);
    const b = seededRng(12345);
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
  });

  it('gives different sequences for different seeds', () => {
    expect(seededRng(1)()).not.toBe(seededRng(2)());
  });

  it('stays within the unit interval', () => {
    const r = seededRng(99);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not immediately repeat itself', () => {
    const r = seededRng(7);
    const seen = new Set(Array.from({ length: 200 }, () => r()));
    expect(seen.size).toBe(200);
  });
});

describe('seedFrom', () => {
  it('uses a plain number as given', () => {
    expect(seedFrom('464654654')).toBe(464654654);
    expect(seedFrom(12345)).toBe(12345);
  });

  it('round-trips a seed the admin wrote down', () => {
    // A displayed seed must read back as itself, or copying one out and typing it in
    // builds a different city.
    const s = randomSeed();
    expect(seedFrom(String(s))).toBe(s);
  });

  it('accepts a word as a seed rather than rejecting it', () => {
    // Anything goes, so the field never has to be corrected.
    expect(Number.isInteger(seedFrom('NIGHTCITY'))).toBe(true);
    expect(seedFrom('NIGHTCITY')).toBe(seedFrom('NIGHTCITY'));
  });

  it('gives different words different seeds', () => {
    expect(seedFrom('NIGHTCITY')).not.toBe(seedFrom('WATSON'));
  });

  it('hashes an out-of-range number instead of silently wrapping it', () => {
    // Coercing to 32 bits turned a long number into a different one, and writing that
    // back read as the field being cleared and replaced.
    const big = '48219603749999';
    expect(seedFrom(big)).toBe(seedFrom(big));
    expect(Number.isInteger(seedFrom(big))).toBe(true);
  });

  it('rolls a fresh seed for a blank field', () => {
    expect(Number.isFinite(seedFrom(''))).toBe(true);
    expect(Number.isFinite(seedFrom('   '))).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(seedFrom('  777  ')).toBe(seedFrom('777'));
  });
});

describe('randomSeed', () => {
  it('produces a whole number in range', () => {
    for (let i = 0; i < 50; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(4294967296);
    }
  });

  it('does not keep returning the same value', () => {
    const seen = new Set(Array.from({ length: 50 }, randomSeed));
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe('a seed reproduces a whole city', () => {
  it('gives identical buildings, not just identical streets', () => {
    // The gap this closed: layout was reproducible, buildings were not.
    const a = cityFrom(2026);
    const b = cityFrom(2026);
    expect(b.buildings).toEqual(a.buildings);
  });

  it('gives identical roads and blocks', () => {
    const a = cityFrom(2026);
    const b = cityFrom(2026);
    expect(b.roads).toEqual(a.roads);
    expect(b.blocks).toEqual(a.blocks);
  });

  it('gives a different city for a different seed', () => {
    const a = cityFrom(1);
    const b = cityFrom(2);
    expect(b.buildings).not.toEqual(a.buildings);
  });

  it('reproduces across every layout', () => {
    for (const layout of ['BSP', 'GRID', 'SUPERBLOCK', 'RING'] as const) {
      const a = cityFrom(555, { layout });
      const b = cityFrom(555, { layout });
      expect(b.buildings, layout).toEqual(a.buildings);
    }
  });

  it('only reproduces for the same options', () => {
    // Worth stating plainly: a seed is not a city on its own. Change the bounds or
    // the layout and the same seed builds something else.
    const grid = cityFrom(777, { layout: 'GRID' });
    const bsp = cityFrom(777, { layout: 'BSP' });
    expect(bsp.blocks).not.toEqual(grid.blocks);
  });
});
