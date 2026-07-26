import type { Block, RawBuilding, Rng } from './types';
import type { IsBlocked } from './collision';
import type { SpatialGrid } from './collision';

/** Chance any eligible plot is promoted to a landmark. */
const LANDMARK_CHANCE = 0.20;

export const LANDMARK_STYLE_COUNT = 4;

/**
 * Landmarks are visual anchors — oversized hero structures placed sparingly
 * in wealthier zones. A plot qualifies when it rolls under the chance, sits in
 * an urban-or-better zone, is either corporate or physically large, and has a
 * clear footprint.
 *
 * The rng draw happens first and unconditionally, so the random sequence does
 * not depend on the zone or plot size.
 */
export function shouldPlaceLandmark(
  block: Block,
  bw: number,
  bd: number,
  zoneTypeVal: number,
  isBlocked: IsBlocked,
  rng: Rng
): boolean {
  const roll = rng();
  return (
    roll < LANDMARK_CHANCE &&
    zoneTypeVal > 0.3 &&
    (zoneTypeVal > 0.8 || (bw > 30 && bd > 30)) &&
    !isBlocked(block.x, block.z, bw * 0.7, bd * 0.7, 2.0)
  );
}

/**
 * Place one landmark on the plot, picking a style at random.
 *
 * Every style pushes a single unparented root first (registered in the grid so
 * later placements avoid it) followed by CORP_ROOT children that the caller
 * groups under it after the root gets its database id.
 */
export function generateLandmark(
  block: Block,
  bw: number,
  bd: number,
  out: RawBuilding[],
  grid: SpatialGrid,
  rng: Rng
): void {
  const style = Math.floor(rng() * LANDMARK_STYLE_COUNT);
  const color = ''; // neutral — renderer falls back to the wireframe style
  const { x, z } = block;

  if (style === 0) {
    // Cyber-Citadel: tall central spire ringed by tiered corner buttresses.
    const spireH = 150 + rng() * 70;
    const spireW = bw * 0.45;
    const spireD = bd * 0.45;
    const root: RawBuilding = {
      name: '', description: '', x, y: 0, z,
      width: spireW, depth: spireD, height: spireH, color, shape: 'box',
    };
    out.push(root);
    grid.add(root);

    const bW = bw * 0.15;
    const bD = bd * 0.15;
    const offsets = [
      { dx: -bw * 0.35, dz: -bd * 0.35 },
      { dx: bw * 0.35, dz: -bd * 0.35 },
      { dx: -bw * 0.35, dz: bd * 0.35 },
      { dx: bw * 0.35, dz: bd * 0.35 },
    ];
    offsets.forEach((o) => {
      const bx = x + o.dx;
      const bz = z + o.dz;
      out.push({
        name: '', x: bx, y: 0, z: bz, width: bW, depth: bD,
        height: spireH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT',
      });
      out.push({
        name: '',
        x: bx - Math.sign(o.dx) * bW * 0.2,
        y: spireH * 0.4,
        z: bz - Math.sign(o.dz) * bD * 0.2,
        width: bW * 0.7, depth: bD * 0.7, height: spireH * 0.35,
        color, shape: 'box', parent_name: 'CORP_ROOT',
      });
    });

    // Crown slab and antenna
    out.push({
      name: '', x, y: spireH * 0.8, z,
      width: spireW * 1.3, depth: spireD * 1.3, height: 4.0,
      color, shape: 'box', parent_name: 'CORP_ROOT',
    });
    out.push({
      name: '', x, y: spireH, z, width: 0.3, depth: 0.3,
      height: spireH * 0.18, color, shape: 'box', parent_name: 'CORP_ROOT',
    });

  } else if (style === 1) {
    // Hyper-Pyramid Complex: stepped bases under a crown pyramid.
    const base1W = bw * 0.75;
    const base1D = bd * 0.75;
    const base1H = 8.0;
    const root: RawBuilding = {
      name: '', description: '', x, y: 0, z,
      width: base1W, depth: base1D, height: base1H, color, shape: 'box',
    };
    out.push(root);
    grid.add(root);

    const base2W = base1W * 0.75;
    const base2D = base1D * 0.75;
    const base2H = 12.0;
    out.push({
      name: '', x, y: base1H, z, width: base2W, depth: base2D,
      height: base2H, color, shape: 'box', parent_name: 'CORP_ROOT',
    });

    const pyramidH = 120 + rng() * 50;
    out.push({
      name: '', x, y: base1H + base2H, z,
      width: base2W * 0.75, depth: base2D * 0.75, height: pyramidH,
      color, shape: 'pyramid', parent_name: 'CORP_ROOT',
    });

    // Satellite obelisks at the corners
    const satOffsets = [
      { dx: -bw * 0.42, dz: -bd * 0.42 },
      { dx: bw * 0.42, dz: -bd * 0.42 },
      { dx: -bw * 0.42, dz: bd * 0.42 },
      { dx: bw * 0.42, dz: bd * 0.42 },
    ];
    satOffsets.forEach((o) => {
      const bx = x + o.dx;
      const bz = z + o.dz;
      out.push({
        name: '', x: bx, y: 0, z: bz, width: bw * 0.08, depth: bd * 0.08,
        height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT',
      });
      out.push({
        name: '', x: bx, y: 4.0, z: bz, width: bw * 0.08, depth: bd * 0.08,
        height: 25.0, color, shape: 'pyramid', parent_name: 'CORP_ROOT',
      });
    });

  } else if (style === 2) {
    // Megastructure Arch: twin pillars joined by a sky-bridge, atrium slung
    // between them. Both pillars register in the grid — the span is wide
    // enough that one root would leave the far side unguarded.
    const pillarW = bw * 0.22;
    const pillarD = bd * 0.65;
    const pillarH = 140 + rng() * 50;
    const offsetDist = bw * 0.33;

    const root: RawBuilding = {
      name: '', description: '', x: x - offsetDist, y: 0, z,
      width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box',
    };
    out.push(root);
    grid.add(root);

    const rightPillar: RawBuilding = {
      name: '', x: x + offsetDist, y: 0, z,
      width: pillarW, depth: pillarD, height: pillarH,
      color, shape: 'box', parent_name: 'CORP_ROOT',
    };
    out.push(rightPillar);
    grid.add(rightPillar);

    const archH = 12.0;
    out.push({
      name: '', x, y: pillarH - archH, z,
      width: offsetDist * 2 + pillarW, depth: pillarD * 0.9, height: archH,
      color, shape: 'box', parent_name: 'CORP_ROOT',
    });
    out.push({
      name: '', x, y: pillarH * 0.35, z,
      width: offsetDist * 1.3, depth: pillarD * 0.7, height: pillarH * 0.45,
      color, shape: 'box', parent_name: 'CORP_ROOT',
    });

    // Twin spires crowning each pillar
    out.push({
      name: '', x: x - offsetDist, y: pillarH, z, width: 0.5, depth: 0.5,
      height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT',
    });
    out.push({
      name: '', x: x + offsetDist, y: pillarH, z, width: 0.5, depth: 0.5,
      height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT',
    });

  } else {
    // Communications Array: stepped tower carrying horizontal dishes.
    const towerH = 130 + rng() * 60;
    const root: RawBuilding = {
      name: '', description: '', x, y: 0, z,
      width: bw * 0.4, depth: bd * 0.4, height: towerH * 0.3, color, shape: 'box',
    };
    out.push(root);
    grid.add(root);

    out.push({
      name: '', x, y: towerH * 0.3, z, width: bw * 0.3, depth: bd * 0.3,
      height: towerH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT',
    });
    out.push({
      name: '', x, y: towerH * 0.7, z, width: bw * 0.2, depth: bd * 0.2,
      height: towerH * 0.3, color, shape: 'box', parent_name: 'CORP_ROOT',
    });

    // Array discs, narrowing as they climb
    const discs = [
      { y: towerH * 0.45, scale: 0.65, h: 2.0 },
      { y: towerH * 0.75, scale: 0.5, h: 1.5 },
      { y: towerH * 0.92, scale: 0.32, h: 1.0 },
    ];
    discs.forEach((disc) => {
      out.push({
        name: '', x, y: disc.y, z,
        width: bw * disc.scale, depth: bd * disc.scale, height: disc.h,
        color, shape: 'box', parent_name: 'CORP_ROOT',
      });
    });

    // Central needle plus two offset side needles
    out.push({
      name: '', x, y: towerH, z, width: 0.2, depth: 0.2,
      height: towerH * 0.2, color, shape: 'box', parent_name: 'CORP_ROOT',
    });
    out.push({
      name: '', x: x - bw * 0.1, y: towerH * 0.92, z: z - bd * 0.1,
      width: 0.1, depth: 0.1, height: towerH * 0.12,
      color, shape: 'box', parent_name: 'CORP_ROOT',
    });
    out.push({
      name: '', x: x + bw * 0.1, y: towerH * 0.92, z: z + bd * 0.1,
      width: 0.1, depth: 0.1, height: towerH * 0.12,
      color, shape: 'box', parent_name: 'CORP_ROOT',
    });
  }
}
