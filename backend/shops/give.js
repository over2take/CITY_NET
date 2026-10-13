// What a GM can give, and where a gift lands (4g2a; approved mockup docs/mockups/give-item.html,
// 2026-10-12). GIVE ITEM offers everything the running game's shops could sell, free: the shelves
// of every catalogue it has on (a catalogue turned off, or off with its part, is not offered), with
// the CWN book's items on CWN and the GM's uploads everywhere. A gift lands exactly where buying it
// would: on a CWN book shelf the book's way (bookPlacement.js), an upload on one of those shelves as
// a row of it, as the shop merges them; anywhere else the uploaded way (placement.js).
//
// The uploads are the ones catalogueStore holds, which are the running system's: the caller loads
// them for `system` first (catalogueDb.refresh), as the shop's handlers do.

const store = require('./catalogueStore');
const { CATALOGUES } = require('../buildingTypes');
const { knowsSheet } = require('./availability');
const customSystems = require('../systemBuilder/runtime');
const { placeUploaded, placeTimes } = require('./placement');
const { BOOK_CATALOGUES, asBookRow, bookRow, placeBook } = require('./bookPlacement');

/** The catalogues a shop can put on a shelf: the only ones anything can be bought from, or given. */
const SHELVED = CATALOGUES.filter((c) => c.shelved).map((c) => c.id);

/** Whether `system` offers a catalogue's items to give: a shelf it has on, on a sheet the shops know. */
const offers = (system, catalogue) => SHELVED.includes(catalogue)
  && knowsSheet(system) && customSystems.buildingIn(system, 'catalogues', catalogue);

/**
 * Everything `system` can give, by catalogue: [{ catalogue, items: [{ id, name, price }] }], the
 * book's items first and then the uploads (one replacing a book item of the same id), catalogues
 * with nothing in them left out. A price is what it is worth, never charged.
 */
const givable = (system) => SHELVED
  .filter((catalogue) => offers(system, catalogue))
  .map((catalogue) => ({ catalogue, items: store.entriesIn(catalogue).map(({ id, name, price }) => ({ id, name, price })) }))
  .filter((c) => c.items.length);

/** One item `system` can give, as the shop has it ({ id, name, price, fields }), or null. */
const itemOf = (system, catalogue, id) => {
  if (!offers(system, catalogue)) return null;
  const entry = store.entriesIn(catalogue).find((e) => e.id === String(id ?? ''));
  return entry ? { id: entry.id, name: entry.name, price: entry.price, fields: entry.fields } : null;
};

/**
 * `qty` of an item onto a sheet's data, all or nothing: { ok: true, item, patch }, or { ok: false,
 * reason } (with `placed`, how many fitted, when the sheet ran out of room part way).
 */
const placeGift = (system, catalogue, id, data, qty = 1) => {
  const item = itemOf(system, catalogue, id);
  if (!item) return { ok: false, reason: 'Not something this game can give.' };
  let place;
  if (store.bookApplies() && BOOK_CATALOGUES.includes(catalogue)) {
    const upload = store.uploadedIn(catalogue).find((e) => e.id === item.id);
    const row = upload ? asBookRow(upload) : bookRow(catalogue, item.id);
    place = (sheet) => placeBook(catalogue, row, sheet);
  } else {
    place = (sheet) => placeUploaded(system, catalogue, item, sheet);
  }
  const placed = placeTimes(place, data, qty);
  return placed.ok ? { ok: true, item, patch: placed.patch } : placed;
};

module.exports = { SHELVED, offers, givable, itemOf, placeGift };
