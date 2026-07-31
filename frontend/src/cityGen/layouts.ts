import type { Block, Bounds, Rng, RoadSegment } from './types';
import { normalizeBounds, splitCity } from './bsp';
import { clipSegmentToLand, clipSegmentToBoundary, pointInPolygon, type Polygon, type WaterPolygon } from './water';

/**
 * Street layouts.
 *
 * Everything downstream of `Block[]` — zoning, parks, landmarks, bridges — is
 * layout-agnostic, so a layout only has to produce blocks and the roads between them.
 * That is the whole extension point.
 */
export type LayoutFn = (
  bounds: Bounds,
  excludeRoads: boolean,
  rng: Rng,
  water?: WaterPolygon[],
  boundary?: Polygon
) => { blocks: Block[]; roads: RoadSegment[] };

export type LayoutType = 'BSP' | 'GRID' | 'SUPERBLOCK';

/** Target block size for the regular grid, before jitter. */
const GRID_CELL = 55;

/** Every nth street in each direction is an avenue rather than a side street. */
const AVENUE_EVERY = 4;

const GRID_AVENUE_WIDTH = 6;
const GRID_STREET_WIDTH = 3;

/** How far a grid line may wander, as a fraction of the cell. Keeps it hand-drawn. */
const GRID_JITTER = 0.12;

/** Minimum block size for the superblock layout — roughly 3x the BSP default. */
const SUPERBLOCK_MIN_SIZE = 110;

/**
 * Evenly spaced cut positions across a span, jittered so the result reads as a surveyed
 * grid rather than a machine one. The outer edges stay put, since they are the boundary
 * of the generated area and should not wobble.
 */
function gridLines(min: number, span: number, rng: Rng): number[] {
  const count = Math.max(1, Math.round(span / GRID_CELL));
  const cell = span / count;
  const lines: number[] = [];
  for (let i = 0; i <= count; i++) {
    const base = min + i * cell;
    const edge = i === 0 || i === count;
    lines.push(edge ? base : base + (rng() - 0.5) * cell * GRID_JITTER * 2);
  }
  return lines;
}

/**
 * Regular street grid — Manhattan, Chicago, any planned city.
 *
 * Distinct from the BSP, which always produces *irregular* rectangles however it is
 * tuned. Avenues every few blocks give the network a hierarchy rather than a uniform
 * mesh, which is most of what makes a grid read as designed rather than generated.
 */
export const gridLayout: LayoutFn = (bounds, excludeRoads, rng, water = [], boundary) => {
  const { minX, minZ, width, depth } = normalizeBounds(bounds);

  const xs = gridLines(minX, width, rng);
  const zs = gridLines(minZ, depth, rng);

  const blocks: Block[] = [];
  const roads: RoadSegment[] = [];

  const layRoad = (seg: RoadSegment) => {
    if (excludeRoads) return;
    for (const dry of clipSegmentToLand(seg, water)) {
      roads.push(...clipSegmentToBoundary(dry, boundary));
    }
  };

  const widthAt = (i: number, count: number) =>
    i === 0 || i === count || i % AVENUE_EVERY === 0 ? GRID_AVENUE_WIDTH : GRID_STREET_WIDTH;

  for (let i = 0; i < xs.length; i++) {
    layRoad({ x1: xs[i], z1: zs[0], x2: xs[i], z2: zs[zs.length - 1], width: widthAt(i, xs.length - 1) });
  }
  for (let j = 0; j < zs.length; j++) {
    layRoad({ x1: xs[0], z1: zs[j], x2: xs[xs.length - 1], z2: zs[j], width: widthAt(j, zs.length - 1) });
  }

  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      // Blocks centred outside a drawn boundary are dropped, matching the BSP.
      if (boundary && !pointInPolygon(boundary, cx, cz)) continue;
      blocks.push({
        x: cx,
        z: cz,
        w: Math.max(1, xs[i + 1] - xs[i] - GRID_STREET_WIDTH),
        d: Math.max(1, zs[j + 1] - zs[j] - GRID_STREET_WIDTH),
      });
    }
  }

  return { blocks, roads };
};

/**
 * Tower in park — Soviet microdistrict, corporate arcology.
 *
 * The same recursive split with a much larger floor, so it stops subdividing while the
 * blocks are still big. Fewer roads, larger plots, more open ground between them.
 */
export const superblockLayout: LayoutFn = (bounds, excludeRoads, rng, water = [], boundary) =>
  splitCity(bounds, excludeRoads, rng, water, boundary, SUPERBLOCK_MIN_SIZE);

/** Today's layout: irregular blocks from a hierarchical binary split. */
export const bspLayout: LayoutFn = (bounds, excludeRoads, rng, water = [], boundary) =>
  splitCity(bounds, excludeRoads, rng, water, boundary);

export const LAYOUTS: Record<LayoutType, LayoutFn> = {
  BSP: bspLayout,
  GRID: gridLayout,
  SUPERBLOCK: superblockLayout,
};

export { GRID_CELL, SUPERBLOCK_MIN_SIZE, AVENUE_EVERY, GRID_AVENUE_WIDTH, GRID_STREET_WIDTH };
