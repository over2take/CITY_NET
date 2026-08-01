import { describe, it, expect } from 'vitest';
import { countGeneratedInRegion, makeRegionTest } from '../index';

/**
 * What a regenerate would clear. Extracted from the panel so the rule is stated once
 * and testable directly, rather than only through a rendered component.
 */

const BOUNDS = { min: { x: -50, z: -50 }, max: { x: 50, z: 50 } };

const gen = (x: number, z: number, over = {}) => ({ name: '', x, z, shape: 'box', ...over });
const named = (x: number, z: number, name = 'AFTERLIFE') => ({ name, x, z, shape: 'box' });

describe('makeRegionTest', () => {
  it('accepts points inside the bounds', () => {
    const inside = makeRegionTest(BOUNDS);
    expect(inside(0, 0)).toBe(true);
    expect(inside(50, 50)).toBe(true);
  });

  it('rejects points outside', () => {
    expect(makeRegionTest(BOUNDS)(500, 0)).toBe(false);
  });

  it('normalises bounds dragged in any direction', () => {
    const flipped = { min: { x: 50, z: 50 }, max: { x: -50, z: -50 } };
    expect(makeRegionTest(flipped)(0, 0)).toBe(true);
  });

  it('prefers a drawn polygon over its bounding box', () => {
    // An L: the notch is inside the bbox but outside the shape.
    const L = [
      { x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 40 },
      { x: 40, z: 40 }, { x: 40, z: 100 }, { x: 0, z: 100 },
    ];
    const inside = makeRegionTest({ min: { x: 0, z: 0 }, max: { x: 100, z: 100 } }, L);
    expect(inside(20, 20)).toBe(true);
    expect(inside(70, 70)).toBe(false);
  });

  it('falls back to the bounds for a degenerate polygon', () => {
    const inside = makeRegionTest(BOUNDS, [{ x: 0, z: 0 }, { x: 1, z: 1 }]);
    expect(inside(0, 0)).toBe(true);
  });
});

describe('countGeneratedInRegion', () => {
  it('counts generated structures inside the region', () => {
    expect(countGeneratedInRegion([gen(0, 0), gen(10, 10)], BOUNDS).removed).toBe(2);
  });

  it('ignores anything outside', () => {
    expect(countGeneratedInRegion([gen(9999, 9999)], BOUNDS).removed).toBe(0);
  });

  it('separates what a GM named from what was generated', () => {
    // The rule that matters: hand-placed work survives a regenerate.
    const counts = countGeneratedInRegion([gen(0, 0), named(5, 5), named(6, 6)], BOUNDS);
    expect(counts).toEqual({ removed: 1, kept: 2 });
  });

  it('never counts tokens', () => {
    const tokens = ['rhombus', 'enemy_rhombus', 'friendly_rhombus']
      .map((shape) => gen(1, 1, { shape }));
    expect(countGeneratedInRegion(tokens, BOUNDS)).toEqual({ removed: 0, kept: 0 });
  });

  it('never counts battle map content', () => {
    expect(countGeneratedInRegion([gen(1, 1, { battle_map_id: 3 })], BOUNDS).removed).toBe(0);
  });

  it('counts within a drawn shape, not its bounding box', () => {
    const L = [
      { x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 40 },
      { x: 40, z: 40 }, { x: 40, z: 100 }, { x: 0, z: 100 },
    ];
    const counts = countGeneratedInRegion(
      [gen(20, 20), gen(70, 70)],
      { min: { x: 0, z: 0 }, max: { x: 100, z: 100 } },
      L,
    );
    expect(counts.removed).toBe(1);
  });

  it('handles an empty world', () => {
    expect(countGeneratedInRegion([], BOUNDS)).toEqual({ removed: 0, kept: 0 });
  });
});
