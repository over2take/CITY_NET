import { describe, it, expect } from 'vitest';
import { consolidateRoads, chainRoadPolylines, buildRoadRibbonGeometry } from '../roadHelpers';

const seg = (x1: number, z1: number, x2: number, z2: number, width = 4) => ({ x1, z1, x2, z2, width });

describe('consolidateRoads', () => {
  it('returns segments unchanged when no existing roads and no nearby points', () => {
    const input = [seg(0, 0, 100, 0)];
    const result = consolidateRoads(input, []);
    expect(result).toHaveLength(1);
    expect(result[0].x1).toBeCloseTo(0);
    expect(result[0].x2).toBeCloseTo(100);
  });

  it('snaps an endpoint to a nearby existing road node within threshold', () => {
    const existing = [seg(10, 0, 50, 0)];
    // New segment starts at (7, 0) — 3 units before the existing road's start node (10,0),
    // approaching from outside the segment so closest-on-segment is (10,0) itself
    const input = [seg(7, 0, 80, 0)];
    const result = consolidateRoads(input, existing);
    expect(result[0].x1).toBeCloseTo(10);
    expect(result[0].z1).toBeCloseTo(0);
  });

  it('does NOT snap an endpoint outside the threshold', () => {
    const existing = [seg(0, 0, 10, 0)];
    // New segment endpoint at (20, 0) — 10 units away, beyond default snapDist=6
    const input = [seg(20, 0, 50, 0)];
    const result = consolidateRoads(input, existing);
    expect(result[0].x1).toBeCloseTo(20);
  });

  it('snaps to a point projected onto an existing segment, not just endpoints', () => {
    const existing = [seg(0, 0, 100, 0)]; // horizontal road along z=0
    // New point at (50, 4) — 4 units from the existing segment midpoint
    const input = [seg(50, 4, 50, 50)];
    const result = consolidateRoads(input, existing, 6);
    expect(result[0].z1).toBeCloseTo(0); // snapped to segment
    expect(result[0].x1).toBeCloseTo(50);
  });

  it('snaps two new segment endpoints to each other when within threshold', () => {
    const input = [seg(0, 0, 9, 0), seg(10, 0, 30, 0)];
    // Endpoints (9,0) and (10,0) are 1 unit apart — within default snapDist=6
    const result = consolidateRoads(input, []);
    expect(result[0].x2).toBeCloseTo(result[1].x1);
  });

  it('filters out degenerate zero-length segments after snapping', () => {
    // Both endpoints of a segment snap to the same point → filtered out
    const existing = [seg(0, 0, 0, 10)];
    const input = [seg(1, 5, 2, 5)]; // both within snapDist=6 of (0,5) on the segment
    const result = consolidateRoads(input, existing, 6);
    // If both endpoints snapped to the same point the segment has length 0 and is removed
    // (may or may not snap depending on projection — just verify no negative-length segments)
    result.forEach(s => {
      const dx = s.x2 - s.x1;
      const dz = s.z2 - s.z1;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(0.5);
    });
  });

  it('respects a custom snapDist parameter', () => {
    const existing = [seg(0, 0, 10, 0)];
    // Point at (12, 0) — within snapDist=15 but outside default 6
    const input = [seg(12, 0, 50, 0)];
    const result = consolidateRoads(input, existing, 15);
    expect(result[0].x1).toBeCloseTo(10);
  });

  it('chains contiguous segments into one polyline route', () => {
    const segs = [seg(0, 0, 10, 0), seg(10, 0, 20, 0), seg(20, 0, 30, 5)];
    const routes = chainRoadPolylines(segs);
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toHaveLength(4);
    const xs = routes[0].points.map(p => p.x);
    // One continuous walk end-to-end (either direction)
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(30);
  });

  it('breaks chains at 3-way junctions', () => {
    const segs = [
      seg(0, 0, 10, 0),
      seg(10, 0, 20, 0),
      seg(10, 0, 10, 10), // branch off the shared node at (10,0)
    ];
    const routes = chainRoadPolylines(segs);
    // The junction node has degree 3 → no chain passes through it
    expect(routes.length).toBeGreaterThanOrEqual(2);
    routes.forEach(r => expect(r.points.length).toBe(2));
  });

  it('keeps disconnected segments as separate routes and preserves width', () => {
    const segs = [seg(0, 0, 10, 0, 6), seg(100, 100, 120, 100, 3)];
    const routes = chainRoadPolylines(segs);
    expect(routes).toHaveLength(2);
    const widths = routes.map(r => r.width).sort();
    expect(widths).toEqual([3, 6]);
  });

  it('produces a single segment route for an isolated road', () => {
    const routes = chainRoadPolylines([seg(0, 0, 10, 0)]);
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toHaveLength(2);
  });

  it('4-way intersection breaks into 4 separate single-segment routes', () => {
    // Four roads sharing the node at (10,10)
    const segs = [
      seg(10, 10, 20, 10), // east
      seg(10, 10,  0, 10), // west
      seg(10, 10, 10, 20), // south
      seg(10, 10, 10,  0), // north
    ];
    const routes = chainRoadPolylines(segs);
    expect(routes).toHaveLength(4);
    routes.forEach(r => expect(r.points).toHaveLength(2));
  });

  it('chains a longer straight with mixed order segments', () => {
    // Segments supplied out of spatial order — chaining must still find the full street
    const segs = [seg(20, 0, 30, 0), seg(0, 0, 10, 0), seg(10, 0, 20, 0)];
    const routes = chainRoadPolylines(segs);
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toHaveLength(4);
  });

  it('T-junction: straight road breaks at the T, branch is its own route', () => {
    // Straight A–B–C with branch off B
    const segs = [
      seg( 0, 0, 10, 0), // A→B
      seg(10, 0, 20, 0), // B→C
      seg(10, 0, 10, 10), // B→D (branch)
    ];
    const routes = chainRoadPolylines(segs);
    // B has degree 3 → no chain passes through B; all three segments are standalone
    expect(routes.length).toBe(3);
    routes.forEach(r => expect(r.points).toHaveLength(2));
  });

  it('handles a closed loop — all segments visited, none left out', () => {
    const segs = [
      seg( 0,  0, 10,  0),
      seg(10,  0, 10, 10),
      seg(10, 10,  0, 10),
      seg( 0, 10,  0,  0),
    ];
    const routes = chainRoadPolylines(segs);
    // Every node in a loop has degree 2 but walk hits the start twice → should
    // still visit all 4 segments with no duplication
    const totalSegsCovered = routes.reduce((sum, r) => sum + (r.points.length - 1), 0);
    expect(totalSegsCovered).toBe(4);
  });

  it('uses the snap tolerance to treat near-coincident endpoints as shared', () => {
    // key = Math.round(x / tol): 10/1=10, 10.3/1=10.3→10 → same bucket → connected
    const segs = [seg(0, 0, 10, 0), seg(10.3, 0, 20, 0)];
    const routes = chainRoadPolylines(segs, 1.0);
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toHaveLength(3);
  });

  it('does NOT merge endpoints outside the snap tolerance', () => {
    // 10/1=10, 12/1=12 → different buckets → two separate routes
    const segs = [seg(0, 0, 10, 0), seg(12, 0, 20, 0)];
    const routes = chainRoadPolylines(segs, 1.0);
    expect(routes).toHaveLength(2);
  });

  it('returns no routes for an empty segment list', () => {
    expect(chainRoadPolylines([])).toHaveLength(0);
  });

  it('preserves extra properties on segments', () => {
    const input = [{ x1: 0, z1: 0, x2: 20, z2: 0, width: 6, myProp: 'hello' }];
    const result = consolidateRoads(input, []);
    expect((result[0] as any).myProp).toBe('hello');
    expect(result[0].width).toBe(6);
  });
});

describe('buildRoadRibbonGeometry', () => {
  it('builds two vertices per point and two triangles per segment', () => {
    const chains = [{ points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }], width: 4 }];
    const geo = buildRoadRibbonGeometry(chains);
    expect(geo.getAttribute('position').count).toBe(6); // 3 pts * 2
    expect(geo.getIndex()!.count).toBe(12); // 2 segments * 2 tris * 3 idx
  });

  it('offsets straight-line vertices by half the width', () => {
    const chains = [{ points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], width: 4 }];
    const geo = buildRoadRibbonGeometry(chains);
    const pos = geo.getAttribute('position');
    // Direction +x → perpendicular ±z, half width 2
    expect(Math.abs(pos.getZ(0))).toBeCloseTo(2);
    expect(Math.abs(pos.getZ(1))).toBeCloseTo(2);
    expect(pos.getZ(0)).toBeCloseTo(-pos.getZ(1));
  });

  it('widens the joint at a 90-degree bend (miter)', () => {
    const chains = [{ points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], width: 4 }];
    const geo = buildRoadRibbonGeometry(chains);
    const pos = geo.getAttribute('position');
    // Interior point vertices (idx 2,3) — miter at 45° half-angle = halfW / cos(45°) ≈ 2.828
    const d = Math.hypot(pos.getX(2) - 10, pos.getZ(2) - 0);
    expect(d).toBeCloseTo(2 / Math.cos(Math.PI / 4), 1);
  });

  it('respects the width scale factor', () => {
    const chains = [{ points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], width: 4 }];
    const geo = buildRoadRibbonGeometry(chains, 0.5);
    const pos = geo.getAttribute('position');
    expect(Math.abs(pos.getZ(0))).toBeCloseTo(1);
  });

  it('handles multiple chains and skips degenerate ones', () => {
    const chains = [
      { points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], width: 4 },
      { points: [{ x: 5, z: 5 }], width: 4 }, // degenerate, skipped
      { points: [{ x: 0, z: 20 }, { x: 10, z: 20 }], width: 6 },
    ];
    const geo = buildRoadRibbonGeometry(chains);
    expect(geo.getAttribute('position').count).toBe(8);
    expect(geo.getIndex()!.count).toBe(12);
  });
});
