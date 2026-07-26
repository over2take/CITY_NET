import { describe, it, expect, vi } from 'vitest';
import {
  parseWaterBodies,
  pointInPolygon,
  pointInWater,
  footprintInWater,
  submergedSpans,
  segmentLength,
  applyWaterToRoads,
  createIsBlocked,
  SpatialGrid,
  generateCity,
  MAX_BRIDGE_SPAN,
  BRIDGE_RAMP_LENGTH,
  type WaterPolygon,
  type OverpassDensity,
  type SectionType,
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

describe('applyWaterToRoads', () => {
  const channel = [rect(-10, -1000, 10, 1000)]; // 20 wide
  const crossing = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };

  it('passes roads through untouched when there is no water', () => {
    const result = applyWaterToRoads([crossing], [], 'normal', mulberry32(1));
    expect(result.roads).toEqual([crossing]);
    expect(result.overpasses).toEqual([]);
  });

  it('draws no randomness when there is no water', () => {
    const rng = vi.fn(() => 0.5);
    applyWaterToRoads([crossing], [], 'normal', rng);
    expect(rng).not.toHaveBeenCalled();
  });

  it('splits a crossing road into two dry approaches', () => {
    const { roads } = applyWaterToRoads([crossing], channel, 'off', mulberry32(1));
    expect(roads).toHaveLength(2);
    // Approaches stop at the shoreline.
    expect(roads[0].x2).toBeCloseTo(-10, 5);
    expect(roads[1].x1).toBeCloseTo(10, 5);
  });

  it('drops a road entirely submerged', () => {
    const submerged = { x1: -5, z1: 0, x2: 5, z2: 0, width: 6 };
    const { roads } = applyWaterToRoads([submerged], channel, 'off', mulberry32(1));
    expect(roads).toEqual([]);
  });

  it('bridges a narrow crossing at heavy density', () => {
    const { overpasses } = applyWaterToRoads([crossing], channel, 'heavy', mulberry32(1));
    expect(overpasses).toHaveLength(1);
    expect(overpasses[0].width).toBe(6);
    expect(overpasses[0].ramp_length).toBe(BRIDGE_RAMP_LENGTH);
  });

  it('never bridges at off density', () => {
    const { overpasses } = applyWaterToRoads([crossing], channel, 'off', mulberry32(1));
    expect(overpasses).toEqual([]);
  });

  it('extends the deck onto dry land for the ramps', () => {
    const { overpasses } = applyWaterToRoads([crossing], channel, 'heavy', mulberry32(1));
    const [start, end] = overpasses[0].points;
    // Shores are at x = -10 and x = 10; ramps run back from each.
    expect(start.x).toBeCloseTo(-10 - BRIDGE_RAMP_LENGTH, 5);
    expect(end.x).toBeCloseTo(10 + BRIDGE_RAMP_LENGTH, 5);
  });

  it('refuses to bridge water wider than the span cap', () => {
    const lake = [rect(-500, -1000, 500, 1000)]; // 1000 wide
    const long = { x1: -800, z1: 0, x2: 800, z2: 0, width: 6 };
    const { roads, overpasses } = applyWaterToRoads([long], lake, 'heavy', mulberry32(1));
    expect(overpasses).toEqual([]);
    // The road still stops at each shore.
    expect(roads).toHaveLength(2);
  });

  it('bridges right up to the span cap but not past it', () => {
    const half = MAX_BRIDGE_SPAN / 2;
    const justUnder = [rect(-half + 1, -1000, half - 1, 1000)];
    const justOver = [rect(-half - 1, -1000, half + 1, 1000)];
    const seg = { x1: -400, z1: 0, x2: 400, z2: 0, width: 6 };
    expect(applyWaterToRoads([seg], justUnder, 'heavy', mulberry32(1)).overpasses).toHaveLength(1);
    expect(applyWaterToRoads([seg], justOver, 'heavy', mulberry32(1)).overpasses).toEqual([]);
  });

  it('will not bridge when a ramp would touch down in water', () => {
    // Two channels separated by a spit half the ramp run wide, so each
    // crossing's far touchdown lands in the opposite channel.
    //   channel A: x -30..-10   spit: -10..0   channel B: x 0..30
    //   bridge A: start -50 (dry), end -10+20 = +10 -> inside B  -> rejected
    //   bridge B: start 0-20 = -20 -> inside A                   -> rejected
    const twoChannels = [
      rect(-30, -1000, -10, 1000),
      rect(0, -1000, 30, 1000),
    ];
    const seg = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    const { roads, overpasses } = applyWaterToRoads([seg], twoChannels, 'heavy', mulberry32(1));
    expect(overpasses).toEqual([]);
    // Both crossings are still cut out: two shores plus the spit between them.
    expect(roads).toHaveLength(3);
  });

  it('bridges arterials more readily than side streets', () => {
    // Same seed, same geometry, only the road width differs.
    const arterial = { ...crossing, width: 6 };
    const side = { ...crossing, width: 3 };
    let arterialCount = 0;
    let sideCount = 0;
    for (let seed = 0; seed < 40; seed++) {
      arterialCount += applyWaterToRoads([arterial], channel, 'normal', mulberry32(seed)).overpasses.length;
      sideCount += applyWaterToRoads([side], channel, 'normal', mulberry32(seed)).overpasses.length;
    }
    expect(arterialCount).toBeGreaterThan(sideCount);
  });

  it('produces more bridges at heavier density', () => {
    const roads = Array.from({ length: 30 }, (_, i) => ({
      x1: -100, z1: i * 10, x2: 100, z2: i * 10, width: 6,
    }));
    const count = (d: OverpassDensity) =>
      applyWaterToRoads(roads, channel, d, mulberry32(3)).overpasses.length;
    expect(count('sparse')).toBeLessThan(count('heavy'));
    expect(count('off')).toBe(0);
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

  it('puts no buildings in the water', () => {
    const waterBodies = [rectRow(-200, -200, 0, 200)]; // floods the left half
    const result = generateCity(
      AREA,
      { ...baseOpts, sectionType: 'CORPO' as SectionType },
      { locations: [], roads: [], waterBodies },
      mulberry32(8)
    );
    const polys = parseWaterBodies(waterBodies);
    result.buildings.forEach((b) => {
      expect(pointInWater(polys, b.x as number, b.z as number)).toBe(false);
    });
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
      expect(o.points).toHaveLength(2);
      expect(o.height).toBeGreaterThan(0);
      expect(o.width).toBeGreaterThan(0);
      expect(o.ramp_length).toBeGreaterThan(0);
      expect(o.pillar_spacing).toBeGreaterThan(0);
    });
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
