// What a character owns, gathered from the four places a sheet keeps things.
//
// **Derived, never cached.** An earlier design kept a manifest updated whenever something
// was bought. That is one place to get right on the way in and about a dozen on the way
// out - a hand-deleted weapon row, chrome uninstalled on the diagram, a cleared vehicle
// slot, a PDF or CharWN import replacing the sheet wholesale, an admin editing somebody's
// gear - and any one missed pays a player for something they no longer have. The sheet is
// the truth; this reads it.
//
// Mirrored in frontend/src/sheets/ownedItems.ts, which draws the SELL tab from the same
// four places. The window shows what you can sell; this is what the server pays for. A
// test walks both against the same sheets, because a disagreement is either an item a
// player cannot sell or one they get paid twice for.
//
// Four shapes, because a sheet genuinely stores these differently:
//
//   inventory  - JSON rows with a quantity. Gear, armor, mods, fittings, doses.
//   weapons    - six numbered slots, plus a stash. One each, no quantity.
//   cyberware  - JSON rows, placed (installed) or not. Both sell.
//   vehicles   - six numbered slots, keyed by type id rather than by name.
//
// Quantity is the reason they cannot simply be concatenated: two inventory rows of the
// same thing are one line reading x2, and so are two weapon slots holding the same gun.

const cyberware = require('../sheets/cyberware');
const prices = require('./prices');

/** Matches the frontend's own constants. Six of each, in the CWN template. */
const WEAPON_ROWS = 6;
const VEHICLE_ROWS = 6;

const INVENTORY_FIELD = 'inventory';
const STASH_FIELD = 'weapons_stash';

/** A JSON field that may arrive as a string, an array, or nothing at all. */
const readJsonRows = (value) => {
  let v = value;
  if (typeof v === 'string') {
    if (!v.trim()) return [];
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
};

/**
 * Where a thing lives, which decides how it is taken away again.
 *
 * Carried on every line because removing one is not the same job in each place: an
 * inventory row is decremented, a weapon slot is cleared, a cyberware row is spliced out.
 */
const SOURCES = {
  INVENTORY: 'inventory',
  WEAPON: 'weapon',
  STASH: 'stash',
  CYBERWARE: 'cyberware',
  VEHICLE: 'vehicle',
};

/**
 * Add one owned thing to the tally.
 *
 * Lines are keyed by catalogue+id so the same gun in two slots is one line reading x2.
 * Anything the catalogues do not recognise still gets a line - renamed rows, homebrew,
 * quest items - keyed by its name, with no catalogue and no price. Those are sellable for
 * nothing, and the GM settles up directly.
 */
const tally = (into, name, source, extra) => {
  const label = String(name == null ? '' : name).trim();
  if (!label) return;
  const hit = prices.findByName(label);
  const key = hit ? `${hit.catalogue}/${hit.id}` : `?/${prices.normaliseName(label)}`;
  const line = into.get(key) || {
    key,
    catalogue: hit ? hit.catalogue : null,
    id: hit ? hit.id : null,
    label: hit ? prices.labelOf(hit.catalogue, hit.id) : label,
    // What one is worth on a shelf. Null for anything no catalogue carries.
    unitPrice: hit ? prices.priceOf(hit.catalogue, hit.id) : null,
    qty: 0,
    /** Every place one of these is sitting, so a sale knows what to empty. */
    at: [],
  };
  const n = Math.max(0, Math.floor(Number(extra && extra.qty) || 1));
  if (n <= 0) return;
  line.qty += n;
  line.at.push({ source, qty: n, ...(extra || {}) });
  into.set(key, line);
};

/**
 * Everything this character owns, as lines a shop could put a price on.
 *
 * `system` decides whether the vehicle and weapon slots are read at all - a generic sheet
 * has neither - but the inventory and cyberware are read regardless, because those exist
 * wherever they are filled in.
 */
const ownedItems = (data) => {
  const sheet = data && typeof data === 'object' ? data : {};
  const lines = new Map();

  // ── inventory rows ──────────────────────────────────────────────────────────
  readJsonRows(sheet[INVENTORY_FIELD]).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    tally(lines, item.name, SOURCES.INVENTORY, {
      index,
      qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
      carry: item.carry,
    });
  });

  // ── carried weapon slots ────────────────────────────────────────────────────
  for (let i = 1; i <= WEAPON_ROWS; i += 1) {
    tally(lines, sheet[`weapon${i}_name`], SOURCES.WEAPON, { slot: i });
  }

  // ── the weapon stash ────────────────────────────────────────────────────────
  readJsonRows(sheet[STASH_FIELD]).forEach((w, index) => {
    if (!w || typeof w !== 'object') return;
    tally(lines, w.name, SOURCES.STASH, { index });
  });

  // ── cyberware, installed or not ─────────────────────────────────────────────
  // Both sell. Taking installed chrome out is surgery in the book, and the app does not
  // model that on the way out yet - a decision made deliberately rather than missed.
  cyberware.rows(sheet).forEach((row, index) => {
    if (!row) return;
    tally(lines, row.name, SOURCES.CYBERWARE, { index, placed: !!row.placed });
  });

  // ── vehicle slots ───────────────────────────────────────────────────────────
  // Keyed by the type id rather than the name, because a vehicle somebody has called
  // "Betty" is still a Motorcycle and still worth what one is worth.
  for (let i = 1; i <= VEHICLE_ROWS; i += 1) {
    const typeId = String(sheet[`vehicle${i}_type`] ?? '').trim();
    const name = String(sheet[`vehicle${i}_name`] ?? '').trim();
    if (!typeId && !name) continue;
    const label = prices.labelOf('vehicles', typeId);
    tally(lines, label || name, SOURCES.VEHICLE, { slot: i, named: name });
  }

  return [...lines.values()];
};

/** One line by catalogue and id, or undefined. Null catalogue means unpriced. */
const ownedLine = (data, catalogue, itemId) =>
  ownedItems(data).find((l) => l.catalogue === catalogue && l.id === itemId);

module.exports = {
  ownedItems, ownedLine, SOURCES, WEAPON_ROWS, VEHICLE_ROWS,
  INVENTORY_FIELD, STASH_FIELD, readJsonRows,
};
