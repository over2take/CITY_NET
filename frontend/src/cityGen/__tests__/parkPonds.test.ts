import { describe, it, expect } from 'vitest';
import { generateCity, generatePark, pointInPolygon, pointInWater } from '../index';
import type { Block } from '../types';

/**
 * Park ponds.
 *
 * The opposite ordering case from rivers and coastlines: a park only exists once the
 * split has produced the block it sits in, so its pond is made afterwards. That is
 * safe because a pond is contained by its plot — it never reaches a road, so no road
 * needs re-cutting and no bridge is called for.
 */

const bounds = (half: number) => ({
  min: { x: -half, z: -half },
  max: { x: half, z: half },
});

function seededRng(seed = 4242) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

const freshContext = () => ({ locations: [], roads: [], waterBodies: [] });
const deps = { fillPlot: () => {} };
const clear = () => false;

const block: Block = { x: 0, z: 0, w: 60, d: 60 };

/** Run generatePark until it yields a pond, so pond-shape assertions aren't flaky. */
function firstPond(seed = 1) {
  const rng = seededRng(seed);
  for (let i = 0; i < 200; i++) {
    const [pond] = generatePark(block, 50, 50, [], clear, rng, true);
    if (pond) return pond;
  }
  throw new Error('no pond in 200 attempts');
}

describe('generatePark ponds', () => {
  it('makes none unless asked', () => {
    const rng = seededRng();
    for (let i = 0; i < 50; i++) {
      expect(generatePark(block, 50, 50, [], clear, rng)).toHaveLength(0);
    }
  });

  it('draws no randomness for a pond when ponds are off', () => {
    // Otherwise a seed would stop reproducing the parks it produced before ponds
    // existed, purely from the extra rolls.
    const withFlag = seededRng(9);
    const without = seededRng(9);
    const a: unknown[] = [];
    const b: unknown[] = [];
    generatePark(block, 50, 50, a as never[], clear, withFlag, false);
    generatePark(block, 50, 50, b as never[], clear, without);
    expect(a).toEqual(b);
    expect(withFlag()).toBe(without());
  });

  it('makes ponds when asked', () => {
    const rng = seededRng();
    let made = 0;
    for (let i = 0; i < 60; i++) {
      made += generatePark(block, 50, 50, [], clear, rng, true).length;
    }
    expect(made).toBeGreaterThan(0);
  });

  it('encloses actual area', () => {
    const pond = firstPond();
    const area = Math.abs(pond.points.reduce((sum, p, i) => {
      const q = pond.points[(i + 1) % pond.points.length];
      return sum + (p.x * q.z - q.x * p.z);
    }, 0) / 2);
    expect(area).toBeGreaterThan(1);
  });

  it('stays inside its own plot', () => {
    // The whole point of siting a pond after the split: it must not reach the road.
    const pond = firstPond();
    for (const p of pond.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(25);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(25);
    }
  });

  it('skips a pond on ground that is already taken', () => {
    // isBlocked already composes every reason a footprint is unusable, roads included.
    const rng = seededRng();
    let made = 0;
    for (let i = 0; i < 60; i++) {
      made += generatePark(block, 50, 50, [], () => true, rng, true).length;
    }
    expect(made).toBe(0);
  });

  it('keeps trees out of the water', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 60; i++) {
      const trees: { x: number; z: number }[] = [];
      const [pond] = generatePark(block, 50, 50, trees as never[], clear, rng, true);
      if (!pond) continue;
      for (const t of trees) expect(pointInPolygon(pond, t.x, t.z)).toBe(false);
    }
  });
});

describe('generateCity with park ponds', () => {
  it('returns no water when ponds are off', () => {
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', excludeRoads: false }, freshContext(), seededRng(), deps
    );
    expect(result.waterBodies).toHaveLength(0);
  });

  it('returns ponds to be persisted when they are on', () => {
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', excludeRoads: false, parkPonds: true },
      freshContext(), seededRng(), deps
    );
    expect(result.waterBodies.length).toBeGreaterThan(0);
  });

  it('does not let a pond move the roads it was made after', () => {
    // Ponds are collected apart from the water the split saw. If they leaked into it,
    // the road network would differ between a ponded and an unponded run of the same
    // seed — and the pond would be sited against roads that no longer exist.
    const dry = generateCity(
      bounds(300), { sectionType: 'MIXED', excludeRoads: false }, freshContext(), seededRng(11), deps
    );
    const wet = generateCity(
      bounds(300), { sectionType: 'MIXED', excludeRoads: false, parkPonds: true },
      freshContext(), seededRng(11), deps
    );
    expect(wet.roads).toEqual(dry.roads);
    expect(wet.overpasses).toEqual(dry.overpasses);
  });

  it('keeps ponds clear of the roads', () => {
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', excludeRoads: false, parkPonds: true },
      freshContext(), seededRng(5), deps
    );
    for (const road of result.roads) {
      const mid = { x: (road.x1 + road.x2) / 2, z: (road.z1 + road.z2) / 2 };
      expect(pointInWater(result.waterBodies, mid.x, mid.z)).toBe(false);
    }
  });

  it('reproduces its ponds from a seed', () => {
    const opts = { sectionType: 'MIXED' as const, excludeRoads: false, parkPonds: true };
    const a = generateCity(bounds(300), opts, freshContext(), seededRng(77), deps);
    const b = generateCity(bounds(300), opts, freshContext(), seededRng(77), deps);
    expect(a.waterBodies).toEqual(b.waterBodies);
  });
});
