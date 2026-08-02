import type { RoadSegment, Rng } from './types';
import {
  type Polygon, type WaterPolygon,
  clipSegmentToLand, clipSegmentToBoundary, pointInWater, pointInPolygon, segmentCrossing,
} from './water';

/**
 * Roundabouts.
 *
 * An overlay on a finished road network rather than a layout, in the same way bridges
 * are. That means one implementation serves every layout, instead of five.
 *
 * The observation that makes this cheap: as far as roads are concerned, a roundabout
 * island is a tiny lake. `clipSegmentToLand` already cuts a segment out of a polygon
 * and leaves the approaches stopping at its edge — which is exactly what a junction
 * does to the roads meeting it. The ring itself is the same arc sampling `RING` uses
 * for its beltways. Neither piece is new.
 *
 * **Ordering matters.** This has to run *after* `consolidateRoads`. Consolidation snaps
 * endpoints within a few units of each other, and a ring is many short segments with
 * close endpoints — run it first and the circle is snapped into a blob.
 */

export type RoundaboutDensity = 'off' | 'sparse' | 'normal';

/** A sited roundabout: where it is and how big, so the caller can dress the island. */
export interface Roundabout {
  x: number;
  z: number;
  /** Radius of the ring road's centreline. */
  radius: number;
}

/** Roads narrower than this do not warrant a roundabout — it is a junction of arterials. */
const MIN_ARTERIAL_WIDTH = 5;

/** Ring radius, as a multiple of the widest road meeting it. */
const RADIUS_FROM_ROAD = 2.6;
const MIN_RADIUS = 9;
const MAX_RADIUS = 22;

/** Two roundabouts closer than this many radii read as one mistake, not two junctions. */
const SPACING_RADII = 4;

/** Degrees between sampled points on the ring. */
const RING_STEP_DEG = 20;

/** Ring roads are a lane and a bit — narrower than the arterials they join. */
const RING_WIDTH = 5;

/** Fraction of eligible junctions that actually get one, per density. */
const DENSITY_SHARE: Record<RoundaboutDensity, number> = {
  off: 0,
  sparse: 0.25,
  normal: 0.6,
};

/**
 * Junctions in a road network.
 *
 * Two kinds, because layouts differ in how they meet. BSP and VORONOI join at shared
 * endpoints; `gridLayout` lays each street as one full-length span, so its crossings
 * share no endpoint at all and are found only by intersecting the segments. Missing the
 * second kind would mean the grid — the layout most obviously wanting roundabouts —
 * never got one.
 */
export function findJunctions(roads: RoadSegment[]): { x: number; z: number; width: number }[] {
  const arterials = roads.filter((r) => (r.width ?? 0) >= MIN_ARTERIAL_WIDTH);
  const out: { x: number; z: number; width: number }[] = [];

  for (let i = 0; i < arterials.length; i++) {
    for (let j = i + 1; j < arterials.length; j++) {
      const a = arterials[i];
      const b = arterials[j];
      const hit = segmentCrossing(a, b);
      if (!hit) continue;
      out.push({ x: hit.x, z: hit.z, width: Math.max(a.width ?? 0, b.width ?? 0) });
    }
  }
  return out;
}

/**
 * True when the whole ring sits on land and inside any drawn boundary.
 *
 * Testing the centre alone is not enough, and looked fine until a lake was generated: a
 * junction on a shoreline has its centre on dry ground while half its ring hangs over
 * the water. The ring points are the same ones that become road, so this asks the
 * question about the geometry that will actually exist rather than a proxy for it.
 */
function ringOnLand(r: Roundabout, water: WaterPolygon[], boundary?: Polygon): boolean {
  if (water.length > 0 && pointInWater(water, r.x, r.z)) return false;
  if (boundary && !pointInPolygon(boundary, r.x, r.z)) return false;

  for (const p of ringPolygon(r).points) {
    if (water.length > 0 && pointInWater(water, p.x, p.z)) return false;
    if (boundary && !pointInPolygon(boundary, p.x, p.z)) return false;
  }
  return true;
}

/**
 * Choose which junctions become roundabouts.
 *
 * Sited away from water, spaced apart, and thinned by density. The spacing test uses
 * the radius of what is already placed, so a wide roundabout keeps a larger berth than
 * a narrow one without a second constant to keep in step.
 */
export function siteRoundabouts(
  roads: RoadSegment[],
  density: RoundaboutDensity,
  rng: Rng,
  water: WaterPolygon[] = [],
  boundary?: Polygon
): Roundabout[] {
  if (density === 'off') return [];
  const share = DENSITY_SHARE[density] ?? 0;
  if (share <= 0) return [];

  const placed: Roundabout[] = [];

  for (const j of findJunctions(roads)) {
    // Drawn first and unconditionally, so the sequence does not depend on how many
    // junctions happen to be eligible — the same rule the landmark roll follows.
    const roll = rng();
    if (roll >= share) continue;

    const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, j.width * RADIUS_FROM_ROAD));
    if (!ringOnLand({ x: j.x, z: j.z, radius }, water, boundary)) continue;

    const tooClose = placed.some(
      (p) => Math.hypot(p.x - j.x, p.z - j.z) < Math.max(p.radius, radius) * SPACING_RADII
    );
    if (tooClose) continue;

    placed.push({ x: j.x, z: j.z, radius });
  }

  return placed;
}

/** The ring as a closed polygon — both the road to lay and the hole to cut. */
export function ringPolygon(r: Roundabout): Polygon {
  const step = (RING_STEP_DEG * Math.PI) / 180;
  const steps = Math.max(6, Math.ceil((Math.PI * 2) / step));
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    points.push({ x: r.x + Math.cos(a) * r.radius, z: r.z + Math.sin(a) * r.radius });
  }
  return { points };
}

/**
 * Cut the approaches back to each ring and lay the rings themselves.
 *
 * The trim reuses the water clipper: every roundabout is passed as a polygon to cut
 * *out* of the network, exactly as a lake would be. Without it the arterials would run
 * straight through the island and the roundabout would read as a decoration painted
 * over a crossroads.
 */
export function applyRoundabouts(
  roads: RoadSegment[],
  roundabouts: Roundabout[],
  boundary?: Polygon
): RoadSegment[] {
  if (roundabouts.length === 0) return roads;

  const islands = roundabouts.map(ringPolygon);

  const out: RoadSegment[] = [];
  for (const road of roads) {
    out.push(...clipSegmentToLand(road, islands));
  }

  for (const r of roundabouts) {
    const pts = ringPolygon(r).points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const seg: RoadSegment = { x1: a.x, z1: a.z, x2: b.x, z2: b.z, width: RING_WIDTH };
      out.push(...clipSegmentToBoundary(seg, boundary));
    }
  }

  return out;
}

export { MIN_ARTERIAL_WIDTH, RADIUS_FROM_ROAD, MIN_RADIUS, MAX_RADIUS, RING_WIDTH, SPACING_RADII, DENSITY_SHARE };
