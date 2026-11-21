// The catalogues a GM uploaded, sitting alongside the ones that ship with the app.
//
// **Added to, never replacing.** CWN arrives with 216 priced items read out of the book;
// a GM who uploads a weapon list is extending that, not overwriting it. Where an uploaded
// entry has the same id as a built-in one the uploaded one wins - somebody typing
// "Heavy Pistol, 250" into their own file means it - but that is an override of one line,
// surfaced in the preview, rather than the book quietly disappearing.
//
// **In memory, and deliberately not a database module.** The registry below holds plain
// objects and requires nothing, which is what lets `priceOf` stay synchronous and
// `planSale` stay pure. Loading rows out of SQLite happens elsewhere and calls `load()`.
// It is also what keeps this side importable from a frontend test - see
// crossBoundaryImports.test.ts for why that rule exists.
//
// Only the running system's uploads are held. One game is active at a time, so carrying
// every system's catalogues would mean threading a system id through every call site for a
// distinction nothing can currently observe.

const builtIn = require('./prices');

/** catalogue id -> id -> { id, name, price, fields }. Replaced wholesale by `load`. */
let uploaded = {};
/**
 * The system whose catalogues are held, and so whether the book applies at all.
 *
 * **The built-in tables are the Cities Without Number book, and only CWN shops sell from
 * them.** Every other system's shops start empty and carry only what that GM uploaded -
 * a Cyberpunk RED gun shop selling CWN guns at CWN prices would be wrong in a way nobody at
 * the table could see. The book is consulted only while this is CWN.
 *
 * Starts as CWN because for a long time it was the only system with shops, and boot
 * replaces it with the running system within the first database read. The socket
 * handlers also check it against the system they are pricing for and reload on a
 * mismatch, so a purchase can never be priced from the wrong system's list.
 */
const BOOK_SYSTEM = 'cities_without_number';
let loadedSystem = BOOK_SYSTEM;

/** Whether the built-in book applies to the system that is loaded. */
const bookApplies = () => loadedSystem === BOOK_SYSTEM;

/**
 * The running game's own items on the shelves (8a7a3a, shops/ownItems.js): { catalogues, off }, asked of whoever knows the
 * systems (the sockets set it), so this file still requires nothing and a frontend test can load it. Asked on every read,
 * so a published change sells at once. Under the uploaded lines, as they are over the book: a line uploaded with an item's
 * name is the GM's latest word and wins; an item turned off keeps a line of its name off the shelves.
 */
const NO_OWN = { catalogues: {}, off: new Set(), buyback: {} };
let ownSource = () => NO_OWN;
const setOwnSource = (fn) => { ownSource = typeof fn === 'function' ? fn : () => NO_OWN; };
/** Whatever is set, so a test that sets its own can put it back. */
const ownSourceNow = () => ownSource;
const own = () => { const got = ownSource(loadedSystem); return got && got.catalogues && got.off ? got : NO_OWN; };
/** Whether a name is an item the game turned off for the shops. */
const isOff = (name) => own().off.has(builtIn.normaliseName(name));

/**
 * Replace everything uploaded for the running system.
 *
 * Wholesale rather than merged, because "here is my weapon list" is how a GM thinks about
 * it: re-uploading a catalogue is the way to remove a line from it. Built-in entries are
 * untouched either way - this only ever holds the uploaded ones.
 */
const load = (system, catalogues) => {
  loadedSystem = system || BOOK_SYSTEM;
  uploaded = {};
  for (const [catalogue, entries] of Object.entries(catalogues || {})) {
    const table = {};
    for (const entry of entries || []) {
      if (!entry || !entry.id) continue;
      table[entry.id] = {
        id: entry.id,
        name: String(entry.name || ''),
        price: Number(entry.price) || 0,
        fields: entry.fields && typeof entry.fields === 'object' ? { ...entry.fields } : {},
      };
    }
    uploaded[catalogue] = table;
  }
};

/** Forget everything. Used when the game system changes out from under us. */
const clear = () => { uploaded = {}; loadedSystem = BOOK_SYSTEM; };

const systemLoaded = () => loadedSystem;

/** The uploaded entries for one catalogue, as a list. */
const uploadedIn = (catalogue) => Object.values(uploaded[String(catalogue || '')] || {});

/** The uploaded entries a shop sells: without those named as an item turned off. */
const sellableIn = (catalogue) => uploadedIn(catalogue).filter((e) => !isOff(e.name));
/** The game's own items a shop sells from a catalogue: without those an uploaded line of the same name stands in for. */
const ownIn = (catalogue) => {
  const named = new Set(sellableIn(catalogue).map((e) => builtIn.normaliseName(e.name)));
  return (own().catalogues[String(catalogue || '')] || []).filter((e) => !named.has(builtIn.normaliseName(e.name)));
};

/** The game's items kept out of the shops, by id, that a shop of their type buys back (8a7a3c2): never sold, never priced to buy. */
const buybackOf = (catalogue, itemId) => ((own().buyback || {})[String(catalogue || '')] || []).find((e) => e.id === String(itemId || ''));

/** One entry a shop sells, uploaded or the game's own, by id; undefined for neither (the book is asked apart). */
const sold = (catalogue, itemId) => {
  const mine = (uploaded[String(catalogue || '')] || {})[String(itemId || '')];
  if (mine) return isOff(mine.name) ? { off: true } : { entry: mine };
  const item = ownIn(catalogue).find((e) => e.id === String(itemId || ''));
  return item ? { entry: item } : undefined;
};

/** Whether anything has been uploaded for a catalogue at all. */
const hasUploads = (catalogue) => uploadedIn(catalogue).length > 0;

/**
 * What one thing costs.
 *
 * Uploaded first, then the book. Null when neither has it, because "free" and "no such
 * item" have to stay different answers - the same distinction that once sold a Tank for
 * nothing when `Number(null)` was read as zero.
 */
const priceOf = (catalogue, itemId) => {
  const mine = sold(catalogue, itemId);
  if (mine) return mine.entry && Number.isFinite(mine.entry.price) ? mine.entry.price : null;
  return bookApplies() ? builtIn.priceOf(catalogue, itemId) : null;
};

/**
 * What a shop pays for one, before its rate (8a7a3c2): what it sells it for, else an item kept out of the shops at its own
 * price, as one-of-a-kind things still sell back. Null for neither.
 */
const sellPriceOf = (catalogue, itemId) => {
  const price = priceOf(catalogue, itemId);
  if (price !== null) return price;
  const kept = buybackOf(catalogue, itemId);
  return kept ? kept.price : null;
};

/** What a catalogue entry is called. Uploaded first, then the book; an item kept out of the shops by its own name. */
const labelOf = (catalogue, itemId) => {
  const mine = sold(catalogue, itemId);
  if (mine) return mine.entry ? mine.entry.name : null;
  const kept = buybackOf(catalogue, itemId);
  if (kept) return kept.name;
  return bookApplies() ? builtIn.labelOf(catalogue, itemId) : null;
};

/** The sheet fields an uploaded entry fills when bought. Empty for a built-in one. */
const fieldsOf = (catalogue, itemId) => {
  const mine = sold(catalogue, itemId);
  return mine && mine.entry ? { ...mine.entry.fields } : {};
};

/**
 * Which catalogue entry a name on a sheet came from.
 *
 * The book is searched first here, and that is the opposite of `priceOf` on purpose. A
 * price lookup is answering "what does THIS entry cost", where an override should win. A
 * name lookup is answering "what is this thing the player owns", and a character carrying
 * a Heavy Pistol bought before the GM uploaded anything is still carrying the book's
 * Heavy Pistol. Both point at the same id anyway whenever the names match, so the two only
 * differ for something the book has never heard of - which is exactly what the uploaded
 * pass is for.
 */
const findByName = (name) => {
  const hit = bookApplies() ? builtIn.findByName(name) : null;
  if (hit) return hit;
  const wanted = builtIn.normaliseName(name);
  if (!wanted) return null;
  for (const catalogue of Object.keys(uploaded)) {
    for (const entry of sellableIn(catalogue)) {
      if (builtIn.normaliseName(entry.name) === wanted) return { catalogue, id: entry.id };
    }
  }
  // The game's own items (8a7a3a), so one bought from a shop sells back at the shop's rate.
  for (const catalogue of Object.keys(own().catalogues)) {
    for (const entry of ownIn(catalogue)) {
      if (builtIn.normaliseName(entry.name) === wanted) return { catalogue, id: entry.id };
    }
  }
  // And one kept out of the shops (8a7a3c2), to sell back where its type is sold.
  for (const [catalogue, entries] of Object.entries(own().buyback || {})) {
    for (const entry of entries) {
      if (builtIn.normaliseName(entry.name) === wanted) return { catalogue, id: entry.id };
    }
  }
  return null;
};

/**
 * Every entry a shop can sell from a catalogue, book and uploaded together.
 *
 * Uploaded entries override a built-in one of the same id rather than appearing twice.
 */
const entriesIn = (catalogue) => {
  const out = new Map();
  const book = bookApplies() ? (builtIn.CATALOGUE[String(catalogue || '')] || {}) : {};
  for (const [id, [name, price]] of Object.entries(book)) {
    out.set(id, { id, name, price, fields: {}, source: 'book' });
  }
  // The game's own items (8a7a3a), then the uploaded lines over them.
  for (const entry of ownIn(catalogue)) out.set(entry.id, { ...entry, fields: { ...entry.fields }, source: 'items' });
  for (const entry of sellableIn(catalogue)) {
    out.set(entry.id, { ...entry, source: 'uploaded' });
  }
  return [...out.values()];
};

/** Which uploaded ids would sit on top of a built-in entry, for a preview to say so. */
const overridesIn = (catalogue, entries) => {
  // Outside CWN there is no book to override, so nothing is ever an override there.
  const book = bookApplies() ? (builtIn.CATALOGUE[String(catalogue || '')] || {}) : {};
  return (entries || []).filter((e) => e && e.id && book[e.id]).map((e) => e.name);
};

module.exports = {
  BOOK_SYSTEM, bookApplies, setOwnSource, ownSourceNow,
  load, clear, systemLoaded, uploadedIn, hasUploads, entriesIn, overridesIn,
  priceOf, sellPriceOf, labelOf, fieldsOf, findByName,
  normaliseName: builtIn.normaliseName,
};
