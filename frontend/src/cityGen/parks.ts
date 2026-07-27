import type { Block, RawBuilding, Rng } from './types';
import type { IsBlocked } from './collision';

/** Holographic foliage colour shared by trunk and canopy. */
const HOLO_GREEN = '#00ff66';

/**
 * Fill a plot with a park: scattered low-poly holographic trees, each a
 * cylinder trunk with a pyramid or box canopy parented to it.
 *
 * Trees that would collide with existing geometry are skipped rather than
 * relocated, so a crowded plot simply ends up sparser.
 */
export function generatePark(
  block: Block,
  bw: number,
  bd: number,
  out: RawBuilding[],
  isBlocked: IsBlocked,
  rng: Rng
): void {
  const numPlants = 6 + Math.floor(rng() * 7); // 6 to 12 trees

  for (let i = 0; i < numPlants; i++) {
    const px = block.x + (rng() - 0.5) * bw * 0.8;
    const pz = block.z + (rng() - 0.5) * bd * 0.8;

    if (isBlocked(px, pz, 0.4, 0.4, 0.5)) continue;

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
}
