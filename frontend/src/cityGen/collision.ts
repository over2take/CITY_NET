import * as THREE from 'three';
import type { Obstacle, RoadSegment } from './types';

/** Cell size of the uniform grid used to bucket obstacles. */
const GRID_CELL = 20;

/** Extra clearance kept between a building and the edge of a road. */
const ROAD_MARGIN = 1.2;

/**
 * Uniform spatial hash over the XZ plane.
 *
 * Collision checks only look at the 3x3 cell neighbourhood around a point,
 * which keeps placement O(1) per candidate instead of scanning every existing
 * structure in the city.
 */
export class SpatialGrid {
  /** Bucketed obstacles, keyed by "cellX,cellZ". Exposed for interop with
   *  the building generators, which append their own roots as they place. */
  readonly cells: Record<string, Obstacle[]> = {};

  constructor(obstacles: Obstacle[] = []) {
    obstacles.forEach((o) => this.add(o));
  }

  /** Grid key for a world position. Arrow property so it can be passed bare. */
  key = (x: number, z: number): string =>
    `${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`;

  add = (o: Obstacle): void => {
    const k = this.key(o.x, o.z);
    if (!this.cells[k]) this.cells[k] = [];
    this.cells[k].push(o);
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

/** True when the footprint overlaps an existing obstacle, with padding. */
function overlapsObstacle(
  grid: SpatialGrid,
  x: number,
  z: number,
  w: number,
  d: number,
  buffer: number
): boolean {
  for (const key of grid.neighborKeys(x, z)) {
    const cell = grid.cells[key];
    if (!cell) continue;
    const hit = cell.some((o) => {
      const xOverlap = Math.abs(o.x - x) < (o.width + w) / 2 + buffer;
      const zOverlap = Math.abs(o.z - z) < (o.depth + d) / 2 + buffer;
      return xOverlap && zOverlap;
    });
    if (hit) return true;
  }
  return false;
}

/** True when the footprint sits on or too near any road. */
function overlapsRoad(
  roads: RoadSegment[],
  x: number,
  z: number,
  w: number,
  d: number
): boolean {
  const point = new THREE.Vector3(x, 0, z);
  const closest = new THREE.Vector3();
  for (const r of roads) {
    const line = new THREE.Line3(
      new THREE.Vector3(r.x1, 0, r.z1),
      new THREE.Vector3(r.x2, 0, r.z2)
    );
    line.closestPointToPoint(point, true, closest);
    const roadW = r.width ?? 0;
    const halfW = w / 2 + roadW / 2 + ROAD_MARGIN;
    const halfD = d / 2 + roadW / 2 + ROAD_MARGIN;
    if (Math.abs(closest.x - x) < halfW && Math.abs(closest.z - z) < halfD) {
      return true;
    }
  }
  return false;
}

/**
 * Build the placement test used throughout generation: a footprint is blocked
 * when it collides with an existing structure or lands on a road.
 *
 * Road checks are skipped entirely when roads aren't part of this generation.
 */
export function createIsBlocked(
  grid: SpatialGrid,
  roads: RoadSegment[],
  checkRoads: boolean
): IsBlocked {
  return (x, z, w, d, buffer = 2) => {
    if (overlapsObstacle(grid, x, z, w, d, buffer)) return true;
    if (checkRoads && overlapsRoad(roads, x, z, w, d)) return true;
    return false;
  };
}
