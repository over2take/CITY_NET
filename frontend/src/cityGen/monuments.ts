import type { Block, RawBuilding, Rng } from './types';

/**
 * Monuments — small civic ornaments for a traffic island.
 *
 * Separate from `landmarks.ts` on grounds of scale, which is the whole point. A
 * landmark is a hero building 150 to 220 units tall, sized to anchor a skyline from
 * across the city. Putting one on a roundabout produced a tower rising out of a traffic
 * island, which is not what a roundabout has in the middle of it.
 *
 * What a roundabout actually has is a column, a statue, a fountain, or a clock — a
 * couple of storeys at most, sized against the island rather than the city. Everything
 * here is proportional to the island span, so a small circus gets a small ornament and
 * a large one gets something worth looking at, with no absolute heights to go wrong
 * when the road widths are next retuned.
 */

/** Monument height as a multiple of the island span, per style. */
const COLUMN_HEIGHT = 1.5;
const STATUE_HEIGHT = 1.0;
const FOUNTAIN_HEIGHT = 0.3;
const CLOCK_HEIGHT = 1.5;

export const MONUMENT_STYLE_COUNT = 4;

/**
 * Place one monument centred on the island.
 *
 * Parts follow the same convention as the landmark styles: a single unparented root
 * first, then `ROOT` children the caller groups under it once the root has an id.
 * Colour is left empty — the renderer picks its own from whether the structure carries
 * data, so anything set here would be discarded.
 */
export function generateMonument(block: Block, span: number, out: RawBuilding[], rng: Rng): void {
  const style = Math.floor(rng() * MONUMENT_STYLE_COUNT);
  const color = '';
  const { x, z } = block;

  if (style === 0) {
    // Victory column: a stepped plinth carrying a slender shaft and a figure on top.
    const baseW = span * 0.42;
    const baseH = span * 0.16;
    out.push({
      name: '', description: '', x, y: 0, z,
      width: baseW, depth: baseW, height: baseH,
      color, shape: 'box',
    });
    const shaftW = span * 0.14;
    const shaftH = span * COLUMN_HEIGHT * 0.42;
    out.push({
      name: '', x, y: baseH, z,
      width: shaftW, depth: shaftW, height: shaftH,
      color, shape: 'cylinder', parent_name: 'ROOT',
    });
    out.push({
      name: '', x, y: baseH + shaftH, z,
      width: shaftW * 1.6, depth: shaftW * 1.6, height: span * 0.22,
      color, shape: 'pyramid', parent_name: 'ROOT',
    });
    return;
  }

  if (style === 1) {
    // Statue: a broad plinth and a figure, deliberately off-square so it reads as
    // something facing a direction rather than a post.
    const plinthW = span * 0.34;
    const plinthH = span * STATUE_HEIGHT * 0.3;
    out.push({
      name: '', description: '', x, y: 0, z,
      width: plinthW, depth: plinthW, height: plinthH,
      color, shape: 'box',
    });
    const figureW = span * 0.16;
    out.push({
      name: '', x, y: plinthH, z,
      width: figureW, depth: figureW * 0.6, height: span * STATUE_HEIGHT * 0.7,
      color, shape: 'box', parent_name: 'ROOT',
      rotation: rng() * Math.PI * 2,
    });
    return;
  }

  if (style === 2) {
    // Fountain: a wide, low basin with a small jet at the centre. The only style that
    // is broader than it is tall, which is what keeps a run of roundabouts from all
    // reading the same.
    const basinW = span * 0.7;
    out.push({
      name: '', description: '', x, y: 0, z,
      width: basinW, depth: basinW, height: span * FOUNTAIN_HEIGHT,
      color, shape: 'cylinder',
    });
    out.push({
      name: '', x, y: span * FOUNTAIN_HEIGHT, z,
      width: span * 0.12, depth: span * 0.12, height: span * 0.5,
      color, shape: 'cylinder', parent_name: 'ROOT',
    });
    return;
  }

  // Clock tower: the tallest of the four, and still under one and a half island spans.
  const towerW = span * 0.26;
  const towerH = span * CLOCK_HEIGHT * 0.8;
  out.push({
    name: '', description: '', x, y: 0, z,
    width: towerW, depth: towerW, height: towerH,
    color, shape: 'box',
  });
  out.push({
    name: '', x, y: towerH, z,
    width: towerW * 1.3, depth: towerW * 1.3, height: span * 0.25,
    color, shape: 'pyramid', parent_name: 'ROOT',
  });
}

export { COLUMN_HEIGHT, STATUE_HEIGHT, FOUNTAIN_HEIGHT, CLOCK_HEIGHT };
