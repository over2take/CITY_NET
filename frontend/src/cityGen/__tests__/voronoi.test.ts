import { describe, it, expect } from 'vitest';
import {
  seedPoints, voronoiCells, cellEdges, inscribedRect, centroid, polygonArea,
  voronoiLayout, LAYOUTS, VORONOI_SPACING,
} from '../index';
import type { Pt } from '../voronoi';

/**
 * Voronoi layout.
 *
 * The defining property is that every point of a cell is closer to that cell's seed
 * than to any other. Most of what follows checks that directly, because if it holds the
 * diagram is correct however the cells were built.
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

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

describe('voronoi cells', () => {
  it('gives every seed a cell', () => {
    const seeds = seedPoints(bounds(300), seededRng());
    const cells = voronoiCells(bounds(300), seeds);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(seeds.length);
  });

  it('puts each cell closer to its own seed than to any other', () => {
    // The definition of a Voronoi diagram. Sampled at each cell's centroid, which is
    // interior to a convex cell.
    const seeds = seedPoints(bounds(300), seededRng());
    const cells = voronoiCells(bounds(300), seeds);
    for (const cell of cells) {
      const c = centroid(cell.poly);
      const own = dist(c, cell.seed);
      for (const other of seeds) {
        if (other === cell.seed) continue;
        expect(own).toBeLessThanOrEqual(dist(c, other) + 1e-6);
      }
    }
  });

  it('tiles the region without gaps', () => {
    // Cells partition the frame, so their areas must sum to it. A gap or an overlap
    // would show up here and nowhere else.
    const half = 300;
    const seeds = seedPoints(bounds(half), seededRng());
    const cells = voronoiCells(bounds(half), seeds);
    const total = cells.reduce((s, c) => s + polygonArea(c.poly), 0);
    expect(total).toBeCloseTo((half * 2) ** 2, -2);
  });

  it('keeps cells inside the bounds', () => {
    const cells = voronoiCells(bounds(300), seedPoints(bounds(300), seededRng()));
    for (const cell of cells) {
      for (const p of cell.poly) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(300 + 1e-6);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(300 + 1e-6);
      }
    }
  });

  it('produces convex cells', () => {
    // Convexity is what lets inscribedRect test only four corners.
    const cells = voronoiCells(bounds(300), seedPoints(bounds(300), seededRng()));
    for (const { poly } of cells) {
      const signs = new Set<number>();
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
        const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
        if (Math.abs(cross) > 1e-6) signs.add(Math.sign(cross));
      }
      expect(signs.size).toBeLessThanOrEqual(1);
    }
  });

  it('reproduces from a seed', () => {
    expect(seedPoints(bounds(300), seededRng(7))).toEqual(seedPoints(bounds(300), seededRng(7)));
  });
});

describe('cellEdges', () => {
  it('lays each shared edge once', () => {
    // Every interior edge belongs to two cells. Without deduplication the whole network
    // would be built twice.
    const cells = voronoiCells(bounds(300), seedPoints(bounds(300), seededRng()));
    const edges = cellEdges(cells);
    const total = cells.reduce((s, c) => s + c.poly.length, 0);
    expect(edges.length).toBeLessThan(total);
    expect(edges.length).toBeGreaterThan(0);
  });
});

describe('inscribedRect', () => {
  it('recovers a rectangle exactly', () => {
    const rect = inscribedRect([
      { x: -20, z: -10 }, { x: 20, z: -10 }, { x: 20, z: 10 }, { x: -20, z: 10 },
    ]);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.z).toBeCloseTo(0);
    expect(rect.w).toBeCloseTo(40, 1);
    expect(rect.d).toBeCloseTo(20, 1);
  });

  it('stays inside an irregular cell', () => {
    const cells = voronoiCells(bounds(300), seedPoints(bounds(300), seededRng()));
    for (const { poly } of cells) {
      const r = inscribedRect(poly);
      const cellArea = polygonArea(poly);
      expect(r.w * r.d).toBeLessThanOrEqual(cellArea + 1e-6);
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.d).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses a worthwhile share of the cell', () => {
    // A rectangle that shrank to nothing would give a city of empty lots.
    const cells = voronoiCells(bounds(300), seedPoints(bounds(300), seededRng()));
    const ratios = cells.map(({ poly }) => {
      const r = inscribedRect(poly);
      return (r.w * r.d) / polygonArea(poly);
    });
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    expect(mean).toBeGreaterThan(0.4);
  });
});

describe('voronoiLayout', () => {
  it('is registered and reachable by name', () => {
    expect(LAYOUTS.VORONOI).toBe(voronoiLayout);
  });

  it('produces blocks and roads', () => {
    const { blocks, roads } = voronoiLayout(bounds(300), false, seededRng());
    expect(blocks.length).toBeGreaterThan(0);
    expect(roads.length).toBeGreaterThan(0);
  });

  it('produces no roads when they are excluded', () => {
    const { blocks, roads } = voronoiLayout(bounds(300), true, seededRng());
    expect(roads).toHaveLength(0);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('gives the network a hierarchy', () => {
    // Long cell boundaries become avenues. Without that the whole thing is a uniform
    // mesh, which is the flaw the grid layout also had to solve.
    const { roads } = voronoiLayout(bounds(400), false, seededRng());
    const widths = new Set(roads.map(r => r.width));
    expect(widths.size).toBeGreaterThan(1);
  });

  it('is not axis-aligned, unlike every other layout', () => {
    // The entire reason this layout exists. GRID and BSP produce only horizontal and
    // vertical roads; a majority of these should run at some other angle.
    const { roads } = voronoiLayout(bounds(400), false, seededRng());
    const axisAligned = roads.filter(r =>
      Math.abs(r.x1 - r.x2) < 0.5 || Math.abs(r.z1 - r.z2) < 0.5).length;
    expect(axisAligned / roads.length).toBeLessThan(0.35);
  });

  it('drops blocks centred outside a drawn boundary', () => {
    const boundary = { points: [
      { x: -100, z: -100 }, { x: 100, z: -100 }, { x: 100, z: 100 }, { x: -100, z: 100 },
    ] };
    const { blocks } = voronoiLayout(bounds(300), true, seededRng(), [], boundary);
    for (const b of blocks) {
      expect(Math.abs(b.x)).toBeLessThanOrEqual(100);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(100);
    }
  });

  it('keeps roads out of the water', () => {
    const lake = { points: [
      { x: -80, z: -80 }, { x: 80, z: -80 }, { x: 80, z: 80 }, { x: -80, z: 80 },
    ] };
    const { roads } = voronoiLayout(bounds(300), false, seededRng(), [lake]);
    for (const r of roads) {
      const mx = (r.x1 + r.x2) / 2;
      const mz = (r.z1 + r.z2) / 2;
      const inLake = Math.abs(mx) < 80 && Math.abs(mz) < 80;
      expect(inLake).toBe(false);
    }
  });

  it('reproduces the same city from the same seed', () => {
    const a = voronoiLayout(bounds(300), false, seededRng(31));
    const b = voronoiLayout(bounds(300), false, seededRng(31));
    expect(a.blocks).toEqual(b.blocks);
    expect(a.roads).toEqual(b.roads);
  });

  it('scales its cell count with the area', () => {
    const small = voronoiLayout(bounds(150), true, seededRng());
    const large = voronoiLayout(bounds(450), true, seededRng());
    expect(large.blocks.length).toBeGreaterThan(small.blocks.length);
  });

  it('sizes cells around the configured spacing', () => {
    const { blocks } = voronoiLayout(bounds(400), true, seededRng());
    const mean = blocks.reduce((s, b) => s + Math.max(b.w, b.d), 0) / blocks.length;
    expect(mean).toBeGreaterThan(VORONOI_SPACING * 0.2);
    expect(mean).toBeLessThan(VORONOI_SPACING * 1.5);
  });
});
