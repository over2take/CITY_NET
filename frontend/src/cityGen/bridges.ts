import type { RoadSegment, Rng } from './types';
import {
  type WaterPolygon,
  submergedSpans,
  pointAt,
  segmentLength,
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
 * Widest stretch of water a generated road will bridge. Anything broader reads
 * as a lake rather than a channel, and the road stops at the shore instead.
 */
export const MAX_BRIDGE_SPAN = 120;

/** Roads at least this wide count as arterials and bridge more readily. */
const ARTERIAL_WIDTH = 6;

/** Horizontal run each ramp needs on dry land at either end of a span. */
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

/**
 * Build the bridge deck path for a crossing.
 *
 * The path has to include the ramp runs, because the geometry builder raises
 * the deck over the first and last `rampLength` of arclength. So it starts on
 * dry land short of the near shore and ends on dry land past the far one.
 *
 * Returns null when either ramp would touch down in water — a spit too narrow
 * to land on means this crossing can't carry a bridge.
 */
function buildBridge(
  seg: RoadSegment,
  t0: number,
  t1: number,
  polygons: WaterPolygon[]
): OverpassSpec | null {
  const len = segmentLength(seg);
  if (len < 1e-6) return null;

  const dirX = (seg.x2 - seg.x1) / len;
  const dirZ = (seg.z2 - seg.z1) / len;

  const entry = pointAt(seg, t0);
  const exit = pointAt(seg, t1);

  const start = {
    x: entry.x - dirX * BRIDGE_RAMP_LENGTH,
    z: entry.z - dirZ * BRIDGE_RAMP_LENGTH,
  };
  const end = {
    x: exit.x + dirX * BRIDGE_RAMP_LENGTH,
    z: exit.z + dirZ * BRIDGE_RAMP_LENGTH,
  };

  // Both touchdown points must be on dry land.
  if (pointInWater(polygons, start.x, start.z)) return null;
  if (pointInWater(polygons, end.x, end.z)) return null;

  return {
    points: [start, end],
    height: BRIDGE_HEIGHT,
    width: seg.width ?? ARTERIAL_WIDTH,
    ramp_length: BRIDGE_RAMP_LENGTH,
    pillar_spacing: BRIDGE_PILLAR_SPACING,
  };
}

/**
 * Take generated roads through water.
 *
 * Every submerged stretch is cut out of its road, leaving the dry approaches
 * as waterfront stubs. A stretch narrow enough to bridge may then get a span
 * laid over it, subject to the density setting — arterials are twice as likely
 * to be bridged as side streets, so sparse settings favour the main network.
 *
 * With no water bodies this is a pass-through.
 */
export function applyWaterToRoads(
  roads: RoadSegment[],
  polygons: WaterPolygon[],
  density: OverpassDensity,
  rng: Rng
): WaterRoadResult {
  if (polygons.length === 0) return { roads, overpasses: [] };

  const fraction = DENSITY_FRACTION[density] ?? 0;
  const outRoads: RoadSegment[] = [];
  const overpasses: OverpassSpec[] = [];

  for (const seg of roads) {
    const spans = submergedSpans(polygons, seg);
    if (spans.length === 0) {
      outRoads.push(seg);
      continue;
    }

    const len = segmentLength(seg);

    // Keep the dry stretches between (and either side of) the water.
    let cursor = 0;
    for (const span of spans) {
      if (span.t0 - cursor > 1e-6) {
        const a = pointAt(seg, cursor);
        const b = pointAt(seg, span.t0);
        outRoads.push({ ...seg, x1: a.x, z1: a.z, x2: b.x, z2: b.z });
      }
      cursor = span.t1;
    }
    if (1 - cursor > 1e-6) {
      const a = pointAt(seg, cursor);
      outRoads.push({ ...seg, x1: a.x, z1: a.z, x2: seg.x2, z2: seg.z2 });
    }

    // Consider each crossing for a bridge.
    for (const span of spans) {
      const spanLength = (span.t1 - span.t0) * len;
      if (spanLength > MAX_BRIDGE_SPAN) continue;

      // One draw per eligible crossing, so density changes don't reorder the
      // rest of the sequence.
      const roll = rng();
      const isArterial = (seg.width ?? 0) >= ARTERIAL_WIDTH;
      const chance = isArterial ? fraction : fraction / 2;
      if (roll >= chance) continue;

      const bridge = buildBridge(seg, span.t0, span.t1, polygons);
      if (bridge) overpasses.push(bridge);
    }
  }

  return { roads: outRoads, overpasses };
}
