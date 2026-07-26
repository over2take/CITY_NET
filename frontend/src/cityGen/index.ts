import { consolidateRoads } from '../utils/roadHelpers';
import { generateThemedBuildingsForPlot } from '../components/Buildings';
import { splitCity, normalizeBounds } from './bsp';
import { SpatialGrid, createIsBlocked } from './collision';
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
export { SpatialGrid, createIsBlocked } from './collision';
export * from './zoning';
export { generatePark } from './parks';
export { shouldPlaceLandmark, generateLandmark } from './landmarks';

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
  const { sectionType, excludeRoads } = options;
  const { width, depth, centerX, centerZ } = normalizeBounds(bounds);
  const maxRadius = Math.max(1, Math.max(width, depth) / 2);

  // Sector angles are drawn before anything else so the district layout is
  // stable regardless of how many blocks the split produces.
  const sectors = createSectorLayout(rng);

  const { blocks, roads: newRoads } = splitCity(bounds, excludeRoads, rng);
  const finalRoads = excludeRoads
    ? []
    : consolidateRoads(newRoads, context.roads, ROAD_CONSOLIDATION_RADIUS);

  const grid = new SpatialGrid(context.locations);
  const roadsToCheck = [...context.roads, ...newRoads];
  const isBlocked = createIsBlocked(grid, roadsToCheck, !excludeRoads);

  const buildings: RawBuilding[] = [];

  blocks.forEach((block, index) => {
    const plotId = `gen_${index}`;
    const startIndex = buildings.length;

    let bw = block.w - PLOT_PADDING;
    let bd = block.d - PLOT_PADDING;
    if (bw < MIN_PLOT_SIZE || bd < MIN_PLOT_SIZE) return;

    /** Stamp the plot id and a fallback name onto everything just emitted. */
    const tagPlot = (fallbackName: string) => {
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

  return { blocks, roads: finalRoads, buildings };
}
