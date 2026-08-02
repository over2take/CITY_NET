import { describe, it, expect } from 'vitest';
import {
  findJunctions, siteRoundabouts, applyRoundabouts, ringPolygon,
  segmentCrossing, generateCity, pointInPolygon,
  MIN_ARTERIAL_WIDTH, RING_WIDTH, SPACING_RADII,
} from '../index';
import type { RoadSegment } from '../types';
import { isUserDefinedName } from '../../utils/locationHelpers';

/**
 * Roundabouts.
 *
 * An overlay on a finished road network, not a layout, so these test it against roads
 * given directly rather than through a particular layout — that is the point of it
 * being an overlay.
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

/**
 * A seed whose first roll clears the `normal` density share.
 *
 * Siting rolls before it tests anything else, so a seed that fails the roll skips the
 * junction outright — and every exclusion test below would pass without exercising the
 * rule it names. The default seed rolls 0.88, above the 0.6 share, and did exactly that.
 */
const PASSES_ROLL = 1;

/** A crossroads of two wide roads, sharing no endpoint — the grid's case. */
const cross = (x = 0, z = 0, width = 8): RoadSegment[] => [
  { x1: x - 100, z1: z, x2: x + 100, z2: z, width },
  { x1: x, z1: z - 100, x2: x, z2: z + 100, width },
];

describe('segmentCrossing', () => {
  it('finds where two segments cross', () => {
    const hit = segmentCrossing(
      { x1: -10, z1: 0, x2: 10, z2: 0, width: 5 },
      { x1: 0, z1: -10, x2: 0, z2: 10, width: 5 }
    );
    expect(hit?.x).toBeCloseTo(0);
    expect(hit?.z).toBeCloseTo(0);
  });

  it('returns null for segments that miss', () => {
    expect(segmentCrossing(
      { x1: -10, z1: 0, x2: -5, z2: 0, width: 5 },
      { x1: 0, z1: -10, x2: 0, z2: 10, width: 5 }
    )).toBeNull();
  });

  it('returns null for parallel segments', () => {
    expect(segmentCrossing(
      { x1: -10, z1: 0, x2: 10, z2: 0, width: 5 },
      { x1: -10, z1: 5, x2: 10, z2: 5, width: 5 }
    )).toBeNull();
  });
});

describe('findJunctions', () => {
  it('finds a crossing where no endpoint is shared', () => {
    // gridLayout lays each street as one full-length span, so its intersections exist
    // only as crossings. Missing these would leave the grid without roundabouts.
    const j = findJunctions(cross());
    expect(j).toHaveLength(1);
    expect(j[0].x).toBeCloseTo(0);
    expect(j[0].z).toBeCloseTo(0);
  });

  it('ignores junctions of minor roads', () => {
    // A roundabout is a junction of arterials; on a side street it is street furniture.
    expect(findJunctions(cross(0, 0, MIN_ARTERIAL_WIDTH - 1))).toHaveLength(0);
  });

  it('reports the wider of the two roads', () => {
    const [j] = findJunctions([
      { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 },
      { x1: 0, z1: -100, x2: 0, z2: 100, width: 9 },
    ]);
    expect(j.width).toBe(9);
  });
});

describe('siteRoundabouts', () => {
  it('places none when off', () => {
    expect(siteRoundabouts(cross(), 'off', seededRng())).toHaveLength(0);
  });

  it('draws no randomness when off, so an existing seed is unaffected', () => {
    const a = seededRng(5);
    const b = seededRng(5);
    siteRoundabouts(cross(), 'off', a);
    expect(a()).toBe(b());
  });

  it('places fewer when sparse than when normal', () => {
    // Twenty junctions, so the difference is a share rather than a coin flip.
    const roads: RoadSegment[] = [];
    for (let i = 0; i < 20; i++) {
      roads.push({ x1: -500, z1: i * 200 - 2000, x2: 500, z2: i * 200 - 2000, width: 8 });
      roads.push({ x1: i * 200 - 2000, z1: -500, x2: i * 200 - 2000, z2: 500, width: 8 });
    }
    const sparse = siteRoundabouts(roads, 'sparse', seededRng(3)).length;
    const normal = siteRoundabouts(roads, 'normal', seededRng(3)).length;
    expect(normal).toBeGreaterThanOrEqual(sparse);
  });

  it('keeps them apart', () => {
    const roads: RoadSegment[] = [];
    for (let i = 0; i < 12; i++) {
      roads.push({ x1: -400, z1: i * 12 - 100, x2: 400, z2: i * 12 - 100, width: 8 });
      roads.push({ x1: i * 12 - 100, z1: -400, x2: i * 12 - 100, z2: 400, width: 8 });
    }
    const placed = siteRoundabouts(roads, 'normal', seededRng());
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const gap = Math.hypot(placed[i].x - placed[j].x, placed[i].z - placed[j].z);
        expect(gap).toBeGreaterThanOrEqual(
          Math.max(placed[i].radius, placed[j].radius) * SPACING_RADII - 1e-6
        );
      }
    }
  });

  it('keeps them out of the water', () => {
    const lake = { points: [
      { x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 },
    ] };
    expect(siteRoundabouts(cross(), 'normal', seededRng(PASSES_ROLL), [lake])).toHaveLength(0);
  });

  it('keeps the whole ring out of the water, not just its centre', () => {
    // A junction on a shoreline has its centre on dry ground while half the ring hangs
    // over the water. Testing the centre alone let that through.
    const shore = { points: [
      { x: 5, z: -200 }, { x: 400, z: -200 }, { x: 400, z: 200 }, { x: 5, z: 200 },
    ] };
    // The junction is at the origin and the shore starts at x = 5, so the centre is
    // dry and the ring is not. Asserting it is rejected outright, rather than looping
    // over what got placed — an empty list would pass that vacuously.
    expect(siteRoundabouts(cross(), 'normal', seededRng(PASSES_ROLL), [shore])).toHaveLength(0);
  });

  it('keeps them inside a drawn boundary', () => {
    const boundary = { points: [
      { x: 200, z: 200 }, { x: 300, z: 200 }, { x: 300, z: 300 }, { x: 200, z: 300 },
    ] };
    expect(siteRoundabouts(cross(), 'normal', seededRng(PASSES_ROLL), [], boundary)).toHaveLength(0);
  });

  it('keeps the whole ring inside a drawn boundary', () => {
    // Same defect as the shoreline, and the same fix: a junction just inside an edge
    // would otherwise put half its ring outside the area the GM drew.
    const boundary = { points: [
      { x: -400, z: -400 }, { x: 5, z: -400 }, { x: 5, z: 400 }, { x: -400, z: 400 },
    ] };
    // The junction sits inside the boundary, which ends at x = 5; the ring does not.
    expect(siteRoundabouts(cross(), 'normal', seededRng(PASSES_ROLL), [], boundary)).toHaveLength(0);
  });

  it('places one on clear ground with that seed', () => {
    // The control for every exclusion test above: if this were empty they would all
    // pass without exercising anything.
    expect(siteRoundabouts(cross(), 'normal', seededRng(PASSES_ROLL))).toHaveLength(1);
  });

  it('reproduces from a seed', () => {
    expect(siteRoundabouts(cross(), 'normal', seededRng(9)))
      .toEqual(siteRoundabouts(cross(), 'normal', seededRng(9)));
  });
});

describe('applyRoundabouts', () => {
  const one = [{ x: 0, z: 0, radius: 15 }];

  it('returns the roads untouched when there are none', () => {
    const roads = cross();
    expect(applyRoundabouts(roads, [])).toBe(roads);
  });

  it('cuts the approaches back to the ring', () => {
    // Without this the arterials run straight through the island and the roundabout is
    // a decoration painted over a crossroads.
    const out = applyRoundabouts(cross(), one);
    const ring = ringPolygon(one[0]);
    for (const r of out) {
      if (r.width === RING_WIDTH) continue; // the ring itself
      const mid = { x: (r.x1 + r.x2) / 2, z: (r.z1 + r.z2) / 2 };
      expect(pointInPolygon(ring, mid.x, mid.z)).toBe(false);
    }
  });

  it('leaves the approaches reaching the ring', () => {
    // Trimmed too far and the roundabout is an island with no roads touching it.
    const out = applyRoundabouts(cross(), one).filter(r => r.width !== RING_WIDTH);
    const touching = out.filter(r =>
      [[r.x1, r.z1], [r.x2, r.z2]].some(([x, z]) =>
        Math.abs(Math.hypot(x, z) - one[0].radius) < 1.5));
    expect(touching.length).toBe(4);
  });

  it('lays the ring itself', () => {
    const out = applyRoundabouts(cross(), one);
    const ring = out.filter(r => r.width === RING_WIDTH);
    expect(ring.length).toBeGreaterThanOrEqual(6);
    // Every ring segment sits at the radius, which is what makes it read as a circle.
    for (const r of ring) {
      expect(Math.hypot(r.x1, r.z1)).toBeCloseTo(one[0].radius, 1);
    }
  });

  it('closes the ring', () => {
    // An open arc would leave traffic driving off the end of a curve.
    const ring = applyRoundabouts(cross(), one).filter(r => r.width === RING_WIDTH);
    const ends = new Map<string, number>();
    for (const r of ring) {
      for (const k of [`${r.x1.toFixed(3)},${r.z1.toFixed(3)}`, `${r.x2.toFixed(3)},${r.z2.toFixed(3)}`]) {
        ends.set(k, (ends.get(k) ?? 0) + 1);
      }
    }
    for (const count of ends.values()) expect(count).toBe(2);
  });
});

describe('generateCity with roundabouts', () => {
  const opts = (extra = {}) => ({
    sectionType: 'MIXED' as const, excludeRoads: false, layout: 'GRID' as const, ...extra,
  });

  it('makes none by default', () => {
    const a = generateCity(bounds(400), opts(), freshContext(), seededRng(21), deps);
    const b = generateCity(
      bounds(400), opts({ roundabouts: 'off' }), freshContext(), seededRng(21), deps
    );
    expect(a.roads).toEqual(b.roads);
  });

  it('changes the road network when asked for', () => {
    const off = generateCity(bounds(400), opts(), freshContext(), seededRng(21), deps);
    const on = generateCity(
      bounds(400), opts({ roundabouts: 'normal' }), freshContext(), seededRng(21), deps
    );
    expect(on.roads).not.toEqual(off.roads);
  });

  it('dresses the islands rather than leaving holes', () => {
    const on = generateCity(
      bounds(400), opts({ roundabouts: 'normal' }), freshContext(), seededRng(21), deps
    );
    expect(on.buildings.some(b => b.temp_block_id?.startsWith('gen_circus_'))).toBe(true);
  });

  it('names islands from the generated vocabulary, not something new', () => {
    // Anything outside ZONE_TYPE_NAMES counts as authored by the GM: it renders in the
    // purple reserved for structures with data, and a region purge keeps it — so every
    // regenerate would leave its old islands behind and stack new ones on them.
    const on = generateCity(
      bounds(400), opts({ roundabouts: 'normal' }), freshContext(), seededRng(21), deps
    );
    const islands = on.buildings.filter(b => b.temp_block_id?.startsWith('gen_circus_'));
    expect(islands.length).toBeGreaterThan(0);
    for (const b of islands) {
      expect(isUserDefinedName(b.name), b.name).toBe(false);
    }
  });

  it('reproduces from a seed', () => {
    const a = generateCity(
      bounds(400), opts({ roundabouts: 'normal' }), freshContext(), seededRng(8), deps
    );
    const b = generateCity(
      bounds(400), opts({ roundabouts: 'normal' }), freshContext(), seededRng(8), deps
    );
    expect(a.roads).toEqual(b.roads);
    expect(a.buildings).toEqual(b.buildings);
  });

  it('works on every layout, being an overlay rather than one of them', () => {
    for (const layout of ['BSP', 'GRID', 'RING', 'VORONOI'] as const) {
      const res = generateCity(
        bounds(400), opts({ layout, roundabouts: 'normal' }), freshContext(), seededRng(4), deps
      );
      expect(res.roads.length, layout).toBeGreaterThan(0);
    }
  });

  it('makes none when roads are excluded', () => {
    const res = generateCity(
      bounds(400), opts({ excludeRoads: true, roundabouts: 'normal' }),
      freshContext(), seededRng(21), deps
    );
    expect(res.roads).toHaveLength(0);
    expect(res.buildings.some(b => b.temp_block_id?.startsWith('gen_circus_'))).toBe(false);
  });
});
