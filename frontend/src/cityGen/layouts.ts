import type { Block, Bounds, Rng, RoadSegment } from './types';
import type { OverpassSpec } from './bridges';
import { normalizeBounds, splitCity } from './bsp';
import { clipSegmentToLand, clipSegmentToBoundary, pointInPolygon, type Polygon, type WaterPolygon } from './water';
import { seedPoints, voronoiCells, cellEdges, inscribedRect, VORONOI_SPACING } from './voronoi';

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
) => { blocks: Block[]; roads: RoadSegment[]; overpasses?: OverpassSpec[] };

export type LayoutType = 'BSP' | 'GRID' | 'SUPERBLOCK' | 'RING' | 'VORONOI';

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

/**
 * Spokes are elevated; rings are not.
 *
 * An elevated deck consumes no ground — placement never checks overpasses — so the
 * street fabric runs unbroken beneath it and small buildings fill in below. That is
 * what stops six converging arterials sterilising the middle of the city.
 *
 * Rings stay on the ground because a closed loop has no ends to ramp down at. An
 * elevated loop either never touches the street network or does so at one arbitrary
 * point, and both read as broken. A ground-level loop simply has verges, which is what
 * a beltway looks like anyway.
 */
const SPOKE_DECK_HEIGHT = 14;

/** Fraction of a spoke given over to each ramp, so both ends reach the ground. */
const DECK_RAMP_FRACTION = 0.3;
const DECK_PILLAR_SPACING = 14;

/** Degrees between sampled points on a ring. Smaller reads rounder, at more segments. */
const ARC_STEP_DEG = 9;

/** A Voronoi edge longer than this many spacings is an avenue rather than a street. */
const VORONOI_AVENUE_RATIO = 1.15;

const VORONOI_AVENUE_WIDTH = 7;
const VORONOI_STREET_WIDTH = 4;

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

/**
 * Beltway city — concentric ring roads with radial spokes converging on the centre.
 * San Antonio, with its 410 and 1604 loops, is the reference.
 *
 * The observation that makes this work is that a beltway city is not built from
 * annular blocks, and its local streets are not divided up by the loops. Between the
 * arterials sits one continuous fabric of ordinary streets; the beltway simply cuts
 * across it. So this fills the whole disc with a single sub-layout and lays the rings
 * and spokes over the top — buildings then keep clear of the arterials through the
 * usual road check, which is what gives them their verges.
 *
 * An earlier version partitioned the disc into annular sectors and ran a sub-layout in
 * each. That produced a sparse, fragmented city: a sector's bounding box is far larger
 * than the sector, so most of what each run generated fell outside its own region and
 * was discarded.
 *
 * The corners of a rectangular selection are left empty on purpose — a ring city is
 * round, and filling the corners would defeat the shape.
 */
export const ringLayout: LayoutFn = (bounds, excludeRoads, rng, water = [], boundary) => {
  const { centerX, centerZ, width, depth } = normalizeBounds(bounds);
  const maxR = Math.min(width, depth) / 2;

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

  // The city is the disc, so that circle is the boundary the street fabric is laid
  // inside. Combined with any outer drawn boundary, both must hold.
  const disc: Polygon = { points: arcPoints(centerX, centerZ, maxR, 0, Math.PI * 2) };
  const fill = bspLayout(bounds, excludeRoads, rng, water, disc);

  const blocks = fill.blocks.filter((b) => !boundary || pointInPolygon(boundary, b.x, b.z));
  for (const r of fill.roads) roads.push(...clipSegmentToBoundary(r, boundary));

  const overpasses: OverpassSpec[] = [];

  // Radii grow faster than linearly, so downtown is ringed tightly and the outer loop
  // sweeps wide.
  const radii: number[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    radii.push(maxR * Math.pow((i + 1) / RING_COUNT, RING_FALLOFF));
  }
  for (const r of radii) {
    layPolyline(arcPoints(centerX, centerZ, r, 0, Math.PI * 2), RING_ROAD_WIDTH);
  }

  // Spokes run from the innermost loop outward rather than converging on a point.
  // Six arterials meeting at the centre left a starburst of dead ground there, and
  // real highways meet a downtown loop rather than piling into the middle.
  const innerR = radii[0];
  const spokeLength = Math.max(1, maxR - innerR);
  // Both ramps have to fit inside the spoke, or the deck never reaches the ground and
  // the road ends in mid-air.
  const rampLength = spokeLength * DECK_RAMP_FRACTION;

  const sector = (Math.PI * 2) / SPOKE_COUNT;
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const a = i * sector + (rng() - 0.5) * sector * 0.2;
    if (excludeRoads) continue;
    overpasses.push({
      points: [
        { x: centerX + Math.cos(a) * innerR, z: centerZ + Math.sin(a) * innerR },
        { x: centerX + Math.cos(a) * maxR, z: centerZ + Math.sin(a) * maxR },
      ],
      height: SPOKE_DECK_HEIGHT,
      width: SPOKE_ROAD_WIDTH,
      ramp_length: rampLength,
      ramp_length_start: rampLength,
      ramp_length_end: rampLength,
      pillar_spacing: DECK_PILLAR_SPACING,
    });
  }

  return { blocks, roads, overpasses };
};

/**
 * Organic cell city — a Voronoi diagram, streets along the cell boundaries.
 *
 * The only layout that produces no right angles. Streets meet at odd angles and blocks
 * are wedges and pentagons, which reads as a town that grew around footpaths rather
 * than one a surveyor set out.
 *
 * The plot inside each cell is the largest rectangle that fits it. That keeps the
 * existing plot filler — which lays buildings out along a rectangle's axes and has no
 * axes to work with in a pentagon — entirely unchanged, while still delivering the
 * irregular *street pattern*, which is where nearly all of the look comes from. A cell
 * is rarely filled by its rectangle, so setbacks vary from plot to plot for free.
 *
 * Long edges become avenues. Cell boundaries vary a lot in length, so this gives the
 * network a hierarchy without inventing one: the long runs across the diagram are
 * exactly the ones that would carry traffic.
 */
export const voronoiLayout: LayoutFn = (bounds, excludeRoads, rng, water = [], boundary) => {
  const seeds = seedPoints(bounds, rng);
  const cells = voronoiCells(bounds, seeds);

  const roads: RoadSegment[] = [];
  if (!excludeRoads) {
    for (const { a, b } of cellEdges(cells)) {
      const long = Math.hypot(b.x - a.x, b.z - a.z) > VORONOI_SPACING * VORONOI_AVENUE_RATIO;
      const seg: RoadSegment = {
        x1: a.x, z1: a.z, x2: b.x, z2: b.z,
        width: long ? VORONOI_AVENUE_WIDTH : VORONOI_STREET_WIDTH,
      };
      for (const dry of clipSegmentToLand(seg, water)) {
        roads.push(...clipSegmentToBoundary(dry, boundary));
      }
    }
  }

  const blocks: Block[] = [];
  for (const { poly } of cells) {
    const rect = inscribedRect(poly);
    // Blocks centred outside a drawn boundary are dropped, matching every other layout.
    if (boundary && !pointInPolygon(boundary, rect.x, rect.z)) continue;
    // The streets run along the cell edges, so the plot has to stand back from them.
    const w = rect.w - VORONOI_AVENUE_WIDTH;
    const d = rect.d - VORONOI_AVENUE_WIDTH;
    if (w < 1 || d < 1) continue;
    blocks.push({ x: rect.x, z: rect.z, w, d });
  }

  return { blocks, roads };
};

export const LAYOUTS: Record<LayoutType, LayoutFn> = {
  BSP: bspLayout,
  GRID: gridLayout,
  SUPERBLOCK: superblockLayout,
  RING: ringLayout,
  VORONOI: voronoiLayout,
};

export * from './voronoi';
export { VORONOI_AVENUE_WIDTH, VORONOI_STREET_WIDTH, VORONOI_AVENUE_RATIO, GRID_CELL, SUPERBLOCK_MIN_SIZE, AVENUE_EVERY, GRID_AVENUE_WIDTH, GRID_STREET_WIDTH, RING_COUNT, SPOKE_COUNT, RING_ROAD_WIDTH, SPOKE_ROAD_WIDTH, SPOKE_DECK_HEIGHT };
