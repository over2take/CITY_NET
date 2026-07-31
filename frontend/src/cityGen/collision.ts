import type { Obstacle, RoadSegment } from './types';
import { footprintInWater, footprintOutsidePolygon, type WaterPolygon } from './water';

/** Cell size of the uniform grid used to bucket obstacles. */
const GRID_CELL = 20;

/** Extra clearance kept between a building and the edge of a road. */
const ROAD_MARGIN = 1.2;

/**
 * An obstacle spanning more than this many cells on either axis is held in a
 * separate always-checked list rather than written into every cell it covers,
 * so one pathological footprint can't balloon the grid.
 */
const MAX_SPAN_CELLS = 16;

/**
 * Uniform spatial hash over the XZ plane.
 *
 * Collision checks only look at the 3x3 cell neighbourhood around a point,
 * which keeps placement O(1) per candidate instead of scanning every existing
 * structure in the city.
 *
 * An obstacle is registered in every cell its footprint covers, not just the
 * one holding its centre — otherwise a structure wider than a cell would only
 * be detected near its middle and buildings would spawn inside its edges.
 */
export class SpatialGrid {
  /** Bucketed obstacles, keyed by "cellX,cellZ". Exposed for interop with
   *  the building generators, which append their own roots as they place. */
  readonly cells: Record<string, Obstacle[]> = {};

  /** Footprints too large to bucket sanely; tested on every query. */
  readonly oversized: Obstacle[] = [];

  constructor(obstacles: Obstacle[] = []) {
    obstacles.forEach((o) => this.add(o));
  }

  /** Grid key for a world position. Arrow property so it can be passed bare. */
  key = (x: number, z: number): string =>
    `${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`;

  add = (o: Obstacle): void => {
    // Malformed rows (missing width/depth) collapse to a point, which keeps
    // them in a single cell exactly as they were before footprint spanning.
    const halfW = (Number(o.width) || 0) / 2;
    const halfD = (Number(o.depth) || 0) / 2;
    const minCX = Math.floor((o.x - halfW) / GRID_CELL);
    const maxCX = Math.floor((o.x + halfW) / GRID_CELL);
    const minCZ = Math.floor((o.z - halfD) / GRID_CELL);
    const maxCZ = Math.floor((o.z + halfD) / GRID_CELL);

    if (maxCX - minCX > MAX_SPAN_CELLS || maxCZ - minCZ > MAX_SPAN_CELLS) {
      this.oversized.push(o);
      return;
    }

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const k = `${cx},${cz}`;
        if (!this.cells[k]) this.cells[k] = [];
        this.cells[k].push(o);
      }
    }
  };

  /** Keys of the cell containing (x, z) plus its eight neighbours. */
  neighborKeys(x: number, z: number): string[] {
    const keys = [this.key(x, z)];
    const cx = Math.floor(x / GRID_CELL);
    const cz = Math.floor(z / GRID_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        keys.push(`${cx + dx},${cz + dz}`);
      }
    }
    return keys;
  }
}

export type IsBlocked = (
  x: number,
  z: number,
  w: number,
  d: number,
  buffer?: number
) => boolean;

/** Padded AABB intersection between a candidate footprint and an obstacle. */
function intersects(
  o: Obstacle,
  x: number,
  z: number,
  w: number,
  d: number,
  buffer: number
): boolean {
  const xOverlap = Math.abs(o.x - x) < (o.width + w) / 2 + buffer;
  const zOverlap = Math.abs(o.z - z) < (o.depth + d) / 2 + buffer;
  return xOverlap && zOverlap;
}

/** True when the footprint overlaps an existing obstacle, with padding. */
function overlapsObstacle(
  grid: SpatialGrid,
  x: number,
  z: number,
  w: number,
  d: number,
  buffer: number
): boolean {
  if (grid.oversized.some((o) => intersects(o, x, z, w, d, buffer))) return true;

  for (const key of grid.neighborKeys(x, z)) {
    const cell = grid.cells[key];
    if (!cell) continue;
    const hit = cell.some((o) => intersects(o, x, z, w, d, buffer));
    if (hit) return true;
  }
  return false;
}

/**
 * Segment against axis-aligned box, by the slab method.
 *
 * Comparing a road's nearest point to a building's centre is not the same
 * test: a road can clip a corner while its closest approach to the centre
 * still reads as clear, which is how buildings ended up sitting on pavement.
 * Clipping the segment against the box answers the question directly.
 */
function segmentHitsBox(
  x1: number, z1: number, x2: number, z2: number,
  minX: number, minZ: number, maxX: number, maxZ: number
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  let t0 = 0;
  let t1 = 1;

  const edges: [number, number][] = [
    [-dx, x1 - minX],
    [dx, maxX - x1],
    [-dz, z1 - minZ],
    [dz, maxZ - z1],
  ];

  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false; // parallel to this slab and outside it
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/**
 * True when the footprint sits on or too near any road.
 *
 * Exported so a finished plot can be re-checked: the themed generators place
 * most of a structure relative to a cleared root without testing each piece,
 * so wings and annexes can still end up over pavement.
 */
export function footprintOnRoad(
  roads: RoadSegment[],
  x: number,
  z: number,
  w: number,
  d: number
): boolean {
  for (const r of roads) {
    // Grow the footprint by the road's half-width plus clearance, so the road
    // can be treated as a bare centreline.
    const pad = (r.width ?? 0) / 2 + ROAD_MARGIN;
    const halfW = w / 2 + pad;
    const halfD = d / 2 + pad;
    if (segmentHitsBox(
      r.x1, r.z1, r.x2, r.z2,
      x - halfW, z - halfD, x + halfW, z + halfD
    )) {
      return true;
    }
  }
  return false;
}

/**
 * Build the placement test used throughout generation: a footprint is blocked
 * when it collides with an existing structure, lands on a road, or sits in
 * water.
 *
 * Road checks are skipped entirely when roads aren't part of this generation.
 * Passing no water polygons skips that check at zero cost.
 */
export function createIsBlocked(
  grid: SpatialGrid,
  roads: RoadSegment[],
  checkRoads: boolean,
  water: WaterPolygon[] = [],
  boundary?: WaterPolygon
): IsBlocked {
  return (x, z, w, d, buffer = 2) => {
    if (overlapsObstacle(grid, x, z, w, d, buffer)) return true;
    if (checkRoads && footprintOnRoad(roads, x, z, w, d)) return true;
    if (water.length > 0 && footprintInWater(water, x, z, w, d)) return true;
    // A drawn boundary is water with the sign flipped: reject what falls outside it.
    // This is what lets a block straddling the edge build only on its inside.
    if (boundary && footprintOutsidePolygon(boundary, x, z, w, d)) return true;
    return false;
  };
}
