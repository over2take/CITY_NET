import { describe, it, expect } from 'vitest';
import {
  perimeterLots, perimeterLayout, LAYOUTS, LOT_DEPTH,
  generateCity, splitCity,
} from '../index';
import type { Block } from '../types';

/**
 * Downtown layout.
 *
 * The point of it is density and a street wall, so that is what these check: many lots
 * per block, narrow frontages left narrow, neighbours close enough to read as a
 * terrace, and the middle of the block left open.
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

const bigBlock: Block = { x: 0, z: 0, w: 140, d: 80 };

/** Axis-aligned overlap between two lots, ignoring a hair of tolerance. */
const overlaps = (a: Block, b: Block) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.01 &&
  Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.01;

describe('perimeterLots', () => {
  it('cuts a block into many lots', () => {
    const lots = perimeterLots(bigBlock, seededRng());
    expect(lots.length).toBeGreaterThan(8);
  });

  it('marks every lot as already sized', () => {
    // Block.lot is what stops the generator padding, squaring and setting back a
    // footprint the layout has already decided. Without it there is no terrace.
    for (const lot of perimeterLots(bigBlock, seededRng())) {
      expect(lot.lot).toBe(true);
    }
  });

  it('keeps every lot inside the block', () => {
    for (const lot of perimeterLots(bigBlock, seededRng())) {
      expect(Math.abs(lot.x) + lot.w / 2).toBeLessThanOrEqual(bigBlock.w / 2 + 0.01);
      expect(Math.abs(lot.z) + lot.d / 2).toBeLessThanOrEqual(bigBlock.d / 2 + 0.01);
    }
  });

  it('does not overlap its own lots', () => {
    // The runs along x take the corners, so the runs along z must fill only the gap
    // between them. Getting that wrong stacks buildings on the corners.
    const lots = perimeterLots(bigBlock, seededRng());
    for (let i = 0; i < lots.length; i++) {
      for (let j = i + 1; j < lots.length; j++) {
        expect(overlaps(lots[i], lots[j]), `lot ${i} vs ${j}`).toBe(false);
      }
    }
  });

  it('leaves the middle of the block open', () => {
    // Back lots are half of what makes a perimeter block read as one.
    const lots = perimeterLots(bigBlock, seededRng());
    const inMiddle = lots.filter(l =>
      Math.abs(l.x) < bigBlock.w / 2 - LOT_DEPTH && Math.abs(l.z) < bigBlock.d / 2 - LOT_DEPTH);
    expect(inMiddle).toHaveLength(0);
  });

  it('puts neighbours close enough to read as a terrace', () => {
    // The whole point. A gap of more than a metre or two and it is detached houses.
    const lots = perimeterLots(bigBlock, seededRng())
      .filter(l => Math.abs(l.z - (bigBlock.z - bigBlock.d / 2 + LOT_DEPTH / 2)) < 0.01)
      .sort((a, b) => a.x - b.x);
    expect(lots.length).toBeGreaterThan(2);
    for (let i = 1; i < lots.length; i++) {
      const gap = (lots[i].x - lots[i].w / 2) - (lots[i - 1].x + lots[i - 1].w / 2);
      expect(gap).toBeLessThan(2);
      expect(gap).toBeGreaterThanOrEqual(0);
    }
  });

  it('varies the frontages', () => {
    // A row of identical widths reads as a barracks.
    const widths = new Set(perimeterLots(bigBlock, seededRng()).map(l => l.w.toFixed(2)));
    expect(widths.size).toBeGreaterThan(3);
  });

  it('builds a small block solid rather than cutting a hole in it', () => {
    // A block with no room for a rim and a middle would otherwise become four slivers
    // around a courtyard.
    const small: Block = { x: 0, z: 0, w: 30, d: 26 };
    const lots = perimeterLots(small, seededRng());
    expect(lots).toHaveLength(1);
    expect(lots[0].w).toBe(30);
    expect(lots[0].d).toBe(26);
  });

  it('reproduces from a seed', () => {
    expect(perimeterLots(bigBlock, seededRng(11))).toEqual(perimeterLots(bigBlock, seededRng(11)));
  });
});

describe('perimeterLayout', () => {
  it('is registered', () => {
    expect(LAYOUTS.PERIMETER).toBe(perimeterLayout);
  });

  it('is far denser than the grid it is built on', () => {
    const grid = LAYOUTS.GRID(bounds(300), false, seededRng());
    const downtown = perimeterLayout(bounds(300), false, seededRng());
    expect(downtown.blocks.length).toBeGreaterThan(grid.blocks.length * 2);
  });

  it('lays an elongated street grid, not a square one', () => {
    // A Manhattan block is roughly three times longer than it is deep, and that shape is
    // most of why the city reads as it does. The blocks themselves never reach the
    // caller — they are cut into lots first — so the grid that made them is what can be
    // measured, via the spacing between parallel streets on each axis.
    const { roads } = perimeterLayout(bounds(600), false, seededRng());
    const spacing = (vals: number[]) => {
      const uniq = [...new Set(vals.map(v => Math.round(v)))].sort((a, b) => a - b);
      const gaps = uniq.slice(1).map((v, i) => v - uniq[i]).filter(g => g > 5);
      return gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    };
    const acrossX = spacing(roads.filter(r => Math.abs(r.x1 - r.x2) < 0.5).map(r => r.x1));
    const acrossZ = spacing(roads.filter(r => Math.abs(r.z1 - r.z2) < 0.5).map(r => r.z1));
    const ratio = Math.max(acrossX, acrossZ) / Math.min(acrossX, acrossZ);
    expect(ratio).toBeGreaterThan(1.5);
  });

  it('still lays roads', () => {
    expect(perimeterLayout(bounds(300), false, seededRng()).roads.length).toBeGreaterThan(0);
  });

  it('lays no roads when excluded', () => {
    expect(perimeterLayout(bounds(300), true, seededRng()).roads).toHaveLength(0);
  });

  it('keeps roads out of the water', () => {
    const lake = { points: [
      { x: -80, z: -80 }, { x: 80, z: -80 }, { x: 80, z: 80 }, { x: -80, z: 80 },
    ] };
    const { roads } = perimeterLayout(bounds(300), false, seededRng(), [lake]);
    for (const r of roads) {
      const mx = (r.x1 + r.x2) / 2;
      const mz = (r.z1 + r.z2) / 2;
      expect(Math.abs(mx) < 80 && Math.abs(mz) < 80).toBe(false);
    }
  });

  it('drops lots outside a drawn boundary', () => {
    const boundary = { points: [
      { x: -100, z: -100 }, { x: 100, z: -100 }, { x: 100, z: 100 }, { x: -100, z: 100 },
    ] };
    const { blocks } = perimeterLayout(bounds(300), true, seededRng(), [], boundary);
    for (const b of blocks) {
      expect(Math.abs(b.x)).toBeLessThan(200);
      expect(Math.abs(b.z)).toBeLessThan(200);
    }
  });

  it('reproduces from a seed', () => {
    expect(perimeterLayout(bounds(300), false, seededRng(3)))
      .toEqual(perimeterLayout(bounds(300), false, seededRng(3)));
  });
});

describe('Block.lot in the generator', () => {
  it('leaves every other layout untouched', () => {
    // No existing layout sets `lot`, so the padding, aspect clamp and setback all still
    // apply exactly as before.
    const { blocks } = splitCity(bounds(300), false, seededRng());
    expect(blocks.some(b => b.lot)).toBe(false);
  });

  it('builds a downtown', () => {
    const res = generateCity(
      bounds(400), { sectionType: 'MIXED', excludeRoads: false, layout: 'PERIMETER' },
      freshContext(), seededRng(5), deps
    );
    expect(res.blocks.length).toBeGreaterThan(0);
    expect(res.roads.length).toBeGreaterThan(0);
  });
});
