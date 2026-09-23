// Selling things back to a shop.
//
// Works out what a basket is worth and what the sheet should look like afterwards, and
// does neither of those from anything the client said. The window sends "this catalogue,
// this id, this many"; ownership is re-derived here from the sheet itself, and the price
// comes from the book table and the shop's rate.
//
// Pure, like purchase.js: it takes a sheet and hands back a payout and a patch. Nothing
// here touches a database or a socket, so every rule below can be argued with in a test.

const owned = require('./owned');
const prices = require('./prices');
const buyback = require('./buyback');

/** Every field one carried weapon row owns. Cleared together or not at all. */
const WEAPON_FIELDS = (i) => [
  `weapon${i}_name`, `weapon${i}_dmg`, `weapon${i}_skill`, `weapon${i}_attr`,
  `weapon${i}_trauma`, `weapon${i}_shock`, `weapon${i}_atk`, `weapon${i}_enc`,
  `weapon${i}_mods`, `weapon${i}_carry`,
];

/**
 * Every field one vehicle slot owns, its weapon mounts included.
 *
 * The mounts matter: selling the car and leaving three mounted guns behind would leave a
 * sheet describing weapons bolted to nothing.
 */
const VEHICLE_MOUNT_ROWS = 3;
const VEHICLE_FIELDS = (i) => {
  const base = [
    'name', 'type', 'hp', 'hp_max', 'armor', 'ac', 'spd', 'tt', 'crew', 'hrdpt',
    'pow', 'mass', 'cost', 'size', 'notes', 'moving',
  ].map((f) => `vehicle${i}_${f}`);
  for (let w = 1; w <= VEHICLE_MOUNT_ROWS; w += 1) {
    base.push(
      `vehicle${i}_weapon${w}_name`, `vehicle${i}_weapon${w}_dmg`,
      `vehicle${i}_weapon${w}_trauma`, `vehicle${i}_weapon${w}_range`,
      `vehicle${i}_weapon${w}_mag`, `vehicle${i}_weapon${w}_notes`,
    );
  }
  return base;
};

/**
 * What one line is worth, and what emptying it does to the sheet.
 *
 * Places are consumed in the order `ownedItems` found them, which is stable but otherwise
 * arbitrary - there is no rule in the book about which of two identical pistols you hand
 * over, and inventing one would be inventing a rule.
 */
const takeFrom = (line, wanted, state) => {
  let left = wanted;
  for (const at of line.at) {
    if (left <= 0) break;
    const take = Math.min(left, at.qty);

    if (at.source === owned.SOURCES.INVENTORY) {
      const row = state.inventory[at.index];
      if (!row) continue;
      const have = Math.max(1, Math.floor(Number(row.qty) || 1));
      const next = have - take;
      // A row that reaches zero goes entirely, rather than sitting there reading x0.
      if (next <= 0) state.inventoryDropped.add(at.index);
      else row.qty = next;
    } else if (at.source === owned.SOURCES.WEAPON) {
      WEAPON_FIELDS(at.slot).forEach((f) => { state.patch[f] = ''; });
    } else if (at.source === owned.SOURCES.STASH) {
      state.stashDropped.add(at.index);
    } else if (at.source === owned.SOURCES.CYBERWARE) {
      state.cyberDropped.add(at.index);
      /**
       * Chrome coming out of a body, counted so somebody can be told.
       *
       * The book puts surgery and a complications roll on removal and this app models
       * neither, so the sale itself is clean - the row goes, the strain goes with it, and
       * nothing is rolled. That is a gap the table has to fill, and it is only fillable if
       * the player is told it exists rather than finding out later that their doctor never
       * got involved.
       */
      if (at.placed) state.fromBody += take;
    } else if (at.source === owned.SOURCES.VEHICLE) {
      VEHICLE_FIELDS(at.slot).forEach((f) => { state.patch[f] = ''; });
    }

    left -= take;
  }
  return wanted - left;
};

/**
 * Work out a whole basket at once.
 *
 * Returns `{ ok: true, payout, patch, sold }` or `{ ok: false, reason, itemId }`. The
 * patch is a flat object of sheet fields to write, which is the shape the sheet mutation
 * already takes.
 *
 * `reason` is one of:
 *   'empty'     - nothing in the basket
 *   'not_sold'  - this shop does not deal in that catalogue
 *   'not_owned' - they do not have that many of it
 *
 * An unpriced item - homebrew, a renamed row, a quest item - is sellable for nothing
 * rather than refused. That is a deliberate call: the player gets it off their sheet and
 * the GM settles up directly, which is what a GM would do at a table anyway.
 */
const planSale = ({ data, items, catalogues, locationPct, globalPct }) => {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: 'empty' };

  const pct = buyback.buybackPct(locationPct, globalPct);
  const lines = owned.ownedItems(data);
  const byKey = new Map(lines.map((l) => [l.key, l]));

  const state = {
    patch: {},
    inventory: owned.readJsonRows(data && data[owned.INVENTORY_FIELD])
      .map((r) => (r && typeof r === 'object' ? { ...r } : r)),
    inventoryDropped: new Set(),
    stashDropped: new Set(),
    cyberDropped: new Set(),
    /** How many pieces came out of a body, for the surgery warning. */
    fromBody: 0,
  };

  let payout = 0;
  const sold = [];
  /** Guards against the same line appearing twice in one basket and being paid twice. */
  const takenSoFar = new Map();

  for (const raw of items) {
    const catalogue = raw && raw.catalogue ? String(raw.catalogue) : null;
    const id = raw && raw.id ? String(raw.id) : null;
    const key = catalogue && id ? `${catalogue}/${id}` : `?/${prices.normaliseName(raw && raw.label)}`;
    const want = Math.max(0, Math.floor(Number(raw && raw.qty) || 0));
    if (want <= 0) continue;

    // A shop only buys what it sells. Unpriced things have no catalogue and are taken
    // anywhere, since no storefront is the right one for a quest item.
    if (catalogue && !catalogues.includes(catalogue)) {
      return { ok: false, reason: 'not_sold', itemId: id };
    }

    const line = byKey.get(key);
    const already = takenSoFar.get(key) || 0;
    if (!line || line.qty - already < want) {
      return { ok: false, reason: 'not_owned', itemId: id || key };
    }
    takenSoFar.set(key, already + want);

    // Priced from the book table on this side, never from anything the client sent.
    const unit = catalogue && id ? prices.priceOf(catalogue, id) : null;
    const each = buyback.buybackValue(unit, pct);
    payout += each * want;
    sold.push({ catalogue, id, label: line.label, qty: want, each });
  }

  if (sold.length === 0) return { ok: false, reason: 'empty' };

  // Emptying happens only once the whole basket has been checked, so a basket that fails
  // half way leaves the sheet untouched.
  for (const entry of sold) {
    const key = entry.catalogue && entry.id
      ? `${entry.catalogue}/${entry.id}`
      : `?/${prices.normaliseName(entry.label)}`;
    takeFrom(byKey.get(key), entry.qty, state);
  }

  if (state.inventoryDropped.size || state.inventory.some((r, i) => r && !state.inventoryDropped.has(i))) {
    state.patch[owned.INVENTORY_FIELD] = JSON.stringify(
      state.inventory.filter((_r, i) => !state.inventoryDropped.has(i)),
    );
  }
  if (state.stashDropped.size) {
    const stash = owned.readJsonRows(data && data[owned.STASH_FIELD]);
    state.patch[owned.STASH_FIELD] = JSON.stringify(
      stash.filter((_r, i) => !state.stashDropped.has(i)),
    );
  }
  if (state.cyberDropped.size) {
    const rows = Array.isArray(data && data.cyberware) ? data.cyberware : [];
    state.patch.cyberware = rows.filter((_r, i) => !state.cyberDropped.has(i));
  }

  return {
    ok: true,
    payout,
    patch: state.patch,
    sold,
    pct,
    /**
     * How many pieces of installed chrome this sale took out of a body.
     *
     * Reported rather than acted on: the app does not model extraction surgery, so this
     * is what lets a window say so before the player clicks, and say so again on the
     * receipt. Zero for a sale that touched nothing installed.
     */
    fromBody: state.fromBody,
  };
};

module.exports = { planSale, WEAPON_FIELDS, VEHICLE_FIELDS, VEHICLE_MOUNT_ROWS };
