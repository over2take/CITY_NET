import type { Block, RawBuilding, Rng } from './types';

/**
 * Monuments — small civic ornaments for a traffic island.
 *
 * Separate from `landmarks.ts` on grounds of scale, which is the whole point. A
 * landmark is a hero building 150 to 220 units tall, sized to anchor a skyline from
 * across the city. Putting one on a roundabout produced a tower rising out of a traffic
 * island, which is not what a roundabout has in the middle of it.
 *
 * Everything here is proportional to the island span, so a small circus gets a small
 * ornament and a large one gets something worth looking at, with no absolute heights to
 * go wrong when the road widths are next retuned.
 *
 * **On detail.** A first version was two stacked boxes and read as exactly that. The
 * renderer supports more than a box — `cylinder`, `sphere`, `pyramid` (a cone) and all
 * three rotation axes. Note which shape is *not* in that list: see `SHAPES` below. Silhouette is what carries a monument
 * at this size, so these use the lot: stepped plinths turned 45° against each other,
 * rings of bollards, tapered shafts, finials. The segment count stays at the app's
 * `POLY_COUNT` — raising it is what made these look foreign.
 */

/** Monument height as a multiple of the island span, per style. */
const COLUMN_HEIGHT = 1.5;
const STATUE_HEIGHT = 1.0;
const FOUNTAIN_HEIGHT = 0.3;
const CLOCK_HEIGHT = 1.5;

export const MONUMENT_STYLE_COUNT = 6;

/**
 * The app-wide "inherit the theme" sentinel, which is what every other structure uses.
 *
 * `#00ff00` is not a colour here. The renderer resolves a part as
 * `(p.color && p.color !== '#00ff00') ? p.color : district_color ?? theme.primary`, so
 * this exact value is the way a structure says "no opinion, use the theme" — which is
 * why the generated city stores it on some two thousand buildings.
 *
 * An earlier attempt to calm monuments down set an explicit muted green instead. That
 * opted them out of the theme system altogether: they stopped matching their
 * neighbours and would have ignored a theme switch entirely. Density, not colour, is
 * what made them stand out, so that is what was reduced instead.
 */
const MONUMENT_COLOR = '#00ff00';

/**
 * Shapes a monument may use.
 *
 * `rhombus` is deliberately absent, and this is not a style preference. In this app a
 * rhombus *is* a player or NPC token: `TOKEN_SHAPES` on the server treats it as one, a
 * region purge spares it as player content, and `OverlapChecker` registers it in
 * `activeRhombuses` so that structures containing it can be made transparent — which is
 * how you see a token standing behind a wall.
 *
 * Using it as an octahedral finial therefore made each monument publish a fake token
 * inside itself. The overlap check found it, concluded a token was standing in the
 * structure, and dropped the fill to zero opacity — a monument that turned itself
 * invisible. It also survived every regenerate as "player content", orphaning itself
 * from the deleted root. The statue and the fountain, the two styles with no finial,
 * were the only ones that ever looked right.
 */
const SHAPES = ['box', 'cylinder', 'sphere', 'pyramid'] as const;

/**
 * The app's segment count, used by every structure on the map.
 *
 * Everything is drawn as a wireframe, so `polyCount` is not a quality setting — it is
 * the look. At 5 a cylinder is a pentagonal prism with five vertical edges, which is
 * what the whole city is built from. At 16 it is a dense cage of lines that reads as a
 * bright striped mass beside its neighbours, which is exactly how monuments ended up
 * looking like they belonged to a different app.
 */
const POLY_COUNT = 5;

/** Right angle, for turning a flat cylinder into a disc facing sideways. */
const QUARTER = Math.PI / 2;

/** Eighth turn — a square rotated by this against another reads as an eight-pointed star. */
const EIGHTH = Math.PI / 4;

/**
 * Place one monument centred on the island.
 *
 * Parts follow the same convention as the landmark styles: a single unparented root
 * first, then `ROOT` children the caller groups under it once the root has an id.
 * Colour and segment count both stay on the app-wide values — see `MONUMENT_COLOR` and
 * `POLY_COUNT`. Both were overridden at some point and both times the result was a
 * structure that did not look like it belonged to the same city.
 */
export function generateMonument(block: Block, span: number, out: RawBuilding[], rng: Rng): void {
  const style = Math.floor(rng() * MONUMENT_STYLE_COUNT);
  const color = MONUMENT_COLOR;
  const { x, z } = block;
  let rooted = false;

  /** Emit a part, making the first one the unparented root. */
  const part = (p: Partial<RawBuilding> & { y: number; width: number; height: number }) => {
    const base: RawBuilding = {
      name: '', x, z, depth: p.width, color, shape: 'box', polyCount: POLY_COUNT,
      ...(p as object),
    } as RawBuilding;
    if (!rooted) {
      base.description = '';
      rooted = true;
    } else {
      base.parent_name = 'ROOT';
    }
    out.push(base);
  };

  /** Repeat something evenly around a circle — bollards, spouts, corner posts. */
  const around = (count: number, radius: number, make: (px: number, pz: number, angle: number) => void) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      make(x + Math.cos(a) * radius, z + Math.sin(a) * radius, a);
    }
  };

  if (style === 0) {
    // Victory column. Three plinth steps turned against each other, a fluted shaft, a
    // capital, and a faceted finial — then a ring of bollards to give the base a skirt.
    let y = 0;
    const steps = [0.56, 0.46, 0.38];
    steps.forEach((w, i) => {
      const h = span * 0.05;
      part({ y, width: span * w, height: h, rotation: i % 2 ? EIGHTH : 0 });
      y += h;
    });

    const shaftW = span * 0.13;
    const shaftH = span * COLUMN_HEIGHT * 0.42;
    part({ y, width: shaftW, height: shaftH, shape: 'cylinder' });
    y += shaftH;

    part({ y, width: span * 0.2, height: span * 0.06, shape: 'cylinder' });
    y += span * 0.06;
    part({ y, width: span * 0.17, height: span * 0.22, shape: 'pyramid' });

    around(4, span * 0.42, (px, pz) =>
      part({ x: px, z: pz, y: 0, width: span * 0.05, height: span * 0.09, shape: 'cylinder' }));
    return;
  }

  if (style === 1) {
    // Statue: a plinth, then a figure assembled from a torso, a head and two arms, all
    // turned to one bearing so it reads as facing somewhere rather than standing to
    // attention. The arms are what stop it being a post on a box.
    const facing = rng() * Math.PI * 2;
    const plinthW = span * 0.34;
    const plinthH = span * STATUE_HEIGHT * 0.26;
    part({ y: 0, width: plinthW, height: plinthH, rotation: facing });
    part({ y: plinthH, width: plinthW * 1.12, height: span * 0.04, rotation: facing });

    const deckY = plinthH + span * 0.04;
    const torsoW = span * 0.13;
    const torsoH = span * STATUE_HEIGHT * 0.42;
    part({ y: deckY, width: torsoW, depth: torsoW * 0.62, height: torsoH, rotation: facing });

    const headY = deckY + torsoH;
    part({ y: headY, width: span * 0.09, height: span * 0.09, shape: 'sphere' });

    // One arm raised, one at rest — the asymmetry is most of the silhouette.
    part({
      x: x + Math.cos(facing + QUARTER) * torsoW * 0.7,
      z: z + Math.sin(facing + QUARTER) * torsoW * 0.7,
      y: deckY + torsoH * 0.45, width: span * 0.045, height: torsoH * 0.75,
      rotation: facing, rotation_z: -EIGHTH,
    });
    part({
      x: x - Math.cos(facing + QUARTER) * torsoW * 0.7,
      z: z - Math.sin(facing + QUARTER) * torsoW * 0.7,
      y: deckY + torsoH * 0.2, width: span * 0.045, height: torsoH * 0.6,
      rotation: facing, rotation_z: EIGHTH * 0.4,
    });
    return;
  }

  if (style === 2) {
    // Fountain: three tiers of narrowing basins with a jet through the middle and
    // spouts around the rim. The only style broader than it is tall, which is what
    // keeps a run of roundabouts from all reading the same.
    const basinW = span * 0.78;
    const basinH = span * FOUNTAIN_HEIGHT * 0.4;
    part({ y: 0, width: basinW, height: basinH, shape: 'cylinder' });
    part({ y: basinH, width: basinW * 0.92, height: span * 0.02, shape: 'cylinder' });

    let y = basinH + span * 0.02;
    const tiers = [0.3];
    for (const w of tiers) {
      part({ y, width: span * 0.08, height: span * 0.12, shape: 'cylinder' });
      y += span * 0.12;
      part({ y, width: span * w, height: span * 0.05, shape: 'cylinder' });
      y += span * 0.05;
    }

    part({ y, width: span * 0.05, height: span * 0.22, shape: 'cylinder' });
    y += span * 0.22;
    part({ y, width: span * 0.1, height: span * 0.1, shape: 'sphere' });

    around(4, basinW * 0.36, (px, pz) =>
      part({ x: px, z: pz, y: basinH, width: span * 0.05, height: span * 0.1, shape: 'cylinder' }));
    return;
  }

  if (style === 3) {
    // Clock tower: a tapering stack with a clock face on each side, a belfry and a
    // spire. The faces are flat cylinders stood on edge — the one place the rotation
    // axes earn their keep, since a disc has to face outward to read as a clock.
    let y = 0;
    part({ y, width: span * 0.34, height: span * 0.08 });
    y += span * 0.08;
    part({ y, width: span * 0.28, height: span * 0.05, rotation: EIGHTH });
    y += span * 0.05;

    const shaftW = span * 0.24;
    const shaftH = span * CLOCK_HEIGHT * 0.62;
    part({ y, width: shaftW, height: shaftH });

    const faceY = y + shaftH * 0.78;
    const faceR = shaftW * 0.52;
    const faceW = span * 0.15;
    // Two on the X faces, two on the Z faces; a cylinder's axis is Y, so each is
    // tipped a quarter turn about the axis that leaves it facing outward.
    part({ x: x + faceR, y: faceY, width: faceW, height: span * 0.02, shape: 'cylinder', rotation_z: QUARTER });
    part({ x: x - faceR, y: faceY, width: faceW, height: span * 0.02, shape: 'cylinder', rotation_z: QUARTER });
    part({ z: z + faceR, y: faceY, width: faceW, height: span * 0.02, shape: 'cylinder', rotation_x: QUARTER });
    part({ z: z - faceR, y: faceY, width: faceW, height: span * 0.02, shape: 'cylinder', rotation_x: QUARTER });

    y += shaftH;
    part({ y, width: span * 0.3, height: span * 0.1 });
    y += span * 0.1;
    part({ y, width: span * 0.32, height: span * 0.26, shape: 'pyramid', polyCount: POLY_COUNT, rotation: EIGHTH });
    y += span * 0.26;
    part({ y, width: span * 0.07, height: span * 0.12, shape: 'pyramid' });
    return;
  }

  if (style === 4) {
    // Triumphal arch: two piers carrying a lintel, with an attic above. Reads as a gate
    // rather than an object, which is a different silhouette from everything else here
    // and the one you can see through.
    const facing = Math.floor(rng() * 4) * QUARTER;
    const gap = span * 0.24;
    const pierW = span * 0.15;
    const pierH = span * 0.52;
    const dx = Math.cos(facing);
    const dz = Math.sin(facing);

    part({ x: x + dx * gap, z: z + dz * gap, y: 0, width: pierW, height: pierH, rotation: facing });
    part({ x: x - dx * gap, z: z - dz * gap, y: 0, width: pierW, height: pierH, rotation: facing });

    const spanW = gap * 2 + pierW;
    part({ y: pierH, width: spanW, depth: pierW, height: span * 0.13, rotation: facing });
    part({ y: pierH + span * 0.13, width: spanW * 0.82, depth: pierW * 0.9, height: span * 0.16, rotation: facing });
    part({ y: pierH + span * 0.29, width: span * 0.13, height: span * 0.18, shape: 'pyramid' });

    around(4, span * 0.4, (px, pz) =>
      part({ x: px, z: pz, y: 0, width: span * 0.05, height: span * 0.1, shape: 'cylinder' }));
    return;
  }

  // Obelisk: a squat base under a shaft that tapers in three turned stages to a point.
  // The turn between stages is what keeps a plain taper from reading as one long box.
  let y = 0;
  part({ y, width: span * 0.36, height: span * 0.07 });
  y += span * 0.07;
  part({ y, width: span * 0.26, height: span * 0.08, rotation: EIGHTH });
  y += span * 0.08;

  const stages = [0.17, 0.135, 0.1];
  for (let i = 0; i < stages.length; i++) {
    const h = span * 0.29;
    part({ y, width: span * stages[i], height: h, rotation: i % 2 ? EIGHTH : 0 });
    y += h;
  }
  part({ y, width: span * 0.1, height: span * 0.16, shape: 'pyramid', polyCount: POLY_COUNT });

  around(4, span * 0.34, (px, pz) =>
    part({ x: px, z: pz, y: 0, width: span * 0.06, height: span * 0.14, shape: 'cylinder' }));

}

export { COLUMN_HEIGHT, STATUE_HEIGHT, FOUNTAIN_HEIGHT, CLOCK_HEIGHT, POLY_COUNT, MONUMENT_COLOR, SHAPES };
