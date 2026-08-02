// Shared types for the city generator.
//
// The generator is a pure pipeline: bounds + options + existing world state
// go in, a set of blocks / roads / buildings comes out. Nothing here touches
// React, the network, or the DOM — persistence is the caller's job.

/** Random source. Injected so generation can be made deterministic in tests. */
export type Rng = () => number;

/** Axis-aligned selection rectangle on the XZ plane. */
export interface Bounds {
  min: { x: number; z: number };
  max: { x: number; z: number };
}

/** One city block produced by the BSP split. x/z is the centre. */
export interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
  /**
   * This is a finished building lot, not a city block — take `w`/`d` as the footprint.
   *
   * The generator normally trims road padding off a block, clamps its aspect toward
   * square and applies a per-zone setback. All three exist to turn a whole city block
   * into one sensible plot. A layout that has already subdivided a block into lots has
   * made those decisions itself, and leaving them on would pad neighbouring lots apart,
   * square up the narrow frontages and pull the row back off the street — undoing the
   * street wall that was the point of subdividing.
   */
  lot?: boolean;
}

// Roads reuse the canonical shape from roadHelpers so consolidateRoads and
// the renderer stay the single source of truth for road geometry.
import type { RoadSegment } from '../utils/roadHelpers';
export type { RoadSegment };

import type { OverpassDensity, OverpassSpec } from './bridges';
import type { Polygon } from './water';
import type { LayoutType } from './layouts';
import type { WaterType } from './waterGen';
import type { RoundaboutDensity } from './roundabouts';
export type { OverpassDensity, OverpassSpec };

/** Zoning preset chosen in the admin panel. */
export type SectionType = 'MIXED' | 'CORPO' | 'URBAN' | 'SLUMS' | 'INDUSTRIAL';

/**
 * A generated structure, shaped for POST /api/locations.
 * Deliberately loose — the building generators in Buildings.tsx emit a
 * superset of fields and the API accepts extras.
 */
export interface RawBuilding {
  name: string;
  description?: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  shape: string;
  /** 'ROOT' | 'CORP_ROOT' marks a child that gets grouped under a root. */
  parent_name?: string;
  /** Set by the generator so the caller can group children to their root. */
  temp_block_id?: string;
  polyCount?: number;
  rotation?: number;
  [key: string]: unknown;
}

/** Anything with a footprint that new buildings must avoid. */
export interface Obstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface GenerateCityOptions {
  sectionType: SectionType;
  /**
   * Generate only inside this polygon. `bounds` still frames the work — the split
   * recurses on the bounding box and blocks outside the shape are dropped.
   */
  boundary?: Polygon;
  /** Street layout. Defaults to BSP, which is what generation has always produced. */
  layout?: LayoutType;
  /**
   * Water to generate before laying the city out. Defaults to NONE — generation has
   * never produced water, and defaulting otherwise would put a river through the city
   * of everyone already using the button.
   */
  water?: WaterType;
  /**
   * Give parks ponds. Separate from `water` because it is a different scale of
   * decision — a river reshapes the whole city, a pond is scenery in one plot — and a
   * GM may well want one without the other. Off by default, on the same reasoning.
   */
  parkPonds?: boolean;
  /**
   * Put roundabouts at junctions of major roads. An overlay on the finished network
   * rather than a layout, so it applies whichever layout is chosen. Defaults to 'off'.
   */
  roundabouts?: RoundaboutDensity;
  /** When true, no roads are generated and road collision is skipped. */
  excludeRoads: boolean;
  /** How freely roads bridge the water they cross. Defaults to 'normal'. */
  overpassDensity?: OverpassDensity;
}

export interface GenerateCityContext {
  /** Existing locations, used to seed the collision grid. */
  locations: Obstacle[];
  /** Existing roads, merged with new ones for collision and consolidation. */
  roads: RoadSegment[];
  /**
   * Water body rows as served by the API (outline in `points_json`).
   * Buildings avoid them and roads stop at the shore. Omit for dry land.
   */
  waterBodies?: unknown[];
}

export interface GenerateCityResult {
  blocks: Block[];
  /** Roads ready to POST, trimmed at any shoreline. Empty when excludeRoads. */
  roads: RoadSegment[];
  buildings: RawBuilding[];
  /** Bridges spanning water crossings that qualified. */
  overpasses: OverpassSpec[];
  /** Water the run generated, for the caller to persist. Empty unless asked for. */
  waterBodies: Polygon[];
}
