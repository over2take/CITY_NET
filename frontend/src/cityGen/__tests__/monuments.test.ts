import { describe, it, expect } from 'vitest';
import { generateMonument, generateLandmark, MONUMENT_STYLE_COUNT, SpatialGrid } from '../index';
import type { Block, RawBuilding } from '../types';

/**
 * Island monuments.
 *
 * These exist because landmarks were used first and came out as 150-unit towers rising
 * from a traffic island. So the tests that matter are about *scale*, not shape.
 */

function seededRng(seed = 4242) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

const island: Block = { x: 0, z: 0, w: 20, d: 20 };
const SPAN = 20;

/** Every style, so a per-style regression cannot hide behind an average. */
function allStyles(span = SPAN): RawBuilding[][] {
  const out: RawBuilding[][] = [];
  for (let style = 0; style < MONUMENT_STYLE_COUNT; style++) {
    // Feed a first draw that lands squarely in this style's bucket.
    const pick = (style + 0.5) / MONUMENT_STYLE_COUNT;
    let first = true;
    const rng = () => {
      if (first) { first = false; return pick; }
      return 0.5;
    };
    const parts: RawBuilding[] = [];
    generateMonument({ x: 0, z: 0, w: span, d: span }, span, parts, rng);
    out.push(parts);
  }
  return out;
}

const topOf = (parts: RawBuilding[]) => Math.max(...parts.map(p => p.y + p.height));
const widestOf = (parts: RawBuilding[]) =>
  Math.max(...parts.map(p => Math.max(p.width, p.depth)));

describe('generateMonument', () => {
  it('produces something for every style', () => {
    for (const parts of allStyles()) expect(parts.length).toBeGreaterThan(0);
  });

  it('stays at civic scale, not skyline scale', () => {
    // The bug this module exists for: a landmark on a traffic island was a tower.
    for (const parts of allStyles()) {
      // A monument on a 20-unit island should not be a 15-storey tower. First cut at
      // this passed a /3-of-a-landmark check at 54 units and still read as a building.
      expect(topOf(parts)).toBeLessThan(SPAN * 2);
    }
  });

  it('is dramatically shorter than a landmark on the same plot', () => {
    // Pins the relationship rather than a number, so it survives retuning either side.
    const landmark: RawBuilding[] = [];
    generateLandmark(island, SPAN, SPAN, landmark, new SpatialGrid(), seededRng());
    const tallestMonument = Math.max(...allStyles().map(topOf));
    expect(tallestMonument).toBeLessThan(topOf(landmark) / 3);
  });

  it('fits within the island', () => {
    // A monument wider than the disc would overhang the ring road.
    for (const parts of allStyles()) {
      expect(widestOf(parts)).toBeLessThanOrEqual(SPAN);
    }
  });

  it('scales with the island rather than using fixed heights', () => {
    // Absolute heights would go wrong the moment road widths are retuned.
    const small = Math.max(...allStyles(10).map(topOf));
    const large = Math.max(...allStyles(40).map(topOf));
    expect(large).toBeGreaterThan(small * 3);
  });

  it('sits on the ground', () => {
    for (const parts of allStyles()) {
      expect(Math.min(...parts.map(p => p.y))).toBe(0);
    }
  });

  it('stacks its parts without gaps or floating', () => {
    // y is the bottom of a mesh, so a part resting on another has its y set to that
    // one's height. Getting this wrong is what left skyscrapers hanging in mid-air.
    for (const parts of allStyles()) {
      for (const p of parts.slice(1)) {
        const supported = parts.some(q => Math.abs(q.y + q.height - p.y) < 1e-6);
        expect(supported, `part at y=${p.y}`).toBe(true);
      }
    }
  });

  it('emits one unparented root, with the rest grouped under it', () => {
    // The caller groups children by parent_name once the root has a database id.
    for (const parts of allStyles()) {
      expect(parts.filter(p => !p.parent_name)).toHaveLength(1);
      expect(parts[0].parent_name).toBeUndefined();
      for (const p of parts.slice(1)) expect(p.parent_name).toBe('ROOT');
    }
  });

  it('centres on the island', () => {
    for (const parts of allStyles()) {
      for (const p of parts) {
        expect(p.x).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(0);
      }
    }
  });

  it('offers visibly different styles', () => {
    // A run of roundabouts all carrying the same column would read worse than none.
    const shapes = allStyles().map(parts => topOf(parts).toFixed(2));
    expect(new Set(shapes).size).toBeGreaterThan(1);
  });

  it('reproduces from a seed', () => {
    const a: RawBuilding[] = [];
    const b: RawBuilding[] = [];
    generateMonument(island, SPAN, a, seededRng(12));
    generateMonument(island, SPAN, b, seededRng(12));
    expect(a).toEqual(b);
  });
});
