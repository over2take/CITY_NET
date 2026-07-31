import { describe, it, expect } from 'vitest';
import {
  LAYOUTS,
  gridLayout,
  superblockLayout,
  bspLayout,
  ringLayout,
  RING_COUNT,
  SPOKE_COUNT,
  RING_ROAD_WIDTH,
  SPOKE_COUNT as SC,
  clampBuildingsUnderDecks,
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

/** Perpendicular distance from a point to a segment, on the XZ plane. */
function distanceToSegment(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

// ─── registry ─────────────────────────────────────────────────────────────────

describe('layout registry', () => {
  it('offers every layout type', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(['BSP', 'GRID', 'RING', 'SUPERBLOCK']);
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

// ─── ring ────────────────────────────────────────────────────────────────────

describe('ringLayout', () => {
  const R = 300;
  const radiusOf = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

  it('keeps the city round, leaving the corners of a square selection empty', () => {
    // A beltway city is circular; filling the corners would defeat the shape.
    const { blocks } = ringLayout(bounds(R), false, seededRng());
    for (const b of blocks) expect(radiusOf(b)).toBeLessThanOrEqual(R + 1);
    const corner = blocks.filter((b) => Math.abs(b.x) > R * 0.85 && Math.abs(b.z) > R * 0.85);
    expect(corner).toHaveLength(0);
  });

  it('elevates the spokes but leaves the loops on the ground', () => {
    // A closed loop has no ends to ramp down at, so an elevated ring either never
    // meets the street network or does so at one arbitrary point. Both read as broken.
    const { roads, overpasses } = ringLayout(bounds(R), false, seededRng());
    expect(overpasses?.length).toBe(SPOKE_COUNT);
    expect(roads.some((r) => r.width === RING_ROAD_WIDTH)).toBe(true);
  });

  it('lays closed loops at more than one radius', () => {
    const { roads } = ringLayout(bounds(R), false, seededRng());
    const ringRoads = roads.filter((r) => r.width === RING_ROAD_WIDTH);
    expect(ringRoads.length).toBeGreaterThan(RING_COUNT * 10);

    const radii = new Set(ringRoads.map((r) => Math.round(radiusOf({ x: r.x1, z: r.z1 }) / 10)));
    expect(radii.size).toBeGreaterThanOrEqual(RING_COUNT);
  });

  it('runs spokes outward from the innermost loop, not from the centre', () => {
    // Six arterials converging on a point left a starburst of dead ground there, and
    // real highways meet a downtown loop rather than piling into the middle.
    const { overpasses } = ringLayout(bounds(R), false, seededRng());
    for (const s of overpasses ?? []) {
      const inner = Math.min(...s.points.map(radiusOf));
      const outer = Math.max(...s.points.map(radiusOf));
      expect(inner).toBeGreaterThan(1);
      expect(outer).toBeGreaterThan(inner);
    }
  });

  it('brings both ends of a spoke down to the ground', () => {
    // Ramps that do not fit inside the deck leave it ending in mid-air.
    const { overpasses } = ringLayout(bounds(R), false, seededRng());
    for (const s of overpasses ?? []) {
      const length = Math.hypot(
        s.points[1].x - s.points[0].x, s.points[1].z - s.points[0].z,
      );
      expect(s.ramp_length_start + s.ramp_length_end).toBeLessThanOrEqual(length);
      expect(s.ramp_length_start).toBeGreaterThan(0);
      expect(s.ramp_length_end).toBeGreaterThan(0);
    }
  });

  it('spaces the inner loop tighter than the outer one', () => {
    // Beltways are not evenly spaced; downtown is ringed close.
    const { roads } = ringLayout(bounds(R), false, seededRng());
    const radii = [...new Set(
      roads.filter((r) => r.width === RING_ROAD_WIDTH)
        .map((r) => Math.round(radiusOf({ x: r.x1, z: r.z1 }))),
    )].sort((a, b) => a - b);
    expect(radii[0]).toBeLessThan(radii[radii.length - 1] / 2);
  });

  it('fills the space between the arterials with ordinary blocks', () => {
    // The point of the layout: only the arterial network is radial. Between the
    // loops sit normal streets, so there should be plenty of blocks out there.
    const { blocks } = ringLayout(bounds(R), false, seededRng());
    const outerBand = blocks.filter((b) => radiusOf(b) > R * 0.5);
    expect(outerBand.length).toBeGreaterThan(10);
  });

  it('builds downtown inside the innermost loop', () => {
    const { blocks } = ringLayout(bounds(R), false, seededRng());
    const core = blocks.filter((b) => radiusOf(b) < R * 0.25);
    expect(core.length).toBeGreaterThan(0);
  });

  it('fills the disc as densely as the BSP fills a rectangle', () => {
    // The regression this layout shipped with: partitioning the disc into annular
    // sectors and sub-laying each one discarded most of what it generated, because a
    // sector's bounding box is far larger than the sector. The city came out sparse
    // and fragmented. A disc is pi/4 of its square, so the ratio should land near that.
    const ring = ringLayout(bounds(R), false, seededRng()).blocks.length;
    const bsp = bspLayout(bounds(R), false, seededRng()).blocks.length;
    expect(ring / bsp).toBeGreaterThan(0.6);
  });

  it('lays one continuous street fabric rather than one per sector', () => {
    // Local streets are continuous; they are not divided up by the loops.
    // Sector-local networks showed up as far more short segments.
    const { roads } = ringLayout(bounds(R), false, seededRng());
    const local = roads.filter((r) => r.width !== RING_ROAD_WIDTH);
    expect(local.length).toBeGreaterThan(0);
  });

  it('raises nothing when infrastructure is excluded', () => {
    const { overpasses } = ringLayout(bounds(R), true, seededRng());
    expect(overpasses ?? []).toHaveLength(0);
  });

  it('lays no roads when infrastructure is excluded, but still blocks out the city', () => {
    const { blocks, roads } = ringLayout(bounds(R), true, seededRng());
    expect(roads).toHaveLength(0);
    expect(blocks.length).toBeGreaterThan(0);
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
    const counts = (['BSP', 'GRID', 'SUPERBLOCK', 'RING'] as const).map(
      (layout) =>
        generateCity(bounds(300), { ...opts, layout }, freshContext(), seededRng(), deps)
          .blocks.length,
    );
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('carries arterials raised by the layout through to the result', () => {
    // RING elevates its spokes, and those have to reach the caller alongside whatever
    // bridges the water needed.
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', layout: 'RING' }, freshContext(), seededRng(), deps,
    );
    expect(result.overpasses.length).toBeGreaterThanOrEqual(SC);
  });

  it('leaves the ground under an elevated spoke buildable', () => {
    // The whole reason for raising them: a ground-level arterial sterilises every block
    // it crosses, because placement rejects footprints touching a road. Placement never
    // checks overpasses, so the fabric survives underneath.
    const offered: Array<{ x: number; z: number }> = [];
    const result = generateCity(
      bounds(300),
      { sectionType: 'MIXED', layout: 'RING' },
      freshContext(),
      seededRng(),
      { fillPlot: (x: number, z: number) => { offered.push({ x, z }); } },
    );

    const spoke = result.overpasses[0];
    expect(spoke).toBeDefined();
    const near = offered.filter((p) =>
      p.x * 0 === 0 && distanceToSegment(p, spoke.points[0], spoke.points[1]) < spoke.width);
    expect(near.length).toBeGreaterThan(0);
  });

  it('falls back to BSP for an unrecognised layout', () => {
    // A stale saved option should not generate an empty city.
    const opts = { sectionType: 'MIXED' as const, layout: 'NONSENSE' as never };
    const result = generateCity(bounds(200), opts, freshContext(), seededRng(), deps);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('honours a drawn boundary whichever layout is chosen', () => {
    for (const layout of ['BSP', 'GRID', 'SUPERBLOCK', 'RING'] as const) {
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

// ─── decks over buildings ─────────────────────────────────────────────────────

describe('clampBuildingsUnderDecks', () => {
  const deck = (over: Partial<{ points: { x: number; z: number }[]; width: number; height: number }> = {}) => ({
    points: [{ x: 0, z: 0 }, { x: 200, z: 0 }],
    width: 8,
    height: 14,
    ramp_length: 60,
    ramp_length_start: 60,
    ramp_length_end: 60,
    ...over,
  });

  const building = (over: Partial<{ x: number; z: number; width: number; depth: number; height: number }> = {}) => ({
    x: 100, z: 0, width: 6, depth: 6, height: 50, ...over,
  });

  it('leaves buildings clear of any deck alone', () => {
    const b = building({ z: 500 });
    expect(clampBuildingsUnderDecks([b], [deck()])).toEqual([b]);
  });

  it('leaves everything alone when there are no decks', () => {
    const b = building();
    expect(clampBuildingsUnderDecks([b], [])).toEqual([b]);
  });

  it('caps a tower that would rise through the deck', () => {
    // The reported bug: overpasses running through buildings.
    const [out] = clampBuildingsUnderDecks([building({ height: 50 })], [deck()]);
    expect(out.height).toBeLessThan(14);
    expect(out.height).toBeGreaterThan(0);
  });

  it('leaves a building that already fits underneath', () => {
    const b = building({ height: 4 });
    const [out] = clampBuildingsUnderDecks([b], [deck()]);
    expect(out.height).toBe(4);
  });

  it('drops a building where the deck is too low to build under', () => {
    // Near a ramp the deck is at ground level, which is just a road.
    const out = clampBuildingsUnderDecks([building({ x: 3, height: 20 })], [deck()]);
    expect(out).toHaveLength(0);
  });

  it('caps against the lowest deck when several cross', () => {
    const low = deck({ height: 10, points: [{ x: 0, z: 0 }, { x: 200, z: 0 }] });
    const high = deck({ height: 24, points: [{ x: 100, z: -100 }, { x: 100, z: 100 }] });
    const [out] = clampBuildingsUnderDecks([building({ height: 60 })], [high, low]);
    expect(out.height).toBeLessThan(10);
  });

  it('accounts for footprint width, not just the centre point', () => {
    // A wide building whose centre clears the deck can still be under its edge.
    const wide = building({ z: 9, width: 20, depth: 20, height: 40 });
    const [out] = clampBuildingsUnderDecks([wide], [deck()]);
    expect(out.height).toBeLessThan(40);
  });
});
