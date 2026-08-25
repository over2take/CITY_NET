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

/** A row with every field present, whatever it was handed. */
function normaliseRow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hl = Number(r.hl);
  return {
    name: typeof r.name === 'string' ? r.name : '',
    // '' rather than a guess: an imported piece knows what it is and what it cost, but the
    // export carries no install location, and inventing one puts chrome in the wrong arm.
    type: typeof r.type === 'string' ? r.type : '',
    side: r.side === 'l' || r.side === 'r' ? r.side : null,
    hl: Number.isFinite(hl) ? hl : 0,
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

module.exports = { FIELD, humanise, normaliseRow, rows, humanityLoss, fromCompanion };
