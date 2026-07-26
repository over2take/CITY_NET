import { chainRoadPolylines } from '../utils/roadHelpers';
import type { RoadSegment, Rng } from './types';
import {
  type WaterPolygon,
  submergedSpans,
  pointInWater,
} from './water';

/** How freely generated roads bridge the water they meet. */
export type OverpassDensity = 'off' | 'sparse' | 'normal' | 'heavy';

/** Fraction of eligible crossings that actually get a span. */
const DENSITY_FRACTION: Record<OverpassDensity, number> = {
  off: 0,
  sparse: 0.3,
  normal: 0.6,
  heavy: 1.0,
};

/**
 * Widest stretch of water each setting will bridge. Heavier settings reach
 * further as well as more often, so the control reads as one dial: anything
 * beyond the cap is a lake, and the road stops at the shore.
 */
const DENSITY_MAX_SPAN: Record<OverpassDensity, number> = {
  off: 0,
  sparse: 90,
  normal: 160,
  heavy: 260,
};

/** Widest crossing any setting will bridge. */
export const MAX_BRIDGE_SPAN = DENSITY_MAX_SPAN.heavy;

/** Roads at least this wide count as arterials and bridge more readily. */
const ARTERIAL_WIDTH = 6;

/** Horizontal run each ramp needs at either end of a span. */
export const BRIDGE_RAMP_LENGTH = 20;

/** Deck elevation of a generated bridge. */
const BRIDGE_HEIGHT = 8;

/** Spacing of the pillars carrying the deck. */
const BRIDGE_PILLAR_SPACING = 12;

/** An overpass ready to POST to /api/overpasses. */
export interface OverpassSpec {
  points: { x: number; z: number }[];
  height: number;
  width: number;
  ramp_length: number;
  pillar_spacing: number;
}

export interface WaterRoadResult {
  /** Road segments with every submerged stretch removed. */
  roads: RoadSegment[];
  /** Bridges spanning the crossings that qualified. */
  overpasses: OverpassSpec[];
}

type Pt = { x: number; z: number };

/** Cumulative arclength at each point of a polyline. */
function cumulative(points: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  return cum;
}

/**
 * Position at a given arclength along a polyline.
 *
 * Distances before the start or past the end extrapolate along the end
 * direction, so a ramp can run onto the open ground beyond a road's last
 * junction instead of being refused for want of pavement.
 */
function posAt(points: Pt[], cum: number[], s: number): Pt {
  const total = cum[cum.length - 1];
  if (s <= 0) {
    const [a, b] = [points[0], points[1] ?? points[0]];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: a.x + ((a.x - b.x) / len) * -s, z: a.z + ((a.z - b.z) / len) * -s };
  }
  if (s >= total) {
    const n = points.length;
    const [a, b] = [points[n - 2] ?? points[n - 1], points[n - 1]];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const over = s - total;
    return { x: b.x + ((b.x - a.x) / len) * over, z: b.z + ((b.z - a.z) / len) * over };
  }
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const segLen = Math.max(cum[i] - cum[i - 1], 1e-9);
  const t = (s - cum[i - 1]) / segLen;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
    z: points[i - 1].z + (points[i].z - points[i - 1].z) * t,
  };
}

/** The stretch of a polyline between two arclengths, as its own point list. */
function slice(points: Pt[], cum: number[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [posAt(points, cum, s0)];
  for (let i = 0; i < points.length; i++) {
    if (cum[i] > s0 && cum[i] < s1) out.push(points[i]);
  }
  out.push(posAt(points, cum, s1));
  return out;
}

/** Consecutive points of a polyline as road segments. */
function toSegments(points: Pt[], width: number): RoadSegment[] {
  const segs: RoadSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) continue;
    segs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, width });
  }
  return segs;
}

/** Water gaps along a whole street, in arclength. */
function waterGaps(points: Pt[], cum: number[], polygons: WaterPolygon[]) {
  const gaps: { s0: number; s1: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = cum[i + 1] - cum[i];
    if (segLen < 1e-9) continue;
    const seg = { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
    for (const span of submergedSpans(polygons, seg)) {
      const s0 = cum[i] + span.t0 * segLen;
      const s1 = cum[i] + span.t1 * segLen;
      // Stitch onto the previous gap when this one continues it across a bend.
      const last = gaps[gaps.length - 1];
      if (last && s0 - last.s1 < 1e-6) last.s1 = s1;
      else gaps.push({ s0, s1 });
    }
  }
  return gaps;
}

/**
 * Build the bridge deck for one water gap.
 *
 * The path includes the ramp runs, because the geometry builder raises the
 * deck over the first and last stretch of arclength. Returns null when either
 * touchdown would land in water — a spit too narrow to come down on.
 */
function buildBridge(
  points: Pt[],
  cum: number[],
  gap: { s0: number; s1: number },
  width: number,
  polygons: WaterPolygon[]
): OverpassSpec | null {
  const start = posAt(points, cum, gap.s0 - BRIDGE_RAMP_LENGTH);
  const end = posAt(points, cum, gap.s1 + BRIDGE_RAMP_LENGTH);

  if (pointInWater(polygons, start.x, start.z)) return null;
  if (pointInWater(polygons, end.x, end.z)) return null;

  // Follow the street's own shape across, so a bridge on a bend curves with it.
  const deck = [start, ...slice(points, cum, gap.s0, gap.s1).slice(1, -1), end];

  return {
    points: deck,
    height: BRIDGE_HEIGHT,
    width,
    ramp_length: BRIDGE_RAMP_LENGTH,
    pillar_spacing: BRIDGE_PILLAR_SPACING,
  };
}

/**
 * Take generated roads through water.
 *
 * Segments are first chained into whole streets, because the BSP split leaves
 * roads as ~35-unit pieces and a piece that crosses water usually begins in it
 * — judged individually, no crossing would ever have dry road to ramp from.
 *
 * Each street then has its submerged stretches cut out, leaving waterfront
 * stubs, and narrow enough gaps may be carried by a bridge. Arterials bridge at
 * twice the rate of side streets, so sparse settings favour the main network.
 *
 * With no water bodies this is a pass-through that draws no randomness.
 */
export function applyWaterToRoads(
  roads: RoadSegment[],
  polygons: WaterPolygon[],
  density: OverpassDensity,
  rng: Rng
): WaterRoadResult {
  if (polygons.length === 0) return { roads, overpasses: [] };

  const fraction = DENSITY_FRACTION[density] ?? 0;
  const maxSpan = DENSITY_MAX_SPAN[density] ?? 0;
  const outRoads: RoadSegment[] = [];
  const overpasses: OverpassSpec[] = [];

  for (const chain of chainRoadPolylines(roads)) {
    const points = chain.points;
    if (points.length < 2) continue;
    const cum = cumulative(points);
    const total = cum[cum.length - 1];
    if (total < 1e-6) continue;

    const gaps = waterGaps(points, cum, polygons);
    if (gaps.length === 0) {
      outRoads.push(...toSegments(points, chain.width));
      continue;
    }

    // Keep the dry stretches between (and either side of) the water.
    let cursor = 0;
    for (const gap of gaps) {
      if (gap.s0 - cursor > 1e-6) {
        outRoads.push(...toSegments(slice(points, cum, cursor, gap.s0), chain.width));
      }
      cursor = gap.s1;
    }
    if (total - cursor > 1e-6) {
      outRoads.push(...toSegments(slice(points, cum, cursor, total), chain.width));
    }

    // Consider each crossing for a bridge.
    for (const gap of gaps) {
      if (gap.s1 - gap.s0 > maxSpan) continue;

      // One draw per eligible crossing, so density changes don't reorder the
      // rest of the sequence.
      const roll = rng();
      const isArterial = chain.width >= ARTERIAL_WIDTH;
      const chance = isArterial ? fraction : fraction / 2;
      if (roll >= chance) continue;

      const bridge = buildBridge(points, cum, gap, chain.width, polygons);
      if (bridge) overpasses.push(bridge);
    }
  }

  return { roads: outRoads, overpasses };
}
