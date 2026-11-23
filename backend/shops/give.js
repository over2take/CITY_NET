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
const { typesOf, ownTypes } = require('../systemBuilder/itemTypes');

/** The catalogues a shop can put on a shelf: the only ones anything can be bought from, or given. */
const SHELVED = CATALOGUES.filter((c) => c.shelved).map((c) => c.id);

/** The system's own item types (8a7a2): each a catalogue of its own, `type:<id>`, given wherever or not it is sold. */
const ownTypesOf = (system) => { const def = customSystems.definitionOf(system); return def && ownTypes(def) ? typesOf(def) : []; };
/** One of them by its catalogue, or undefined. */
const typeOfCatalogue = (system, catalogue) => ownTypesOf(system).find((t) => `type:${t.id}` === catalogue);

/** Whether `system` offers a catalogue's items to give: a shelf it has on, on a sheet the shops know; or one of its item types. */
const offers = (system, catalogue) => (SHELVED.includes(catalogue)
  && knowsSheet(system) && customSystems.buildingIn(system, 'catalogues', catalogue)) || !!typeOfCatalogue(system, catalogue);

/**
 * Everything `system` can give, by catalogue: [{ catalogue, items: [{ id, name, price }] }], the
 * book's items first and then the uploads (one replacing a book item of the same id), catalogues
 * with nothing in them left out. A price is what it is worth, never charged.
 */
const givable = (system) => [...SHELVED, ...ownTypesOf(system).map((t) => `type:${t.id}`)]
  .filter((catalogue) => offers(system, catalogue))
  // The game's own items aren't listed again under their type (8a7a3a): GIVE.EXE has them all in ITEMS, sold or not.
  // Each with its values where it has any (8a7d), so GIVE.EXE's QUICK FIND finds a line by anything on it and says it.
  .map((catalogue) => ({ catalogue, items: store.entriesIn(catalogue).filter((e) => e.source !== 'items')
    .map(({ id, name, price, fields }) => ({ id, name, price, ...(fields && Object.keys(fields).length ? { fields } : {}) })) }))
  .filter((c) => c.items.length);

/** One item `system` can give, as the shop has it ({ id, name, price, fields }), or null. */
const itemOf = (system, catalogue, id) => {
  if (!offers(system, catalogue)) return null;
  const entry = store.entriesIn(catalogue).find((e) => e.source !== 'items' && e.id === String(id ?? ''));
  return entry ? { id: entry.id, name: entry.name, price: entry.price, fields: entry.fields } : null;
};

/**
 * How one of a shelf's entries ({ id, name, price, fields }) lands on a sheet, as a function of the sheet: on a CWN book
 * shelf the book's way (an upload there shaped as a book row), on one of the game's item types as a line of it, anywhere
 * else the uploaded way. The one way a gift and a purchase (8n6a) both land.
 */
const placerFor = (system, catalogue, entry) => {
  if (store.bookApplies() && BOOK_CATALOGUES.includes(catalogue)) {
    const upload = store.uploadedIn(catalogue).find((e) => e.id === entry.id);
    const row = upload ? asBookRow(upload) : bookRow(catalogue, entry.id);
    return (sheet) => placeBook(catalogue, row, sheet);
  }
  const type = typeOfCatalogue(system, catalogue);
  return (sheet) => placeUploaded(system, catalogue, entry, sheet, type ? type.columns.map((c) => c.id) : []);
};

/**
 * `qty` of an item onto a sheet's data, all or nothing: { ok: true, item, patch }, or { ok: false,
 * reason } (with `placed`, how many fitted, when the sheet ran out of room part way).
 */
const placeGift = (system, catalogue, id, data, qty = 1) => {
  const item = itemOf(system, catalogue, id);
  if (!item) return { ok: false, reason: 'Not something this game can give.' };
  const placed = placeTimes(placerFor(system, catalogue, item), data, qty);
  return placed.ok ? { ok: true, item, patch: placed.patch } : placed;
};

/**
 * What a checkout bought, onto the sheet (8n6a; found by the two-games journey, 2026-11-23: placed by the buyer's window
 * after paying, a purchase could land in another game's sheet when the game changed in that moment, or nowhere when the
 * window closed). `lines` are the checkout's, each { catalogue, itemId, qty }, every one sold at the shop and priced
 * already; `data` the sheet as the sale left it. All or nothing: { ok: true, patch }, or { ok: false, reason, itemId } when
 * one doesn't fit, before anything is charged.
 */
const placePurchases = (system, lines, data) => {
  let sheet = data && typeof data === 'object' ? { ...data } : {};
  const patch = {};
  for (const line of Array.isArray(lines) ? lines : []) {
    const entry = store.entriesIn(line.catalogue).find((e) => e.id === String(line.itemId ?? ''));
    if (!entry) return { ok: false, reason: 'Not on the shelf any more.', itemId: line.itemId };
    const placed = placeTimes(placerFor(system, line.catalogue, entry), sheet, line.qty);
    if (!placed.ok) return { ok: false, reason: placed.reason, itemId: line.itemId };
    Object.assign(patch, placed.patch);
    sheet = { ...sheet, ...placed.patch };
  }
  return { ok: true, patch };
};

module.exports = { SHELVED, offers, givable, itemOf, placeGift, placePurchases, ownTypesOf };
