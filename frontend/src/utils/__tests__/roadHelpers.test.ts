import { describe, it, expect } from 'vitest';
import { consolidateRoads } from '../roadHelpers';

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

  it('preserves extra properties on segments', () => {
    const input = [{ x1: 0, z1: 0, x2: 20, z2: 0, width: 6, myProp: 'hello' }];
    const result = consolidateRoads(input, []);
    expect((result[0] as any).myProp).toBe('hello');
    expect(result[0].width).toBe(6);
  });
});
