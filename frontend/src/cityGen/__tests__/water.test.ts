import { describe, it, expect, vi } from 'vitest';
import {
  parseWaterBodies,
  pointInPolygon,
  pointInWater,
  footprintInWater,
  submergedSpans,
  segmentLength,
  clipSegmentToLand,
  findBridges,
  generateShorelineRoads,
  snapRoadEndsToShoreline,
  splitCity,
  createIsBlocked,
  SpatialGrid,
  generateCity,
  MAX_BRIDGE_SPAN,
  BRIDGE_RAMP_LENGTH,
  type WaterPolygon,
  type OverpassDensity,
  type SectionType,
  type RawBuilding,
  type GenerateCityDeps,
} from '../index';

/** Deterministic PRNG so bridge draws are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Proper segment intersection on the XZ plane, for deck-crossing checks. */
const segmentsIntersect = (
  a1: { x: number; z: number }, a2: { x: number; z: number },
  b1: { x: number; z: number }, b2: { x: number; z: number }
) => {
  const rx = a2.x - a1.x, rz = a2.z - a1.z;
  const sx = b2.x - b1.x, sz = b2.z - b1.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((b1.x - a1.x) * sz - (b1.z - a1.z) * sx) / den;
  const u = ((b1.x - a1.x) * rz - (b1.z - a1.z) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};

/** Axis-aligned rectangular water body. */
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): WaterPolygon => ({
  points: [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ],
});

/** The same rectangle as an API row. */
const rectRow = (minX: number, minZ: number, maxX: number, maxZ: number) => ({
  points_json: JSON.stringify(rect(minX, minZ, maxX, maxZ).points),
});

describe('parseWaterBodies', () => {
  it('parses points_json rows', () => {
    const polys = parseWaterBodies([rectRow(0, 0, 10, 10)]);
    expect(polys).toHaveLength(1);
    expect(polys[0].points).toHaveLength(4);
  });

  it('drops unparseable json instead of throwing', () => {
    expect(parseWaterBodies([{ points_json: '{oops' }])).toEqual([]);
  });

  it('drops outlines with fewer than three points', () => {
    expect(parseWaterBodies([{ points_json: '[{"x":0,"z":0},{"x":1,"z":1}]' }])).toEqual([]);
  });

  it('drops points with non-finite coordinates', () => {
    // Three points, one invalid — the survivors no longer form a polygon.
    const row = { points_json: '[{"x":0,"z":0},{"x":null,"z":1},{"x":2,"z":2}]' };
    expect(parseWaterBodies([row])).toEqual([]);
  });

  it('accepts pre-parsed points', () => {
    const polys = parseWaterBodies([{ points: rect(0, 0, 10, 10).points }]);
    expect(polys).toHaveLength(1);
  });

  it('returns empty for no input', () => {
    expect(parseWaterBodies([])).toEqual([]);
  });
});

describe('pointInPolygon', () => {
  const square = rect(0, 0, 100, 100);

  it('detects a point inside', () => {
    expect(pointInPolygon(square, 50, 50)).toBe(true);
  });

  it('detects points outside on every side', () => {
    expect(pointInPolygon(square, -10, 50)).toBe(false);
    expect(pointInPolygon(square, 110, 50)).toBe(false);
    expect(pointInPolygon(square, 50, -10)).toBe(false);
    expect(pointInPolygon(square, 50, 110)).toBe(false);
  });

  it('handles a concave outline', () => {
    // A C-shape opening to +x; the notch centre is outside.
    const cShape: WaterPolygon = {
      points: [
        { x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 20 }, { x: 20, z: 20 },
        { x: 20, z: 80 }, { x: 100, z: 80 }, { x: 100, z: 100 }, { x: 0, z: 100 },
      ],
    };
    expect(pointInPolygon(cShape, 10, 50)).toBe(true);  // spine
    expect(pointInPolygon(cShape, 60, 50)).toBe(false); // notch
  });
});

describe('pointInWater', () => {
  it('is false with no water at all', () => {
    expect(pointInWater([], 0, 0)).toBe(false);
  });

  it('checks every body', () => {
    const polys = [rect(0, 0, 10, 10), rect(100, 100, 110, 110)];
    expect(pointInWater(polys, 105, 105)).toBe(true);
  });
});

describe('footprintInWater', () => {
  const lake = [rect(0, 0, 100, 100)];

  it('catches a fully submerged footprint', () => {
    expect(footprintInWater(lake, 50, 50, 10, 10)).toBe(true);
  });

  it('catches a corner dipping in', () => {
    // Centre is outside but the +x/+z corner reaches into the lake.
    expect(footprintInWater(lake, -2, -2, 10, 10)).toBe(true);
  });

  it('allows a footprint clear of the shore', () => {
    expect(footprintInWater(lake, -50, -50, 10, 10)).toBe(false);
  });

  it('short-circuits when there is no water', () => {
    expect(footprintInWater([], 50, 50, 10, 10)).toBe(false);
  });
});

describe('submergedSpans', () => {
  const channel = [rect(-10, -1000, 10, 1000)]; // 20 wide, runs along z

  it('finds the crossing of a channel', () => {
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    const spans = submergedSpans(channel, seg);
    expect(spans).toHaveLength(1);
    const len = (spans[0].t1 - spans[0].t0) * segmentLength(seg);
    expect(len).toBeCloseTo(20, 5);
  });

  it('returns nothing for a segment clear of the water', () => {
    const seg = { x1: -100, z1: 0, x2: -50, z2: 0, width: 6 };
    expect(submergedSpans(channel, seg)).toEqual([]);
  });

  it('returns nothing when there is no water', () => {
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    expect(submergedSpans([], seg)).toEqual([]);
  });

  it('reports two spans for two separate bodies', () => {
    const two = [rect(-60, -100, -40, 100), rect(40, -100, 60, 100)];
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    expect(submergedSpans(two, seg)).toHaveLength(2);
  });

  it('merges touching bodies into a single span', () => {
    const touching = [rect(-20, -100, 0, 100), rect(0, -100, 20, 100)];
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    const spans = submergedSpans(touching, seg);
    expect(spans).toHaveLength(1);
    const len = (spans[0].t1 - spans[0].t0) * segmentLength(seg);
    expect(len).toBeCloseTo(40, 5);
  });
});

describe('createIsBlocked with water', () => {
  it('blocks a footprint sitting in water', () => {
    const isBlocked = createIsBlocked(new SpatialGrid(), [], false, [rect(0, 0, 100, 100)]);
    expect(isBlocked(50, 50, 4, 4)).toBe(true);
  });

  it('allows a footprint on dry land', () => {
    const isBlocked = createIsBlocked(new SpatialGrid(), [], false, [rect(0, 0, 100, 100)]);
    expect(isBlocked(-50, -50, 4, 4)).toBe(false);
  });

  it('behaves as before when no water is supplied', () => {
    const isBlocked = createIsBlocked(new SpatialGrid(), [], false);
    expect(isBlocked(50, 50, 4, 4)).toBe(false);
  });
});

describe('clipSegmentToLand', () => {
  const channel = [rect(-10, -1000, 10, 1000)];

  it('leaves a dry segment alone', () => {
    const seg = { x1: -100, z1: 0, x2: -50, z2: 0, width: 6 };
    expect(clipSegmentToLand(seg, channel)).toEqual([seg]);
  });

  it('passes through when there is no water', () => {
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    expect(clipSegmentToLand(seg, [])).toEqual([seg]);
  });

  it('splits a crossing into two approaches ending at the shore', () => {
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    const parts = clipSegmentToLand(seg, channel);
    expect(parts).toHaveLength(2);
    expect(parts[0].x2).toBeCloseTo(-10, 5);
    expect(parts[1].x1).toBeCloseTo(10, 5);
  });

  it('drops a fully submerged segment', () => {
    const seg = { x1: -5, z1: 0, x2: 5, z2: 0, width: 6 };
    expect(clipSegmentToLand(seg, channel)).toEqual([]);
  });

  it('preserves the road width', () => {
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 3 };
    clipSegmentToLand(seg, channel).forEach((p) => expect(p.width).toBe(3));
  });
});

describe('splitCity with water', () => {
  const AREA = { min: { x: -200, z: -200 }, max: { x: 200, z: 200 } };

  it('lays no road across water', () => {
    const lake = [rect(-60, -60, 60, 60)];
    const { roads } = splitCity(AREA, false, mulberry32(4), lake);
    roads.forEach((r) => expect(submergedSpans(lake, r)).toEqual([]));
  });

  it('still produces roads outside the water', () => {
    const lake = [rect(-60, -60, 60, 60)];
    const { roads } = splitCity(AREA, false, mulberry32(4), lake);
    expect(roads.length).toBeGreaterThan(0);
  });

  it('splits identically on a dry map whether or not water is passed', () => {
    const withArg = splitCity(AREA, false, mulberry32(4), []);
    const without = splitCity(AREA, false, mulberry32(4));
    expect(withArg).toEqual(without);
  });

  it('produces the same blocks with and without water', () => {
    // Clipping must not disturb the random sequence driving the split.
    const dry = splitCity(AREA, false, mulberry32(4));
    const wet = splitCity(AREA, false, mulberry32(4), [rect(-60, -60, 60, 60)]);
    expect(wet.blocks).toEqual(dry.blocks);
  });
});

describe('generateShorelineRoads', () => {
  const AREA = { min: { x: -200, z: -200 }, max: { x: 200, z: 200 } };

  it('rings a water body with road', () => {
    const segs = generateShorelineRoads([rect(-60, -60, 60, 60)], AREA);
    expect(segs.length).toBeGreaterThan(0);
  });

  it('keeps the waterfront road out of the water', () => {
    const lake = [rect(-60, -60, 60, 60)];
    const segs = generateShorelineRoads(lake, AREA);
    segs.forEach((s) => {
      expect(pointInWater(lake, s.x1, s.z1)).toBe(false);
      expect(pointInWater(lake, s.x2, s.z2)).toBe(false);
    });
  });

  it('stays inside the generation area', () => {
    const segs = generateShorelineRoads([rect(-60, -60, 60, 60)], AREA);
    segs.forEach((s) => {
      expect(Math.abs(s.x1)).toBeLessThanOrEqual(200);
      expect(Math.abs(s.z1)).toBeLessThanOrEqual(200);
    });
  });

  it('produces nothing without water', () => {
    expect(generateShorelineRoads([], AREA)).toEqual([]);
  });

  it('drops shoreline that falls outside the selection', () => {
    // Lake mostly outside a small selection: only the overlapping arc remains.
    const small = { min: { x: -20, z: -20 }, max: { x: 20, z: 20 } };
    const segs = generateShorelineRoads([rect(-200, -200, 0, 0)], small);
    segs.forEach((s) => {
      expect(s.x1).toBeGreaterThanOrEqual(-20);
      expect(s.x1).toBeLessThanOrEqual(20);
    });
  });
});

describe('snapRoadEndsToShoreline', () => {
  // Waterfront road running along z at x = 0.
  const shore = [{ x1: 0, z1: -100, x2: 0, z2: 100, width: 6 }];

  it('pulls an overshooting end back onto the waterfront road', () => {
    // Approach runs past x = 0 and stops at x = 7, where the water starts.
    const approach = [{ x1: -60, z1: 0, x2: 7, z2: 0, width: 6 }];
    const [snapped] = snapRoadEndsToShoreline(approach, shore);
    expect(snapped.x2).toBeCloseTo(0, 5);
    expect(snapped.z2).toBeCloseTo(0, 5);
    expect(snapped.x1).toBeCloseTo(-60, 5); // inland end untouched
  });

  it('gives the two roads a shared point to be joined at', () => {
    const approach = [{ x1: -60, z1: 25, x2: 7, z2: 25, width: 6 }];
    const [snapped] = snapRoadEndsToShoreline(approach, shore);
    // The snapped end lies exactly on the waterfront segment.
    expect(snapped.x2).toBeCloseTo(0, 5);
    expect(Math.abs(snapped.z2)).toBeLessThanOrEqual(100);
  });

  it('leaves ends nowhere near the waterfront alone', () => {
    const inland = [{ x1: -200, z1: 0, x2: -120, z2: 0, width: 6 }];
    expect(snapRoadEndsToShoreline(inland, shore)).toEqual(inland);
  });

  it('passes roads through when there is no waterfront road', () => {
    const roads = [{ x1: -60, z1: 0, x2: 7, z2: 0, width: 6 }];
    expect(snapRoadEndsToShoreline(roads, [])).toEqual(roads);
  });

  it('drops a segment that collapses onto the waterfront road', () => {
    // Both ends within snapping distance of the same spot.
    const stub = [{ x1: -2, z1: 0, x2: 3, z2: 0, width: 6 }];
    expect(snapRoadEndsToShoreline(stub, shore)).toEqual([]);
  });

  it('preserves road width', () => {
    const approach = [{ x1: -60, z1: 0, x2: 7, z2: 0, width: 3 }];
    expect(snapRoadEndsToShoreline(approach, shore)[0].width).toBe(3);
  });
});

describe('findBridges', () => {
  // A channel with a road stub running to each bank, facing each other.
  const channel = [rect(-30, -1000, 30, 1000)];
  const approaches = [
    { x1: -120, z1: 0, x2: -30, z2: 0, width: 6 },
    { x1: 30, z1: 0, x2: 120, z2: 0, width: 6 },
  ];

  it('bridges a stub facing a road across the water', () => {
    const bridges = findBridges(approaches, channel, 'heavy', mulberry32(1));
    expect(bridges).toHaveLength(1);
    expect(bridges[0].width).toBe(6);
    expect(bridges[0].ramp_length).toBe(BRIDGE_RAMP_LENGTH);
  });

  it('extends the deck onto land at both ends for the ramps', () => {
    const [bridge] = findBridges(approaches, channel, 'heavy', mulberry32(1));
    const [start, end] = bridge.points;
    expect(Math.min(start.x, end.x)).toBeCloseTo(-30 - BRIDGE_RAMP_LENGTH, 5);
    expect(Math.max(start.x, end.x)).toBeCloseTo(30 + BRIDGE_RAMP_LENGTH, 5);
  });

  it('collapses the crossing seen from both banks into one bridge', () => {
    // Both stubs point at each other; without dedupe this would be two decks.
    expect(findBridges(approaches, channel, 'heavy', mulberry32(1))).toHaveLength(1);
  });

  it('builds nothing at off density', () => {
    expect(findBridges(approaches, channel, 'off', mulberry32(1))).toEqual([]);
  });

  it('builds nothing without water', () => {
    expect(findBridges(approaches, [], 'heavy', mulberry32(1))).toEqual([]);
  });

  it('draws no randomness without water', () => {
    const rng = vi.fn(() => 0.5);
    findBridges(approaches, [], 'heavy', rng);
    expect(rng).not.toHaveBeenCalled();
  });

  it('refuses a crossing with no road on the far bank', () => {
    const lonely = [{ x1: -120, z1: 0, x2: -30, z2: 0, width: 6 }];
    expect(findBridges(lonely, channel, 'heavy', mulberry32(1))).toEqual([]);
  });

  it('refuses water wider than the setting reaches', () => {
    const lake = [rect(-400, -1000, 400, 1000)]; // 800 across
    const far = [
      { x1: -500, z1: 0, x2: -400, z2: 0, width: 6 },
      { x1: 400, z1: 0, x2: 500, z2: 0, width: 6 },
    ];
    expect(findBridges(far, lake, 'heavy', mulberry32(1))).toEqual([]);
  });

  it('never spans beyond the documented maximum', () => {
    const lake = [rect(-1000, -1000, 1000, 1000)];
    const stubs = [
      { x1: -1100, z1: 0, x2: -1000, z2: 0, width: 6 },
      { x1: 1000, z1: 0, x2: 1100, z2: 0, width: 6 },
    ];
    findBridges(stubs, lake, 'heavy', mulberry32(1)).forEach((b) => {
      const deck = Math.hypot(b.points[1].x - b.points[0].x, b.points[1].z - b.points[0].z);
      expect(deck - 2 * BRIDGE_RAMP_LENGTH).toBeLessThanOrEqual(MAX_BRIDGE_SPAN);
    });
  });

  it('keeps at least one bridge whenever a site is viable', () => {
    // Scarce sites must not be thinned away to nothing by a light setting.
    (['sparse', 'normal', 'heavy'] as OverpassDensity[]).forEach((d) => {
      expect(findBridges(approaches, channel, d, mulberry32(1)).length).toBeGreaterThan(0);
    });
  });

  it('only uses recognised deck levels', () => {
    const bridges = findBridges(approaches, channel, 'heavy', mulberry32(1));
    bridges.forEach((b) => {
      expect([8, 13, 18, 23]).toContain(b.height);
    });
  });

  it('ignores approaches too short to ramp from', () => {
    const stubby = [
      { x1: -34, z1: 0, x2: -30, z2: 0, width: 6 },
      { x1: 30, z1: 0, x2: 34, z2: 0, width: 6 },
    ];
    expect(findBridges(stubby, channel, 'heavy', mulberry32(1))).toEqual([]);
  });
});

describe('generateCity with water', () => {
  const AREA = { min: { x: -200, z: -200 }, max: { x: 200, z: 200 } };
  const baseOpts = {
    sectionType: 'URBAN' as SectionType,
    excludeRoads: false,
  };

  it('is unchanged on a dry map', () => {
    const dry = generateCity(AREA, baseOpts, { locations: [], roads: [] }, mulberry32(5), {
      fillPlot: vi.fn(),
    });
    const explicitlyEmpty = generateCity(
      AREA, baseOpts, { locations: [], roads: [], waterBodies: [] }, mulberry32(5),
      { fillPlot: vi.fn() }
    );
    expect(explicitlyEmpty).toEqual(dry);
    expect(dry.overpasses).toEqual([]);
  });

  it('puts no building footprint in the water', () => {
    // Footprints, not just centres: the themed generators place most of a
    // structure relative to a checked root without re-testing each piece.
    const waterBodies = [rectRow(-200, -200, 0, 200)]; // floods the left half
    const result = generateCity(
      AREA,
      { ...baseOpts, sectionType: 'CORPO' as SectionType },
      { locations: [], roads: [], waterBodies },
      mulberry32(8)
    );
    const polys = parseWaterBodies(waterBodies);
    expect(result.buildings.length).toBeGreaterThan(0);
    result.buildings.forEach((b) => {
      expect(footprintInWater(polys, b.x, b.z, b.width, b.depth)).toBe(false);
    });
  });

  it('rolls a plot back whole rather than leaving it half built', () => {
    // fillPlot emits one piece on land and one out over the water; the plot
    // must be discarded entirely, not trimmed to the dry piece.
    const waterBodies = [rectRow(-200, -200, 0, 200)];
    const result = generateCity(
      AREA, baseOpts, { locations: [], roads: [], waterBodies }, mulberry32(3),
      {
        fillPlot: ((_x, _z, _w, _d, _zone, _blocked, _key, _grid, out) => {
          const list = out as RawBuilding[];
          const base = { name: '', y: 0, width: 4, depth: 4, height: 4, color: '', shape: 'box' };
          list.push({ ...base, x: 50, z: 50 });    // dry side
          list.push({ ...base, x: -50, z: -50 });  // in the water
        }) as GenerateCityDeps['fillPlot'],
      }
    );
    // Every plot emits one wet piece, so every plot rolls back — including the
    // dry piece that would otherwise have survived on its own.
    const atDry = result.buildings.filter((b) => b.x === 50 && b.z === 50);
    const atWet = result.buildings.filter((b) => b.x === -50 && b.z === -50);
    expect(atWet).toEqual([]);
    expect(atDry).toEqual([]);
  });

  it('keeps no road running through water', () => {
    const waterBodies = [rectRow(-40, -200, 40, 200)];
    const result = generateCity(
      AREA, baseOpts, { locations: [], roads: [], waterBodies }, mulberry32(12),
      { fillPlot: vi.fn() }
    );
    const polys = parseWaterBodies(waterBodies);
    result.roads.forEach((r) => {
      expect(submergedSpans(polys, r)).toEqual([]);
    });
  });

  it('emits bridges over a channel and none when density is off', () => {
    const waterBodies = [rectRow(-15, -200, 15, 200)];
    const ctx = { locations: [], roads: [], waterBodies };
    const withBridges = generateCity(
      AREA, { ...baseOpts, overpassDensity: 'heavy' }, ctx, mulberry32(2), { fillPlot: vi.fn() }
    );
    const without = generateCity(
      AREA, { ...baseOpts, overpassDensity: 'off' }, ctx, mulberry32(2), { fillPlot: vi.fn() }
    );
    expect(withBridges.overpasses.length).toBeGreaterThan(0);
    expect(without.overpasses).toEqual([]);
  });

  it('shapes every bridge for the overpass API', () => {
    const waterBodies = [rectRow(-15, -200, 15, 200)];
    const result = generateCity(
      AREA, { ...baseOpts, overpassDensity: 'heavy' },
      { locations: [], roads: [], waterBodies }, mulberry32(2), { fillPlot: vi.fn() }
    );
    result.overpasses.forEach((o) => {
      // Two points for a straight crossing, more when the street bends.
      expect(o.points.length).toBeGreaterThanOrEqual(2);
      expect(o.height).toBeGreaterThan(0);
      expect(o.width).toBeGreaterThan(0);
      expect(o.ramp_length).toBeGreaterThan(0);
      expect(o.pillar_spacing).toBeGreaterThan(0);
    });
  });

  it('never leaves two crossing decks at the same level', () => {
    // An irregular lake big enough to produce a dozen bridges, several of
    // which cross — decks at a shared level would intersect each other.
    const lake = [{
      points_json: JSON.stringify([
        { x: -380, z: 40 }, { x: -200, z: -40 }, { x: 40, z: -60 },
        { x: 180, z: -140 }, { x: 260, z: -60 }, { x: 200, z: 60 },
        { x: 320, z: 120 }, { x: 300, z: 260 }, { x: 60, z: 300 },
        { x: -180, z: 260 }, { x: -380, z: 200 },
      ]),
    }];
    const result = generateCity(
      { min: { x: -400, z: -400 }, max: { x: 400, z: 400 } },
      { ...baseOpts, sectionType: 'MIXED' as SectionType, overpassDensity: 'heavy' },
      { locations: [], roads: [], waterBodies: lake },
      mulberry32(7),
      { fillPlot: vi.fn() }
    );

    let crossings = 0;
    const decks = result.overpasses;
    for (let i = 0; i < decks.length; i++) {
      for (let j = i + 1; j < decks.length; j++) {
        const a = decks[i], b = decks[j];
        if (!segmentsIntersect(
          a.points[0], a.points[a.points.length - 1],
          b.points[0], b.points[b.points.length - 1]
        )) continue;
        crossings++;
        expect(a.height).not.toBe(b.height);
      }
    }
    // Guard against the assertion above passing vacuously.
    expect(crossings).toBeGreaterThan(0);
  });

  it('spreads decks across more than one level', () => {
    const lake = [rectRow(-15, -200, 15, 200)];
    const result = generateCity(
      AREA, { ...baseOpts, overpassDensity: 'heavy' },
      { locations: [], roads: [], waterBodies: lake }, mulberry32(2), { fillPlot: vi.fn() }
    );
    const levels = new Set(result.overpasses.map((o) => o.height));
    expect(result.overpasses.length).toBeGreaterThan(2);
    expect(levels.size).toBeGreaterThan(1);
  });

  it('generates no bridges when roads are excluded', () => {
    const waterBodies = [rectRow(-15, -200, 15, 200)];
    const result = generateCity(
      AREA, { ...baseOpts, excludeRoads: true, overpassDensity: 'heavy' },
      { locations: [], roads: [], waterBodies }, mulberry32(2), { fillPlot: vi.fn() }
    );
    expect(result.overpasses).toEqual([]);
    expect(result.roads).toEqual([]);
  });
});
