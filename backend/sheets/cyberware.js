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
 * The five kinds of modifier a piece can carry, keyed by what the export calls them.
 *
 * Adjusting a value and setting one are kept apart deliberately: +3 Cool and "Cool becomes
 * 3" are different claims, and collapsing them would silently change what a piece does.
 */
const MOD_KINDS = {
  modifyStatsBy: 'stat',
  setStatsTo: 'statSet',
  modifySkillsBy: 'skill',
  setSkillTo: 'skillSet',
  modifyRollTypesBy: 'roll',
};

const MOD_KIND_VALUES = Object.values(MOD_KINDS);

/**
 * Whatever was handed over, as a list of well-formed modifiers.
 *
 * A flat list rather than five buckets because that is how it is read and shown — "+6
 * Business" is one thing — and because a piece with no modifiers should carry an empty
 * list rather than five empty objects.
 *
 * A modifier with no target is dropped: it cannot be shown, and it cannot be applied.
 */
function normaliseMods(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const value = Number(m.value);
      return {
        kind: MOD_KIND_VALUES.includes(m.kind) ? m.kind : 'stat',
        target: String(m.target || '').trim(),
        // Unlike cost, zero is a real answer here — a player can park a modifier at 0
        // while they decide — so an unreadable value becomes 0 rather than dropping.
        value: Number.isFinite(value) ? value : 0,
      };
    })
    .filter((m) => m.target);
}

/**
 * A Companion `modifier` object, flattened into rows.
 *
 * Only pieces that carry modifiers have the key at all; on those, every bucket is present
 * and the unused ones are empty objects. So this reads what is there and ignores the rest
 * rather than expecting any particular bucket to exist.
 */
function modsFromCompanion(modifier) {
  if (!modifier || typeof modifier !== 'object') return [];
  const out = [];
  for (const [bucket, kind] of Object.entries(MOD_KINDS)) {
    const entries = modifier[bucket];
    if (!entries || typeof entries !== 'object') continue;
    for (const [target, raw] of Object.entries(entries)) {
      const value = Number(raw);
      if (!target || !Number.isFinite(value)) continue;
      out.push({ kind, target, value });
    }
  }
  return out;
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
    // Installed unless it says otherwise. Rows stored before this field existed have no
    // opinion, and defaulting those to false would switch off chrome nobody touched.
    equipped: r.equipped !== false,
    // Whether it is in the body. Naming a type does not put it there — that is what the
    // body diagram is for — so this is stored rather than inferred.
    placed: typeof r.placed === 'boolean' ? r.placed : inferPlaced(r),
    mods: normaliseMods(r.mods),
  };
}

/**
 * Types that exist on both sides of the body.
 *
 * Mirrored from `frontend/src/sheets/cyberwareLocations.ts`, which owns the full list and
 * where each one sits on the figure. Only the pairing is needed here, and only to answer
 * one question: a Cybereye that is in neither eye has not been installed yet.
 */
const PAIRED_TYPES = new Set(['cybereye', 'cyberarm', 'cyberleg']);

/**
 * Whether a piece has been put in the body, as opposed to merely owned.
 *
 * Its own stored fact rather than something read off the type, because saying what a piece
 * *is* and putting it in a body part are two decisions. Inferring placement from the type
 * made them one: choosing "Fashionware" in the list installed the piece on the spot, with
 * no way to describe something you owned but had not fitted.
 *
 * This is what "installed" has to mean everywhere, or the sheet claims a character has
 * eight pieces installed while the body diagram shows an empty figure.
 */
const isPlaced = (row) => Boolean(row && row.placed);

/**
 * What placement a row stored before it was recorded explicitly.
 *
 * Rows written earlier have no `placed` field, and defaulting those to false would
 * uninstall chrome nobody touched. Placement used to be inferred exactly this way, so the
 * old rule is kept for exactly the rows that were stored under it.
 */
const inferPlaced = (r) =>
  Boolean(r.type) && (!PAIRED_TYPES.has(r.type) || Boolean(r.side));

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
 *
 * `modifier` is the exception to the export being mechanically empty. The descriptions come
 * across blank because the Companion renders flavour text from its own catalogue, but a
 * modifier is something the player typed, so it is really there and worth reading.
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
        // A piece can be owned but not currently installed. Ignoring this imported
        // unequipped chrome as though it were wired in, which matters now that a
        // modifier on it would reach the sheet.
        equipped: e.equipped !== false,
        mods: modsFromCompanion(e.modifier),
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
      // Typed but not fitted, like every other import. The form names what a piece is; it
      // has no column for which arm, so a Cyberarm off a form is in neither one until
      // somebody places it on the diagram.
      placed: false,
    }));
  }
  return out;
}

/** Whether a field is one of the form's transport boxes rather than sheet data. */
const isFormField = (key) => /^cyber\d+_(name|type|hl|cost|data)$/.test(key);

module.exports = {
  FIELD, humanise, normaliseRow, rows, humanityLoss, PAIRED_TYPES, isPlaced, inferPlaced,
  MOD_KINDS, normaliseMods, modsFromCompanion,
  fromCompanion, fromNotes, fromFormFields, isFormField,
};
