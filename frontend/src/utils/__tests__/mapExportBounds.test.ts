import { describe, it, expect } from 'vitest';
import {
  computeCityBounds,
  boundsCenter,
  boundsWidth,
  boundsDepth,
  isTokenShape,
  resolveExportSize,
  PNG_EXPORT_WIDTHS,
  DEFAULT_PNG_EXPORT_WIDTH,
  BOUNDS_PAD,
  BOUNDS_FALLBACK,
  type BoundsLocation,
} from '../mapExportBounds';

const building = (over: Partial<BoundsLocation> = {}): BoundsLocation => ({
  x: 0, y: 0, z: 0,
  width: 10, height: 10, depth: 10,
  shape: 'box',
  ...over,
});

describe('computeCityBounds', () => {
  describe('buildings', () => {
    it('frames a single building with padding', () => {
      // Circumradius of a 10x10x10 box is sqrt(300)/2 ~= 8.66, not 5.
      const b = computeCityBounds([building()]);
      const r = Math.hypot(10, 10, 10) / 2;
      expect(b.minX).toBeCloseTo(-r - BOUNDS_PAD);
      expect(b.maxX).toBeCloseTo(r + BOUNDS_PAD);
      expect(b.minZ).toBeCloseTo(-r - BOUNDS_PAD);
      expect(b.maxZ).toBeCloseTo(r + BOUNDS_PAD);
    });

    it('covers a rotated building beyond its axis-aligned width and depth', () => {
      // A 40x2 footprint rotated 45deg sweeps well past +/-20 on both axes; the
      // circumradius must cover the diagonal rather than the declared half-width.
      const b = computeCityBounds([
        building({ width: 40, depth: 2, height: 2 }),
      ]);
      expect(b.maxX - BOUNDS_PAD).toBeGreaterThan(20);
      expect(b.maxZ - BOUNDS_PAD).toBeGreaterThan(20);
    });

    it('expands to contain every building', () => {
      const b = computeCityBounds([
        building({ x: -100, z: -100, width: 2, height: 2, depth: 2 }),
        building({ x: 100, z: 100, width: 2, height: 2, depth: 2 }),
      ]);
      expect(b.minX).toBeLessThan(-100);
      expect(b.maxX).toBeGreaterThan(100);
      expect(b.minZ).toBeLessThan(-100);
      expect(b.maxZ).toBeGreaterThan(100);
    });

    it('treats y as the bottom of the mesh when computing maxY', () => {
      const b = computeCityBounds([building({ y: 30, height: 12 })]);
      expect(b.maxY).toBe(42);
    });

    it('reports the tallest structure in maxY', () => {
      const b = computeCityBounds([
        building({ y: 0, height: 5 }),
        building({ y: 0, height: 80 }),
        building({ y: 0, height: 20 }),
      ]);
      expect(b.maxY).toBe(80);
    });
  });

  describe('roads', () => {
    it('includes road width, not just the centreline', () => {
      const b = computeCityBounds([], [{ x1: 0, z1: 0, x2: 50, z2: 0, width: 8 }]);
      // The ribbon reaches z = +/-4 either side of a centreline sitting at z = 0.
      expect(b.maxZ).toBeCloseTo(4 + BOUNDS_PAD);
      expect(b.minZ).toBeCloseTo(-4 - BOUNDS_PAD);
      expect(b.maxX).toBeCloseTo(54 + BOUNDS_PAD);
    });

    it('frames a city that is roads only', () => {
      const b = computeCityBounds([], [{ x1: -30, z1: -30, x2: 30, z2: 30, width: 2 }]);
      expect(b.minX).toBeLessThan(-30);
      expect(b.maxX).toBeGreaterThan(30);
    });
  });

  describe('water bodies', () => {
    it('includes water parsed from points_json', () => {
      const b = computeCityBounds([], [], [
        { points_json: JSON.stringify([{ x: 200, z: 200 }, { x: 260, z: 240 }]) },
      ]);
      expect(b.maxX).toBeCloseTo(260 + BOUNDS_PAD);
      expect(b.maxZ).toBeCloseTo(240 + BOUNDS_PAD);
    });

    it('accepts an already-parsed points array', () => {
      const b = computeCityBounds([], [], [{ points: [{ x: 90, z: 90 }] }]);
      expect(b.maxX).toBeCloseTo(90 + BOUNDS_PAD);
    });

    it('survives malformed points_json', () => {
      const b = computeCityBounds([building()], [], [{ points_json: 'not json' }]);
      expect(Number.isFinite(b.minX)).toBe(true);
      expect(Number.isFinite(b.maxX)).toBe(true);
    });
  });

  describe('overpasses', () => {
    it('includes overpass points and deck width', () => {
      const b = computeCityBounds([], [], [], [
        { points: [{ x: 0, z: 0 }, { x: 300, z: 0 }], width: 10, height: 25 },
      ]);
      expect(b.maxX).toBeCloseTo(305 + BOUNDS_PAD);
      expect(b.maxY).toBe(25);
    });

    it('parses overpass points supplied as a JSON string', () => {
      const b = computeCityBounds([], [], [], [
        { points: JSON.stringify([{ x: 400, z: 0 }]), width: 0, height: 0 },
      ]);
      expect(b.maxX).toBeCloseTo(400 + BOUNDS_PAD);
    });
  });

  describe('tokens', () => {
    it.each(['rhombus', 'enemy_rhombus', 'friendly_rhombus'])(
      'never lets a %s affect framing',
      (shape) => {
        const withToken = computeCityBounds([
          building({ x: 0, z: 0 }),
          building({ x: 5000, z: 5000, shape }),
        ]);
        const withoutToken = computeCityBounds([building({ x: 0, z: 0 })]);
        expect(withToken).toEqual(withoutToken);
      },
    );

    it('identifies token shapes', () => {
      expect(isTokenShape('rhombus')).toBe(true);
      expect(isTokenShape('enemy_rhombus')).toBe(true);
      expect(isTokenShape('friendly_rhombus')).toBe(true);
      expect(isTokenShape('box')).toBe(false);
      expect(isTokenShape('cylinder')).toBe(false);
    });

    it('falls back when the city holds nothing but tokens', () => {
      const b = computeCityBounds([building({ x: 900, shape: 'rhombus' })]);
      expect(b.minX).toBe(-BOUNDS_FALLBACK);
      expect(b.maxX).toBe(BOUNDS_FALLBACK);
    });
  });

  describe('hidden structures', () => {
    it('does not inflate the frame when hidden buildings are filtered out first', () => {
      const all = [building({ x: 0 }), building({ x: 4000, is_hidden: 1 })];
      const shown = computeCityBounds(all.filter((l) => !l.is_hidden));
      expect(shown.maxX).toBeLessThan(100);
    });

    it('includes hidden buildings when the caller passes them through', () => {
      const all = [building({ x: 0 }), building({ x: 4000, is_hidden: 1 })];
      expect(computeCityBounds(all).maxX).toBeGreaterThan(4000);
    });
  });

  describe('empty city', () => {
    it('falls back to a fixed frame', () => {
      const b = computeCityBounds([], [], [], []);
      expect(b).toEqual({
        minX: -BOUNDS_FALLBACK,
        maxX: BOUNDS_FALLBACK,
        minZ: -BOUNDS_FALLBACK,
        maxZ: BOUNDS_FALLBACK,
        maxY: 50,
      });
    });

    it('defaults every optional collection', () => {
      expect(() => computeCityBounds([building()])).not.toThrow();
    });
  });
});

describe('bounds helpers', () => {
  it('centres on the city, not the origin', () => {
    const b = computeCityBounds([
      building({ x: 1000, z: 500, width: 2, height: 2, depth: 2 }),
      building({ x: 1100, z: 700, width: 2, height: 2, depth: 2 }),
    ]);
    const c = boundsCenter(b);
    expect(c.x).toBeGreaterThan(1000);
    expect(c.x).toBeLessThan(1100);
    expect(c.z).toBeGreaterThan(500);
    expect(c.z).toBeLessThan(700);
  });

  it('reports width and depth spans', () => {
    const b = computeCityBounds([building({ width: 2, height: 2, depth: 2 })]);
    expect(boundsWidth(b)).toBeCloseTo(b.maxX - b.minX);
    expect(boundsDepth(b)).toBeCloseTo(b.maxZ - b.minZ);
    expect(boundsWidth(b)).toBeGreaterThan(0);
  });

  it('keeps an off-centre city inside the frame', () => {
    const b = computeCityBounds([building({ x: 800, z: -600 })]);
    const c = boundsCenter(b);
    expect(c.x).toBeCloseTo(800);
    expect(c.z).toBeCloseTo(-600);
  });
});

describe('resolveExportSize', () => {
  const GPU = 16384; // typical desktop limit; well clear of the sizes below

  it('uses the requested width when the GPU allows it', () => {
    const { width, clamped } = resolveExportSize(1000, 500, 2048, GPU);
    expect(width).toBe(2048);
    expect(clamped).toBe(false);
  });

  it('derives height from the city aspect ratio', () => {
    // Twice as wide as deep, so the image is half as tall as it is wide.
    expect(resolveExportSize(1000, 500, 2048, GPU).height).toBe(1024);
    expect(resolveExportSize(500, 1000, 2048, GPU).height).toBe(4096);
  });

  it('scales with the chosen width', () => {
    const small = resolveExportSize(1000, 600, 1024, GPU);
    const large = resolveExportSize(1000, 600, 4096, GPU);
    expect(large.width / small.width).toBe(4);
    // Height rounds to whole pixels, so the ratio lands near 4 rather than exactly on
    // it (2458/614, not 2456/614).
    expect(large.height / small.height).toBeGreaterThan(3.99);
    expect(large.height / small.height).toBeLessThan(4.01);
  });

  it('clamps when the requested width exceeds the GPU limit', () => {
    const { width, height, clamped } = resolveExportSize(1000, 1000, 8192, 4096);
    expect(clamped).toBe(true);
    expect(width).toBeLessThanOrEqual(4096);
    expect(height).toBeLessThanOrEqual(4096);
  });

  it('clamps on height even when the width alone would fit', () => {
    // A tall narrow city: 4096 wide implies 16384 tall, which breaches an 8192 limit
    // on an axis the user never chose.
    const { width, height, clamped } = resolveExportSize(500, 2000, 4096, 8192);
    expect(clamped).toBe(true);
    expect(height).toBeLessThanOrEqual(8192);
    expect(width).toBeLessThan(4096);
  });

  it('preserves aspect ratio when clamping', () => {
    const worldW = 500, worldD = 2000;
    const { width, height } = resolveExportSize(worldW, worldD, 4096, 8192);
    expect(height / width).toBeCloseTo(worldD / worldW, 1);
  });

  it.each(PNG_EXPORT_WIDTHS)('never exceeds the GPU limit at %ipx', (requested) => {
    for (const [w, d] of [[1000, 100], [100, 1000], [800, 800], [3000, 40]]) {
      const { width, height } = resolveExportSize(w, d, requested, 8192);
      expect(width).toBeLessThanOrEqual(8192);
      expect(height).toBeLessThanOrEqual(8192);
    }
  });

  it('always returns at least one pixel on each axis', () => {
    for (const size of [
      resolveExportSize(0, 0, 2048, GPU),
      resolveExportSize(10000, 1, 1024, 16),
      resolveExportSize(1, 10000, 1024, 16),
      resolveExportSize(-5, -5, 2048, GPU),
    ]) {
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(size.width)).toBe(true);
      expect(Number.isInteger(size.height)).toBe(true);
    }
  });

  it('offers the default among the selectable widths', () => {
    expect(PNG_EXPORT_WIDTHS).toContain(DEFAULT_PNG_EXPORT_WIDTH);
  });
});
