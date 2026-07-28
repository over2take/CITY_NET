import { parseOverpassPoints } from './overpassHelpers';

/**
 * Framing math for map export.
 *
 * Kept free of Three.js and R3F so it can be unit tested without a WebGL
 * context — jsdom cannot provide one inside `useThree()`.
 */

export interface BoundsPoint { x: number; z: number }

/** Only the fields framing actually reads, so tests need not build a full Location. */
export interface BoundsLocation {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  shape: string;
  is_hidden?: number;
}

export interface BoundsRoad {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

export interface BoundsWaterBody {
  points_json?: string;
  points?: BoundsPoint[];
}

export interface BoundsOverpass {
  points: string | BoundsPoint[];
  width: number;
  height: number;
}

export interface CityBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Highest point of any structure, used to place the export camera above the city. */
  maxY: number;
}

/** World units of margin left around the city edge. */
export const BOUNDS_PAD = 20;

/** Half-extent of the fallback frame when there is no city content at all. */
export const BOUNDS_FALLBACK = 100;

/**
 * Player, enemy and friendly tokens share the `locations` table with buildings and
 * are told apart by `shape`. They are mobile and can be parked far outside the city,
 * so they never contribute to framing — see `computeCityBounds`.
 */
export const TOKEN_SHAPES = new Set(['rhombus', 'enemy_rhombus', 'friendly_rhombus']);

export const isTokenShape = (shape: string): boolean => TOKEN_SHAPES.has(shape);

/** Water rows carry their polygon as JSON; tolerate either form. */
const waterPoints = (body: BoundsWaterBody): BoundsPoint[] => {
  if (Array.isArray(body.points)) return body.points;
  if (typeof body.points_json !== 'string') return [];
  try {
    const parsed = JSON.parse(body.points_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Axis-aligned extent of the whole city, plus padding.
 *
 * Callers pass locations already filtered for `is_hidden` when hidden structures are
 * being excluded, so a distant secret does not silently inflate the frame.
 */
export function computeCityBounds(
  locations: BoundsLocation[],
  roads: BoundsRoad[] = [],
  waterBodies: BoundsWaterBody[] = [],
  overpasses: BoundsOverpass[] = [],
): CityBounds {
  const xs: number[] = [];
  const zs: number[] = [];
  let maxY = 0;

  for (const loc of locations) {
    if (isTokenShape(loc.shape)) continue;

    // Circumradius rather than half-width: buildings carry rotation, rotation_x and
    // rotation_z, so an axis-aligned width/depth box under-covers a rotated mesh.
    // This over-pads slightly and stays correct for all three rotation axes.
    const r = Math.hypot(loc.width, loc.height, loc.depth) / 2;
    xs.push(loc.x - r, loc.x + r);
    zs.push(loc.z - r, loc.z + r);
    // `y` is the bottom of the mesh, not its centre (see Buildings.tsx).
    maxY = Math.max(maxY, loc.y + loc.height);
  }

  for (const rd of roads) {
    // x1/z1 -> x2/z2 is a centreline; the rendered ribbon extends width/2 either side.
    const hw = (rd.width ?? 0) / 2;
    xs.push(rd.x1 - hw, rd.x1 + hw, rd.x2 - hw, rd.x2 + hw);
    zs.push(rd.z1 - hw, rd.z1 + hw, rd.z2 - hw, rd.z2 + hw);
  }

  for (const body of waterBodies) {
    for (const p of waterPoints(body)) {
      xs.push(p.x);
      zs.push(p.z);
    }
  }

  for (const o of overpasses) {
    const hw = (o.width ?? 0) / 2;
    for (const p of parseOverpassPoints(o.points)) {
      xs.push(p.x - hw, p.x + hw);
      zs.push(p.z - hw, p.z + hw);
    }
    maxY = Math.max(maxY, o.height ?? 0);
  }

  if (xs.length === 0) {
    return {
      minX: -BOUNDS_FALLBACK,
      maxX: BOUNDS_FALLBACK,
      minZ: -BOUNDS_FALLBACK,
      maxZ: BOUNDS_FALLBACK,
      maxY: 50,
    };
  }

  return {
    minX: Math.min(...xs) - BOUNDS_PAD,
    maxX: Math.max(...xs) + BOUNDS_PAD,
    minZ: Math.min(...zs) - BOUNDS_PAD,
    maxZ: Math.max(...zs) + BOUNDS_PAD,
    maxY,
  };
}

/** Centre of the framed area. A city generated off-origin must not be cropped. */
export const boundsCenter = (b: CityBounds): BoundsPoint => ({
  x: (b.minX + b.maxX) / 2,
  z: (b.minZ + b.maxZ) / 2,
});

export const boundsWidth = (b: CityBounds): number => b.maxX - b.minX;
export const boundsDepth = (b: CityBounds): number => b.maxZ - b.minZ;

/** Extra room left around the city so it does not sit flush against the frame edge. */
export const FLY_HEIGHT_MARGIN = 1.05;

/** Selectable PNG widths. Height follows the city's aspect ratio. */
export const PNG_EXPORT_WIDTHS = [1024, 2048, 4096, 8192] as const;
export const DEFAULT_PNG_EXPORT_WIDTH = 2048;

export interface ExportSize {
  width: number;
  height: number;
  /** True when the GPU limit forced a smaller image than was asked for. */
  clamped: boolean;
}

/**
 * Pixel dimensions for a PNG export, fitted to the city's aspect ratio and to what
 * the GPU can actually render.
 *
 * Clamping has to consider both axes, not just the one the user picked. A tall narrow
 * city at 4096 wide implies a height several times that, and exceeding
 * MAX_RENDERBUFFER_SIZE fails the render outright or returns a blank image — so the
 * whole thing is scaled down together, preserving aspect.
 */
export function resolveExportSize(
  worldWidth: number,
  worldDepth: number,
  requestedWidth: number,
  maxDimension: number,
): ExportSize {
  const safeWorldW = Math.max(worldWidth, 1);
  const safeWorldD = Math.max(worldDepth, 1);
  const safeMax = Math.max(1, Math.floor(maxDimension));

  let width = Math.max(1, Math.floor(requestedWidth));
  let height = Math.max(1, Math.round(width * (safeWorldD / safeWorldW)));

  const overshoot = Math.max(width / safeMax, height / safeMax, 1);
  const clamped = overshoot > 1;
  if (clamped) {
    width = Math.max(1, Math.floor(width / overshoot));
    height = Math.max(1, Math.floor(height / overshoot));
  }

  return { width, height, clamped };
}

/**
 * Height a perspective camera must reach for the city to fill the frame from directly
 * overhead.
 *
 * The PNG export sets an orthographic frustum to the bounds directly, so its fit is
 * exact. Recording reuses the live perspective camera, where what you can see depends
 * on FOV and window aspect.
 *
 * Width and depth are fitted against their own screen axes rather than collapsed into
 * a single span. Looking straight down, world X runs across the screen and world Z
 * runs up it — so a city twice as wide as it is deep must fit its width horizontally
 * and its depth vertically. Fitting one span into both axes zooms out by the city's
 * aspect ratio and leaves most of the frame empty.
 */
export function overheadFlyHeight(
  worldWidth: number,
  worldDepth: number,
  fovDegrees: number,
  aspect: number,
  maxY = 0,
  margin = FLY_HEIGHT_MARGIN,
): number {
  const safeWidth = Math.max(worldWidth, 1);
  const safeDepth = Math.max(worldDepth, 1);
  const safeFov = Math.min(Math.max(fovDegrees, 1), 179);
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;

  const halfFov = (safeFov * Math.PI) / 180 / 2;
  const t = Math.tan(halfFov);

  // Visible vertical extent at height h is 2*h*tan(fov/2); horizontal is that times
  // the aspect ratio. Invert each for the height that just contains the city.
  const fitDepth = safeDepth / (2 * t);
  const fitWidth = safeWidth / (2 * t * safeAspect);

  return Math.max(fitDepth, fitWidth) * margin + maxY;
}
