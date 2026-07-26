import type { RoadSegment } from './types';

/** A water body reduced to its outline on the XZ plane. */
export interface WaterPolygon {
  points: { x: number; z: number }[];
}

/** A stretch of a segment that runs through water, as parameters along it. */
export interface SubmergedSpan {
  /** Entry point along the segment, 0–1. */
  t0: number;
  /** Exit point along the segment, 0–1. */
  t1: number;
}

/**
 * Read water rows as polygons. Rows arrive from the API with the outline in
 * `points_json`; anything unparseable or degenerate is dropped rather than
 * throwing, so one bad row can't fail a whole generation run.
 */
export function parseWaterBodies(rows: unknown[]): WaterPolygon[] {
  const polygons: WaterPolygon[] = [];
  for (const row of rows ?? []) {
    const raw = (row as { points_json?: string; points?: unknown })?.points_json;
    let points: unknown;
    if (typeof raw === 'string') {
      try {
        points = JSON.parse(raw);
      } catch {
        continue;
      }
    } else {
      points = (row as { points?: unknown })?.points;
    }
    if (!Array.isArray(points) || points.length < 3) continue;
    const cleaned = points
      .filter((p): p is { x: number; z: number } =>
        !!p && Number.isFinite((p as { x?: number }).x) && Number.isFinite((p as { z?: number }).z))
      .map((p) => ({ x: p.x, z: p.z }));
    if (cleaned.length >= 3) polygons.push({ points: cleaned });
  }
  return polygons;
}

/** Ray-casting point-in-polygon test on the XZ plane. */
export function pointInPolygon(poly: WaterPolygon, x: number, z: number): boolean {
  const pts = poly.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z;
    const xj = pts[j].x, zj = pts[j].z;
    const straddles = zi > z !== zj > z;
    if (straddles && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when the point falls inside any water body. */
export function pointInWater(polygons: WaterPolygon[], x: number, z: number): boolean {
  return polygons.some((p) => pointInPolygon(p, x, z));
}

/**
 * True when a footprint touches water.
 *
 * Tests the centre and the four corners, which catches the cases that matter
 * (fully submerged, or a corner dipping in) without the cost of exact
 * rectangle-polygon clipping. A footprint straddling a water spit narrower
 * than itself can slip through — acceptable for building placement.
 */
export function footprintInWater(
  polygons: WaterPolygon[],
  x: number,
  z: number,
  w: number,
  d: number
): boolean {
  if (polygons.length === 0) return false;
  const hw = w / 2;
  const hd = d / 2;
  return (
    pointInWater(polygons, x, z) ||
    pointInWater(polygons, x - hw, z - hd) ||
    pointInWater(polygons, x + hw, z - hd) ||
    pointInWater(polygons, x - hw, z + hd) ||
    pointInWater(polygons, x + hw, z + hd)
  );
}

/**
 * Parameter along segment AB where it crosses segment CD, or null.
 * Returns t in 0–1 measured from A.
 */
function crossingParam(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number
): number | null {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel or degenerate
  const t = ((cx - ax) * sz - (cz - az) * sx) / denom;
  const u = ((cx - ax) * rz - (cz - az) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/**
 * Find the stretches of a road segment that run through water.
 *
 * Collects every shoreline crossing along the segment, then classifies each
 * resulting interval by sampling its midpoint. Handles concave outlines and
 * overlapping bodies, and reports a fully submerged segment as one span.
 */
export function submergedSpans(
  polygons: WaterPolygon[],
  seg: RoadSegment
): SubmergedSpan[] {
  if (polygons.length === 0) return [];

  const cuts: number[] = [0, 1];
  for (const poly of polygons) {
    const pts = poly.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const t = crossingParam(
        seg.x1, seg.z1, seg.x2, seg.z2,
        pts[j].x, pts[j].z, pts[i].x, pts[i].z
      );
      if (t !== null) cuts.push(t);
    }
  }

  const ordered = [...new Set(cuts)].sort((a, b) => a - b);
  const spans: SubmergedSpan[] = [];

  for (let i = 0; i < ordered.length - 1; i++) {
    const t0 = ordered[i];
    const t1 = ordered[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    const mx = seg.x1 + (seg.x2 - seg.x1) * mid;
    const mz = seg.z1 + (seg.z2 - seg.z1) * mid;
    if (!pointInWater(polygons, mx, mz)) continue;

    // Merge with the previous span when they abut, so a segment crossing two
    // touching bodies reads as one continuous water gap.
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.t1 - t0) < 1e-6) last.t1 = t1;
    else spans.push({ t0, t1 });
  }

  return spans;
}

/** Point at parameter t along a segment. */
export function pointAt(seg: RoadSegment, t: number): { x: number; z: number } {
  return {
    x: seg.x1 + (seg.x2 - seg.x1) * t,
    z: seg.z1 + (seg.z2 - seg.z1) * t,
  };
}

/** Full length of a segment. */
export function segmentLength(seg: RoadSegment): number {
  return Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
}
