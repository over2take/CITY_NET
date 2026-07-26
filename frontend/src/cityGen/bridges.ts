import type { RoadSegment, Rng } from './types';
import {
  type WaterPolygon,
  submergedSpans,
  pointInWater,
  segmentLength,
} from './water';

/** How freely generated roads bridge the water they meet. */
export type OverpassDensity = 'off' | 'sparse' | 'normal' | 'heavy';

/**
 * Share of viable sites that get a span. Applied as a proportion of the sites
 * actually found rather than a per-site coin flip: crossings that clear every
 * test are scarce — often only a handful on a whole lake — and independent
 * rolls would routinely produce none at all.
 */
const DENSITY_FRACTION: Record<OverpassDensity, number> = {
  off: 0,
  sparse: 0.34,
  normal: 0.7,
  heavy: 1.0,
};

/**
 * Widest stretch of water each setting will bridge. Heavier settings reach
 * further as well as more often, so the control reads as one dial: anything
 * beyond the cap is a lake, and the road simply stops at the shore.
 */
const DENSITY_MAX_SPAN: Record<OverpassDensity, number> = {
  off: 0,
  sparse: 120,
  normal: 200,
  heavy: 300,
};

/** Widest crossing any setting will bridge. */
export const MAX_BRIDGE_SPAN = DENSITY_MAX_SPAN.heavy;

/** Horizontal run each ramp needs at either end of a span. */
export const BRIDGE_RAMP_LENGTH = 20;

/**
 * Deck elevations available to a generated bridge, lowest first.
 *
 * Bridges that cross in plan are given different levels so one passes over the
 * other instead of intersecting it, and the choice among the remaining levels
 * is random so a run of bridges is not all at one height.
 */
const BRIDGE_HEIGHTS = [8, 13, 18, 23];

/** Fallback when a crossing has more neighbours than there are levels. */
const BRIDGE_HEIGHT = BRIDGE_HEIGHTS[0];

/** Spacing of the pillars carrying the deck. */
const BRIDGE_PILLAR_SPACING = 12;

/** Roads at least this wide count as arterials and bridge more readily. */
const ARTERIAL_WIDTH = 6;

/** How close the far shore must have a road for a crossing to be worth making. */
const LANDING_TOLERANCE = 18;

/** Two candidate decks closer than this are the same crossing seen twice. */
const DUPLICATE_RADIUS = 25;

/** A stub must have at least this much dry road behind it to ramp from. */
const MIN_APPROACH = 12;

/**
 * How far past a road end to look for water. Approaches stop on the waterfront
 * road, which is set back from the edge, so the water begins a little beyond
 * the end rather than immediately at it.
 */
const SHORE_REACH = 14;

/** An overpass ready to POST to /api/overpasses. */
export interface OverpassSpec {
  points: { x: number; z: number }[];
  height: number;
  width: number;
  ramp_length: number;
  pillar_spacing: number;
}

type Pt = { x: number; z: number };

/** A road end that stops at the water, pointing across it. */
interface ShoreStub {
  /** The road end itself, on land at the shoreline. */
  at: Pt;
  /** Unit vector pointing out over the water. */
  dir: Pt;
  /** Length of dry road leading up to this end. */
  approach: number;
  width: number;
}

/**
 * Find road ends that terminate at the water's edge.
 *
 * After the split clips its seams to land, a road that would have crossed
 * water ends exactly at the shore — those ends are where a bridge can start.
 * Ends that merely stop inland are ignored, as are stubs too short to ramp
 * from.
 */
function findShoreStubs(roads: RoadSegment[], polygons: WaterPolygon[]): ShoreStub[] {
  const stubs: ShoreStub[] = [];

  /** True when water begins within reach of a point, looking along dir. */
  const waterAhead = (x: number, z: number, dx: number, dz: number) => {
    for (let step = 2; step <= SHORE_REACH; step += 3) {
      if (pointInWater(polygons, x + dx * step, z + dz * step)) return true;
    }
    return false;
  };

  for (const seg of roads) {
    const len = segmentLength(seg);
    if (len < MIN_APPROACH) continue;
    const dx = (seg.x2 - seg.x1) / len;
    const dz = (seg.z2 - seg.z1) / len;
    const width = seg.width ?? ARTERIAL_WIDTH;

    if (waterAhead(seg.x2, seg.z2, dx, dz)) {
      stubs.push({ at: { x: seg.x2, z: seg.z2 }, dir: { x: dx, z: dz }, approach: len, width });
    }
    if (waterAhead(seg.x1, seg.z1, -dx, -dz)) {
      stubs.push({ at: { x: seg.x1, z: seg.z1 }, dir: { x: -dx, z: -dz }, approach: len, width });
    }
  }
  return stubs;
}

/**
 * Follow a stub out across the water and report where it would come ashore.
 *
 * Returns null when the far bank is beyond reach, when the ramp would touch
 * down in water, or when the crossing never leaves the water at all.
 */
function probeCrossing(
  stub: ShoreStub,
  polygons: WaterPolygon[],
  maxSpan: number
): { landing: Pt; span: number } | null {
  const reach = maxSpan + BRIDGE_RAMP_LENGTH * 2;
  const ray: RoadSegment = {
    x1: stub.at.x,
    z1: stub.at.z,
    x2: stub.at.x + stub.dir.x * reach,
    z2: stub.at.z + stub.dir.z * reach,
    width: 1,
  };

  const spans = submergedSpans(polygons, ray);
  if (spans.length === 0) return null;

  // The crossing we care about is the one just ahead of the stub, allowing for
  // the setback between the waterfront road and the water itself.
  const first = spans[0];
  if (first.t0 * reach > SHORE_REACH) return null;

  const span = (first.t1 - first.t0) * reach;
  if (span > maxSpan) return null;

  const landing = {
    x: stub.at.x + stub.dir.x * (first.t1 * reach),
    z: stub.at.z + stub.dir.z * (first.t1 * reach),
  };

  // The far ramp has to come down on dry ground.
  const touchdown = {
    x: landing.x + stub.dir.x * BRIDGE_RAMP_LENGTH,
    z: landing.z + stub.dir.z * BRIDGE_RAMP_LENGTH,
  };
  if (pointInWater(polygons, touchdown.x, touchdown.z)) return null;

  return { landing, span };
}

/** True when some road end sits near the landing point. */
function hasRoadNear(roads: RoadSegment[], p: Pt, tolerance: number): boolean {
  const t2 = tolerance * tolerance;
  for (const r of roads) {
    const d1 = (r.x1 - p.x) ** 2 + (r.z1 - p.z) ** 2;
    if (d1 <= t2) return true;
    const d2 = (r.x2 - p.x) ** 2 + (r.z2 - p.z) ** 2;
    if (d2 <= t2) return true;
  }
  return false;
}

/**
 * Choose where to bridge the water.
 *
 * Works from road ends left at the shore by the split, probes each one across
 * the water, and keeps the crossings that reach a far bank within range, come
 * down on dry ground, and land near a road on the other side — so every bridge
 * joins two pieces of the network instead of stranding traffic on a beach.
 *
 * Each crossing is found twice, once from each bank, so near-identical decks
 * are collapsed. Wider approaches are considered first, letting sparse settings
 * favour the arterials.
 *
 * Draws no randomness when there is no water.
 */
export function findBridges(
  roads: RoadSegment[],
  polygons: WaterPolygon[],
  density: OverpassDensity,
  rng: Rng
): OverpassSpec[] {
  if (polygons.length === 0) return [];
  const fraction = DENSITY_FRACTION[density] ?? 0;
  const maxSpan = DENSITY_MAX_SPAN[density] ?? 0;
  if (fraction <= 0 || maxSpan <= 0) return [];

  // Gather every crossing worth making, collapsing the ones found twice.
  const viable: OverpassSpec[] = [];
  const arterial: OverpassSpec[] = [];
  const midpoints: Pt[] = [];

  for (const stub of findShoreStubs(roads, polygons)) {
    const crossing = probeCrossing(stub, polygons, maxSpan);
    if (!crossing) continue;
    if (!hasRoadNear(roads, crossing.landing, LANDING_TOLERANCE)) continue;

    // Collapse the same crossing seen from the opposite bank.
    const mid = {
      x: (stub.at.x + crossing.landing.x) / 2,
      z: (stub.at.z + crossing.landing.z) / 2,
    };
    if (midpoints.some((m) => Math.hypot(m.x - mid.x, m.z - mid.z) < DUPLICATE_RADIUS)) continue;
    midpoints.push(mid);

    // The deck carries its own ramps: the geometry builder raises it over the
    // first and last stretch of arclength, so the path starts back on land.
    const spec: OverpassSpec = {
      points: [
        { x: stub.at.x - stub.dir.x * BRIDGE_RAMP_LENGTH, z: stub.at.z - stub.dir.z * BRIDGE_RAMP_LENGTH },
        { x: crossing.landing.x + stub.dir.x * BRIDGE_RAMP_LENGTH, z: crossing.landing.z + stub.dir.z * BRIDGE_RAMP_LENGTH },
      ],
      height: BRIDGE_HEIGHT,
      width: stub.width,
      ramp_length: BRIDGE_RAMP_LENGTH,
      pillar_spacing: BRIDGE_PILLAR_SPACING,
    };
    (stub.width >= ARTERIAL_WIDTH ? arterial : viable).push(spec);
  }

  // Arterials first so thinning keeps the main crossings, shuffled within each
  // tier so repeat runs of the same map vary.
  const ranked = [...shuffle(arterial, rng), ...shuffle(viable, rng)];
  if (ranked.length === 0) return [];

  const keep = Math.max(1, Math.ceil(ranked.length * fraction));
  const chosen = ranked.slice(0, keep);

  // Level the decks only once the final set is known, so thinning never leaves
  // a gap in the sequence or two survivors sharing a crossing level.
  assignHeights(chosen, rng);

  return chosen;
}

/** Do two deck paths cross in plan? */
function decksCross(a: OverpassSpec, b: OverpassSpec): boolean {
  for (let i = 1; i < a.points.length; i++) {
    for (let j = 1; j < b.points.length; j++) {
      if (segmentsCross(a.points[i - 1], a.points[i], b.points[j - 1], b.points[j])) return true;
    }
  }
  return false;
}

/** Proper segment intersection test on the XZ plane. */
function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const rx = a2.x - a1.x, rz = a2.z - a1.z;
  const sx = b2.x - b1.x, sz = b2.z - b1.z;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return false; // parallel
  const t = ((b1.x - a1.x) * sz - (b1.z - a1.z) * sx) / denom;
  const u = ((b1.x - a1.x) * rz - (b1.z - a1.z) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Give each deck a level, keeping crossing decks apart.
 *
 * Greedy graph colouring: every bridge takes a level none of the bridges it
 * crosses already hold, picked at random from what is left so the skyline
 * varies. With more crossings at a point than there are levels the lowest is
 * reused — geometry that dense is not reachable from the siting rules.
 */
function assignHeights(bridges: OverpassSpec[], rng: Rng): void {
  bridges.forEach((bridge, i) => {
    const taken = new Set<number>();
    for (let j = 0; j < i; j++) {
      if (decksCross(bridge, bridges[j])) taken.add(bridges[j].height);
    }
    const free = BRIDGE_HEIGHTS.filter((h) => !taken.has(h));
    bridge.height = free.length > 0
      ? free[Math.floor(rng() * free.length)]
      : BRIDGE_HEIGHT;
  });
}

/** Fisher-Yates, using the injected source so runs stay reproducible. */
function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
