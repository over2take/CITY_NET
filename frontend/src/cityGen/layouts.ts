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

export type LayoutType = 'BSP' | 'GRID' | 'SUPERBLOCK' | 'RING';

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

/** Concentric loops, as San Antonio has 410 and 1604. */
const RING_COUNT = 2;

/** Arterials converging on the centre. */
const SPOKE_COUNT = 6;

/**
 * Ring radii grow faster than linearly, so the inner loop sits tight around downtown
 * and outer ones sweep wide — which is what beltways actually do.
 */
const RING_FALLOFF = 1.35;

const RING_ROAD_WIDTH = 8;
const SPOKE_ROAD_WIDTH = 7;

/** Degrees between sampled points on a ring. Smaller reads rounder, at more segments. */
const ARC_STEP_DEG = 9;

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


/** Points along an arc, inclusive of both ends. */
function arcPoints(cx: number, cz: number, r: number, a0: number, a1: number) {
  const step = (ARC_STEP_DEG * Math.PI) / 180;
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return pts;
}

/** Bounding box of a polygon, for handing to a sub-layout. */
function polyBounds(points: { x: number; z: number }[]): Bounds {
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  return {
    min: { x: Math.min(...xs), z: Math.min(...zs) },
    max: { x: Math.max(...xs), z: Math.max(...zs) },
  };
}

/**
 * Beltway city — concentric ring roads with radial spokes converging on the centre.
 * San Antonio, with its 410 and 1604 loops, is the reference.
 *
 * The important observation is that a beltway city is not made of annular *blocks*.
 * Between the loops sit perfectly ordinary streets; only the arterial network is
 * radial. So this lays the rings and spokes, then runs an existing layout inside each
 * region between them, passing that region as a boundary.
 *
 * That means it is almost entirely composition: `LayoutFn` calling `LayoutFn`, using
 * the same boundary confinement drawn bounds introduced. It needs no polygonal blocks,
 * because the sub-layout keeps producing rectangles and the boundary clips them
 * against the curve.
 *
 * The corners of a rectangular selection are left empty on purpose — a ring city is
 * round, and filling the corners would defeat the shape.
 */
export const ringLayout: LayoutFn = (bounds, excludeRoads, rng, water = [], boundary) => {
  const { centerX, centerZ, width, depth } = normalizeBounds(bounds);
  const maxR = Math.min(width, depth) / 2;

  const blocks: Block[] = [];
  const roads: RoadSegment[] = [];

  const layRoad = (seg: RoadSegment) => {
    if (excludeRoads) return;
    for (const dry of clipSegmentToLand(seg, water)) {
      roads.push(...clipSegmentToBoundary(dry, boundary));
    }
  };

  const layPolyline = (pts: { x: number; z: number }[], w: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      layRoad({ x1: pts[i].x, z1: pts[i].z, x2: pts[i + 1].x, z2: pts[i + 1].z, width: w });
    }
  };

  // Radii grow faster than linearly, so downtown is ringed tightly and the outer loop
  // sweeps wide.
  const radii: number[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    radii.push(maxR * Math.pow((i + 1) / RING_COUNT, RING_FALLOFF));
  }

  for (const r of radii) {
    layPolyline(arcPoints(centerX, centerZ, r, 0, Math.PI * 2), RING_ROAD_WIDTH);
  }

  // Spokes are jittered off the even division so the network does not read as a
  // wheel diagram.
  const spokeAngles: number[] = [];
  const sector = (Math.PI * 2) / SPOKE_COUNT;
  for (let i = 0; i < SPOKE_COUNT; i++) {
    spokeAngles.push(i * sector + (rng() - 0.5) * sector * 0.2);
  }
  spokeAngles.sort((a, b) => a - b);

  for (const a of spokeAngles) {
    layRoad({
      x1: centerX, z1: centerZ,
      x2: centerX + Math.cos(a) * maxR,
      z2: centerZ + Math.sin(a) * maxR,
      width: SPOKE_ROAD_WIDTH,
    });
  }

  /** Run a sub-layout inside one region and fold its output in. */
  const fillRegion = (poly: { x: number; z: number }[], sub: LayoutFn) => {
    if (poly.length < 3) return;
    const region: Polygon = { points: poly };
    const result = sub(polyBounds(poly), excludeRoads, rng, water, region);
    // The sub-layout was confined to its region, which says nothing about any outer
    // drawn boundary — so both blocks and roads are filtered against that too, or RING
    // would spill outside a traced area.
    for (const b of result.blocks) {
      if (boundary && !pointInPolygon(boundary, b.x, b.z)) continue;
      blocks.push(b);
    }
    for (const r of result.roads) roads.push(...clipSegmentToBoundary(r, boundary));
  };

  // Downtown, inside the innermost loop: a grid, as most beltway cities have.
  fillRegion(arcPoints(centerX, centerZ, radii[0], 0, Math.PI * 2), gridLayout);

  // Everything outside it: annular sectors between consecutive rings and spokes,
  // filled organically. The outermost band runs from the last ring to maxR.
  const bandEdges = [...radii, maxR];
  for (let b = 0; b < bandEdges.length - 1; b++) {
    const rInner = bandEdges[b];
    const rOuter = bandEdges[b + 1];
    if (rOuter - rInner < 1) continue;

    for (let i = 0; i < spokeAngles.length; i++) {
      const a0 = spokeAngles[i];
      const a1 = i === spokeAngles.length - 1 ? spokeAngles[0] + Math.PI * 2 : spokeAngles[i + 1];
      const poly = [
        ...arcPoints(centerX, centerZ, rInner, a0, a1),
        ...arcPoints(centerX, centerZ, rOuter, a1, a0),
      ];
      fillRegion(poly, bspLayout);
    }
  }

  return { blocks, roads };
};

export const LAYOUTS: Record<LayoutType, LayoutFn> = {
  BSP: bspLayout,
  GRID: gridLayout,
  SUPERBLOCK: superblockLayout,
  RING: ringLayout,
};

export { GRID_CELL, SUPERBLOCK_MIN_SIZE, AVENUE_EVERY, GRID_AVENUE_WIDTH, GRID_STREET_WIDTH, RING_COUNT, SPOKE_COUNT, RING_ROAD_WIDTH, SPOKE_ROAD_WIDTH };
