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

/** Two lines' fields alike, whatever order their keys came in. */
const sameFields = (a, b) => {
  const pairs = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k]]);
  return JSON.stringify(pairs(a)) === JSON.stringify(pairs(b));
};

/**
 * A catalogue file's lines held against the game's own items (8a7a3c1; decided 2026-11-21, mockup types-in-shops.html,
 * questions 9 and 15): a line that is exactly an item IN SHOPS (its name, price and every column) is left out, the item
 * selling itself, so nothing is kept twice; a line naming an item turned off is left out, the shops never selling it; a line
 * of an item's name otherwise overrules it, said. { sections to save, leftOut, overrules, onSale: the items on sale besides }.
 */
const againstItems = (sections, definition) => {
  const stock = ownStock(definition);
  const leftOut = [];
  const overrules = [];
  const kept = {};
  for (const [catalogue, entries] of Object.entries(sections || {})) {
    const items = stock.catalogues[catalogue] || [];
    kept[catalogue] = (entries || []).filter((e) => {
      const name = normaliseName(e && e.name);
      const at = { line: (e && e.line) || 0, catalogue, name: e && e.name };
      if (stock.off.has(name)) { leftOut.push({ ...at, message: 'kept out of the shops on ITEMS (IN SHOPS is off), so never sold: left out' }); return false; }
      const item = items.find((i) => normaliseName(i.name) === name);
      if (!item) return true;
      if (item.price === e.price && sameFields(item.fields, e.fields)) {
        leftOut.push({ ...at, message: `already on ITEMS at ${item.price}, the same in every column: left out, as it sells itself` });
        return false;
      }
      overrules.push({ ...at, from: item.price, to: e.price });
      return true;
    });
  }
  const onSale = Object.values(stock.catalogues).reduce((n, list) => n + list.length, 0);
  return { sections: kept, leftOut, overrules, onSale };
};

module.exports = { ITEM_PREFIX, ownStock, againstItems };
