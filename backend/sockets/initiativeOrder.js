/**
 * Where a combatant stands in the initiative order, so the order as the GM dragged it stands (the user, 2026-11-20: "drags
 * should survive ... so when new users/npcs join the list stands").
 *
 * A drag or a late join gives a combatant a hidden `place` only where its roll doesn't already put it there; the tracker
 * still shows the `score` it rolled. Rolls are sorted by place, so a roll arriving later slots in around the dragged order rather than
 * sorting it away. A re-roll is a new combatant entry with no place: a new roll is a new place.
 */

/** Where it stands: where a drag or a late join put it, or else its roll. */
const placeOf = (c) => (typeof c.place === 'number' ? c.place : c.score);

/** The smallest lift that keeps two tied combatants in the order they stand. */
const STEP = 0.001;

/**
 * Every place no longer needed let go, in place: one whose roll falls strictly between its neighbors' places stands by its
 * roll again. Strictly, so the order never comes to lean on a tie; round again till nothing changes, as letting one go
 * can free the next.
 */
const tidy = (list) => {
  for (let changed = true; changed;) {
    changed = false;
    list.forEach((x, i) => {
      if (typeof x.place !== 'number') return;
      const hi = i > 0 ? placeOf(list[i - 1]) : Infinity;
      const lo = i < list.length - 1 ? placeOf(list[i + 1]) : -Infinity;
      if (x.score < hi && x.score > lo) { delete x.place; changed = true; }
    });
  }
  return list;
};

/**
 * The one now at `index` (just dragged there) placed between its new neighbors, worked out from its own roll every time,
 * never from a place an earlier drag gave it, so drags back and forth can't add up (the user, 2026-11-20):
 * - its roll already falls between them: no place, its roll stands (dragged back to where it was, it is as it was);
 * - otherwise a place a step inside the gap, on the side nearest its roll, so later rolls fall as near as can be to
 *   where they would have;
 * - between two who tie (no gap to step into): halfway, and the ones above lifted a step at a time, only as far up as
 *   needed, to keep the order strict.
 * Then every place no longer needed is let go (tidy), so none is left behind by a drag back.
 * A new list; the turn is not touched.
 */
const keepDrag = (list, index) => {
  const out = list.map((c) => ({ ...c }));
  const moved = out[index];
  if (!moved) return out;
  delete moved.place;
  const above = out[index - 1];
  const below = out[index + 1];
  const hi = above ? placeOf(above) : Infinity;
  const lo = below ? placeOf(below) : -Infinity;
  if (moved.score < hi && moved.score > lo) return tidy(out);
  if (hi - lo > 2 * STEP) {
    moved.place = moved.score >= hi ? hi - STEP : lo + STEP;
    return tidy(out);
  }
  // Here it has both neighbors (an open end is never a tie), and ties the one below: lifted over it, and on up, each one
  // a step over the one under it, till one already stands over.
  moved.place = (hi + lo) / 2;
  for (let i = index + 1; i > 0 && placeOf(out[i - 1]) <= placeOf(out[i]); i--) out[i - 1].place = placeOf(out[i]) + STEP;
  return tidy(out);
};

/** A late joiner at the bottom of `list`, whatever its roll, kept there: a place a step under the last one's where its roll isn't already. */
const atBottom = (list, combatant) => {
  const last = list[list.length - 1];
  return last && combatant.score >= placeOf(last) ? { ...combatant, place: placeOf(last) - STEP } : combatant;
};
/** Shadowrun's pass: the roll and the place both down by `by`. */
const lowered = (c, by) => ({ ...c, score: c.score - by, ...(typeof c.place === 'number' ? { place: c.place - by } : {}) });

module.exports = { placeOf, keepDrag, atBottom, lowered, STEP };
