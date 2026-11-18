// A COUNT column on a line of gear (8a4; approved mockup docs/mockups/item-types.html, 2026-11-14, decision 5):
// so many of so many (AMMO 4 / 6), spent one at a time by the button its column names (FIRE, USE, CAST), and refilled
// by a rest the column names (or one that counts as it), or by RELOAD from a carried line of one or more items the
// column names (Pistol Rounds, AP Rounds), taking from that line's quantity; asked which when several are carried.
// A line's current number is kept on it, `counts: { ammo: 4 }`, unsaid where nothing is spent (itemTypes.js).
// Pure: the sheet's data in, its next gear out.

const { lineColumns, typesOf } = require('./itemTypes');
const { namesOf } = require('./choices');
const { linesOf } = require('./gearRolls');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const key = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');

/** The gear written back as the sheet had it: a JSON string, as the sheet stores it, unless it was a list. */
const written = (data, rows) => (isPlainObject(data) && Array.isArray(data.inventory) ? rows : JSON.stringify(rows));
const itemsOf = (definition) => list(isPlainObject(definition.items) ? definition.items.list : undefined).filter(isPlainObject);
/** How many a line is, and whether it's on you, read as the sheet reads them (frontend sheets/inventory.ts normaliseItem). */
const qtyOf = (line) => { const n = Math.floor(Number(line.qty)); return Number.isFinite(n) && n >= 1 ? n : 1; };
const carried = (line) => { const c = typeof line.carry === 'string' ? line.carry.trim().toLowerCase() : ''; return c === 'readied' || c === 'stowed'; };
const nameOf = (line, type) => (typeof line.name === 'string' && line.name.trim() ? line.name.trim() : (type.one || type.label || type.id));

/** Line `index`'s COUNT `column`: its now and most, and what its column says; or why it isn't one. */
const countAt = (definition, rows, index, column) => {
  const line = rows[index];
  if (!Number.isInteger(index) || !isPlainObject(line)) return { error: 'No such line' };
  const labels = namesOf(definition);
  const names = { known: (n) => labels.has(n), refused: (n) => `@${n} isn't one of this system's names` };
  const cols = lineColumns(definition, line, itemsOf(definition), names);
  const type = typesOf(definition).find((t) => t.id === cols.type);
  const col = type && type.columns.find((c) => c.id === column);
  if (!col || col.kind !== 'count') return { error: 'Not a COUNT' };
  const { now, most } = cols.counts[column];
  const items = itemsOf(definition);
  const reload = list(col.reload).map((id) => items.find((i) => i.id === id)).filter(Boolean).map((i) => i.label || i.id);
  return { line, type, col, now, most, reload, name: nameOf(line, type), label: (col.label || col.id).toUpperCase() };
};

/** A line with its COUNT at `now`: unsaid again when full, as a line that has spent nothing is. */
const withCount = (line, column, now, most) => {
  const counts = { ...(isPlainObject(line.counts) ? line.counts : {}) };
  if (now >= most) delete counts[column]; else counts[column] = now;
  const next = { ...line, counts };
  if (!Object.keys(counts).length) delete next.counts;
  return next;
};

/**
 * One spent by the column's button: `{ ok: true, data, now, most, line, label, button }`, `data` the sheet's with its
 * gear changed; or `{ ok: false, error }`, none left among them.
 */
const spendCount = (definition, data, index, column) => {
  const rows = linesOf(data);
  const c = countAt(definition, rows, index, column);
  if (c.error) return { ok: false, error: c.error };
  if (c.now <= 0) return { ok: false, error: `No ${c.label} left in the ${c.name}` };
  const next = rows.map((r, i) => (i === index ? withCount(r, column, c.now - 1, c.most) : r));
  return { ok: true, data: { ...data, inventory: written(data, next) }, now: c.now - 1, most: c.most, line: c.name, label: c.label, button: (c.col.button || 'USE').toUpperCase() };
};

/**
 * RELOAD: filled from a carried line (readied or stowed, not stashed) named like one of the column's items, as much
 * as it has, taken from its quantity; that line gone when nothing is left of it. With several, which one is asked:
 * `{ ok: false, ask: [{ line, name, qty }] }` until `from` names one. Else `{ ok: true, data, now, most, took, from,
 * line, label }`, or `{ ok: false, error }`: full, or nothing carried to reload from.
 */
const reloadCount = (definition, data, index, column, from) => {
  const rows = linesOf(data);
  const c = countAt(definition, rows, index, column);
  if (c.error) return { ok: false, error: c.error };
  if (!c.reload.length) return { ok: false, error: `The ${c.label} is refilled another way` };
  if (c.now >= c.most) return { ok: false, error: `The ${c.name}'s ${c.label} is full` };
  const wanted = new Set(c.reload.map(key));
  const sources = rows.map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i !== index && isPlainObject(r) && carried(r) && wanted.has(key(r.name)));
  if (!sources.length) return { ok: false, error: `Nothing carried to reload from: ${c.reload.join(' or ')}` };
  if (sources.length > 1 && from === undefined) return { ok: false, ask: sources.map(({ r, i }) => ({ line: i, name: r.name.trim(), qty: qtyOf(r) })) };
  const source = from === undefined ? sources[0] : sources.find((s) => s.i === from);
  if (!source) return { ok: false, error: `Not one to reload from: ${c.reload.join(' or ')}` };
  const took = Math.min(c.most - c.now, qtyOf(source.r));
  const left = qtyOf(source.r) - took;
  const next = rows.map((r, i) => (i === index ? withCount(r, column, c.now + took, c.most) : i === source.i ? { ...r, qty: left } : r))
    .filter((r, i) => i !== source.i || left > 0);
  return { ok: true, data: { ...data, inventory: written(data, next) }, now: c.now + took, most: c.most, took, from: source.r.name.trim(), line: c.name, label: c.label };
};

/**
 * A rest's refills (`ends`: it and every rest it counts as): each COUNT whose column names one of them, full again.
 * `{ inventory, refilled: [{ index, column, line, label, from, to }] }`, `inventory` null where nothing changed.
 */
const refillCounts = (definition, data, ends) => {
  const rows = linesOf(data);
  const refilled = [];
  const next = rows.map((r, index) => {
    if (!isPlainObject(r) || !isPlainObject(r.counts)) return r;
    let line = r;
    for (const column of Object.keys(r.counts)) {
      const c = countAt(definition, rows, index, column);
      if (c.error || !c.col.refill || !ends.has(c.col.refill) || c.now >= c.most) continue;
      refilled.push({ index, column, line: c.name, label: c.label, from: c.now, to: c.most });
      line = withCount(line, column, c.most, c.most);
    }
    return line;
  });
  return { inventory: refilled.length ? written(data, next) : null, refilled };
};

module.exports = { spendCount, reloadCount, refillCounts };
