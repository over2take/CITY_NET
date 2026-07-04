import { describe, it, expect } from 'vitest';
import {
  elevationAt,
  buildOverpassGeometry,
  isEndpointConnected,
  pointToSegmentDist,
  sampleOverpassPath,
  parseOverpassPoints,
} from '../overpassHelpers';

const params = { height: 10, width: 6, rampLength: 20, pillarSpacing: 12 };

describe('elevationAt', () => {
  it('is 0 at both ends and full height on the flat middle of a long road', () => {
    // Length 100, ramps of 20 each → flat from s=20 to s=80
    expect(elevationAt(0, 100, 10, 20)).toBeCloseTo(0);
    expect(elevationAt(100, 100, 10, 20)).toBeCloseTo(0);
    expect(elevationAt(50, 100, 10, 20)).toBeCloseTo(10);
    expect(elevationAt(20, 100, 10, 20)).toBeCloseTo(10);
    expect(elevationAt(80, 100, 10, 20)).toBeCloseTo(10);
  });

  it('rises linearly along the ramp', () => {
    expect(elevationAt(10, 100, 10, 20)).toBeCloseTo(5); // halfway up the ramp
    expect(elevationAt(95, 100, 10, 20)).toBeCloseTo(2.5); // 5 units from far end
  });

  it('scales peak height down when road length ≤ 2 × rampLength', () => {
    // Length 20, rampLength 20 → slopes meet in the middle at s=10.
    // slope = 10/20 = 0.5 → peak = 0.5 * 10 = 5, half the target height.
    expect(elevationAt(10, 20, 10, 20)).toBeCloseTo(5);
    // Slope angle unchanged — no bow shape
    expect(elevationAt(5, 20, 10, 20)).toBeCloseTo(2.5);
  });

  it('suppresses the ramp on a connected start (deck flat to the join)', () => {
    expect(elevationAt(0, 100, 10, 20, true, false)).toBeCloseTo(10);
    expect(elevationAt(5, 100, 10, 20, true, false)).toBeCloseTo(10);
    // Far end still ramps down
    expect(elevationAt(100, 100, 10, 20, true, false)).toBeCloseTo(0);
  });

  it('suppresses the ramp on a connected end', () => {
    expect(elevationAt(100, 100, 10, 20, false, true)).toBeCloseTo(10);
    expect(elevationAt(0, 100, 10, 20, false, true)).toBeCloseTo(0);
  });
});

describe('buildOverpassGeometry — tiles', () => {
  it('classifies flat vs ramp tiles on a long road', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles, totalLength } = buildOverpassGeometry(pts, params, []);
    expect(totalLength).toBeCloseTo(100);
    const flat = tiles.filter(t => !t.isRamp);
    const ramps = tiles.filter(t => t.isRamp);
    expect(flat.length).toBeGreaterThan(0);
    expect(ramps.length).toBeGreaterThan(0);
    // Flat tiles sit at full height with no pitch
    flat.forEach(t => { expect(t.y).toBeCloseTo(10); expect(t.pitch).toBeCloseTo(0); });
    // Ramp slope never exceeds atan(height / rampLength); tiles fully inside
    // a ramp hit it exactly (tiles straddling the ramp/flat break are shallower)
    const expectedPitch = Math.atan(10 / 20);
    ramps.forEach(t => expect(Math.abs(t.pitch)).toBeLessThanOrEqual(expectedPitch + 1e-6));
    const maxPitch = Math.max(...ramps.map(t => Math.abs(t.pitch)));
    expect(maxPitch).toBeCloseTo(expectedPitch, 5);
  });

  it('produces only ramp tiles (no flat) when slopes meet in the middle', () => {
    const pts = [{ x: 0, z: 0 }, { x: 30, z: 0 }]; // length 30 < 2×20
    const { tiles } = buildOverpassGeometry(pts, params, []);
    expect(tiles.length).toBeGreaterThan(0);
    tiles.forEach(t => expect(t.isRamp).toBe(true));
    // Peak scales: slope 0.5 × half-length 15 = 7.5, never reaching 10
    tiles.forEach(t => expect(t.y).toBeLessThan(10));
  });

  it('keeps the deck flat at a connected start', () => {
    const roads = [{ x1: 0, z1: 0, x2: -50, z2: 0, width: 4 }]; // endpoint at (0,0)
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, params, roads);
    // First tile should already be at full height, unpitched
    expect(tiles[0].y).toBeCloseTo(10, 1);
    expect(tiles[0].pitch).toBeCloseTo(0, 3);
    // Last tile still ramps down
    expect(tiles[tiles.length - 1].isRamp).toBe(true);
  });

  it('returns empty geometry for degenerate paths', () => {
    expect(buildOverpassGeometry([{ x: 0, z: 0 }], params, []).tiles).toHaveLength(0);
    expect(buildOverpassGeometry([{ x: 0, z: 0 }, { x: 0.1, z: 0 }], params, []).tiles).toHaveLength(0);
  });
});

describe('buildOverpassGeometry — pillars', () => {
  it('places pillars under the elevated deck at the given spacing', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { pillars } = buildOverpassGeometry(pts, params, []);
    expect(pillars.length).toBeGreaterThan(0);
    // All pillars support an elevated deck
    pillars.forEach(p => expect(p.height).toBeGreaterThan(1.5));
    // Consecutive pillars are ~pillarSpacing apart
    for (let i = 1; i < pillars.length; i++) {
      const d = Math.hypot(pillars[i].x - pillars[i - 1].x, pillars[i].z - pillars[i - 1].z);
      expect(d).toBeCloseTo(12, 0);
    }
  });

  it('skips pillar candidates that land on an existing road', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    // Road crossing underneath at x=50
    const crossing = [{ x1: 50, z1: -50, x2: 50, z2: 50, width: 6 }];
    const withRoad = buildOverpassGeometry(pts, params, crossing);
    const without = buildOverpassGeometry(pts, params, []);
    expect(withRoad.pillars.length).toBeLessThan(without.pillars.length);
    // No surviving pillar is inside the crossing road's footprint
    withRoad.pillars.forEach(p => {
      expect(pointToSegmentDist(p.x, p.z, 50, -50, 50, 50)).toBeGreaterThan(3);
    });
  });

  it('does not place stubby pillars near ground level on ramps', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { pillars } = buildOverpassGeometry(pts, { ...params, pillarSpacing: 2 }, []);
    pillars.forEach(p => expect(p.height).toBeGreaterThanOrEqual(1.5));
  });
});

describe('sampleOverpassPath', () => {
  it('produces evenly spaced samples following the elevation profile', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const samples = sampleOverpassPath(pts, { height: 10, rampLength: 20 }, [], 4);
    expect(samples.length).toBeGreaterThan(20);
    // Ends at ground, middle at full height
    expect(samples[0].y).toBeCloseTo(0);
    expect(samples[samples.length - 1].y).toBeCloseTo(0);
    const mid = samples[Math.floor(samples.length / 2)];
    expect(mid.y).toBeCloseTo(10, 1);
    // x runs monotonically from 0 to 100
    expect(samples[0].x).toBeCloseTo(0);
    expect(samples[samples.length - 1].x).toBeCloseTo(100);
  });

  it('respects connected endpoints (flat deck at the join)', () => {
    const roads = [{ x1: 0, z1: 0, x2: -50, z2: 0 }];
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const samples = sampleOverpassPath(pts, { height: 10, rampLength: 20 }, roads, 4);
    expect(samples[0].y).toBeCloseTo(10); // no ramp at the connected start
    expect(samples[samples.length - 1].y).toBeCloseTo(0);
  });

  it('returns empty for degenerate input', () => {
    expect(sampleOverpassPath([{ x: 0, z: 0 }], { height: 10, rampLength: 20 })).toHaveLength(0);
  });
});

describe('parseOverpassPoints', () => {
  it('passes arrays through and parses JSON strings', () => {
    const pts = [{ x: 1, z: 2 }];
    expect(parseOverpassPoints(pts)).toBe(pts);
    expect(parseOverpassPoints(JSON.stringify(pts))).toEqual(pts);
  });

  it('returns empty array on malformed input', () => {
    expect(parseOverpassPoints('not json')).toEqual([]);
    expect(parseOverpassPoints('{"x":1}')).toEqual([]);
  });
});

describe('isEndpointConnected', () => {
  it('detects a nearby road endpoint within tolerance', () => {
    const roads = [{ x1: 10, z1: 0, x2: 50, z2: 0 }];
    expect(isEndpointConnected({ x: 11, z: 1 }, roads)).toBe(true);
    expect(isEndpointConnected({ x: 30, z: 0 }, roads)).toBe(false); // mid-segment ≠ endpoint
    expect(isEndpointConnected({ x: 100, z: 100 }, roads)).toBe(false);
  });
});
