import { describe, it, expect } from 'vitest';
import {
  LAYOUTS,
  gridLayout,
  superblockLayout,
  bspLayout,
  generateCity,
  SUPERBLOCK_MIN_SIZE,
  GRID_AVENUE_WIDTH,
  type Polygon,
} from '../index';

const bounds = (half: number) => ({
  min: { x: -half, z: -half },
  max: { x: half, z: half },
});

const square = (half: number): Polygon => ({
  points: [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ],
});

/** Deterministic sequence so two runs are comparable. */
function seededRng() {
  let a = 20260728;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

const freshContext = () => ({ locations: [], roads: [], waterBodies: [] });

// ─── registry ─────────────────────────────────────────────────────────────────

describe('layout registry', () => {
  it('offers every layout type', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(['BSP', 'GRID', 'SUPERBLOCK']);
  });

  it('every layout produces blocks for the same area', () => {
    for (const [name, fn] of Object.entries(LAYOUTS)) {
      const { blocks } = fn(bounds(200), false, seededRng());
      expect(blocks.length, name).toBeGreaterThan(0);
    }
  });

  it('every layout keeps its blocks inside the bounds', () => {
    for (const [name, fn] of Object.entries(LAYOUTS)) {
      const { blocks } = fn(bounds(200), false, seededRng());
      for (const b of blocks) {
        expect(Math.abs(b.x), name).toBeLessThanOrEqual(200);
        expect(Math.abs(b.z), name).toBeLessThanOrEqual(200);
      }
    }
  });

  it('every layout lays no roads when infrastructure is excluded', () => {
    for (const [name, fn] of Object.entries(LAYOUTS)) {
      const { roads } = fn(bounds(200), true, seededRng());
      expect(roads, name).toHaveLength(0);
    }
  });

  it('every layout confines blocks to a drawn boundary', () => {
    for (const [name, fn] of Object.entries(LAYOUTS)) {
      const { blocks } = fn(bounds(200), false, seededRng(), [], square(60));
      expect(blocks.length, name).toBeGreaterThan(0);
      for (const b of blocks) {
        expect(Math.abs(b.x), name).toBeLessThanOrEqual(60);
        expect(Math.abs(b.z), name).toBeLessThanOrEqual(60);
      }
    }
  });

  it('every layout clips roads to a drawn boundary', () => {
    for (const [name, fn] of Object.entries(LAYOUTS)) {
      const { roads } = fn(bounds(200), false, seededRng(), [], square(60));
      for (const r of roads) {
        expect(Math.abs(r.x1), name).toBeLessThanOrEqual(61);
        expect(Math.abs(r.z1), name).toBeLessThanOrEqual(61);
        expect(Math.abs(r.x2), name).toBeLessThanOrEqual(61);
        expect(Math.abs(r.z2), name).toBeLessThanOrEqual(61);
      }
    }
  });
});

// ─── grid ─────────────────────────────────────────────────────────────────────

describe('gridLayout', () => {
  it('lays streets in two perpendicular families', () => {
    const { roads } = gridLayout(bounds(200), false, seededRng());
    const vertical = roads.filter((r) => Math.abs(r.x1 - r.x2) < 1e-6);
    const horizontal = roads.filter((r) => Math.abs(r.z1 - r.z2) < 1e-6);
    expect(vertical.length).toBeGreaterThan(2);
    expect(horizontal.length).toBeGreaterThan(2);
    // A pure grid has nothing diagonal in it.
    expect(vertical.length + horizontal.length).toBe(roads.length);
  });

  it('gives the network a hierarchy rather than one uniform width', () => {
    // Avenues every few blocks are most of what makes a grid read as designed.
    const { roads } = gridLayout(bounds(300), false, seededRng());
    const widths = new Set(roads.map((r) => r.width));
    expect(widths.size).toBeGreaterThan(1);
    expect(widths.has(GRID_AVENUE_WIDTH)).toBe(true);
  });

  it('produces blocks far more uniform than the BSP', () => {
    // The point of the layout: regular where BSP is irregular.
    const spread = (fn: typeof gridLayout) => {
      const { blocks } = fn(bounds(300), false, seededRng());
      const areas = blocks.map((b) => b.w * b.d);
      const mean = areas.reduce((a, v) => a + v, 0) / areas.length;
      const variance = areas.reduce((a, v) => a + (v - mean) ** 2, 0) / areas.length;
      return Math.sqrt(variance) / mean; // coefficient of variation
    };
    expect(spread(gridLayout)).toBeLessThan(spread(bspLayout));
  });

  it('scales block count with area rather than block size', () => {
    const small = gridLayout(bounds(100), false, seededRng()).blocks.length;
    const large = gridLayout(bounds(300), false, seededRng()).blocks.length;
    expect(large).toBeGreaterThan(small);
  });

  it('still produces a block for an area smaller than one cell', () => {
    const { blocks } = gridLayout(bounds(15), false, seededRng());
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('gives every block a positive footprint', () => {
    const { blocks } = gridLayout(bounds(200), false, seededRng());
    for (const b of blocks) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.d).toBeGreaterThan(0);
    }
  });
});

// ─── superblock ───────────────────────────────────────────────────────────────

describe('superblockLayout', () => {
  it('produces fewer, larger blocks than the BSP over the same area', () => {
    const sb = superblockLayout(bounds(400), false, seededRng());
    const bsp = bspLayout(bounds(400), false, seededRng());

    expect(sb.blocks.length).toBeLessThan(bsp.blocks.length);

    const meanArea = (bs: typeof sb.blocks) =>
      bs.reduce((a, b) => a + b.w * b.d, 0) / bs.length;
    expect(meanArea(sb.blocks)).toBeGreaterThan(meanArea(bsp.blocks));
  });

  it('lays fewer roads, leaving more open ground', () => {
    const sb = superblockLayout(bounds(400), false, seededRng());
    const bsp = bspLayout(bounds(400), false, seededRng());
    expect(sb.roads.length).toBeLessThan(bsp.roads.length);
  });

  it('stops subdividing around its minimum size', () => {
    const { blocks } = superblockLayout(bounds(400), false, seededRng());
    const largest = Math.max(...blocks.map((b) => Math.max(b.w, b.d)));
    expect(largest).toBeGreaterThan(SUPERBLOCK_MIN_SIZE / 2);
  });
});

// ─── selection ────────────────────────────────────────────────────────────────

describe('generateCity layout selection', () => {
  const deps = { fillPlot: () => {} };

  it('defaults to BSP, so existing generation is untouched', () => {
    const opts = { sectionType: 'MIXED' as const };
    const implicit = generateCity(bounds(200), opts, freshContext(), seededRng(), deps);
    const explicit = generateCity(
      bounds(200), { ...opts, layout: 'BSP' as const }, freshContext(), seededRng(), deps,
    );
    expect(explicit).toEqual(implicit);
  });

  it('produces a different city for each layout', () => {
    const opts = { sectionType: 'MIXED' as const };
    const counts = (['BSP', 'GRID', 'SUPERBLOCK'] as const).map(
      (layout) =>
        generateCity(bounds(300), { ...opts, layout }, freshContext(), seededRng(), deps)
          .blocks.length,
    );
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('falls back to BSP for an unrecognised layout', () => {
    // A stale saved option should not generate an empty city.
    const opts = { sectionType: 'MIXED' as const, layout: 'NONSENSE' as never };
    const result = generateCity(bounds(200), opts, freshContext(), seededRng(), deps);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('honours a drawn boundary whichever layout is chosen', () => {
    for (const layout of ['BSP', 'GRID', 'SUPERBLOCK'] as const) {
      const result = generateCity(
        bounds(300),
        { sectionType: 'MIXED', layout, boundary: square(80) },
        freshContext(),
        seededRng(),
        deps,
      );
      for (const b of result.blocks) {
        expect(Math.abs(b.x), layout).toBeLessThanOrEqual(80);
        expect(Math.abs(b.z), layout).toBeLessThanOrEqual(80);
      }
    }
  });
});
