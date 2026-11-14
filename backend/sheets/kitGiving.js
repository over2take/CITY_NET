// A new character's kits given out as they finish (7c4b; approved mockup docs/mockups/new-character.html).
// Each item is a line in the inventory: a custom system's sheet has nowhere else for one, as a purchase
// finds (shops/availability.js). An item named as one in a catalogue the game has takes that one's name
// and encumbrance; any other is the line as the GM typed it. Stacks as buying the same thing does.
//
// Pure but for reading the catalogues, which the caller loads for `system` first (catalogueDb.refresh), as
// GIVE ITEM's does. A patch out; the caller writes it through the sheet's queue, so it lands once.

const { itemOf, givable } = require('../shops/give');
const { addToInventory, placeTimes, readInventory, writeInventory, INVENTORY_FIELD } = require('../shops/placement');

/** The catalogue item called this, in any catalogue the game can give from: { name, fields }, or null. */
const catalogueItem = (system, name) => {
  const wanted = name.trim().toLowerCase();
  for (const { catalogue, items } of givable(system)) {
    const found = items.find((i) => String(i.name).trim().toLowerCase() === wanted);
    if (found) return itemOf(system, catalogue, found.id);
  }
  return null;
};

/** The sheet's inventory with these items added: { name, qty }, each against what the last left. */
const kitPatch = (system, items, data) => {
  let sheet = { ...data };
  const patch = {};
  for (const item of items) {
    const entry = catalogueItem(system, item.name);
    const name = entry ? entry.name : item.name.trim();
    const enc = entry && entry.fields ? entry.fields.enc ?? '' : '';
    const placed = placeTimes((now) => ({ ok: true, patch: addToInventory(now, name, enc) }), sheet, item.qty);
    Object.assign(patch, placed.patch);
    sheet = { ...sheet, ...placed.patch };
  }
  return patch;
};

/**
 * These items taken back out of the inventory (7c5's START OVER): a carried line first, then one stashed,
 * going as far as it can. One since sold or dropped is simply gone. A patch, empty with nothing to take.
 */
const kitTakenBack = (items, data) => {
  if (!items.length) return {};
  let lines = readInventory(data);
  for (const item of items) {
    const wanted = String(item.name).trim().toLowerCase();
    const same = lines.filter((line) => line.name.trim().toLowerCase() === wanted);
    let left = item.qty;
    const taken = new Map();
    for (const line of [...same.filter((l) => l.carry !== 'stash'), ...same.filter((l) => l.carry === 'stash')]) {
      const n = Math.min(left, line.qty);
      taken.set(line, n);
      left -= n;
    }
    lines = lines.map((line) => ({ ...line, qty: line.qty - (taken.get(line) || 0) })).filter((line) => line.qty > 0);
  }
  return { [INVENTORY_FIELD]: writeInventory(lines) };
};

module.exports = { kitPatch, kitTakenBack, catalogueItem };
