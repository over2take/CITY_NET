import { describe, it, expect } from 'vitest';
import {
  elevationAt,
  buildOverpassGeometry,
  isEndpointConnected,
  isEndpointConnectedToOverpass,
  snapToOverpassEdge,
  pointToSegmentDist,
  sampleOverpassPath,
  parseOverpassPoints,
} from '../overpassHelpers';

// ─── pointToSegmentDist ───────────────────────────────────────────────────────

describe('pointToSegmentDist', () => {
  it('returns 0 for a point on the segment', () => {
    expect(pointToSegmentDist(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('returns perpendicular distance for a point beside the segment', () => {
    expect(pointToSegmentDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('clamps to the nearest endpoint for points beyond the segment', () => {
    // Point is past the end — closest point is (10,0)
    expect(pointToSegmentDist(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
    // Point is before the start — closest point is (0,0)
    expect(pointToSegmentDist(-3, 0, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('handles a zero-length segment (point vs point)', () => {
    expect(pointToSegmentDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it('works for diagonal segments', () => {
    // Segment (0,0)-(10,10): perpendicular from (0,10) is √(50)≈7.07
    expect(pointToSegmentDist(0, 10, 0, 0, 10, 10)).toBeCloseTo(Math.sqrt(50), 3);
  });
});

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

describe('elevationAt — edge cases', () => {
  it('returns 0 when rampLength is 0 (flat bridge from end to end)', () => {
    // slope = height / 0.001 (clamped) → enormous slope, so min(height, slope*0) = 0 at ends
    // but at middle it should clamp to height
    expect(elevationAt(50, 100, 10, 0)).toBeCloseTo(10);
  });

  it('both ends connected → full height along entire span', () => {
    expect(elevationAt(0,   100, 10, 20, true, true)).toBeCloseTo(10);
    expect(elevationAt(50,  100, 10, 20, true, true)).toBeCloseTo(10);
    expect(elevationAt(100, 100, 10, 20, true, true)).toBeCloseTo(10);
  });
});

describe('buildOverpassGeometry — multi-segment (curved) path', () => {
  it('handles a 3-point L-shaped path', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 50, z: 50 }];
    const { tiles, totalLength } = buildOverpassGeometry(pts, params, []);
    expect(totalLength).toBeCloseTo(100);
    expect(tiles.length).toBeGreaterThan(0);
    // Flat tiles at height, ramp tiles below it
    tiles.forEach(t => expect(t.y).toBeLessThanOrEqual(10 + 1e-6));
  });

  it('totalLength equals sum of segment lengths', () => {
    const pts = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 40 }];
    const { totalLength } = buildOverpassGeometry(pts, params, []);
    expect(totalLength).toBeCloseTo(70); // 30 + 40
  });
});

describe('buildOverpassGeometry — tile yaw', () => {
  it('yaw is 0 for a path going in the +x direction', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, params, []);
    tiles.forEach(t => expect(t.yaw).toBeCloseTo(0));
  });

  it('yaw is π/2 for a path going in the +z direction', () => {
    const pts = [{ x: 0, z: 0 }, { x: 0, z: 100 }];
    const { tiles } = buildOverpassGeometry(pts, params, []);
    // atan2(-(dz), dx) = atan2(-100, 0) = -π/2; three renders may flip, just check magnitude
    tiles.forEach(t => expect(Math.abs(t.yaw)).toBeCloseTo(Math.PI / 2));
  });
});

describe('buildOverpassGeometry — connected end suppression', () => {
  it('keeps deck flat at a connected end (no ramp on far side)', () => {
    const roads = [{ x1: 100, z1: 0, x2: 150, z2: 0, width: 4 }];
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, params, roads);
    expect(tiles[tiles.length - 1].y).toBeCloseTo(10, 1);
    expect(tiles[tiles.length - 1].pitch).toBeCloseTo(0, 3);
    // Start still ramps up
    expect(tiles[0].isRamp).toBe(true);
  });

  it('opts.connectedStart/End override road detection', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    // No roads, but force both connected via opts
    const { tiles } = buildOverpassGeometry(pts, params, [], { connectedStart: true, connectedEnd: true });
    tiles.forEach(t => {
      expect(t.isRamp).toBe(false);
      expect(t.y).toBeCloseTo(10, 1);
    });
  });
});

describe('buildOverpassGeometry — zero rampLength', () => {
  it('all interior tiles are flat at full height when rampLength is 0', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, { ...params, rampLength: 0 }, []);
    // Ramp is sub-tile in length so only the first and last tiles straddle the
    // elevation jump; every interior tile should be flat at full height
    const interior = tiles.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    interior.forEach(t => {
      expect(t.isRamp).toBe(false);
      expect(t.y).toBeCloseTo(10, 1);
    });
  });
});

describe('sampleOverpassPath — multi-segment', () => {
  it('interpolates through all waypoints of an L-shaped path', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 50, z: 50 }];
    const samples = sampleOverpassPath(pts, { height: 10, rampLength: 20 }, [], 4);
    expect(samples.length).toBeGreaterThan(10);
    // First sample near (0,0), last near (50,50)
    expect(samples[0].x).toBeCloseTo(0);
    expect(samples[0].z).toBeCloseTo(0);
    expect(samples[samples.length - 1].x).toBeCloseTo(50, 0);
    expect(samples[samples.length - 1].z).toBeCloseTo(50, 0);
  });

  it('step size controls sample density', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const coarse = sampleOverpassPath(pts, { height: 10, rampLength: 20 }, [], 20);
    const fine   = sampleOverpassPath(pts, { height: 10, rampLength: 20 }, [], 2);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});

describe('elevationAt — split ramp lengths', () => {
  it('uses rampLengthStart for the start ramp and rampLengthEnd for the end ramp', () => {
    // path length 100, start ramp 10, end ramp 30, height 10
    // at s=5: halfway up start ramp → 5
    expect(elevationAt(5,  100, 10, 20, false, false, 10, 30)).toBeCloseTo(5);
    // at s=10: top of start ramp → full height
    expect(elevationAt(10, 100, 10, 20, false, false, 10, 30)).toBeCloseTo(10);
    // at s=50: flat middle → full height
    expect(elevationAt(50, 100, 10, 20, false, false, 10, 30)).toBeCloseTo(10);
    // at s=70: top of end ramp (30 from end) → full height
    expect(elevationAt(70, 100, 10, 20, false, false, 10, 30)).toBeCloseTo(10);
    // at s=85: halfway down end ramp → 5
    expect(elevationAt(85, 100, 10, 20, false, false, 10, 30)).toBeCloseTo(5);
    // at s=100: ground at far end → 0
    expect(elevationAt(100, 100, 10, 20, false, false, 10, 30)).toBeCloseTo(0);
  });

  it('rampLengthStart=0 keeps start at full height, end still ramps', () => {
    expect(elevationAt(0,   100, 10, 20, false, false, 0, 20)).toBeCloseTo(10);
    expect(elevationAt(50,  100, 10, 20, false, false, 0, 20)).toBeCloseTo(10);
    expect(elevationAt(100, 100, 10, 20, false, false, 0, 20)).toBeCloseTo(0);
  });

  it('rampLengthEnd=0 keeps end at full height, start still ramps', () => {
    expect(elevationAt(0,   100, 10, 20, false, false, 20, 0)).toBeCloseTo(0);
    expect(elevationAt(50,  100, 10, 20, false, false, 20, 0)).toBeCloseTo(10);
    expect(elevationAt(100, 100, 10, 20, false, false, 20, 0)).toBeCloseTo(10);
  });

  it('both split ramps 0 → flat deck full length', () => {
    expect(elevationAt(0,   100, 10, 20, false, false, 0, 0)).toBeCloseTo(10);
    expect(elevationAt(50,  100, 10, 20, false, false, 0, 0)).toBeCloseTo(10);
    expect(elevationAt(100, 100, 10, 20, false, false, 0, 0)).toBeCloseTo(10);
  });

  it('connectedStart overrides rampLengthStart', () => {
    // connected start always forces full height at s=0 regardless of rampLengthStart
    expect(elevationAt(0, 100, 10, 20, true, false, 40, 20)).toBeCloseTo(10);
  });

  it('connectedEnd overrides rampLengthEnd', () => {
    expect(elevationAt(100, 100, 10, 20, false, true, 20, 40)).toBeCloseTo(10);
  });

  it('falls back to rampLength when split values are undefined', () => {
    // No split args — should behave identically to the base elevationAt
    expect(elevationAt(10, 100, 10, 20, false, false, undefined, undefined)).toBeCloseTo(5);
    expect(elevationAt(50, 100, 10, 20, false, false, undefined, undefined)).toBeCloseTo(10);
  });
});

describe('buildOverpassGeometry — split ramp lengths', () => {
  it('produces a short start ramp and long end ramp when split', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, { ...params, rampLengthStart: 5, rampLengthEnd: 30 }, []);
    // First tile is near ground, should be ramped
    expect(tiles[0].isRamp).toBe(true);
    // Tile at s≈7 (past 5-unit start ramp) should be flat
    const earlyFlat = tiles.find(t => t.x > 7 && t.x < 20);
    expect(earlyFlat).toBeDefined();
    expect(earlyFlat!.isRamp).toBe(false);
    expect(earlyFlat!.y).toBeCloseTo(10, 1);
    // Tile near s=90 (inside 30-unit end ramp) should be ramped
    const lateRamp = tiles.find(t => t.x > 85 && t.x < 95);
    expect(lateRamp).toBeDefined();
    expect(lateRamp!.isRamp).toBe(true);
    expect(lateRamp!.y).toBeLessThan(10);
  });

  it('rampLengthStart=0, rampLengthEnd=0 → all interior tiles flat', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, { ...params, rampLengthStart: 0, rampLengthEnd: 0 }, []);
    const interior = tiles.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    interior.forEach(t => {
      expect(t.isRamp).toBe(false);
      expect(t.y).toBeCloseTo(10, 1);
    });
  });

  it('rampLengthStart=0 → first tile at full height', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const { tiles } = buildOverpassGeometry(pts, { ...params, rampLengthStart: 0, rampLengthEnd: 20 }, []);
    expect(tiles[0].y).toBeCloseTo(10, 1);
    expect(tiles[0].isRamp).toBe(false);
    // Far end should still slope down
    expect(tiles[tiles.length - 1].isRamp).toBe(true);
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

describe('isEndpointConnectedToOverpass', () => {
  const path1 = [{ x: 0, z: 0 }, { x: 100, z: 0 }];

  it('returns true when the point is within tolerance of a segment (not just vertices)', () => {
    // Point at x=50 on the segment z=0 — between vertices, not near either endpoint
    expect(isEndpointConnectedToOverpass({ x: 50, z: 2 }, [path1])).toBe(true);
    expect(isEndpointConnectedToOverpass({ x: 50, z: -2 }, [path1])).toBe(true);
  });

  it('returns true near a path vertex', () => {
    expect(isEndpointConnectedToOverpass({ x: 1, z: 1 }, [path1])).toBe(true);
  });

  it('returns false when the point is beyond tolerance', () => {
    expect(isEndpointConnectedToOverpass({ x: 200, z: 200 }, [path1])).toBe(false);
    expect(isEndpointConnectedToOverpass({ x: 50, z: 5 }, [path1])).toBe(false); // 5 > tol=3
  });

  it('returns false for an empty paths array', () => {
    expect(isEndpointConnectedToOverpass({ x: 0, z: 0 }, [])).toBe(false);
  });

  it('checks across multiple other paths', () => {
    const path2 = [{ x: 200, z: 200 }, { x: 250, z: 200 }];
    expect(isEndpointConnectedToOverpass({ x: 225, z: 201 }, [path1, path2])).toBe(true);
  });

  it('respects a custom tolerance', () => {
    // Point 4 units perpendicular from segment — default tol=3 misses, tol=5 catches
    expect(isEndpointConnectedToOverpass({ x: 50, z: 4 }, [path1], 3)).toBe(false);
    expect(isEndpointConnectedToOverpass({ x: 50, z: 4 }, [path1], 5)).toBe(true);
  });
});

describe('snapToOverpassEdge', () => {
  const other = { points: [{ x: 0, z: 0 }, { x: 100, z: 0 }], width: 10 };

  it('snaps to the centreline of the closest segment', () => {
    // Point sitting 3 units above the centreline at x=50
    const snapped = snapToOverpassEdge({ x: 50, z: 3 }, [other]);
    expect(snapped).not.toBeNull();
    expect(snapped!.x).toBeCloseTo(50);
    expect(snapped!.z).toBeCloseTo(0); // centreline z=0
  });

  it('returns null when nothing is within tolerance + half-width', () => {
    const result = snapToOverpassEdge({ x: 50, z: 200 }, [other]);
    expect(result).toBeNull();
  });

  it('returns null for an empty others array', () => {
    expect(snapToOverpassEdge({ x: 50, z: 0 }, [])).toBeNull();
  });

  it('picks the nearest segment when multiple others exist', () => {
    const other2 = { points: [{ x: 0, z: 100 }, { x: 100, z: 100 }], width: 10 };
    // Point at z=8 — closer to other (z=0) than other2 (z=100)
    const snapped = snapToOverpassEdge({ x: 50, z: 8 }, [other, other2]);
    expect(snapped).not.toBeNull();
    expect(snapped!.z).toBeCloseTo(0);
  });

  it('clamps to the nearest segment endpoint for points past the end', () => {
    // x=120, past the end of the segment at x=100
    const snapped = snapToOverpassEdge({ x: 102, z: 2 }, [other]);
    expect(snapped).not.toBeNull();
    expect(snapped!.x).toBeCloseTo(100);
    expect(snapped!.z).toBeCloseTo(0);
  });
});

describe('buildOverpassGeometry — otherOverpasses snapping', () => {
  it('snaps connected start to the centreline of the other overpass', () => {
    // Crossing overpass running along z=0
    const other = { points: [{ x: 0, z: 0 }, { x: 100, z: 0 }], width: 8 };
    // This overpass starts 2 units above the other's centreline — should snap to z=0
    const pts = [{ x: 50, z: 2 }, { x: 50, z: 60 }];
    const { tiles } = buildOverpassGeometry(
      pts, params, [], { otherOverpasses: [other] }
    );
    expect(tiles.length).toBeGreaterThan(0);
    // First tile should be flat (connectedStart suppresses ramp)
    expect(tiles[0].isRamp).toBe(false);
    expect(tiles[0].y).toBeCloseTo(params.height, 1);
  });

  it('does not snap when the endpoint is out of range', () => {
    const other = { points: [{ x: 0, z: 0 }, { x: 100, z: 0 }], width: 8 };
    const pts = [{ x: 50, z: 200 }, { x: 50, z: 260 }]; // far from other
    const { tiles } = buildOverpassGeometry(
      pts, params, [], { otherOverpasses: [other] }
    );
    // Not snapped — start should ramp up normally
    expect(tiles[0].isRamp).toBe(true);
  });

  it('explicit rampLengthStart overrides overpass connection detection', () => {
    const other = { points: [{ x: 0, z: 0 }, { x: 100, z: 0 }], width: 8 };
    const pts = [{ x: 50, z: 2 }, { x: 50, z: 80 }];
    // rampLengthStart explicitly set — should NOT auto-connect
    const { tiles } = buildOverpassGeometry(
      pts, { ...params, rampLengthStart: 15 }, [], { otherOverpasses: [other] }
    );
    // First tile should still be ramping (explicit ramp length wins over auto-connect)
    expect(tiles[0].isRamp).toBe(true);
  });
});

describe('sampleOverpassPath — overpass connectivity', () => {
  it('suppresses the start ramp when the endpoint is near another overpass path', () => {
    const otherPath = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    // Overpass starting 2 units from the other's centreline
    const pts = [{ x: 50, z: 2 }, { x: 50, z: 60 }];
    const samples = sampleOverpassPath(
      pts, { height: 10, rampLength: 20 }, [], 4, [otherPath]
    );
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0].y).toBeCloseTo(10); // no ramp — connected start
  });

  it('does not suppress the ramp when explicit rampLengthStart is set', () => {
    const otherPath = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const pts = [{ x: 50, z: 2 }, { x: 50, z: 60 }];
    const samples = sampleOverpassPath(
      pts, { height: 10, rampLength: 20, rampLengthStart: 15 }, [], 4, [otherPath]
    );
    // Explicit rampLengthStart means connectedStart is false — starts at ground
    expect(samples[0].y).toBeCloseTo(0);
  });
});
