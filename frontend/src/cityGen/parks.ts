import type { Block, RawBuilding, Rng } from './types';
import type { IsBlocked } from './collision';
import { type Polygon, pointInPolygon } from './water';

/** Holographic foliage colour shared by trunk and canopy. */
const HOLO_GREEN = '#00ff66';

/** How often a park gets a pond, and how much of the plot it takes. */
const POND_CHANCE = 0.4;
const POND_MIN = 0.18;
const POND_MAX = 0.32;

/** Points around a pond's edge, and how far each strays from a circle. */
const POND_LOBES = 12;
const POND_JITTER = 0.25;

/**
 * A pond somewhere in a park plot, or nothing.
 *
 * Unlike generated rivers and lakes this runs *after* the split, because a park only
 * exists once the split has produced the block it sits in. That is safe precisely
 * because a pond is contained by its plot: it never reaches a road, so nothing needs
 * re-cutting and no bridge is called for.
 */
function generatePond(block: Block, bw: number, bd: number, isBlocked: IsBlocked, rng: Rng): Polygon | null {
  if (rng() >= POND_CHANCE) return null;

  const span = Math.min(bw, bd);
  const radius = (span * (POND_MIN + rng() * (POND_MAX - POND_MIN))) / 2;

  // Offset from the plot centre so ponds do not all sit dead centre, but not so far
  // that the outline reaches the plot edge.
  const slack = Math.max(0, span / 2 - radius * 1.5);
  const cx = block.x + (rng() - 0.5) * slack;
  const cz = block.z + (rng() - 0.5) * slack;

  // A pond on a road or over an existing structure reads as a mistake. isBlocked
  // already composes every reason a footprint is unusable, so ask it rather than
  // re-deriving the checks here.
  if (isBlocked(cx, cz, radius * 2, radius * 2, 0.5)) return null;

  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < POND_LOBES; i++) {
    const a = (i / POND_LOBES) * Math.PI * 2;
    const r = radius * (1 + (rng() - 0.5) * POND_JITTER);
    points.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return { points };
}

/**
 * Fill a plot with a park: scattered low-poly holographic trees, each a
 * cylinder trunk with a pyramid or box canopy parented to it, and sometimes a pond.
 *
 * Trees that would collide with existing geometry are skipped rather than
 * relocated, so a crowded plot simply ends up sparser.
 *
 * Returns the pond outlines the plot produced, for the caller to persist as water.
 * They are returned rather than pushed into `out` because a pond is not a building —
 * the collision grid and the height taper have no meaning for one.
 */
export function generatePark(
  block: Block,
  bw: number,
  bd: number,
  out: RawBuilding[],
  isBlocked: IsBlocked,
  rng: Rng,
  withPonds = false
): Polygon[] {
  // Guarded rather than filtered afterwards so an unponded run draws no randomness for
  // one, and a seed keeps reproducing the park it produced before ponds existed.
  const pond = withPonds ? generatePond(block, bw, bd, isBlocked, rng) : null;
  const numPlants = 6 + Math.floor(rng() * 7); // 6 to 12 trees

  for (let i = 0; i < numPlants; i++) {
    const px = block.x + (rng() - 0.5) * bw * 0.8;
    const pz = block.z + (rng() - 0.5) * bd * 0.8;

    if (isBlocked(px, pz, 0.4, 0.4, 0.5)) continue;
    // Trees are placed after the pond so they can stand back from it. The
    // whole-plot water test in the caller runs before the pond exists, so nothing
    // else will move them.
    if (pond && pointInPolygon(pond, px, pz)) continue;

    const trunkH = 2.0 + rng() * 2.5;
    const trunkW = 0.4;
    out.push({
      name: '', description: '', x: px, y: 0, z: pz,
      width: trunkW, depth: trunkW, height: trunkH,
      color: HOLO_GREEN, shape: 'cylinder', has_signage: 0,
    });

    const canopyW = 1.5 + rng() * 1.0;
    const canopyH = 2.0 + rng() * 1.5;
    const canopyShape = rng() > 0.5 ? 'pyramid' : 'box';
    out.push({
      name: 'HOLOTREE_CANOPY', x: px, y: trunkH, z: pz,
      width: canopyW, depth: canopyW, height: canopyH,
      color: HOLO_GREEN, shape: canopyShape, parent_name: 'ROOT',
    });
  }

  return pond ? [pond] : [];
}
