import { describe, it, expect } from 'vitest';
import { generateWater, pointInWater, generateCity } from '../index';

/**
 * Generated water.
 *
 * The machinery to *consume* water already existed and was tested — this only has to
 * produce a polygon. What matters is that it lands before the split, so the road grid
 * stops at the banks and bridges get sited.
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

describe('generateWater', () => {
  it('produces nothing by default', () => {
    // Generation has never made water; defaulting otherwise would put a river through
    // the city of everyone already using the button.
    expect(generateWater('NONE', bounds(300), seededRng())).toHaveLength(0);
  });

  it.each(['RIVER', 'COAST', 'LAKE'] as const)('produces a closed polygon for %s', (type) => {
    const [poly] = generateWater(type, bounds(300), seededRng());
    expect(poly).toBeDefined();
    expect(poly.points.length).toBeGreaterThanOrEqual(3);
    for (const p of poly.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });

  it.each(['RIVER', 'COAST', 'LAKE'] as const)('encloses actual area for %s', (type) => {
    // A polygon with no interior would be invisible and would block nothing.
    const [poly] = generateWater(type, bounds(300), seededRng());
    const area = Math.abs(poly.points.reduce((sum, p, i) => {
      const q = poly.points[(i + 1) % poly.points.length];
      return sum + (p.x * q.z - q.x * p.z);
    }, 0) / 2);
    expect(area).toBeGreaterThan(100);
  });

  it.each(['RIVER', 'COAST', 'LAKE'] as const)('reproduces from a seed for %s', (type) => {
    expect(generateWater(type, bounds(300), seededRng(7)))
      .toEqual(generateWater(type, bounds(300), seededRng(7)));
  });

  it('gives a different river for a different seed', () => {
    expect(generateWater('RIVER', bounds(300), seededRng(1)))
      .not.toEqual(generateWater('RIVER', bounds(300), seededRng(2)));
  });

  it('runs a river the full way across, dividing the city', () => {
    // A river that stops short would be a lake with ambitions.
    const [poly] = generateWater('RIVER', bounds(300), seededRng());
    const xs = poly.points.map(p => p.x);
    const zs = poly.points.map(p => p.z);
    const spansX = Math.max(...xs) - Math.min(...xs);
    const spansZ = Math.max(...zs) - Math.min(...zs);
    expect(Math.max(spansX, spansZ)).toBeGreaterThan(500);
  });

  it('leaves a coastline with dry land on one side', () => {
    const [poly] = generateWater('COAST', bounds(300), seededRng());
    const dry = [
      { x: 0, z: 0 }, { x: 200, z: 0 }, { x: -200, z: 0 },
      { x: 0, z: 200 }, { x: 0, z: -200 },
    ].filter(p => !pointInWater([poly], p.x, p.z));
    expect(dry.length).toBeGreaterThan(0);
  });

  it('keeps a lake inside the region', () => {
    const [poly] = generateWater('LAKE', bounds(300), seededRng());
    for (const p of poly.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(300);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(300);
    }
  });
});

describe('generateCity with generated water', () => {
  it('generates none unless asked', () => {
    const result = generateCity(bounds(300), { sectionType: 'MIXED' }, freshContext(), seededRng(), deps);
    expect(result.waterBodies).toHaveLength(0);
  });

  it('returns the water it made, for the caller to persist', () => {
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', water: 'RIVER' }, freshContext(), seededRng(), deps,
    );
    expect(result.waterBodies).toHaveLength(1);
  });

  it('keeps buildings out of the water it generated', () => {
    // Blocks are laid across water as they always have been for hand-drawn water —
    // it is the placement check that keeps buildings out, and generated water has to
    // reach that check the same way.
    const built: { x: number; z: number }[] = [];
    const result = generateCity(
      bounds(300),
      { sectionType: 'MIXED', water: 'RIVER' },
      freshContext(),
      seededRng(),
      {
        fillPlot: (x: number, z: number, bw: number, bd: number, _zone: number,
                   isBlocked: (x: number, z: number, w: number, d: number) => boolean) => {
          if (!isBlocked(x, z, bw, bd)) built.push({ x, z });
        },
      } as never,
    );

    const river = result.waterBodies[0];
    expect(built.length).toBeGreaterThan(0);
    for (const b of built) expect(pointInWater([river], b.x, b.z)).toBe(false);
  });

  it('keeps roads out of the water it generated', () => {
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', water: 'RIVER' }, freshContext(), seededRng(), deps,
    );
    const river = result.waterBodies[0];
    for (const r of result.roads) {
      const mid = { x: (r.x1 + r.x2) / 2, z: (r.z1 + r.z2) / 2 };
      expect(pointInWater([river], mid.x, mid.z)).toBe(false);
    }
  });

  it('builds a smaller city when water takes some of the ground', () => {
    const dry = generateCity(bounds(300), { sectionType: 'MIXED' }, freshContext(), seededRng(), deps);
    const wet = generateCity(
      bounds(300), { sectionType: 'MIXED', water: 'RIVER' }, freshContext(), seededRng(), deps,
    );
    expect(wet.blocks.length).toBeLessThan(dry.blocks.length);
  });

  it('adds generated water to any the GM already drew', () => {
    const context = {
      locations: [], roads: [],
      waterBodies: [{ points_json: JSON.stringify([
        { x: 250, z: 250 }, { x: 290, z: 250 }, { x: 290, z: 290 },
      ]) }],
    };
    const result = generateCity(
      bounds(300), { sectionType: 'MIXED', water: 'RIVER' }, context, seededRng(), deps,
    );
    // Only the generated river comes back — the GM's lake is already persisted.
    expect(result.waterBodies).toHaveLength(1);
  });
});
