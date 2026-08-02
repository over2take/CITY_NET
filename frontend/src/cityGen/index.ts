import { consolidateRoads } from '../utils/roadHelpers';
import { generateThemedBuildingsForPlot } from '../components/Buildings';
import { LAYOUTS } from './layouts';
import { generateWater } from './waterGen';
import { normalizeBounds } from './bsp';
import { SpatialGrid, createIsBlocked, footprintOnRoad, clampBuildingsUnderDecks } from './collision';
import {
  createSectorLayout,
  normalizedDistance,
  heightScaleFor,
  lotCoverageFor,
  parkProbability,
  assignZoneType,
  zonePrefixFor,
  clampPlotAspect,
} from './zoning';
import { generatePark } from './parks';
import { shouldPlaceLandmark, generateLandmark } from './landmarks';
import { generateMonument } from './monuments';
import { parseWaterBodies, pointInWater, footprintInWater, clipSegmentToBoundary } from './water';
import type { Polygon } from './water';
import { findBridges } from './bridges';
import { siteRoundabouts, applyRoundabouts, RING_WIDTH } from './roundabouts';
import { generateShorelineRoads, snapRoadEndsToShoreline } from './shoreline';
import type {
  Block,
  Bounds,
  GenerateCityContext,
  GenerateCityOptions,
  GenerateCityResult,
  RawBuilding,
  Rng,
} from './types';

export * from './types';
export { splitCity, normalizeBounds, maxSplitDepthFor, roadWidthForDepth } from './bsp';
export { SpatialGrid, createIsBlocked, footprintOnRoad, clampBuildingsUnderDecks, DECK_CLEARANCE, MIN_UNDER_DECK_HEIGHT } from './collision';
export * from './zoning';
export { generatePark } from './parks';
export { shouldPlaceLandmark, generateLandmark } from './landmarks';
export * from './monuments';
export * from './water';
export * from './layouts';
export * from './rng';
export * from './region';
export * from './waterGen';
export {
  findBridges, MAX_BRIDGE_SPAN, BRIDGE_RAMP_LENGTH,
  BRIDGE_HEIGHTS, MIN_RAMP_RUN, MAX_RAMP_RUN,
} from './bridges';
export { generateShorelineRoads, snapRoadEndsToShoreline, SHORE_OFFSET } from './shoreline';
export * from './roundabouts';

/** Margin trimmed off every block so buildings don't butt against the road. */
const PLOT_PADDING = 10;

/** Plots smaller than this after padding are left empty. */
const MIN_PLOT_SIZE = 8;

/** Fraction of a roundabout's inner disc actually built on, leaving a verge. */
const ISLAND_COVERAGE = 0.8;

/** Islands smaller than this are left as bare pavement; nothing reads at that size. */
const MIN_ISLAND_SPAN = 4;

/** A monument needs room to look deliberate; below this the island gets trees. */
const MIN_MONUMENT_SPAN = 12;

/** How often an island large enough for one gets a monument rather than trees. */
const ISLAND_MONUMENT_CHANCE = 0.45;

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
  const { sectionType, excludeRoads, overpassDensity = 'normal', layout = 'BSP', water: waterType = 'NONE', parkPonds = false, roundabouts: roundaboutDensity = 'off' } = options;
  // Fewer than three points cannot enclose an area. Treating a degenerate boundary as
  // absent falls back to the plain bounds, rather than generating nothing at all and
  // looking like a broken button.
  const boundary =
    options.boundary && options.boundary.points.length >= 3 ? options.boundary : undefined;
  const { width, depth, centerX, centerZ } = normalizeBounds(bounds);
  const maxRadius = Math.max(1, Math.max(width, depth) / 2);
  // Water is generated *before* the split, because the split is already water-aware:
  // the grid then stops at the banks of its own accord and bridges get sited. Doing it
  // afterwards would mean cutting finished roads.
  const generatedWater = generateWater(waterType, bounds, rng);
  const water = [...parseWaterBodies(context.waterBodies ?? []), ...generatedWater];

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

  // Roundabouts come after consolidation, which snaps nearby endpoints together — a
  // ring is many short segments with close endpoints, and running it first would snap
  // the circle into a blob. After bridge siting too, so the shore stubs bridges are
  // paired from are the ones the layout actually left at the water.
  const roundabouts = excludeRoads
    ? []
    : siteRoundabouts(finalRoads, roundaboutDensity, rng, water, boundary);
  const roadsWithRoundabouts = applyRoundabouts(finalRoads, roundabouts, boundary);

  const grid = new SpatialGrid(context.locations);
  // Test against the roads that will actually exist. Consolidation snaps
  // endpoints onto existing roads and onto each other, so the pre-consolidation
  // seams are not where the pavement ends up — checking those instead lets
  // buildings land on roads that moved underneath them.
  const roadsToCheck = [...context.roads, ...roadsWithRoundabouts];
  const isBlocked = createIsBlocked(grid, roadsToCheck, !excludeRoads, water, boundary);

  const buildings: RawBuilding[] = [];
  // Ponds are collected separately from `water`: that array is what the split, the
  // shoreline roads and bridge siting were built from, and all of those have already
  // run by the time a park exists. Adding to it here would be a lie about what shaped
  // the city. They join the generated water only in the result, to be persisted.
  const pondPolys: Polygon[] = [];

  blocks.forEach((block, index) => {
    const plotId = `gen_${index}`;
    const startIndex = buildings.length;

    // A lot arrives with its footprint already decided by the layout; a block gets the
    // road margin trimmed off it here. See `Block.lot`.
    let bw = block.lot ? block.w : block.w - PLOT_PADDING;
    let bd = block.lot ? block.d : block.d - PLOT_PADDING;
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
     *
     * Returns whether the plot was kept, so a caller that produced something other
     * than buildings — a park pond — can discard that too when the plot is rolled back.
     */
    const tagPlot = (fallbackName: string): boolean => {
      for (let i = startIndex; i < buildings.length; i++) {
        const b = buildings[i];
        const wet = water.length > 0 && footprintInWater(water, b.x, b.z, b.width, b.depth);
        const paved = !excludeRoads && footprintOnRoad(roadsToCheck, b.x, b.z, b.width, b.depth);
        if (wet || paved) {
          buildings.length = startIndex;
          return false;
        }
      }
      for (let i = startIndex; i < buildings.length; i++) {
        buildings[i].temp_block_id = plotId;
        if (!buildings[i].name) buildings[i].name = fallbackName;
      }
      return true;
    };

    const normDist = normalizedDistance(block.x, block.z, centerX, centerZ, maxRadius);

    // Parks claim the plot outright — no buildings share it.
    if (rng() < parkProbability(normDist)) {
      const ponds = generatePark(block, bw, bd, buildings, isBlocked, rng, parkPonds);
      if (tagPlot('PARK')) pondPolys.push(...ponds);
      return;
    }

    const zoneTypeVal = assignZoneType(
      block.x, block.z, centerX, centerZ, normDist, sectionType, sectors, rng
    );
    const zonePrefix = zonePrefixFor(zoneTypeVal);
    // A lot skips both: its narrow frontage is deliberate, and squaring it up or
    // setting it back would pull a terrace apart into detached sheds. Both rules are
    // about fitting one structure sensibly onto a whole city block.
    if (!block.lot) {
      ({ bw, bd } = clampPlotAspect(bw, bd, zoneTypeVal));
      // Setback: corporate plots leave forecourts, slums and markets build to the lot
      // line. Applied after the aspect clamp so it shrinks the plot actually used.
      const coverage = lotCoverageFor(zoneTypeVal);
      bw *= coverage;
      bd *= coverage;
    }

    if (shouldPlaceLandmark(block, bw, bd, zoneTypeVal, isBlocked, rng)) {
      generateLandmark(block, bw, bd, buildings, grid, rng);
      tagPlot(zonePrefix);
      return;
    }

    const beforeFill = buildings.length;
    // The two undefineds are overrideH and styleOverride, which only the editor
    // preview uses. rng is what makes a seed reproduce the buildings and not merely
    // the street layout.
    deps.fillPlot(
      block.x, block.z, bw, bd, zoneTypeVal,
      isBlocked, grid.key, grid.cells, buildings, context.locations, plotId,
      undefined, undefined, rng
    );
    // Zone already steps down with distance, but only in bands — the skyline came out
    // as flat plateaus with hard seams. Scaling within the zone softens those into a
    // continuous taper. Landmarks are left alone; a hero building is sized on purpose.
    //
    // `y` scales with `height`. A plot is often several stacked parts, and a part
    // sitting on another has its `y` set to that one's height — scaling heights alone
    // left every upper storey hanging in the air above a shortened base.
    const heightScale = heightScaleFor(normDist);
    for (let i = beforeFill; i < buildings.length; i++) {
      buildings[i].height *= heightScale;
      buildings[i].y *= heightScale;
    }
    tagPlot(zonePrefix);
  });

  // Dress each island. An empty disc reads as a hole in the road network rather than a
  // roundabout, so every one gets something: a monument where there is room for one,
  // trees otherwise. Done after the blocks so the islands are laid over a finished city
  // — they sit where roads were cut away, which no block ever claimed.
  roundabouts.forEach((r, i) => {
    const span = Math.max(0, (r.radius - RING_WIDTH) * 2 * ISLAND_COVERAGE);
    if (span < MIN_ISLAND_SPAN) return;
    const island: Block = { x: r.x, z: r.z, w: span, d: span };
    const plotId = `gen_circus_${i}`;
    const startIndex = buildings.length;

    // Drawn unconditionally so the sequence does not depend on how large the island is.
    const wantsMonument = rng() < ISLAND_MONUMENT_CHANCE;
    const monument = wantsMonument && span >= MIN_MONUMENT_SPAN;
    if (monument) {
      // Not generateLandmark: those are 150-to-220-unit hero buildings sized to anchor
      // a skyline, and one on a traffic island is a tower growing out of a roundabout.
      // A monument is sized against the island instead.
      generateMonument(island, span, buildings, rng);
    } else {
      generatePark(island, span, span, buildings, isBlocked, rng, false);
    }

    // Named as what they are, from the vocabulary that already exists. A new name would
    // have to be added to ZONE_TYPE_NAMES in two files — the frontend and the backend
    // keep separate copies — and anything missing from that set is treated as authored
    // by the GM: rendered in the "has data" purple, and *kept by a region purge*, so
    // every regenerate would leave its old islands behind and stack new ones on them.
    for (let k = startIndex; k < buildings.length; k++) {
      buildings[k].temp_block_id = plotId;
      if (!buildings[k].name) buildings[k].name = monument ? 'LANDMARK' : 'PARK';
    }
  });

  // Placement ignores overpasses so the ground beneath stays buildable; nothing there
  // stops a tower rising through a deck, so anything under one is capped just below it.
  // Applies to water bridges too, which pierce buildings for the same reason.
  return {
    blocks,
    roads: roadsWithRoundabouts,
    buildings: clampBuildingsUnderDecks(buildings, overpasses),
    overpasses,
    waterBodies: [...generatedWater, ...pondPolys],
  };
}
