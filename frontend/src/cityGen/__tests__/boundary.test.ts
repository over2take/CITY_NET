import { describe, it, expect } from 'vitest';
import {
  footprintOutsidePolygon,
  clipSegmentToBoundary,
  clipSegmentToPolygons,
  clipSegmentToLand,
  splitCity,
  createIsBlocked,
  SpatialGrid,
  generateCity,
  type Polygon,
} from '../index';

/**
 * Drawn generation bounds. A boundary is a water polygon with the sign flipped —
 * water rejects what falls inside it, a boundary rejects what falls outside — so the
 * two share every helper.
 */

/** Axis-aligned square centred on the origin, as a boundary polygon. */
const square = (half: number): Polygon => ({
  points: [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ],
});

/** An L, so the notch can be checked for emptiness. */
const concaveL: Polygon = {
  points: [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 40 },
    { x: 40, z: 40 },
    { x: 40, z: 100 },
    { x: 0, z: 100 },
  ],
};

const seg = (x1: number, z1: number, x2: number, z2: number) =>
  ({ x1, z1, x2, z2, width: 2 });

const bounds = (half: number) => ({
  min: { x: -half, z: -half },
  max: { x: half, z: half },
});

// ─── footprintOutsidePolygon ──────────────────────────────────────────────────

describe('footprintOutsidePolygon', () => {
  const b = square(50);

  it('accepts a footprint well inside', () => {
    expect(footprintOutsidePolygon(b, 0, 0, 10, 10)).toBe(false);
  });

  it('rejects a footprint well outside', () => {
    expect(footprintOutsidePolygon(b, 200, 200, 10, 10)).toBe(true);
  });

  it('rejects one straddling the edge, matching how water treats a shoreline', () => {
    // Centre is inside but two corners are not; a building half outside the drawn
    // area is not what the GM asked for.
    expect(footprintOutsidePolygon(b, 48, 0, 10, 10)).toBe(true);
  });

  it('accepts a footprint that just fits inside the edge', () => {
    expect(footprintOutsidePolygon(b, 44, 0, 10, 10)).toBe(false);
  });

  it('rejects anything in a concave notch', () => {
    expect(footprintOutsidePolygon(concaveL, 70, 70, 4, 4)).toBe(true);
  });
});

// ─── clipping ─────────────────────────────────────────────────────────────────

describe('clipSegmentToBoundary', () => {
  const b = square(50);

  it('leaves a fully inside segment untouched', () => {
    const [only] = clipSegmentToBoundary(seg(-10, 0, 10, 0), b);
    expect(only).toMatchObject({ x1: -10, x2: 10 });
  });

  it('drops a fully outside segment', () => {
    expect(clipSegmentToBoundary(seg(200, 200, 300, 300), b)).toHaveLength(0);
  });

  it('cuts a crossing segment at the edge', () => {
    const out = clipSegmentToBoundary(seg(-100, 0, 0, 0), b);
    expect(out).toHaveLength(1);
    expect(out[0].x1).toBeCloseTo(-50);
    expect(out[0].x2).toBeCloseTo(0);
  });

  it('keeps a segment whole when there is no boundary', () => {
    expect(clipSegmentToBoundary(seg(0, 0, 999, 999), undefined)).toHaveLength(1);
  });

  it('is the exact inverse of clipping to land', () => {
    // Same polygon, same segment: the two together must reconstruct the original.
    const s = seg(-100, 0, 100, 0);
    const inside = clipSegmentToPolygons(s, [b], true);
    const outside = clipSegmentToLand(s, [b]);
    const span = (arr: typeof inside) =>
      arr.reduce((n, r) => n + Math.abs(r.x2 - r.x1), 0);
    expect(span(inside) + span(outside)).toBeCloseTo(200);
  });
});

// ─── placement ────────────────────────────────────────────────────────────────

describe('createIsBlocked with a boundary', () => {
  const empty = () => new SpatialGrid([]);

  it('blocks a footprint outside the boundary', () => {
    const isBlocked = createIsBlocked(empty(), [], false, [], square(50));
    expect(isBlocked(200, 200, 4, 4)).toBe(true);
  });

  it('allows a footprint inside it', () => {
    const isBlocked = createIsBlocked(empty(), [], false, [], square(50));
    expect(isBlocked(0, 0, 4, 4)).toBe(false);
  });

  it('blocks nothing extra when no boundary is given', () => {
    const isBlocked = createIsBlocked(empty(), [], false, []);
    expect(isBlocked(9999, 9999, 4, 4)).toBe(false);
  });
});

// ─── split ────────────────────────────────────────────────────────────────────

describe('splitCity with a boundary', () => {
  it('drops blocks centred outside the boundary', () => {
    const { blocks } = splitCity(bounds(200), false, () => 0.5, [], square(60));
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(Math.abs(b.x)).toBeLessThanOrEqual(60);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(60);
    }
  });

  it('clips road seams to the boundary', () => {
    const { roads } = splitCity(bounds(200), false, () => 0.5, [], square(60));
    for (const r of roads) {
      expect(Math.abs(r.x1)).toBeLessThanOrEqual(61);
      expect(Math.abs(r.x2)).toBeLessThanOrEqual(61);
      expect(Math.abs(r.z1)).toBeLessThanOrEqual(61);
      expect(Math.abs(r.z2)).toBeLessThanOrEqual(61);
    }
  });

  it('leaves the notch of a concave boundary empty', () => {
    const { blocks } = splitCity(
      { min: { x: 0, z: 0 }, max: { x: 100, z: 100 } },
      false, () => 0.5, [], concaveL,
    );
    // The notch is the far corner of the L, x > 40 and z > 40.
    for (const b of blocks) expect(b.x > 40 && b.z > 40).toBe(false);
  });

  it('produces an identical split to today when no boundary is given', () => {
    // The regression guard: drawn bounds must not disturb the existing path.
    const withoutArg = splitCity(bounds(200), false, seededRng(), []);
    const withUndefined = splitCity(bounds(200), false, seededRng(), [], undefined);
    expect(withUndefined).toEqual(withoutArg);
  });
});

/** Deterministic sequence, so two runs are comparable. */
function seededRng() {
  let a = 12345;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

// ─── end to end ───────────────────────────────────────────────────────────────

/**
 * The real `fillPlot` is `generateThemedBuildingsForPlot`, which makes 36 unseeded
 * `Math.random` calls of its own — so buildings are not reproducible from a seed even
 * though the layout is. The existing cityGen suite injects a stub for the same reason.
 * These assertions therefore cover blocks and roads, which are deterministic, and
 * whether placement is offered a position at all.
 */
const freshContext = () => ({ locations: [], roads: [], waterBodies: [] });

describe('generateCity with a boundary', () => {
  it('keeps every block and road inside the drawn area', () => {
    const result = generateCity(
      bounds(200),
      { sectionType: 'MIXED', boundary: square(60) },
      freshContext(),
      seededRng(),
      { fillPlot: () => {} },
    );

    expect(result.blocks.length).toBeGreaterThan(0);
    for (const b of result.blocks) {
      expect(Math.abs(b.x)).toBeLessThanOrEqual(60);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(60);
    }
    for (const r of result.roads) {
      expect(Math.abs(r.x1)).toBeLessThanOrEqual(61);
      expect(Math.abs(r.z1)).toBeLessThanOrEqual(61);
    }
  });

  it('never offers placement a spot outside the boundary', () => {
    // Whatever the building generator does with the position, it must not be given
    // one the GM did not draw.
    const offered: Array<{ x: number; z: number }> = [];
    generateCity(
      bounds(200),
      { sectionType: 'MIXED', boundary: square(60) },
      freshContext(),
      seededRng(),
      { fillPlot: (x: number, z: number) => { offered.push({ x, z }); } },
    );
    expect(offered.length).toBeGreaterThan(0);
    for (const p of offered) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(60);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(60);
    }
  });

  it('builds a smaller city than the same bounds unbounded', () => {
    const opts = { sectionType: 'MIXED' as const };
    const deps = { fillPlot: () => {} };
    const free = generateCity(bounds(200), opts, freshContext(), seededRng(), deps);
    const bounded = generateCity(
      bounds(200), { ...opts, boundary: square(60) }, freshContext(), seededRng(), deps,
    );
    expect(bounded.blocks.length).toBeLessThan(free.blocks.length);
  });

  it('is identical to today when no boundary is given', () => {
    // The guard that matters most: existing generation is untouched.
    const opts = { sectionType: 'MIXED' as const };
    const deps = { fillPlot: () => {} };
    const a = generateCity(bounds(150), opts, freshContext(), seededRng(), deps);
    const b = generateCity(
      bounds(150), { ...opts, boundary: undefined }, freshContext(), seededRng(), deps,
    );
    expect(b).toEqual(a);
  });

  it('falls back to the bounds when the boundary is degenerate', () => {
    // Fewer than three points cannot enclose anything; generating nothing at all
    // would look like a broken button.
    const result = generateCity(
      bounds(150),
      { sectionType: 'MIXED', boundary: { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }] } },
      freshContext(),
      seededRng(),
      { fillPlot: () => {} },
    );
    expect(result.blocks.length).toBeGreaterThan(0);
  });
});
