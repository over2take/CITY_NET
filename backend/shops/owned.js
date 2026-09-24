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
//   weapons    - numbered slots, plus a stash on CWN. One each, no quantity.
//   cyberware  - JSON rows, placed (installed) or not. Both sell.
//   vehicles   - numbered slots, keyed by type id rather than by name.
//
// How many slots, and whether a system has them at all, comes from sheetSlots.js rather
// than from here: six of each on CWN, four on Cyberpunk RED, four weapons and no vehicles
// on Shadowrun, none on generic.
//
// Quantity is the reason they cannot simply be concatenated: two inventory rows of the
// same thing are one line reading x2, and so are two weapon slots holding the same gun.

const cyberware = require('../sheets/cyberware');
// Reads the MERGED catalogue - what the app ships with plus whatever a GM uploaded -
// so a character carrying an uploaded item is seen to own it, and can sell it.
const prices = require('./catalogueStore');

const sheetSlots = require('./sheetSlots');

/**
 * The system a sheet belongs to when a caller does not say.
 *
 * Cities Without Number, because for a long time it was the only system with shops at
 * all and its tests call this without one. Every server caller passes the real system:
 * the row counts differ - CWN has six weapon rows, Cyberpunk RED and Shadowrun four - and
 * the stash is a CWN thing that other sheets never have.
 */
const DEFAULT_SYSTEM = 'cities_without_number';

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
const ownedItems = (data, system = DEFAULT_SYSTEM) => {
  const sheet = data && typeof data === 'object' ? data : {};
  const weaponRows = sheetSlots.rowCount(system, 'weapon');
  const vehicleRows = sheetSlots.rowCount(system, 'vehicle');
  const lines = new Map();

  // ── inventory rows ──────────────────────────────────────────────────────────
  readJsonRows(sheet[INVENTORY_FIELD]).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    // No carry state here on purpose. Selling takes a thing whether it is readied,
    // stowed or in a locker, so it is not needed to remove one - and leaving it out is
    // one less normalisation that has to match the window's reader exactly.
    tally(lines, item.name, SOURCES.INVENTORY, {
      index,
      qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
    });
  });

  // ── carried weapon slots ────────────────────────────────────────────────────
  for (let i = 1; i <= weaponRows; i += 1) {
    tally(lines, sheet[`weapon${i}_name`], SOURCES.WEAPON, { slot: i });
  }

  // ── the weapon stash ────────────────────────────────────────────────────────
  readJsonRows(sheet[STASH_FIELD]).forEach((w, index) => {
    if (!w || typeof w !== 'object') return;
    tally(lines, w.name, SOURCES.STASH, { index });
  });

  // ── cyberware, installed or not ─────────────────────────────────────────────
  //
  // Both sell. Taking installed chrome out is surgery in the book, and the app does not
  // model that on the way out yet - a decision made deliberately rather than missed.
  //
  // **Boxed pieces are listed before installed ones**, and that ordering does real work.
  // Places are consumed in the order they appear here, so somebody who owns a spare
  // Cranial Jack in a bag and another in their skull, and sells one, sells the one in the
  // bag. Sheet order would have picked whichever happened to be first, which could mean
  // opening someone's head while a spare sat in their pocket.
  cyberware.rows(sheet)
    .map((row, index) => ({ row, index }))
    .filter((e) => e.row)
    .sort((a, b) => Number(!!a.row.placed) - Number(!!b.row.placed))
    .forEach(({ row, index }) => {
      tally(lines, row.name, SOURCES.CYBERWARE, { index, placed: !!row.placed });
    });

  // ── vehicle slots ───────────────────────────────────────────────────────────
  // Keyed by the type id rather than the name, because a vehicle somebody has called
  // "Betty" is still a Motorcycle and still worth what one is worth.
  for (let i = 1; i <= vehicleRows; i += 1) {
    const typeId = String(sheet[`vehicle${i}_type`] ?? '').trim();
    const name = String(sheet[`vehicle${i}_name`] ?? '').trim();
    if (!typeId && !name) continue;
    const label = prices.labelOf('vehicles', typeId);
    tally(lines, label || name, SOURCES.VEHICLE, { slot: i, named: name });
  }

  return [...lines.values()];
};

/** One line by catalogue and id, or undefined. Null catalogue means unpriced. */
const ownedLine = (data, catalogue, itemId, system = DEFAULT_SYSTEM) =>
  ownedItems(data, system).find((l) => l.catalogue === catalogue && l.id === itemId);

module.exports = {
  ownedItems, ownedLine, SOURCES, DEFAULT_SYSTEM,
  INVENTORY_FIELD, STASH_FIELD, readJsonRows,
};
