// The game's own items on the shelves (8a7a3a; decided 2026-11-21, mockup docs/mockups/types-in-shops.html).
//
// A custom system's items with a price, IN SHOPS, sell themselves: each a line of its type's catalogue (`type:<id>`), at the
// shops its type is SOLD AT, beside what the GM uploaded. The store (catalogueStore.js) puts them under the uploaded lines, a
// line of the same name winning, as an upload already wins over the CWN book; an item turned off keeps a line of its name off
// the shelves too, so a one-of-a-kind ring can't slip onto one from an old file.
//
// Pure: from a definition to the lines, worked out once per definition (the running copy changes only on publish).

const { itemsOf } = require('../systemBuilder/items');
const { ownTypes, typeNamed, itemValues, itemPrice, inShops, isPrice } = require('../systemBuilder/itemTypes');
const { normaliseName } = require('./prices');

/** An item's line id: apart from an uploaded line's (a slug of its name), so the two never share one. */
const ITEM_PREFIX = 'item:';
const NONE = Object.freeze({ catalogues: Object.freeze({}), off: new Set() });
/** Dice read whatever names they read: the builder checked them. */
const ANY_NAME = { known: () => true, refused: (n) => `@${n}` };

const cache = new WeakMap();

/**
 * { catalogues: { 'type:<id>': [{ id, name, price, fields }] }, off: Set of names }: each item IN SHOPS with a price, a line
 * of its type, its columns' values and its words as its fields, as an uploaded typed line has them; and the names of those
 * turned off. Nothing for a system without types of its own, whose shops have no type shelves.
 */
const ownStock = (definition) => {
  if (!definition || typeof definition !== 'object' || !ownTypes(definition)) return NONE;
  if (cache.has(definition)) return cache.get(definition);
  const catalogues = {};
  const off = new Set();
  for (const item of itemsOf(definition)) {
    const name = typeof item.label === 'string' ? item.label.trim() : '';
    if (!name || typeof item.id !== 'string') continue;
    if (!inShops(definition, item)) { off.add(normaliseName(name)); continue; }
    const price = itemPrice(definition, item);
    if (!isPrice(price)) continue;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const fields = { ...itemValues(definition, item, ANY_NAME), ...(description ? { description } : {}) };
    (catalogues[`type:${typeNamed(definition, item.type).id}`] ||= []).push({ id: ITEM_PREFIX + item.id, name, price, fields });
  }
  const out = { catalogues, off };
  cache.set(definition, out);
  return out;
};

module.exports = { ITEM_PREFIX, ownStock };
