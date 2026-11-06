// A new character's kits given out as they finish (7c4b; approved mockup docs/mockups/new-character.html).
// Each item is a line in the inventory: a custom system's sheet has nowhere else for one, as a purchase
// finds (shops/availability.js). An item named as one in a catalogue the game has takes that one's name
// and encumbrance; any other is the line as the GM typed it. Stacks as buying the same thing does.
//
// Pure but for reading the catalogues, which the caller loads for `system` first (catalogueDb.refresh), as
// GIVE ITEM's does. A patch out; the caller writes it through the sheet's queue, so it lands once.

const { itemOf, givable } = require('../shops/give');
const { addToInventory, placeTimes } = require('../shops/placement');

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

module.exports = { kitPatch, catalogueItem };
