import type { Block, Bounds, Rng, RoadSegment } from './types';
import { clipSegmentToLand, clipSegmentToBoundary, pointInPolygon, type Polygon, type WaterPolygon } from './water';

/** Widths used for the road laid down at each split. */
const MAIN_ROAD_WIDTH = 6;
const SIDE_ROAD_WIDTH = 3;

/** A block stops subdividing once both dimensions fall under this. */
const MIN_BLOCK_SIZE = 35;

/**
 * Normalize a drag selection into ordered min/max corners.
 * The user can drag in any direction, so min may exceed max on either axis.
 */
export function normalizeBounds(bounds: Bounds) {
  const minX = Math.min(bounds.min.x, bounds.max.x);
  const maxX = Math.max(bounds.min.x, bounds.max.x);
  const minZ = Math.min(bounds.min.z, bounds.max.z);
  const maxZ = Math.max(bounds.min.z, bounds.max.z);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

/**
 * Recursion depth scales with the selection size, so a larger area yields
 * MORE blocks rather than bigger ones.
 */
export function maxSplitDepthFor(width: number, depth: number): number {
  const maxDimension = Math.max(width, depth);
  return Math.max(4, Math.ceil(Math.log2(maxDimension / MIN_BLOCK_SIZE)) + 2);
}

/**
 * Hierarchical binary space partition of the selected area.
 *
 * Each recursion splits the current rectangle along its longer axis, lays a
 * road down the seam (unless excludeRoads is set), and recurses into both
 * halves. Splits are jittered and the seam is kinked at a random midpoint so
 * the result reads as a grown city rather than a grid.
 *
 * Seams are clipped to land as they are laid, so no road is ever built across
 * open water and the grid stops at the shore of its own accord. The random
 * draws are unaffected by clipping, so a dry map splits exactly as before.
 *
 * Returns leaf blocks plus every road segment produced along the way.
 */
export function splitCity(
  bounds: Bounds,
  excludeRoads: boolean,
  rng: Rng,
  water: WaterPolygon[] = [],
  boundary?: Polygon
): { blocks: Block[]; roads: RoadSegment[] } {
  const { minX, maxX, minZ, maxZ, width, depth } = normalizeBounds(bounds);
  const maxSplitDepth = maxSplitDepthFor(width, depth);

  const blocks: Block[] = [];
  const roads: RoadSegment[] = [];

  /** Lay a seam, keeping only the stretches on land and inside any boundary. */
  const layRoad = (seg: RoadSegment) => {
    for (const dry of clipSegmentToLand(seg, water)) {
      roads.push(...clipSegmentToBoundary(dry, boundary));
    }
  };

  const split = (x: number, z: number, w: number, d: number, iter: number) => {
    if (iter > maxSplitDepth || (w < MIN_BLOCK_SIZE && d < MIN_BLOCK_SIZE)) {
      // Blocks centred outside a drawn boundary are dropped. Skipping the push draws
      // no randomness, so the split itself is identical either way.
      if (!boundary || pointInPolygon(boundary, x, z)) blocks.push({ x, z, w, d });
      return;
    }
    const splitV = w > d ? true : (w === d ? rng() > 0.5 : false);
    const roadW = iter < 2 ? MAIN_ROAD_WIDTH : SIDE_ROAD_WIDTH;
    const jitter = (rng() - 0.5) * (iter < 2 ? 10 : 5);

    if (splitV) {
      const ratio = 0.35 + rng() * 0.3;
      const lw = w * ratio;
      const rw = w - lw;
      const rx = x - w / 2 + lw + jitter;
      const midZ = z + (rng() - 0.5) * d * 0.25;
      if (!excludeRoads) {
        const offset = (rng() - 0.5) * 4.5;
        layRoad({ x1: rx, z1: z - d / 2, x2: rx + offset, z2: midZ, width: roadW });
        layRoad({ x1: rx + offset, z1: midZ, x2: rx, z2: z + d / 2, width: roadW });
      }
      split(x - w / 2 + (lw + jitter) / 2, z, lw + jitter, d, iter + 1);
      split(x + w / 2 - (rw - jitter) / 2, z, rw - jitter, d, iter + 1);
    } else {
      const ratio = 0.35 + rng() * 0.3;
      const td = d * ratio;
      const bd = d - td;
      const rz = z - d / 2 + td + jitter;
      const midX = x + (rng() - 0.5) * w * 0.25;
      if (!excludeRoads) {
        const offset = (rng() - 0.5) * 4.5;
        layRoad({ x1: x - w / 2, z1: rz, x2: midX + offset, z2: rz, width: roadW });
        layRoad({ x1: midX + offset, z1: rz, x2: x + w / 2, z2: rz, width: roadW });
      }
      split(x, z - d / 2 + (td + jitter) / 2, w, td + jitter, iter + 1);
      split(x, z + d / 2 - (bd - jitter) / 2, w, bd - jitter, iter + 1);
    }
  };

  split((minX + maxX) / 2, (minZ + maxZ) / 2, width, depth, 0);

  return { blocks, roads };
}
