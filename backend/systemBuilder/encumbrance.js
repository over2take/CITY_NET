// Encumbrance (8a5a; approved mockup docs/mockups/item-types.html, 2026-11-14, decision 7; the user, 2026-10-26: shown,
// never enforced, a GM applying a condition by hand if they want one):
//
//   items: {
//     encumbrance: {
//       column: 'weight',          // COUNTED BY: the column it is pointed at. Every type with a NUMBER column of that id
//                                  // counts, one of each times how many; a type without it weighs nothing
//       unit: 'LB',                // what it is counted in, said beside it
//       capacity: '@might * 10',   // CAN CARRY: a formula, worked out as any derived value is, read as @capacity
//       bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }],   // words at a share of it, in %
//       past: 'OVERLOADED',        // the word past the last band
//       // Each band, and the word past them, may say WHAT IT MEANS and name a CONDITION it puts on (8a5d1; approved mockup
//       // docs/mockups/encumbrance-bands.html, 2026-11-18, the user: "word + optional (on/off) condition"):
//       // bands: [{ word, upto, says: 'Speed -10 ft.', condition: 'slowed' }], past_says, past_condition
//     },
//     installs: [{ ..., weighs: true }],   // WEIGHS WHILE INSTALLED (7e4's install; the user, 2026-11-11)
//   }
//
// @carried is what the lines READIED or STOWED come to: a stashed line isn't on them. An item installed (7e4) weighs only
// where its install says WEIGHS, and then wherever its line is kept, as an installed item works wherever. Formulas read
// @carried and @capacity, so a system builds its own consequence (if(@carried > @capacity, @speed - 10, @speed)); what is
// worn summed by column (@armor_defense) is 8a5b's, the builder's panel 8a5c's, and CARRYING on the sheet 8a6's.
// Pure: checks and reads.

const { typesOf, lineColumns, linesOf, NAME } = require('./itemTypes');
const { itemsOf, installOf, stateOf } = require('./items');
const { conditionsOf } = require('./conditions');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

const LIMITS = { bands: 5, upto: 1000, word: 30, unit: 12, says: 200 };
const ENCUMBRANCE_KEYS = new Set(['column', 'unit', 'capacity', 'bands', 'past', 'past_says', 'past_condition']);
const BAND_KEYS = new Set(['word', 'upto', 'says', 'condition']);
/** What formulas read: what is carried, and what can be. */
const CARRIED = 'carried';
const CAPACITY = 'capacity';

/** The system's encumbrance, where it counts one. */
const encumbranceOf = (definition) => {
  const e = isPlainObject(definition) && isPlainObject(definition.items) ? definition.items.encumbrance : undefined;
  return isPlainObject(e) && typeof e.column === 'string' ? e : null;
};
/** Whether it says what can be carried: CAN CARRY's formula. */
const capacityText = (definition) => {
  const e = encumbranceOf(definition);
  return e && typeof e.capacity === 'string' ? e.capacity : null;
};

/**
 * The system's formulas with CAN CARRY among them, as `capacity`: worked out in order with the rest, so it reads any stat
 * or formula and any formula reads it. Left out where it isn't there, or doesn't read, which the checks say.
 */
const derivedOf = (definition, parse = null) => {
  const derived = Array.isArray(definition && definition.derived) ? definition.derived : [];
  const text = capacityText(definition);
  if (!text) return derived;
  if (parse) { try { parse(text); } catch { return derived; } }
  return [...derived, { id: CAPACITY, label: 'Can carry', formula: text }];
};

const qtyOf = (line) => { const n = Math.floor(Number(line.qty)); return Number.isFinite(n) && n >= 1 ? n : 1; };
const carriedLine = (line) => { const c = typeof line.carry === 'string' ? line.carry.trim().toLowerCase() : ''; return c === 'readied' || c === 'stowed'; };

/** What a sheet carries, counted by its column: 0 where the system counts nothing. */
const carriedOf = (definition, data) => {
  const e = encumbranceOf(definition);
  if (!e) return 0;
  const items = itemsOf(definition);
  // A NUMBER's value reads no names.
  const names = { known: () => true, refused: () => '' };
  // An installed item is one line: the first of its name.
  const installedSeen = new Set();
  let total = 0;
  for (const line of linesOf(data)) {
    if (!isPlainObject(line)) continue;
    const cols = lineColumns(definition, line, items, names);
    const each = cols.values[e.column];
    if (typeof each !== 'number') continue;
    const item = cols.item ? items.find((i) => i.id === cols.item) : null;
    const install = item ? installOf(definition, item) : null;
    if (install && stateOf(data, item.id).installed && !installedSeen.has(item.id)) {
      installedSeen.add(item.id);
      if (install.weighs === true) total += each * qtyOf(line);
      continue;
    }
    if (carriedLine(line)) total += each * qtyOf(line);
  }
  // Pounds of 0.05 a round add up to 0.9999999: said as people would.
  return Math.round(total * 1000) / 1000;
};

/** A band as the sheet is told it: its word, WHAT IT MEANS (null where it says nothing) and the condition it names (null). */
const shownBand = (word, says, condition) => ({
  word, says: typeof says === 'string' && says.trim() ? says : null, condition: typeof condition === 'string' && condition ? condition : null,
});

/**
 * The band so much carried of so much is in (8a5d1): its word, what it means and its condition; null with no bands (none
 * past them either), or nothing to carry against.
 */
const bandAt = (definition, carried, capacity) => {
  const e = encumbranceOf(definition);
  const bands = e ? list(e.bands).filter((b) => isPlainObject(b) && typeof b.word === 'string' && Number.isFinite(b.upto)) : [];
  if (!Number.isFinite(capacity)) return null;
  const share = capacity > 0 ? (carried / capacity) * 100 : (carried > 0 ? Infinity : 0);
  const band = bands.find((b) => share <= b.upto);
  if (band) return shownBand(band.word, band.says, band.condition);
  return typeof e.past === 'string' ? shownBand(e.past, e.past_says, e.past_condition) : null;
};
/** The band's word for so much carried of so much, or null. */
const bandOf = (definition, carried, capacity) => { const b = bandAt(definition, carried, capacity); return b ? b.word : null; };

/** Whether any band, or the word past them, names a condition. */
const namesCondition = (definition) => {
  const e = encumbranceOf(definition);
  return !!e && (list(e.bands).some((b) => isPlainObject(b) && typeof b.condition === 'string' && b.condition) || (typeof e.past_condition === 'string' && !!e.past_condition));
};

/** What the sheet is told (8a6 shows it): carried, what can be (null where it says none), the unit, the band, what it means and its condition. */
const carryingOf = (definition, data) => {
  const e = encumbranceOf(definition);
  if (!e) return null;
  const carried = carriedOf(definition, data);
  const capacity = capacityText(definition) && Number.isFinite(Number(data[CAPACITY])) ? Number(data[CAPACITY]) : null;
  const band = capacity === null ? null : bandAt(definition, carried, capacity);
  return { carried, capacity, unit: typeof e.unit === 'string' ? e.unit : '', band: band ? band.word : null, says: band ? band.says : null, condition: band ? band.condition : null };
};

/**
 * Problems with `items.encumbrance` and an install's WEIGHS, pushed onto `problems`. `tools` are the CHOICES check's own:
 * `text`, `keys`, `formula`, and `targets`, the stats and formulas, none of which may be called carried or capacity.
 */
const checkEncumbrance = (definition, problems, { text, keys, formula, targets }) => {
  const items = isPlainObject(definition.items) ? definition.items : {};
  list(items.installs).forEach((s, i) => {
    if (isPlainObject(s) && s.weighs !== undefined && typeof s.weighs !== 'boolean') {
      problems.push({ where: `install ${typeof s.id === 'string' ? s.id : i + 1}, weighs`, message: 'Whether it weighs while installed: true or false' });
    }
  });
  const e = items.encumbrance;
  if (e === undefined) return;
  const where = 'items, encumbrance';
  if (!isPlainObject(e)) { problems.push({ where, message: 'Must say what it counts and what can be carried' }); return; }
  keys(e, ENCUMBRANCE_KEYS, where, 'encumbrance');
  if (typeof e.column !== 'string' || !NAME.test(e.column)) problems.push({ where: `${where}, column`, message: 'The column it counts, by its id' });
  else if (!typesOf(definition).some((t) => t.columns.some((c) => c.id === e.column && c.kind === 'number'))) {
    problems.push({ where: `${where}, column`, message: `No item type has a NUMBER column called ${e.column}` });
  }
  text(e.unit, `${where}, unit`, LIMITS.unit);
  if (e.capacity !== undefined) formula(e.capacity, `${where}, capacity`);
  for (const name of [CARRIED, CAPACITY]) {
    if (targets.has(name)) problems.push({ where, message: `@${name} is what encumbrance reads: a stat or formula is called ${name}` });
  }
  // WHAT IT MEANS, up to so many characters, and a condition of the system's that is on (8a5d1).
  const conditionIds = new Set(conditionsOf(definition).map((c) => c.id));
  const means = (says, condition, at, saysKey, conditionKey) => {
    text(says, `${at}, ${saysKey}`, LIMITS.says);
    if (condition !== undefined && !(typeof condition === 'string' && conditionIds.has(condition))) {
      problems.push({ where: `${at}, ${conditionKey}`, message: typeof condition === 'string' ? `No condition is called ${condition}: make it on CONDITIONS, or turn it on` : 'One of this system\'s conditions' });
    }
  };
  if (e.bands === undefined || (Array.isArray(e.bands) && !e.bands.length)) {
    for (const k of ['past', 'past_says', 'past_condition']) if (e[k] !== undefined) problems.push({ where: `${where}, ${k}`, message: 'Past the last band, with bands to be past' });
    if (e.bands === undefined) return;
  }
  if (!Array.isArray(e.bands)) { problems.push({ where: `${where}, bands`, message: 'Must be a list of bands' }); return; }
  if (e.bands.length > LIMITS.bands) problems.push({ where: `${where}, bands`, message: `At most ${LIMITS.bands} bands` });
  if (e.bands.length && e.capacity === undefined) problems.push({ where: `${where}, bands`, message: 'A band is a share of CAN CARRY: say what can be carried' });
  let last = 0;
  e.bands.slice(0, LIMITS.bands).forEach((b, i) => {
    const bw = `${where}, band ${i + 1}`;
    if (!isPlainObject(b)) { problems.push({ where: bw, message: 'Must be a band' }); return; }
    keys(b, BAND_KEYS, bw, 'a band');
    text(b.word, `${bw}, word`, LIMITS.word, { required: true });
    if (!Number.isInteger(b.upto) || b.upto < 1 || b.upto > LIMITS.upto) problems.push({ where: `${bw}, upto`, message: `Up to what share of CAN CARRY: 1 to ${LIMITS.upto}%` });
    else if (b.upto <= last) problems.push({ where: `${bw}, upto`, message: 'Each band goes further than the one before' });
    else last = b.upto;
    means(b.says, b.condition, bw, 'says', 'condition');
  });
  if (e.bands.length) {
    text(e.past, `${where}, past`, LIMITS.word, { required: true });
    means(e.past_says, e.past_condition, where, 'past_says', 'past_condition');
  }
};

module.exports = { LIMITS, CARRIED, CAPACITY, encumbranceOf, capacityText, derivedOf, carriedOf, bandAt, bandOf, namesCondition, carryingOf, checkEncumbrance };
