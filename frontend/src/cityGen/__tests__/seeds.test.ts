import { describe, it, expect } from 'vitest';
import { seededRng, randomSeed, parseSeed, generateCity } from '../index';

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

describe('parseSeed', () => {
  it('takes a number as given', () => {
    expect(parseSeed(482196037)).toBe(482196037);
  });

  it('wraps a seed beyond 32 bits rather than rejecting it', () => {
    // Seeds are 32-bit, so anything larger folds into range. Still deterministic,
    // which is all that matters.
    const big = parseSeed(4821960374);
    expect(Number.isInteger(big)).toBe(true);
    expect(big).toBeLessThan(4294967296);
    expect(parseSeed(4821960374)).toBe(big);
  });

  it('reads a typed seed', () => {
    expect(parseSeed('  12345 ')).toBe(12345);
  });

  it('rolls a fresh seed for blank input', () => {
    // Blank means "surprise me", which is the default.
    expect(Number.isFinite(parseSeed(''))).toBe(true);
    expect(Number.isFinite(parseSeed('   '))).toBe(true);
  });

  it('rolls a fresh seed rather than generating from NaN', () => {
    const seed = parseSeed('not a number');
    expect(Number.isFinite(seed)).toBe(true);
    expect(Number.isNaN(seed)).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(Number.isFinite(parseSeed(null))).toBe(true);
    expect(Number.isFinite(parseSeed(undefined))).toBe(true);
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
