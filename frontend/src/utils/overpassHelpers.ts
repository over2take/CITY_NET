export interface OverpassPoint { x: number; z: number; }

export interface OverpassParams {
  height: number;        // target deck elevation
  width: number;         // deck width
  rampLength: number;    // horizontal run of each end ramp (used when start/end not split)
  rampLengthStart?: number; // override for start ramp only
  rampLengthEnd?: number;   // override for end ramp only
  pillarSpacing: number; // distance between pillar centres along the deck
}

export interface DeckTile {
  x: number; y: number; z: number; // centre of the tile (y = elevation of deck mid)
  length: number;                  // true (sloped) tile length
  yaw: number;                     // rotation about Y so local +x follows the path
  pitch: number;                   // rotation about local Z (positive = rising along +x)
  isRamp: boolean;                 // true when the tile is on a sloped section
}

export interface OverpassPillar {
  x: number; z: number;
  height: number; // ground to deck underside
}

export interface OverpassGeometry {
  tiles: DeckTile[];
  pillars: OverpassPillar[];
  totalLength: number;
}

const MIN_PILLAR_HEIGHT = 1.5; // don't spawn stubby pillars under low ramp ends
const PILLAR_RADIUS = 0.8;
const PILLAR_CLEARANCE = 1.0;

/** Distance from point (px,pz) to segment (x1,z1)-(x2,z2). */
export const pointToSegmentDist = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number => {
  const dx = x2 - x1, dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 0) t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const cx = x1 + t * dx, cz = z1 + t * dz;
  return Math.hypot(px - cx, pz - cz);
};

/** True if pt sits within tol of any road segment endpoint (an existing junction node). */
export const isEndpointConnected = (
  pt: OverpassPoint,
  roads: Array<{ x1: number; z1: number; x2: number; z2: number }>,
  tol = 2
): boolean => {
  for (const r of roads) {
    if (Math.hypot(pt.x - r.x1, pt.z - r.z1) <= tol) return true;
    if (Math.hypot(pt.x - r.x2, pt.z - r.z2) <= tol) return true;
  }
  return false;
};

/**
 * Deck elevation at arclength s along the path.
 * slope = height / rampLength stays constant; short roads simply peak lower
 * (slopes meet in the middle) and connected ends skip their ramp entirely.
 */
export const elevationAt = (
  s: number,
  totalLength: number,
  height: number,
  rampLength: number,
  connectedStart = false,
  connectedEnd = false,
  rampLengthStart?: number,
  rampLengthEnd?: number,
): number => {
  const rl0 = rampLengthStart ?? rampLength;
  const rl1 = rampLengthEnd   ?? rampLength;
  const elevStart = rl0 === 0 || connectedStart ? height : Math.min(height, (height / rl0) * s);
  const elevEnd   = rl1 === 0 || connectedEnd   ? height : Math.min(height, (height / rl1) * (totalLength - s));
  return Math.min(elevStart, elevEnd);
};

/** Parse an overpass row's points column (JSON string from the DB or an array). */
export const parseOverpassPoints = (raw: string | OverpassPoint[]): OverpassPoint[] => {
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
};

/**
 * Sample an overpass path into evenly spaced 3D points on the deck surface —
 * used by traffic animation so cars climb the ramps and cross the deck.
 */
export const sampleOverpassPath = (
  points: OverpassPoint[],
  params: Pick<OverpassParams, 'height' | 'rampLength' | 'rampLengthStart' | 'rampLengthEnd'>,
  existingRoads: Array<{ x1: number; z1: number; x2: number; z2: number }> = [],
  step = 4
): Array<{ x: number; y: number; z: number }> => {
  if (!points || points.length < 2) return [];
  const connectedStart = isEndpointConnected(points[0], existingRoads);
  const connectedEnd = isEndpointConnected(points[points.length - 1], existingRoads);

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const totalLength = cum[cum.length - 1];
  if (totalLength < 0.5) return [];

  const samples: Array<{ x: number; y: number; z: number }> = [];
  const count = Math.max(2, Math.ceil(totalLength / step) + 1);
  for (let k = 0; k < count; k++) {
    const s = (k / (count - 1)) * totalLength;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const segLen = Math.max(cum[i] - cum[i - 1], 0.001);
    const t = (s - cum[i - 1]) / segLen;
    samples.push({
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
      y: elevationAt(s, totalLength, params.height, params.rampLength, connectedStart, connectedEnd, params.rampLengthStart, params.rampLengthEnd),
      z: points[i - 1].z + (points[i].z - points[i - 1].z) * t,
    });
  }
  return samples;
};

/**
 * Turn a drawn path into deck tiles + pillars.
 * - Tiles follow the polyline, subdivided to ~tileLength so ramps read as smooth slopes.
 * - Pillars go under the elevated deck at pillarSpacing intervals, skipping any
 *   whose footprint would land on an existing road.
 */
export const buildOverpassGeometry = (
  points: OverpassPoint[],
  params: OverpassParams,
  existingRoads: Array<{ x1: number; z1: number; x2: number; z2: number; width?: number }> = [],
  opts: { connectedStart?: boolean; connectedEnd?: boolean; tileLength?: number } = {}
): OverpassGeometry => {
  const { height, rampLength, rampLengthStart, rampLengthEnd, pillarSpacing } = params;
  const tileLength = opts.tileLength ?? 3;
  const connectedStart = opts.connectedStart ?? isEndpointConnected(points[0], existingRoads);
  const connectedEnd = opts.connectedEnd ?? isEndpointConnected(points[points.length - 1], existingRoads);

  if (!points || points.length < 2) return { tiles: [], pillars: [], totalLength: 0 };

  // Cumulative arclength at each path point
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const totalLength = cum[cum.length - 1];
  if (totalLength < 0.5) return { tiles: [], pillars: [], totalLength: 0 };

  const elev = (s: number) => elevationAt(s, totalLength, height, rampLength, connectedStart, connectedEnd, rampLengthStart, rampLengthEnd);
  const posAt = (s: number): OverpassPoint => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const segLen = Math.max(cum[i] - cum[i - 1], 0.001);
    const t = (s - cum[i - 1]) / segLen;
    return {
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
      z: points[i - 1].z + (points[i].z - points[i - 1].z) * t,
    };
  };

  // --- Deck tiles ---
  const tiles: DeckTile[] = [];
  const tileCount = Math.max(1, Math.ceil(totalLength / tileLength));
  const step = totalLength / tileCount;
  for (let i = 0; i < tileCount; i++) {
    const s0 = i * step, s1 = (i + 1) * step;
    const p0 = posAt(s0), p1 = posAt(s1);
    const y0 = elev(s0), y1 = elev(s1);
    const run = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (run < 0.01) continue;
    const rise = y1 - y0;
    tiles.push({
      x: (p0.x + p1.x) / 2,
      y: (y0 + y1) / 2,
      z: (p0.z + p1.z) / 2,
      length: Math.hypot(run, rise),
      yaw: Math.atan2(-(p1.z - p0.z), p1.x - p0.x),
      pitch: Math.atan2(rise, run),
      isRamp: Math.abs(rise) > 0.001,
    });
  }

  // --- Pillars ---
  const pillars: OverpassPillar[] = [];
  const spacing = Math.max(pillarSpacing, 2);
  for (let s = spacing / 2; s < totalLength; s += spacing) {
    const y = elev(s);
    if (y < MIN_PILLAR_HEIGHT) continue;
    const p = posAt(s);
    const collides = existingRoads.some(r =>
      pointToSegmentDist(p.x, p.z, r.x1, r.z1, r.x2, r.z2) < (r.width ?? 4) / 2 + PILLAR_RADIUS + PILLAR_CLEARANCE
    );
    if (collides) continue;
    pillars.push({ x: p.x, z: p.z, height: y });
  }

  return { tiles, pillars, totalLength };
};
