import type { Bounds, RoadSegment } from './types';
import { normalizeBounds } from './bsp';
import { pointInWater, type WaterPolygon } from './water';

/** How far onto land the waterfront road sits from the water's edge. */
const SHORE_OFFSET = 7;

/** Width of a waterfront road — an arterial, so it can carry bridges. */
const SHORE_ROAD_WIDTH = 6;

/**
 * A vertex further than this from its neighbours is a long straight run and
 * gets intermediate points, so the offset road hugs the outline instead of
 * cutting the corner.
 */
const MAX_SHORE_STEP = 30;

type Pt = { x: number; z: number };

/** Unit normal to the edge a->b, rotated to the left of travel. */
function edgeNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

/** Insert points along a polygon's longer edges so offsets follow its shape. */
function densify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push(a);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.floor(len / MAX_SHORE_STEP);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/**
 * Push a vertex off the water onto land.
 *
 * The averaged normal of the two edges meeting at the vertex points along one
 * side of the outline or the other depending on winding, so both directions are
 * tried and whichever lands on dry ground wins. Returns null at a pinch point
 * where neither does.
 */
function offsetVertex(prev: Pt, cur: Pt, next: Pt, polygons: WaterPolygon[]): Pt | null {
  const n1 = edgeNormal(prev, cur);
  const n2 = edgeNormal(cur, next);
  let nx = n1.x + n2.x;
  let nz = n1.z + n2.z;
  const len = Math.hypot(nx, nz);
  if (len < 1e-9) return null; // doubled-back spike
  nx /= len;
  nz /= len;

  const outward = { x: cur.x + nx * SHORE_OFFSET, z: cur.z + nz * SHORE_OFFSET };
  if (!pointInWater(polygons, outward.x, outward.z)) return outward;

  const inward = { x: cur.x - nx * SHORE_OFFSET, z: cur.z - nz * SHORE_OFFSET };
  if (!pointInWater(polygons, inward.x, inward.z)) return inward;

  return null;
}

/** True when a point sits inside the generation area. */
function inBounds(p: Pt, b: ReturnType<typeof normalizeBounds>): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}

/**
 * Lay a road around each water body, just inland of the water's edge.
 *
 * This is what turns approaches that would otherwise dead-end at the water into
 * junctions on a waterfront road, so the network routes around a lake rather
 * than stopping at it. Stretches that fall in the water (across a bay mouth,
 * say) or outside the generation area are dropped.
 */
export function generateShorelineRoads(
  polygons: WaterPolygon[],
  bounds: Bounds
): RoadSegment[] {
  if (polygons.length === 0) return [];
  const box = normalizeBounds(bounds);
  const segments: RoadSegment[] = [];

  for (const poly of polygons) {
    const ring = densify(poly.points);
    const n = ring.length;
    if (n < 3) continue;

    // Offset every vertex; nulls break the ring into open runs.
    const offsets: (Pt | null)[] = ring.map((cur, i) =>
      offsetVertex(ring[(i - 1 + n) % n], cur, ring[(i + 1) % n], polygons)
    );

    for (let i = 0; i < n; i++) {
      const a = offsets[i];
      const b = offsets[(i + 1) % n];
      if (!a || !b) continue;
      if (!inBounds(a, box) || !inBounds(b, box)) continue;

      // A chord that dips back into the water spans a bay mouth — skip it so
      // the road follows the shore rather than cutting across.
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (pointInWater(polygons, mid.x, mid.z)) continue;

      if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) continue;
      segments.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, width: SHORE_ROAD_WIDTH });
    }
  }

  return segments;
}
