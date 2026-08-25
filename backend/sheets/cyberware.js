// Cyberware rows, as stored on a sheet and as they arrive from the Companion.
//
// Stored as one array under a single sheet field rather than as numbered fields the way
// vehicles are. Numbered fields need a maximum decided up front, which is a limit invented
// for the storage rather than for the game: a heavily chromed character has as many pieces
// as they have. An array also makes an import a straight append instead of a hunt for the
// first free index.
//
// The cost is that the generic sheet renderer cannot show these — it draws one field per
// template entry and an array is not that. The augmentation window draws them instead,
// which is the whole reason the window exists.

/** The sheet field holding the array. */
const FIELD = 'cyberware';

/**
 * Turn a Companion catalogue key into something a person would read.
 *
 * Their export identifies a piece by `type`, in PascalCase — `NeuroportCyberdeckPort`,
 * `EMPThreading`. The second pattern is why this is not a single split on capitals: an
 * acronym run has to stay together, and break only where the next word starts.
 */
function humanise(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

/**
 * A row with every field present, whatever it was handed.
 *
 * `hl` and `cost` are different things and both are kept: humanity loss is what the chrome
 * costs you as a person and comes across from an import, while the price in eddies is
 * money and appears nowhere in the export, so it is only ever typed in.
 */
function normaliseRow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hl = Number(r.hl);
  // Number(null) is 0 and Number('') is 0, so an unpriced piece would arrive costing
  // nothing — and then sort as the cheapest thing on the sheet. Absent has to be checked
  // before the conversion, not after it.
  const cost = r.cost === null || r.cost === undefined || r.cost === ''
    ? null
    : Number(r.cost);
  return {
    name: typeof r.name === 'string' ? r.name : '',
    // '' rather than a guess: an imported piece knows what it is and what it cost, but the
    // export carries no install location, and inventing one puts chrome in the wrong arm.
    type: typeof r.type === 'string' ? r.type : '',
    side: r.side === 'l' || r.side === 'r' ? r.side : null,
    hl: Number.isFinite(hl) ? hl : 0,
    // Blank rather than zero when it was never given: a piece nobody priced is not a
    // piece that was free, and a column of zeroes hides which is which.
    cost: cost !== null && Number.isFinite(cost) ? cost : null,
    data: typeof r.data === 'string' ? r.data : '',
  };
}

/**
 * Whatever the sheet holds, as an array of rows.
 *
 * Defensive because the field is free-form JSON on a sheet people import into, paste into
 * and edit by hand: it may be missing, a string, or an array with holes in it. A window
 * that throws on a malformed sheet is worse than one that shows an empty list.
 */
function rows(data) {
  const value = data && data[FIELD];
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map(normaliseRow);
}

/** What the chrome has cost, for showing beside Humanity. */
const humanityLoss = (list) => list.reduce((sum, r) => sum + (Number(r.hl) || 0), 0);

/**
 * Rows from a Companion export's cyberware collection.
 *
 * Three things about their shape, all of them learned from a real export rather than
 * assumed:
 *
 *   - `name` is empty. The identity lives in `type`, and `name` is a label the player may
 *     never have set. Reading `name` — which is what this used to do — imports nothing at
 *     all from a character who has eight pieces of chrome.
 *   - `humanityLoss` is a real number, so the cost comes across rather than being typed in.
 *   - There is no install location anywhere in the export, so every imported row arrives
 *     unfiled and the window has to have somewhere to put it.
 */
function fromCompanion(collection) {
  const entries = collection && typeof collection === 'object' ? Object.values(collection) : [];
  return entries
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const label = String(e.name || '').trim();
      // A piece can be `type: "Custom"` with no name at all, which is a real row somebody
      // added by hand. Keeping it as "Custom" beats dropping it silently.
      const named = label || humanise(e.type) || 'Custom';
      const cost = Number(e.humanityLoss);
      return normaliseRow({
        name: named,
        hl: Number.isFinite(cost) ? cost : 0,
        data: String(e.description || e.longDescription || '').trim(),
      });
    });
}

/**
 * Rows from the free-text field this replaced.
 *
 * Sheets written before the table hold a line like `Cybereye (Low Light), Neural Link`.
 * Splitting on commas gets the pieces back; nothing else in the line is recoverable, so
 * each arrives unfiled with no cost, exactly as an import does.
 *
 * A parenthetical stays with its piece — `Cybereye (Low Light)` is one entry someone
 * wrote, and guessing that it is two loses which eye it was in.
 */
function fromNotes(text) {
  return String(text || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => normaliseRow({ name }));
}

/**
 * Rows out of the printed form's numbered boxes.
 *
 * A paper form needs a fixed number of lines; the sheet does not. These arrive as
 * `cyber1_name`, `cyber1_hl` and so on, get gathered here, and the transport fields are
 * dropped rather than stored — nothing reads them once they are rows.
 *
 * A line with no name is an empty line on a form somebody printed, not a piece of chrome.
 */
function fromFormFields(data, max = 12) {
  const out = [];
  for (let n = 1; n <= max; n += 1) {
    const name = String(data[`cyber${n}_name`] ?? '').trim();
    if (!name) continue;
    out.push(normaliseRow({
      name,
      type: String(data[`cyber${n}_type`] ?? '').trim().toLowerCase(),
      hl: data[`cyber${n}_hl`],
      cost: data[`cyber${n}_cost`],
      data: String(data[`cyber${n}_data`] ?? '').trim(),
    }));
  }
  return out;
}

/** Whether a field is one of the form's transport boxes rather than sheet data. */
const isFormField = (key) => /^cyber\d+_(name|type|hl|cost|data)$/.test(key);

module.exports = {
  FIELD, humanise, normaliseRow, rows, humanityLoss,
  fromCompanion, fromNotes, fromFormFields, isFormField,
};
