// The ways a bonus counts (7e1; approved mockup docs/mockups/items.html, 2026-11-10; the cap moved onto the bonus, the
// user's call the same day: "+2 Con, no higher than 20"): an ADD, which may say where it STOPS AT; and AT LEAST, which
// sets the value unless it is already higher (an Amulet of Health's CON 19, a Belt of Giant Strength's STR 21).
//
// ADDs that stop somewhere count first, each judging the value as it stands (two +2s stopping at 20 never pass it), then
// the plain ADDs, then AT LEAST. So a capped bonus looks at the score before a plain +5 joins it, and the order picks are
// listed in never changes what comes out. A value already past a cap is never cut back; that bonus just adds nothing.
//
// Each bonus says what it really gave (`got`), for the sheet to name what a cap cut. Pure.

const LEAST = 'least';
/** STOPS AT on a bonus: a whole number in this range. */
const STOP_LIMIT = 9999;

/**
 * A value with its bonuses: { value, lines }. `adds` are [{ feature, amount, cap? }], `least` [{ feature, amount }].
 * Lines come in the order given: { feature, amount, got }, with `stop` where a cap cut it and `least: true` for AT LEAST.
 */
const applyBonuses = (base, { adds = [], least = [] } = {}) => {
  let value = base;
  const got = new Map();
  const capped = adds.filter((a) => a.cap !== undefined && a.cap !== null);
  const plain = adds.filter((a) => a.cap === undefined || a.cap === null);
  for (const a of [...capped, ...plain]) {
    // One adding stops at its cap, or where the value already is past it; one taking away is never held, as it never
    // passes a cap the value hasn't.
    const next = a.cap !== undefined && a.cap !== null ? Math.min(value + a.amount, Math.max(a.cap, value)) : value + a.amount;
    got.set(a, next - value);
    value = next;
  }
  const lines = adds.map((a) => ({ ...a, got: got.get(a), ...(got.get(a) !== a.amount ? { stop: a.cap } : {}) }));
  for (const l of least) {
    const next = Math.max(value, l.amount);
    lines.push({ ...l, got: next - value, least: true });
    value = next;
  }
  return { value, lines };
};

/** A cap as set: a whole number in range, or null. */
const stopOf = (v) => (Number.isSafeInteger(v) && Math.abs(v) <= STOP_LIMIT ? v : null);

module.exports = { LEAST, STOP_LIMIT, applyBonuses, stopOf };
