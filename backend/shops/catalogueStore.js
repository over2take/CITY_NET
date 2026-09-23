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
/** Which system the rows in `uploaded` belong to, so a stale load can be spotted. */
let loadedSystem = null;

/**
 * Replace everything uploaded for the running system.
 *
 * Wholesale rather than merged, because "here is my weapon list" is how a GM thinks about
 * it: re-uploading a catalogue is the way to remove a line from it. Built-in entries are
 * untouched either way - this only ever holds the uploaded ones.
 */
const load = (system, catalogues) => {
  loadedSystem = system || null;
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
const clear = () => { uploaded = {}; loadedSystem = null; };

const systemLoaded = () => loadedSystem;

/** The uploaded entries for one catalogue, as a list. */
const uploadedIn = (catalogue) => Object.values(uploaded[String(catalogue || '')] || {});

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
  const mine = (uploaded[String(catalogue || '')] || {})[String(itemId || '')];
  if (mine) return Number.isFinite(mine.price) ? mine.price : null;
  return builtIn.priceOf(catalogue, itemId);
};

/** What a catalogue entry is called. Uploaded first, then the book. */
const labelOf = (catalogue, itemId) => {
  const mine = (uploaded[String(catalogue || '')] || {})[String(itemId || '')];
  if (mine) return mine.name;
  return builtIn.labelOf(catalogue, itemId);
};

/** The sheet fields an uploaded entry fills when bought. Empty for a built-in one. */
const fieldsOf = (catalogue, itemId) => {
  const mine = (uploaded[String(catalogue || '')] || {})[String(itemId || '')];
  return mine ? { ...mine.fields } : {};
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
  const hit = builtIn.findByName(name);
  if (hit) return hit;
  const wanted = builtIn.normaliseName(name);
  if (!wanted) return null;
  for (const [catalogue, table] of Object.entries(uploaded)) {
    for (const entry of Object.values(table)) {
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
  const book = builtIn.CATALOGUE[String(catalogue || '')] || {};
  for (const [id, [name, price]] of Object.entries(book)) {
    out.set(id, { id, name, price, fields: {}, source: 'book' });
  }
  for (const entry of uploadedIn(catalogue)) {
    out.set(entry.id, { ...entry, source: 'uploaded' });
  }
  return [...out.values()];
};

/** Which uploaded ids would sit on top of a built-in entry, for a preview to say so. */
const overridesIn = (catalogue, entries) => {
  const book = builtIn.CATALOGUE[String(catalogue || '')] || {};
  return (entries || []).filter((e) => e && e.id && book[e.id]).map((e) => e.name);
};

module.exports = {
  load, clear, systemLoaded, uploadedIn, hasUploads, entriesIn, overridesIn,
  priceOf, labelOf, fieldsOf, findByName,
  normaliseName: builtIn.normaliseName,
};
