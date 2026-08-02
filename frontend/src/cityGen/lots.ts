import type { Block, Rng } from './types';

/**
 * Subdividing a block into building lots.
 *
 * Every layout until now handed the generator one block per city block, and the block
 * got one structure. That is right for a tower in a park and wrong for a downtown: the
 * thing that makes a dense city look dense is many narrow buildings sharing party walls
 * along the street, with the middle of the block left as back lots.
 *
 * So this cuts a block into lots around its rim, facing the streets, and leaves the
 * interior empty. Each lot comes back as a `Block` with `lot: true`, which tells the
 * generator the footprint is already decided — no road padding, no aspect clamp, no
 * per-zone setback, since all three exist to turn a whole city block into one sensible
 * plot and would here just pull the neighbours apart again.
 */

/** How deep a building lot is, from the street into the block. */
export const LOT_DEPTH = 20;

/** How much that depth varies between blocks, as a fraction of it. */
export const LOT_DEPTH_VARIANCE = 0.3;

/** Street frontage per lot, before jitter. Narrow frontages are the look. */
const LOT_FRONTAGE_MIN = 11;
const LOT_FRONTAGE_MAX = 24;

/** A block with less than this left in the middle is built solid instead. */
const MIN_COURTYARD = 14;

/**
 * How much yard a block is allowed to keep.
 *
 * One ring of lots around a large block leaves an enormous void in the middle — on a
 * 226 by 114 block a 20-deep rim leaves 186 by 74 of nothing, which is most of the
 * block. Real dense blocks are built out to a modest yard, so the interior is
 * subdivided again rather than abandoned: another ring if it is big enough to hold one,
 * a single run of lots if it is only a slab, and left as yard once it is under this.
 */
const MAX_YARD = 40;

/** Gap between neighbouring lots. Small — they are meant to share party walls. */
const PARTY_WALL_GAP = 0.6;

/** Lots below this frontage are dropped rather than built as slivers. */
const MIN_FRONTAGE = 6;

/**
 * Split a run of street frontage into lots of varying width.
 *
 * Widths vary because a row of identical frontages reads as a barracks, and real
 * frontages differ because they were sold off separately.
 */
function frontages(length: number, rng: Rng): number[] {
  const out: number[] = [];
  let used = 0;
  while (used < length) {
    const want = LOT_FRONTAGE_MIN + rng() * (LOT_FRONTAGE_MAX - LOT_FRONTAGE_MIN);
    const remaining = length - used;
    // Absorb a short remainder into the last lot rather than leaving a sliver.
    if (remaining - want < MIN_FRONTAGE) {
      out.push(remaining);
      break;
    }
    out.push(want);
    used += want;
  }
  return out.filter((w) => w >= MIN_FRONTAGE);
}

/**
 * Lots around the rim of a block, interior left as back lots.
 *
 * A block too small to have a rim and a middle is returned as a single lot — cutting a
 * courtyard out of it would leave four slivers around a hole.
 */
export function perimeterLots(block: Block, rng: Rng, depthBudget = 2): Block[] {
  // Rim depth varies block to block. A constant depth makes every terrace the same
  // thickness, which reads as a machine even when the frontages differ.
  const wanted = LOT_DEPTH * (1 - LOT_DEPTH_VARIANCE + rng() * LOT_DEPTH_VARIANCE * 2);
  const depth = Math.min(wanted, Math.min(block.w, block.d) / 2);
  const innerW = block.w - depth * 2;
  const innerD = block.d - depth * 2;

  // Too thin for a rim and a middle. Not one building the length of the block — that is
  // a monolith where a terrace belongs — but a single run of lots along its length.
  if (innerW < MIN_COURTYARD || innerD < MIN_COURTYARD) {
    return slabLots(block, rng);
  }

  const lots: Block[] = [];
  const minX = block.x - block.w / 2;
  const minZ = block.z - block.d / 2;

  // The two street-facing runs along x take the full width, so the corners belong to
  // them; the runs along z then fill only the gap between, and nothing overlaps.
  for (const side of [-1, 1]) {
    let cursor = 0;
    for (const front of frontages(block.w, rng)) {
      const w = front - PARTY_WALL_GAP;
      if (w >= MIN_FRONTAGE) {
        lots.push({
          x: minX + cursor + front / 2,
          z: block.z + side * (block.d / 2 - depth / 2),
          w,
          d: depth,
          lot: true,
        });
      }
      cursor += front;
    }
  }

  for (const side of [-1, 1]) {
    let cursor = 0;
    for (const front of frontages(innerD, rng)) {
      const d = front - PARTY_WALL_GAP;
      if (d >= MIN_FRONTAGE) {
        lots.push({
          x: block.x + side * (block.w / 2 - depth / 2),
          z: minZ + depth + cursor + front / 2,
          w: depth,
          d,
          lot: true,
        });
      }
      cursor += front;
    }
  }

  lots.push(...fillInterior({ x: block.x, z: block.z, w: innerW, d: innerD }, rng, depthBudget));
  return lots;
}

/**
 * Build out what is left in the middle of a block, down to a modest yard.
 *
 * Rings inward while there is room for another one, then stops and leaves the rest as
 * yard. That is what makes a very large block read as built out rather than hollow,
 * without going to the other extreme of a solid slab with nothing behind it.
 *
 * `depthBudget` only guards against a pathological input; each ring removes at least
 * two rim depths, so this terminates on its own.
 */
function fillInterior(inner: Block, rng: Rng, depthBudget: number): Block[] {
  const short = Math.min(inner.w, inner.d);
  const long = Math.max(inner.w, inner.d);
  if (short <= MAX_YARD && long <= MAX_YARD) return [];

  if (depthBudget > 0 && short >= LOT_DEPTH * 2 + MIN_COURTYARD) {
    return perimeterLots(inner, rng, depthBudget - 1);
  }

  // Whatever is left once the rings run out is the yard, and it stays open. Filling it
  // as well took a 226 by 114 block to 97% built — a solid slab with no back lot at
  // all, which is the opposite mistake to the one this was fixing.
  return [];
}

/** A run of lots along the longer axis, each the full depth of the slab. */
function slabLots(slab: Block, rng: Rng): Block[] {
  const alongX = slab.w >= slab.d;
  const long = alongX ? slab.w : slab.d;
  if (Math.min(slab.w, slab.d) < MIN_FRONTAGE) return [];

  const out: Block[] = [];
  let cursor = 0;
  for (const front of frontages(long, rng)) {
    const size = front - PARTY_WALL_GAP;
    if (size >= MIN_FRONTAGE) {
      out.push(alongX
        ? { x: slab.x - slab.w / 2 + cursor + front / 2, z: slab.z, w: size, d: slab.d, lot: true }
        : { x: slab.x, z: slab.z - slab.d / 2 + cursor + front / 2, w: slab.w, d: size, lot: true });
    }
    cursor += front;
  }
  return out;
}
