import type { Bounds, Rng } from './types';
import { normalizeBounds } from './bsp';

/**
 * Voronoi cells.
 *
 * A Voronoi diagram scatters seed points and gives each one the region closer to it
 * than to any other. The boundaries land halfway between neighbouring seeds, so cells
 * come out as irregular convex polygons — four to seven sides, no right angles.
 *
 * Every layout so far produces rectangles, and rectangles read as *planned*. This reads
 * as grown: the street pattern of a medieval core, or a district that filled in around
 * footpaths rather than a surveyor's plan. It is the one layout that looks nothing like
 * the others, which is the whole reason for it.
 *
 * Cells are built by half-plane clipping rather than a sweepline. For the hundred or so
 * seeds a city needs that is fast enough, and it is a fraction of the code — Fortune's
 * algorithm would be several hundred lines of beach line and event queue to save
 * milliseconds nobody is waiting on.
 */

/** Point on the XZ plane. Local to this module; the generator has no shared 2-D point. */
export interface Pt {
  x: number;
  z: number;
}

/** Target distance between seeds — roughly the width of a resulting cell. */
export const VORONOI_SPACING = 60;

/**
 * How far a seed strays from its lattice position, as a fraction of the spacing.
 *
 * Seeds on a perfect lattice give a perfect honeycomb, which is as machine-made as the
 * grid. Fully random seeds clump, and clumped seeds give slivers — cells too thin to
 * hold anything. A jittered lattice keeps the cells similar in size while making no two
 * alike.
 */
export const VORONOI_JITTER = 0.45;

/** Cells thinner than this are dropped; nothing can be built on a splinter. */
const MIN_CELL_AREA = 200;

/** Points closer together than this are treated as one, when matching shared edges. */
const WELD = 0.01;

/**
 * Signed distance to the perpendicular bisector of `a`–`b`, negative on `a`'s side.
 *
 * |p−a|² ≤ |p−b|² expands to a linear test, which is what makes the clip cheap: no
 * square roots and no special case for a vertical bisector.
 */
function bisectorSide(p: Pt, a: Pt, b: Pt): number {
  return (
    2 * (b.x - a.x) * p.x +
    2 * (b.z - a.z) * p.z -
    (b.x * b.x + b.z * b.z - a.x * a.x - a.z * a.z)
  );
}

/** Sutherland–Hodgman clip of a convex polygon to the `a` side of the a–b bisector. */
function clipToBisector(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = bisectorSide(p, a, b);
    const fq = bisectorSide(q, a, b);
    if (fp <= 0) out.push(p);
    // Crossing the bisector: emit the point where the edge meets it.
    if (fp <= 0 !== fq <= 0) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

/** Twice the signed area; the sign gives winding. */
function area2(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.z - q.x * p.z;
  }
  return s;
}

export function polygonArea(poly: Pt[]): number {
  return Math.abs(area2(poly)) / 2;
}

/**
 * Area centroid — not the average of the vertices.
 *
 * The vertex average pulls towards whichever side has more of them, which on a cell
 * with one long edge chopped into several puts the centre off in a corner.
 */
export function centroid(poly: Pt[]): Pt {
  const a2 = area2(poly);
  if (Math.abs(a2) < 1e-9) {
    // Degenerate: fall back to the vertex average rather than dividing by zero.
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      z: poly.reduce((s, p) => s + p.z, 0) / n,
    };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  return { x: cx / (3 * a2), z: cz / (3 * a2) };
}

/** True when a point is inside a convex polygon, whatever its winding. */
function insideConvex(poly: Pt[], p: Pt): boolean {
  const sign = Math.sign(area2(poly));
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (Math.sign(cross) === -sign && cross !== 0) return false;
  }
  return true;
}

/**
 * The largest axis-aligned rectangle that fits in a cell, centred on its centroid.
 *
 * This is what lets an irregular cell feed machinery that only understands
 * `{x, z, w, d}`. The buildings inside stay rectangular and the existing plot filler
 * is untouched; what changes is the *street pattern*, which is where nearly all of the
 * visual payoff lives. The rectangle rarely fills its cell, so setbacks vary naturally
 * from plot to plot — a side effect worth having.
 *
 * Found by scaling the cell's bounding box about the centroid until the corners fit.
 * The cell is convex, so four corners inside means the whole rectangle is inside.
 */
export function inscribedRect(poly: Pt[]): { x: number; z: number; w: number; d: number } {
  const c = centroid(poly);
  const halfW = Math.max(...poly.map((p) => Math.abs(p.x - c.x)));
  const halfD = Math.max(...poly.map((p) => Math.abs(p.z - c.z)));

  const fits = (k: number) =>
    insideConvex(poly, { x: c.x - halfW * k, z: c.z - halfD * k }) &&
    insideConvex(poly, { x: c.x + halfW * k, z: c.z - halfD * k }) &&
    insideConvex(poly, { x: c.x - halfW * k, z: c.z + halfD * k }) &&
    insideConvex(poly, { x: c.x + halfW * k, z: c.z + halfD * k });

  let lo = 0;
  let hi = 1;
  // Twelve halvings resolve to a thousandth of the cell, far finer than a wall.
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { x: c.x, z: c.z, w: halfW * lo * 2, d: halfD * lo * 2 };
}

/** Seed points on a jittered lattice covering the bounds. */
export function seedPoints(bounds: Bounds, rng: Rng, spacing = VORONOI_SPACING): Pt[] {
  const { minX, minZ, width, depth } = normalizeBounds(bounds);
  const cols = Math.max(1, Math.round(width / spacing));
  const rows = Math.max(1, Math.round(depth / spacing));
  const cw = width / cols;
  const cd = depth / rows;

  const pts: Pt[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      pts.push({
        x: minX + (i + 0.5) * cw + (rng() - 0.5) * cw * VORONOI_JITTER * 2,
        z: minZ + (j + 0.5) * cd + (rng() - 0.5) * cd * VORONOI_JITTER * 2,
      });
    }
  }
  return pts;
}

/**
 * Voronoi cells for a set of seeds, clipped to the bounds.
 *
 * Each cell starts as the whole rectangle and is clipped by the bisector against every
 * other seed. That is O(n²) — for the ~100 seeds a city uses, a few thousand clips of a
 * handful of vertices each, which is nothing next to filling the plots afterwards.
 */
export function voronoiCells(bounds: Bounds, seeds: Pt[]): { seed: Pt; poly: Pt[] }[] {
  const { minX, maxX, minZ, maxZ } = normalizeBounds(bounds);
  const frame: Pt[] = [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];

  const cells: { seed: Pt; poly: Pt[] }[] = [];
  for (const seed of seeds) {
    let poly = frame;
    for (const other of seeds) {
      if (other === seed) continue;
      poly = clipToBisector(poly, seed, other);
      if (poly.length < 3) break;
    }
    if (poly.length >= 3 && polygonArea(poly) >= MIN_CELL_AREA) cells.push({ seed, poly });
  }
  return cells;
}

/** An undirected cell edge, keyed so the two cells sharing it agree on one road. */
function edgeKey(a: Pt, b: Pt): string {
  const r = (v: number) => Math.round(v / WELD);
  const ka = `${r(a.x)},${r(a.z)}`;
  const kb = `${r(b.x)},${r(b.z)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * The distinct edges of a set of cells.
 *
 * Every interior edge is shared by exactly two cells, so without this the whole network
 * would be laid twice — doubling the road count and giving consolidation a pile of
 * exact duplicates to reconcile.
 */
export function cellEdges(cells: { poly: Pt[] }[]): { a: Pt; b: Pt }[] {
  const seen = new Set<string>();
  const edges: { a: Pt; b: Pt }[] = [];
  for (const { poly } of cells) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }
  return edges;
}
