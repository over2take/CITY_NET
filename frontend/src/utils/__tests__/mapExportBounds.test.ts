import { describe, it, expect } from 'vitest';
import {
  computeCityBounds,
  boundsCenter,
  boundsWidth,
  boundsDepth,
  isTokenShape,
  overheadFlyHeight,
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

describe('overheadFlyHeight', () => {
  const FOV = 50;

  /** What a perspective camera actually covers on the ground at a given height. */
  const visibleExtent = (h: number, fov: number, aspect: number) => {
    const vertical = 2 * h * Math.tan((fov * Math.PI) / 180 / 2);
    return { vertical, horizontal: vertical * aspect };
  };

  /** Fraction of each screen axis the city occupies — 1.0 is a perfect fit. */
  const fill = (w: number, d: number, aspect: number) => {
    const h = overheadFlyHeight(w, d, FOV, aspect, 0);
    const seen = visibleExtent(h, FOV, aspect);
    return { across: w / seen.horizontal, down: d / seen.vertical };
  };

  it('fits a square city in a landscape window', () => {
    const { across, down } = fill(800, 800, 16 / 9);
    expect(across).toBeLessThanOrEqual(1);
    expect(down).toBeLessThanOrEqual(1);
    // The taller axis is the binding one and should be close to filling it.
    expect(Math.max(across, down)).toBeGreaterThan(0.9);
  });

  it('fills the frame for a wide city instead of zooming out to its longest side', () => {
    // Regression: fitting max(width, depth) into both axes left a 800x400 city
    // occupying roughly half the frame vertically.
    const { across, down } = fill(800, 400, 16 / 9);
    expect(Math.max(across, down)).toBeGreaterThan(0.9);
    expect(across).toBeLessThanOrEqual(1);
    expect(down).toBeLessThanOrEqual(1);
  });

  it('fills the frame for a deep city', () => {
    const { across, down } = fill(300, 900, 16 / 9);
    expect(Math.max(across, down)).toBeGreaterThan(0.9);
    expect(across).toBeLessThanOrEqual(1);
    expect(down).toBeLessThanOrEqual(1);
  });

  it('flies lower than the old single-span fit for a non-square city', () => {
    const wideCity = overheadFlyHeight(800, 400, FOV, 16 / 9, 0);
    const asIfSquare = overheadFlyHeight(800, 800, FOV, 16 / 9, 0);
    expect(wideCity).toBeLessThan(asIfSquare);
  });

  it.each([
    ['ultrawide', 21 / 9],
    ['landscape', 16 / 9],
    ['square', 1],
    ['portrait', 0.6],
  ])('never crops the city in a %s window', (_label, aspect) => {
    for (const [w, d] of [[800, 400], [400, 800], [600, 600], [1500, 200]]) {
      const { across, down } = fill(w, d, aspect);
      expect(across).toBeLessThanOrEqual(1.0001);
      expect(down).toBeLessThanOrEqual(1.0001);
    }
  });

  it('climbs higher for a narrower window', () => {
    expect(overheadFlyHeight(500, 500, FOV, 0.5, 0)).toBeGreaterThan(
      overheadFlyHeight(500, 500, FOV, 2.0, 0),
    );
  });

  it('needs less height as FOV widens', () => {
    expect(overheadFlyHeight(500, 500, 80, 1.6, 0)).toBeLessThan(
      overheadFlyHeight(500, 500, 30, 1.6, 0),
    );
  });

  it('scales linearly with city size', () => {
    const small = overheadFlyHeight(400, 300, FOV, 1.6, 0);
    const large = overheadFlyHeight(800, 600, FOV, 1.6, 0);
    expect(large / small).toBeCloseTo(2, 5);
  });

  it('clears the tallest structure', () => {
    const flat = overheadFlyHeight(500, 500, FOV, 1.6, 0);
    const tall = overheadFlyHeight(500, 500, FOV, 1.6, 120);
    expect(tall - flat).toBeCloseTo(120, 5);
  });

  it('survives degenerate camera and city values', () => {
    for (const h of [
      overheadFlyHeight(0, 0, FOV, 1.6, 0),
      overheadFlyHeight(-100, -100, FOV, 1.6, 0),
      overheadFlyHeight(500, 500, FOV, 0, 0),
      overheadFlyHeight(500, 500, FOV, NaN, 0),
      overheadFlyHeight(500, 500, 0, 1.6, 0),
    ]) {
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(0);
    }
  });
});
