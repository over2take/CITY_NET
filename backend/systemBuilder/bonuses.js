// The three ways a bonus counts (7e1; approved mockup docs/mockups/items.html, 2026-11-10): ADD, every one summed;
// BONUSES STOP AT, set on the stat or formula it caps, after them; and AT LEAST, last, setting the value unless it is
// already higher (an Amulet of Health's CON 19, a Belt of Giant Strength's STR 21, which passes a cap of 20 as the book
// has it). Two +2s never pass the cap. A value already over it, as typed or worked out, is never cut back; it just
// takes no more.
//
// Each bonus says what it really gave (`got`), for the sheet to name what was cut: the latest ones first, as they are
// the ones that met the cap. Pure.

const LEAST = 'least';
/** BONUSES STOP AT, and an AT LEAST amount: whole numbers in this range. */
const STOP_LIMIT = 9999;

/**
 * A value with its bonuses: { value, lines }. `adds` and `least` are [{ feature, amount }]; `stop` a cap or null.
 * Each line is { feature, amount, got } with `least: true` for an AT LEAST and `stop` where the cap cut it.
 */
const applyBonuses = (base, { adds = [], least = [], stop = null } = {}) => {
  const sum = adds.reduce((n, a) => n + a.amount, 0);
  const top = stop === null ? Infinity : Math.max(stop, base);
  // Never below the value as it was, so bonuses that take away are never capped.
  let value = Math.min(base + sum, top);
  // What the cap cut, taken off the latest positive bonuses first.
  let cut = base + sum - value;
  const gave = adds.map((a) => ({ ...a, got: a.amount }));
  for (let i = gave.length - 1; i >= 0 && cut > 0; i -= 1) {
    if (gave[i].amount <= 0) continue;
    const off = Math.min(cut, gave[i].amount);
    gave[i] = { ...gave[i], got: gave[i].amount - off, stop };
    cut -= off;
  }
  const lines = [...gave];
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
