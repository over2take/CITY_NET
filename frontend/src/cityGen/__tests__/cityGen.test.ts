import { describe, it, expect, vi } from 'vitest';
import {
  generateCity,
  splitCity,
  normalizeBounds,
  maxSplitDepthFor,
  SpatialGrid,
  createIsBlocked,
  createSectorLayout,
  normalizedDistance,
  parkProbability,
  assignZoneType,
  zonePrefixFor,
  clampPlotAspect,
  shouldPlaceLandmark,
  generateLandmark,
  generatePark,
  ZONE,
  type Bounds,
  type GenerateCityDeps,
  type RawBuilding,
  type SectionType,
} from '../index';

/** Deterministic PRNG so generation is reproducible across runs. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rng that replays a fixed list, then holds the last value. */
const scripted = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

const bounds = (minX: number, minZ: number, maxX: number, maxZ: number): Bounds => ({
  min: { x: minX, z: minZ },
  max: { x: maxX, z: maxZ },
});

const AREA = bounds(-200, -200, 200, 200);

describe('normalizeBounds', () => {
  it('orders corners regardless of drag direction', () => {
    const forward = normalizeBounds(bounds(-100, -50, 100, 50));
    const reversed = normalizeBounds(bounds(100, 50, -100, -50));
    expect(reversed).toEqual(forward);
  });

  it('derives size and centre', () => {
    const b = normalizeBounds(bounds(0, 0, 100, 60));
    expect(b.width).toBe(100);
    expect(b.depth).toBe(60);
    expect(b.centerX).toBe(50);
    expect(b.centerZ).toBe(30);
  });
});

describe('maxSplitDepthFor', () => {
  it('never drops below the floor of 4', () => {
    expect(maxSplitDepthFor(10, 10)).toBe(4);
  });

  it('increases with area so bigger selections yield more blocks', () => {
    expect(maxSplitDepthFor(2000, 2000)).toBeGreaterThan(maxSplitDepthFor(200, 200));
  });
});

describe('splitCity', () => {
  it('produces blocks and roads for a large area', () => {
    const { blocks, roads } = splitCity(AREA, false, mulberry32(1));
    expect(blocks.length).toBeGreaterThan(1);
    expect(roads.length).toBeGreaterThan(0);
  });

  it('emits no roads when excludeRoads is set', () => {
    const { blocks, roads } = splitCity(AREA, true, mulberry32(1));
    expect(roads).toEqual([]);
    expect(blocks.length).toBeGreaterThan(1);
  });

  it('is deterministic for a fixed seed', () => {
    const a = splitCity(AREA, false, mulberry32(42));
    const b = splitCity(AREA, false, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('keeps every block inside the selection', () => {
    const { blocks } = splitCity(bounds(0, 0, 400, 400), true, mulberry32(7));
    blocks.forEach((b) => {
      expect(b.x).toBeGreaterThan(-50);
      expect(b.x).toBeLessThan(450);
      expect(b.z).toBeGreaterThan(-50);
      expect(b.z).toBeLessThan(450);
    });
  });

  it('a larger area yields more blocks than a small one', () => {
    const small = splitCity(bounds(0, 0, 100, 100), true, mulberry32(3));
    const large = splitCity(bounds(0, 0, 1000, 1000), true, mulberry32(3));
    expect(large.blocks.length).toBeGreaterThan(small.blocks.length);
  });
});

describe('SpatialGrid', () => {
  it('buckets obstacles and finds them via neighbour keys', () => {
    const grid = new SpatialGrid([{ x: 5, z: 5, width: 4, depth: 4 }]);
    const keys = grid.neighborKeys(5, 5);
    const found = keys.some((k) => (grid.cells[k] || []).length > 0);
    expect(found).toBe(true);
  });

  it('returns the centre cell plus eight neighbours', () => {
    const grid = new SpatialGrid();
    expect(grid.neighborKeys(0, 0)).toHaveLength(9);
  });

  it('accepts obstacles added after construction', () => {
    const grid = new SpatialGrid();
    grid.add({ x: 0, z: 0, width: 2, depth: 2 });
    expect(grid.cells[grid.key(0, 0)]).toHaveLength(1);
  });
});

describe('createIsBlocked', () => {
  it('reports a collision with an overlapping obstacle', () => {
    const grid = new SpatialGrid([{ x: 0, z: 0, width: 10, depth: 10 }]);
    const isBlocked = createIsBlocked(grid, [], false);
    expect(isBlocked(0, 0, 10, 10)).toBe(true);
  });

  it('allows placement well clear of everything', () => {
    const grid = new SpatialGrid([{ x: 0, z: 0, width: 10, depth: 10 }]);
    const isBlocked = createIsBlocked(grid, [], false);
    expect(isBlocked(500, 500, 4, 4)).toBe(false);
  });

  it('treats the buffer as extra clearance', () => {
    const grid = new SpatialGrid([{ x: 0, z: 0, width: 10, depth: 10 }]);
    const isBlocked = createIsBlocked(grid, [], false);
    // 12 units apart: clear with a small buffer, blocked with a large one.
    expect(isBlocked(12, 0, 2, 2, 0.5)).toBe(false);
    expect(isBlocked(12, 0, 2, 2, 8)).toBe(true);
  });

  it('blocks footprints sitting on a road', () => {
    const grid = new SpatialGrid();
    const road = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    const isBlocked = createIsBlocked(grid, [road], true);
    expect(isBlocked(0, 0, 4, 4)).toBe(true);
  });

  it('skips road checks entirely when roads are excluded', () => {
    const grid = new SpatialGrid();
    const road = { x1: -100, z1: 0, x2: 100, z2: 0, width: 6 };
    const isBlocked = createIsBlocked(grid, [road], false);
    expect(isBlocked(0, 0, 4, 4)).toBe(false);
  });
});

describe('zoning', () => {
  it('createSectorLayout offsets industrial from slums by 117-180 degrees', () => {
    const { slumAngle, industrialAngle } = createSectorLayout(mulberry32(9));
    const offset = industrialAngle - slumAngle;
    expect(offset).toBeGreaterThanOrEqual(Math.PI * 0.65);
    expect(offset).toBeLessThanOrEqual(Math.PI);
  });

  it('normalizedDistance clamps at 1 outside the radius', () => {
    expect(normalizedDistance(0, 0, 0, 0, 100)).toBe(0);
    expect(normalizedDistance(50, 0, 0, 0, 100)).toBeCloseTo(0.5);
    expect(normalizedDistance(9999, 0, 0, 0, 100)).toBe(1);
  });

  it('parkProbability peaks at the core and hits zero past the slum line', () => {
    expect(parkProbability(0)).toBeCloseTo(0.20);
    expect(parkProbability(0.9)).toBe(0);
    expect(parkProbability(0.4)).toBeLessThan(parkProbability(0.1));
  });

  it.each([
    ['CORPO', ZONE.CORPO],
    ['URBAN', ZONE.URBAN],
    ['SLUMS', ZONE.SLUMS],
    ['INDUSTRIAL', ZONE.INDUSTRIAL],
  ] as [SectionType, number][])('preset %s always returns its zone', (type, expected) => {
    const sectors = { slumAngle: 0, industrialAngle: Math.PI };
    const value = assignZoneType(10, 10, 0, 0, 0.5, type, sectors, mulberry32(1));
    expect(value).toBe(expected);
  });

  it('presets still consume exactly one rng draw', () => {
    const rng = vi.fn(() => 0.5);
    const sectors = { slumAngle: 0, industrialAngle: Math.PI };
    assignZoneType(10, 10, 0, 0, 0.5, 'CORPO', sectors, rng);
    expect(rng).toHaveBeenCalledTimes(1);
  });

  it('MIXED core is corporate on a low roll', () => {
    const sectors = { slumAngle: 0, industrialAngle: Math.PI };
    // second draw (0.1) is under the 0.88 corpo chance
    const value = assignZoneType(1, 1, 0, 0, 0.1, 'MIXED', sectors, scripted(0.5, 0.1));
    expect(value).toBe(ZONE.CORPO);
  });

  it('MIXED core falls back to urban on a high roll', () => {
    const sectors = { slumAngle: 0, industrialAngle: Math.PI };
    const value = assignZoneType(1, 1, 0, 0, 0.1, 'MIXED', sectors, scripted(0.5, 0.99));
    expect(value).toBe(ZONE.URBAN);
  });

  it.each([
    [-0.1, 'INDUSTRIAL'],
    [0.1, 'SLUMS'],
    [0.5, 'URBAN'],
    [0.9, 'CORPO'],
  ])('zonePrefixFor(%s) is %s', (value, expected) => {
    expect(zonePrefixFor(value)).toBe(expected);
  });

  it('clampPlotAspect trims long plots outside slums', () => {
    const { bw, bd } = clampPlotAspect(100, 10, ZONE.CORPO);
    expect(bw / bd).toBeCloseTo(1.3);
  });

  it('clampPlotAspect leaves slums sprawling', () => {
    const result = clampPlotAspect(100, 10, ZONE.SLUMS);
    expect(result).toEqual({ bw: 100, bd: 10 });
  });
});

describe('landmarks', () => {
  const block = { x: 0, z: 0, w: 60, d: 60 };
  const clear = () => false;

  it('rejects a plot when the chance roll fails', () => {
    expect(shouldPlaceLandmark(block, 40, 40, ZONE.CORPO, clear, () => 0.9)).toBe(false);
  });

  it('rejects low-value zones even on a good roll', () => {
    expect(shouldPlaceLandmark(block, 40, 40, ZONE.SLUMS, clear, () => 0.01)).toBe(false);
  });

  it('accepts a large corporate plot on a good roll', () => {
    expect(shouldPlaceLandmark(block, 40, 40, ZONE.CORPO, clear, () => 0.01)).toBe(true);
  });

  it('rejects a plot whose footprint is obstructed', () => {
    const blocked = () => true;
    expect(shouldPlaceLandmark(block, 40, 40, ZONE.CORPO, blocked, () => 0.01)).toBe(false);
  });

  it('always consumes its rng draw, even when the zone disqualifies', () => {
    const rng = vi.fn(() => 0.9);
    shouldPlaceLandmark(block, 40, 40, ZONE.SLUMS, clear, rng);
    expect(rng).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2, 3])('style %i emits exactly one unparented root', (style) => {
    const out: RawBuilding[] = [];
    const grid = new SpatialGrid();
    // First draw picks the style; the rest feed that style's dimensions.
    generateLandmark(block, 40, 40, out, grid, scripted(style / 4, 0.5));
    const roots = out.filter((b) => !b.parent_name);
    expect(roots).toHaveLength(1);
    expect(out.length).toBeGreaterThan(1);
  });

  it('registers its root in the grid so later plots avoid it', () => {
    const out: RawBuilding[] = [];
    const grid = new SpatialGrid();
    generateLandmark(block, 40, 40, out, grid, scripted(0, 0.5));
    const occupied = Object.values(grid.cells).flat();
    expect(occupied.length).toBeGreaterThan(0);
  });

  it('parents every non-root piece to CORP_ROOT', () => {
    const out: RawBuilding[] = [];
    generateLandmark(block, 40, 40, out, new SpatialGrid(), scripted(0, 0.5));
    const children = out.filter((b) => b.parent_name);
    expect(children.length).toBeGreaterThan(0);
    children.forEach((c) => expect(c.parent_name).toBe('CORP_ROOT'));
  });
});

describe('generatePark', () => {
  const block = { x: 0, z: 0, w: 60, d: 60 };

  it('emits trunk/canopy pairs on clear ground', () => {
    const out: RawBuilding[] = [];
    generatePark(block, 50, 50, out, () => false, mulberry32(5));
    expect(out.length).toBeGreaterThan(0);
    expect(out.length % 2).toBe(0); // every trunk has a canopy
    expect(out.filter((b) => b.shape === 'cylinder').length).toBe(out.length / 2);
  });

  it('places nothing when the whole plot is obstructed', () => {
    const out: RawBuilding[] = [];
    generatePark(block, 50, 50, out, () => true, mulberry32(5));
    expect(out).toEqual([]);
  });
});

describe('generateCity', () => {
  const opts = (over: Partial<{ sectionType: SectionType; excludeRoads: boolean }> = {}) => ({
    sectionType: 'MIXED' as SectionType,
    excludeRoads: false,
    ...over,
  });
  const ctx = () => ({ locations: [], roads: [] });
  const noopFill = { fillPlot: vi.fn() };

  it('returns blocks, roads and buildings', () => {
    const result = generateCity(AREA, opts(), ctx(), mulberry32(11));
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.roads.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const a = generateCity(AREA, opts(), ctx(), mulberry32(99), { fillPlot: vi.fn() });
    const b = generateCity(AREA, opts(), ctx(), mulberry32(99), { fillPlot: vi.fn() });
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = generateCity(AREA, opts(), ctx(), mulberry32(1), { fillPlot: vi.fn() });
    const b = generateCity(AREA, opts(), ctx(), mulberry32(2), { fillPlot: vi.fn() });
    expect(a.blocks).not.toEqual(b.blocks);
  });

  it('emits no roads when excludeRoads is set', () => {
    const result = generateCity(AREA, opts({ excludeRoads: true }), ctx(), mulberry32(11), noopFill);
    expect(result.roads).toEqual([]);
  });

  it('delegates ordinary plots to fillPlot', () => {
    const fillPlot = vi.fn();
    generateCity(AREA, opts({ sectionType: 'URBAN' }), ctx(), mulberry32(4), { fillPlot });
    expect(fillPlot).toHaveBeenCalled();
  });

  it('tags every generated building with a plot id and a name', () => {
    const fillPlot: GenerateCityDeps['fillPlot'] = (
      _x, _z, _w, _d, _zone, _blocked, _key, _grid, out
    ) => {
      (out as RawBuilding[]).push({
        name: '', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 1, color: '', shape: 'box',
      });
    };
    const result = generateCity(AREA, opts({ sectionType: 'CORPO' }), ctx(), mulberry32(21), { fillPlot });
    expect(result.buildings.length).toBeGreaterThan(0);
    result.buildings.forEach((b) => {
      expect(b.temp_block_id).toMatch(/^gen_\d+$/);
      expect(b.name).not.toBe('');
    });
  });

  it('skips plots too small to build on', () => {
    const fillPlot = vi.fn();
    // A tiny selection splits into blocks under the padding threshold.
    generateCity(bounds(0, 0, 12, 12), opts(), ctx(), mulberry32(1), { fillPlot });
    expect(fillPlot).not.toHaveBeenCalled();
  });

  it('places no landmarks or parks on fully built-up ground', () => {
    const fillPlot = vi.fn(); // stub emits nothing, so buildings == landmarks + parks
    // Tile the whole selection with obstacles. The collision grid only inspects
    // a 3x3 cell neighbourhood, so a single huge obstacle would NOT block
    // distant plots — occupancy has to be spread across the cells to register.
    const locations = [];
    for (let x = -220; x <= 220; x += 15) {
      for (let z = -220; z <= 220; z += 15) {
        locations.push({ x, z, width: 30, depth: 30 });
      }
    }
    const result = generateCity(
      AREA,
      opts({ sectionType: 'CORPO' }),
      { locations, roads: [] },
      mulberry32(6),
      { fillPlot }
    );
    expect(result.buildings).toEqual([]);
    // Plots are still visited and handed to the themed generator.
    expect(fillPlot).toHaveBeenCalled();
  });
});
