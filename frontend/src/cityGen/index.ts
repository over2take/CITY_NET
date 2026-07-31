import { consolidateRoads } from '../utils/roadHelpers';
import { generateThemedBuildingsForPlot } from '../components/Buildings';
import { LAYOUTS } from './layouts';
import { normalizeBounds } from './bsp';
import { SpatialGrid, createIsBlocked, footprintOnRoad, clampBuildingsUnderDecks } from './collision';
import {
  createSectorLayout,
  normalizedDistance,
  parkProbability,
  assignZoneType,
  zonePrefixFor,
  clampPlotAspect,
} from './zoning';
import { generatePark } from './parks';
import { shouldPlaceLandmark, generateLandmark } from './landmarks';
import { parseWaterBodies, pointInWater, footprintInWater, clipSegmentToBoundary } from './water';
import { findBridges } from './bridges';
import { generateShorelineRoads, snapRoadEndsToShoreline } from './shoreline';
import type {
  Bounds,
  GenerateCityContext,
  GenerateCityOptions,
  GenerateCityResult,
  RawBuilding,
  Rng,
} from './types';

export * from './types';
export { splitCity, normalizeBounds, maxSplitDepthFor } from './bsp';
export { SpatialGrid, createIsBlocked, footprintOnRoad, clampBuildingsUnderDecks, DECK_CLEARANCE, MIN_UNDER_DECK_HEIGHT } from './collision';
export * from './zoning';
export { generatePark } from './parks';
export { shouldPlaceLandmark, generateLandmark } from './landmarks';
export * from './water';
export * from './layouts';
export {
  findBridges, MAX_BRIDGE_SPAN, BRIDGE_RAMP_LENGTH,
  BRIDGE_HEIGHTS, MIN_RAMP_RUN, MAX_RAMP_RUN,
} from './bridges';
export { generateShorelineRoads, snapRoadEndsToShoreline, SHORE_OFFSET } from './shoreline';

/** Margin trimmed off every block so buildings don't butt against the road. */
const PLOT_PADDING = 10;

/** Plots smaller than this after padding are left empty. */
const MIN_PLOT_SIZE = 8;

/** How aggressively new roads snap onto existing ones. */
const ROAD_CONSOLIDATION_RADIUS = 3.0;

/** Injectable collaborators, overridden in tests. */
export interface GenerateCityDeps {
  fillPlot: typeof generateThemedBuildingsForPlot;
}

const DEFAULT_DEPS: GenerateCityDeps = {
  fillPlot: generateThemedBuildingsForPlot,
};

/**
 * Generate a city district into the selected area.
 *
 * Pipeline: BSP-split the area into blocks and roads, seed a collision grid
 * from what already exists, then walk each block and fill it with a park, a
 * landmark, or ordinary themed buildings depending on its zone.
 *
 * Pure — the caller is responsible for persisting the result and for grouping
 * children (`parent_name` set) under their roots once ids exist.
 */
export function generateCity(
  bounds: Bounds,
  options: GenerateCityOptions,
  context: GenerateCityContext,
  rng: Rng = Math.random,
  deps: GenerateCityDeps = DEFAULT_DEPS
): GenerateCityResult {
  const { sectionType, excludeRoads, overpassDensity = 'normal', layout = 'BSP' } = options;
  // Fewer than three points cannot enclose an area. Treating a degenerate boundary as
  // absent falls back to the plain bounds, rather than generating nothing at all and
  // looking like a broken button.
  const boundary =
    options.boundary && options.boundary.points.length >= 3 ? options.boundary : undefined;
  const { width, depth, centerX, centerZ } = normalizeBounds(bounds);
  const maxRadius = Math.max(1, Math.max(width, depth) / 2);
  const water = parseWaterBodies(context.waterBodies ?? []);

  // Sector angles are drawn before anything else so the district layout is
  // stable regardless of how many blocks the split produces.
  const sectors = createSectorLayout(rng);

  // The split clips its own seams to land, so the grid stops at the shore
  // instead of being laid across the water and cut back afterwards.
  const { blocks, roads: newRoads, overpasses: layoutOverpasses = [] } =
    (LAYOUTS[layout] ?? LAYOUTS.BSP)(bounds, excludeRoads, rng, water, boundary);

  // A road around each water body turns what would be dead ends at the shore
  // into junctions, so the network routes around a lake.
  const shoreRoads = excludeRoads
    ? []
    : generateShorelineRoads(water, bounds).flatMap((seg) =>
        clipSegmentToBoundary(seg, boundary));

  // Approaches stop at the water, which leaves them overshooting the waterfront
  // road that sits back from it. Snapping their ends onto it removes the
  // overshoot and gives the two roads a shared point to be joined at.
  const snappedRoads = snapRoadEndsToShoreline(newRoads, shoreRoads);

  const finalRoads = excludeRoads
    ? []
    : consolidateRoads([...snappedRoads, ...shoreRoads], context.roads, ROAD_CONSOLIDATION_RADIUS);

  // Pick crossings worth bridging from the road ends left at the water's edge.
  // Draws no randomness on a dry map, so those generate exactly as before.
  // A layout may raise its own arterials — RING elevates its beltways so they do not
  // sterilise the ground beneath. Those join whatever bridges the water needs.
  const overpasses = excludeRoads
    ? []
    : [...layoutOverpasses, ...findBridges(finalRoads, water, overpassDensity, rng)];

  const grid = new SpatialGrid(context.locations);
  // Test against the roads that will actually exist. Consolidation snaps
  // endpoints onto existing roads and onto each other, so the pre-consolidation
  // seams are not where the pavement ends up — checking those instead lets
  // buildings land on roads that moved underneath them.
  const roadsToCheck = [...context.roads, ...finalRoads];
  const isBlocked = createIsBlocked(grid, roadsToCheck, !excludeRoads, water, boundary);

  const buildings: RawBuilding[] = [];

  blocks.forEach((block, index) => {
    const plotId = `gen_${index}`;
    const startIndex = buildings.length;

    let bw = block.w - PLOT_PADDING;
    let bd = block.d - PLOT_PADDING;
    if (bw < MIN_PLOT_SIZE || bd < MIN_PLOT_SIZE) return;

    // A plot centred in water is open water — skip it outright. Plots that
    // merely touch a shoreline still build, on their dry side: isBlocked
    // rejects the individual footprints that would sit in the water.
    if (water.length > 0 && pointInWater(water, block.x, block.z)) return;

    /**
     * Stamp the plot id and a fallback name onto everything just emitted,
     * unless the plot turned out to be badly sited.
     *
     * The themed generators place most of a structure relative to a cleared
     * root without re-testing each piece, so a root sited legally can still
     * throw a wing, a rooftop tank or a landmark buttress out over water or
     * across a road. Every piece is therefore re-checked once the plot is
     * finished, and the whole plot is rolled back if any of them landed badly
     * — an empty lot reads as deliberate, half a building does not.
     */
    const tagPlot = (fallbackName: string) => {
      for (let i = startIndex; i < buildings.length; i++) {
        const b = buildings[i];
        const wet = water.length > 0 && footprintInWater(water, b.x, b.z, b.width, b.depth);
        const paved = !excludeRoads && footprintOnRoad(roadsToCheck, b.x, b.z, b.width, b.depth);
        if (wet || paved) {
          buildings.length = startIndex;
          return;
        }
      }
      for (let i = startIndex; i < buildings.length; i++) {
        buildings[i].temp_block_id = plotId;
        if (!buildings[i].name) buildings[i].name = fallbackName;
      }
    };

    const normDist = normalizedDistance(block.x, block.z, centerX, centerZ, maxRadius);

    // Parks claim the plot outright — no buildings share it.
    if (rng() < parkProbability(normDist)) {
      generatePark(block, bw, bd, buildings, isBlocked, rng);
      tagPlot('PARK');
      return;
    }

    const zoneTypeVal = assignZoneType(
      block.x, block.z, centerX, centerZ, normDist, sectionType, sectors, rng
    );
    const zonePrefix = zonePrefixFor(zoneTypeVal);
    ({ bw, bd } = clampPlotAspect(bw, bd, zoneTypeVal));

    if (shouldPlaceLandmark(block, bw, bd, zoneTypeVal, isBlocked, rng)) {
      generateLandmark(block, bw, bd, buildings, grid, rng);
      tagPlot(zonePrefix);
      return;
    }

    deps.fillPlot(
      block.x, block.z, bw, bd, zoneTypeVal,
      isBlocked, grid.key, grid.cells, buildings, context.locations, plotId
    );
    tagPlot(zonePrefix);
  });

  // Placement ignores overpasses so the ground beneath stays buildable; nothing there
  // stops a tower rising through a deck, so anything under one is capped just below it.
  // Applies to water bridges too, which pierce buildings for the same reason.
  return {
    blocks,
    roads: finalRoads,
    buildings: clampBuildingsUnderDecks(buildings, overpasses),
    overpasses,
  };
}
