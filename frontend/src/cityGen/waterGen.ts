import type { Bounds, Rng } from './types';
import { normalizeBounds } from './bsp';
import type { Polygon } from './water';

/**
 * Generated water.
 *
 * Rivers and coastlines are most of why real cities look like themselves: they force
 * asymmetry, cut districts apart, and give bridges a reason to exist. Until now the
 * bridge siting only ever fired if a GM happened to draw water first.
 *
 * Everything here produces a polygon and hands it to machinery that already exists —
 * `parseWaterBodies`, `footprintInWater`, the water-aware split, shoreline roads and
 * bridge siting all consume water polygons and are all tested. That is why this is a
 * small addition rather than a large one.
 *
 * **Ordering matters.** These run *before* the split, so the road grid stops at the
 * banks of its own accord and bridges get sited. Generating water afterwards would
 * mean cutting finished roads, which is a different and worse problem. Park ponds are
 * the opposite case and belong after the split — see `parks`.
 */

export type WaterType = 'NONE' | 'RIVER' | 'COAST' | 'LAKE';

/** River width as a fraction of the smaller span. */
const RIVER_WIDTH = 0.1;
const RIVER_WIDTH_VARIANCE = 0.45;

/** Samples along a river's course. More reads smoother, at more points. */
const RIVER_STEPS = 14;

/** How far a river wanders off a straight line, as a fraction of the span. */
const RIVER_MEANDER = 0.18;

/** Fraction of the region a coastline cuts off, and how much its edge wanders. */
const COAST_MIN = 0.18;
const COAST_MAX = 0.38;
const COAST_WANDER = 0.12;
const COAST_STEPS = 12;

/** Lake radius as a fraction of the smaller span, and how lumpy its edge is. */
const LAKE_MIN = 0.14;
const LAKE_MAX = 0.26;
const LAKE_LOBES = 16;
const LAKE_JITTER = 0.3;

/**
 * A river crossing the region.
 *
 * Sampled as a gently meandering centreline, then offset either side by a varying
 * width and closed into a loop. Width varies along the course so it does not read as
 * an extruded line.
 */
function river(bounds: Bounds, rng: Rng): Polygon {
  const { minX, minZ, width, depth, centerX, centerZ } = normalizeBounds(bounds);
  const span = Math.min(width, depth);
  const baseWidth = span * RIVER_WIDTH;

  // Runs across the shorter axis, so it always divides the city rather than clipping
  // a corner.
  const horizontal = width >= depth;
  const meander = span * RIVER_MEANDER;
  const phase = rng() * Math.PI * 2;
  const swing = 1 + rng() * 1.5;

  const left: { x: number; z: number }[] = [];
  const right: { x: number; z: number }[] = [];

  for (let i = 0; i <= RIVER_STEPS; i++) {
    const t = i / RIVER_STEPS;
    const wander = Math.sin(phase + t * Math.PI * swing) * meander;
    const halfWidth = (baseWidth * (1 + (rng() - 0.5) * RIVER_WIDTH_VARIANCE)) / 2;

    if (horizontal) {
      const x = minX + width * t;
      const z = centerZ + wander;
      left.push({ x, z: z - halfWidth });
      right.push({ x, z: z + halfWidth });
    } else {
      const z = minZ + depth * t;
      const x = centerX + wander;
      left.push({ x: x - halfWidth, z });
      right.push({ x: x + halfWidth, z });
    }
  }

  // Down one bank and back up the other.
  return { points: [...left, ...right.reverse()] };
}

/**
 * A coastline cutting one edge off the region, water on the far side.
 *
 * Gives the city a waterfront and a hard edge to build against, which is a different
 * shape of constraint from a river dividing it.
 */
function coast(bounds: Bounds, rng: Rng): Polygon {
  const { minX, maxX, minZ, maxZ, width, depth } = normalizeBounds(bounds);

  // Which edge the sea lies beyond.
  const side = Math.floor(rng() * 4);
  const cut = COAST_MIN + rng() * (COAST_MAX - COAST_MIN);
  const wander = Math.min(width, depth) * COAST_WANDER;
  const phase = rng() * Math.PI * 2;

  const shore: { x: number; z: number }[] = [];
  for (let i = 0; i <= COAST_STEPS; i++) {
    const t = i / COAST_STEPS;
    const drift = Math.sin(phase + t * Math.PI * 2) * wander;
    if (side === 0) shore.push({ x: minX + width * t, z: minZ + depth * cut + drift });
    else if (side === 1) shore.push({ x: minX + width * t, z: maxZ - depth * cut + drift });
    else if (side === 2) shore.push({ x: minX + width * cut + drift, z: minZ + depth * t });
    else shore.push({ x: maxX - width * cut + drift, z: minZ + depth * t });
  }

  // Close the polygon around the corners on the seaward side. Reaching past the
  // bounds keeps the water solid to the edge rather than stopping short of it.
  const over = Math.min(width, depth);
  if (side === 0) return { points: [...shore, { x: maxX, z: minZ - over }, { x: minX, z: minZ - over }] };
  if (side === 1) return { points: [...shore, { x: maxX, z: maxZ + over }, { x: minX, z: maxZ + over }] };
  if (side === 2) return { points: [...shore, { x: minX - over, z: maxZ }, { x: minX - over, z: minZ }] };
  return { points: [...shore, { x: maxX + over, z: maxZ }, { x: maxX + over, z: minZ }] };
}

/** A lake somewhere inside the region — an obstacle rather than a structuring feature. */
function lake(bounds: Bounds, rng: Rng): Polygon {
  const { width, depth, centerX, centerZ } = normalizeBounds(bounds);
  const span = Math.min(width, depth);
  const radius = span * (LAKE_MIN + rng() * (LAKE_MAX - LAKE_MIN));

  // Offset from centre so it does not always sit in the middle of the city.
  const cx = centerX + (rng() - 0.5) * (width / 2 - radius * 2);
  const cz = centerZ + (rng() - 0.5) * (depth / 2 - radius * 2);

  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < LAKE_LOBES; i++) {
    const a = (i / LAKE_LOBES) * Math.PI * 2;
    const r = radius * (1 + (rng() - 0.5) * LAKE_JITTER);
    points.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return { points };
}

/**
 * Water for a generation run, or nothing.
 *
 * `NONE` is the default because generation has never produced water before —
 * defaulting to a river would put one through the city of everyone already using the
 * button.
 */
export function generateWater(type: WaterType, bounds: Bounds, rng: Rng): Polygon[] {
  if (type === 'RIVER') return [river(bounds, rng)];
  if (type === 'COAST') return [coast(bounds, rng)];
  if (type === 'LAKE') return [lake(bounds, rng)];
  return [];
}
