// A system's items (7e2; approved mockup docs/mockups/items.html, 2026-11-10): the things a character can carry, wear or
// attune to that do something, made on the builder's ITEMS page.
//
//   items: {
//     slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],   // what an item may need besides being worn: each
//                                                              // character has `count` (the GM may change one's, 7e3)
//     list: [
//       { id: 'ring_of_constitution', label: 'Ring of Constitution', description: 'Words for the table.',
//         needs: 'attuned',      // what its features need: 'carried', 'worn' (as when absent), or a slot's id,
//                                // worn and in that slot
//         features: [{ id: 'hardy', label: 'Hardy', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] },
//     ],
//   }
//
// An item's features are a class's, checked the same (choices.js checkFeature), but for what only a pick has: a level,
// a list it opens, an increase. An item's id and its features' ids share the one set of names options and features have,
// as has() reads them. Items are matched to the lines of a sheet's gear by name (shops already are), so a shop sells one
// as it is.
//
// At the table (7e3; the user's calls of 2026-11-10): an item is CARRIED while a line of the sheet's gear has its name and
// is READIED or STOWED, not stashed. One line wears as one. What is worn and attuned is kept under WORN_KEY by item,
// { ring: { worn: true, attuned: true, anyway: true } }, which players never type into, only change through itemAction:
// WEAR and TAKE OFF, free; ATTUNE, only worn and with a slot free, or the GM's ATTUNE ANYWAY past it; END, which frees the
// slot. Taken off, an item stays attuned, its slot still used, until it is ENDed. Each character has a slot's count, or
// the GM's own number for them under SLOTS_KEY. An item WORKS (its features count, as an unlocked feature's do) while
// carried, and as it needs: worn, or worn and attuned. A slot is used by each carried item attuned to it.
//
// Pure: checks, reads and the changes asked for.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

const LIMITS = { items: 200, slots: 10, count: 20, features: 20 };
const ITEMS_KEYS = new Set(['slots', 'list']);
const SLOT_KEYS = new Set(['id', 'label', 'count']);
const ITEM_KEYS = new Set(['id', 'label', 'description', 'needs', 'features']);
/** What an item's features need, other than a slot. */
const NEEDS = ['carried', 'worn'];

/** Where a sheet keeps what is worn and attuned, by item (7e3). */
const WORN_KEY = '_worn';
/** Where a sheet keeps the GM's own count of a slot for this character (7e3). */
const SLOTS_KEY = '_slots';

/** The system's slots, those well formed enough to read. */
const slotsOf = (definition) => list(isPlainObject(definition && definition.items) ? definition.items.slots : undefined)
  .filter((s) => isPlainObject(s) && typeof s.id === 'string');
/** The system's items, those well formed enough to read. */
const itemsOf = (definition) => list(isPlainObject(definition && definition.items) ? definition.items.list : undefined)
  .filter((i) => isPlainObject(i) && typeof i.id === 'string');

/**
 * Problems with a definition's `items`, pushed onto `problems`. `tools` are the CHOICES check's own (choices.js): `id`,
 * `text` and `keys` read as they do there, `named` the one set of option and feature names, and `checkFeature` an item's
 * feature checked as a pick's is, with what only a pick has refused.
 */
const checkItems = (definition, problems, { id, text, keys, named, checkFeature, labelMost, descriptionMost }) => {
  const items = definition.items;
  if (items === undefined) return;
  if (!isPlainObject(items)) { problems.push({ where: 'items', message: 'Must say its slots and its items' }); return; }
  keys(items, ITEMS_KEYS, 'items', 'the items');
  const slotIds = new Set();
  if (items.slots !== undefined) {
    if (!Array.isArray(items.slots)) problems.push({ where: 'items, slots', message: 'Must be a list of slots' });
    else {
      if (items.slots.length > LIMITS.slots) problems.push({ where: 'items, slots', message: `At most ${LIMITS.slots} slots` });
      items.slots.slice(0, LIMITS.slots).forEach((s, i) => {
        const where = isPlainObject(s) && typeof s.id === 'string' ? `slot ${s.id}` : `slot ${i + 1}`;
        if (!isPlainObject(s)) { problems.push({ where, message: 'Must be a slot' }); return; }
        keys(s, SLOT_KEYS, where, 'a slot');
        id(s.id, where, slotIds, 'Another slot');
        if (NEEDS.includes(s.id)) problems.push({ where, message: `${s.id} is what an item needs without a slot: call it something else` });
        text(s.label, `${where}, label`, labelMost, { required: true });
        if (!Number.isInteger(s.count) || s.count < 0 || s.count > LIMITS.count) problems.push({ where: `${where}, count`, message: `How many each character has: 0 to ${LIMITS.count}` });
      });
    }
  }
  if (items.list === undefined) return;
  if (!Array.isArray(items.list)) { problems.push({ where: 'items, list', message: 'Must be a list of items' }); return; }
  if (items.list.length > LIMITS.items) problems.push({ where: 'items, list', message: `At most ${LIMITS.items} items` });
  items.list.slice(0, LIMITS.items).forEach((item, i) => {
    const where = isPlainObject(item) && typeof item.id === 'string' ? `item ${item.id}` : `item ${i + 1}`;
    if (!isPlainObject(item)) { problems.push({ where, message: 'Must be an item' }); return; }
    keys(item, ITEM_KEYS, where, 'an item');
    id(item.id, where, named, 'Another item, option or feature');
    text(item.label, `${where}, label`, labelMost, { required: true });
    text(item.description, `${where}, description`, descriptionMost);
    if (item.needs !== undefined && !NEEDS.includes(item.needs) && !slotIds.has(item.needs)) {
      problems.push({ where: `${where}, needs`, message: 'carried, worn, or one of this system\'s slots' });
    }
    if (item.features === undefined) return;
    if (!Array.isArray(item.features)) { problems.push({ where: `${where}, features`, message: 'Must be a list of features' }); return; }
    if (item.features.length > LIMITS.features) problems.push({ where: `${where}, features`, message: `At most ${LIMITS.features} features` });
    item.features.slice(0, LIMITS.features).forEach((f, k) => {
      const fw = isPlainObject(f) && typeof f.id === 'string' ? `${where}, feature ${f.id}` : `${where}, feature ${k + 1}`;
      if (!isPlainObject(f)) { problems.push({ where: fw, message: 'Must be a feature' }); return; }
      checkFeature(f, fw);
    });
  });
};

/** The names of the gear a sheet carries: its lines READIED or STOWED, not stashed, lowercased. */
const carriedNames = (data) => {
  let rows = isPlainObject(data) ? data.inventory : undefined;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  return new Set(list(rows).filter((r) => isPlainObject(r) && (r.carry === 'readied' || r.carry === 'stowed') && typeof r.name === 'string')
    .map((r) => r.name.trim().toLowerCase()).filter(Boolean));
};
/** Whether an item is carried: a carried line has its name. */
const carriedIn = (names, item) => typeof item.label === 'string' && names.has(item.label.trim().toLowerCase());

/** What is worn and attuned, by item: { worn, attuned, anyway }. */
const stateOf = (data, id) => {
  const all = isPlainObject(data) && isPlainObject(data[WORN_KEY]) ? data[WORN_KEY] : {};
  const s = isPlainObject(all[id]) ? all[id] : {};
  return { worn: s.worn === true, attuned: s.attuned === true, anyway: s.anyway === true };
};

/** How many of a slot this character has: the GM's own number for them, or the slot's. */
const slotCount = (definition, data, slot) => {
  const own = isPlainObject(data) && isPlainObject(data[SLOTS_KEY]) ? data[SLOTS_KEY][slot.id] : undefined;
  return Number.isInteger(own) && own >= 0 && own <= LIMITS.count ? own : (Number.isInteger(slot.count) ? slot.count : 0);
};

/** How many of a slot are used: each carried item attuned to it. */
const slotUsed = (definition, data, slotId, names = carriedNames(data)) => itemsOf(definition)
  .filter((i) => i.needs === slotId && carriedIn(names, i) && stateOf(data, i.id).attuned).length;

/** Whether an item works: carried, and as it needs, worn or worn and attuned. */
const works = (item, names, data) => {
  if (!carriedIn(names, item)) return false;
  if (item.needs === 'carried') return true;
  const s = stateOf(data, item.id);
  return s.worn && (item.needs === undefined || item.needs === 'worn' || s.attuned);
};

/** The items working on a sheet, in the system's order. */
const workingItems = (definition, data) => {
  const names = carriedNames(data);
  return itemsOf(definition).filter((i) => works(i, names, data));
};

/** The features of the items working: [{ feature, item }], counted as unlocked features are (choices.js). */
const workingFeatures = (definition, data) => workingItems(definition, data)
  .flatMap((item) => list(item.features).filter((f) => isPlainObject(f) && typeof f.id === 'string').map((feature) => ({ feature, item })));

/** What has() reads of the items: has:<id> for each item working and each of its features. */
const itemsOwned = (definition, data) => {
  const owned = {};
  for (const item of workingItems(definition, data)) {
    owned[`has:${item.id}`] = 1;
    for (const f of list(item.features)) if (isPlainObject(f) && typeof f.id === 'string') owned[`has:${f.id}`] = 1;
  }
  return owned;
};

/** What the sheet shows of the items (7e3): each carried one's state and whether it works, and each slot's count and use. */
const itemsShown = (definition, data) => {
  const names = carriedNames(data);
  return {
    items: itemsOf(definition).filter((i) => carriedIn(names, i)).map((i) => {
      const s = stateOf(data, i.id);
      return { id: i.id, needs: i.needs || 'worn', ...(s.worn ? { worn: true } : {}), ...(s.attuned ? { attuned: true } : {}), ...(works(i, names, data) ? { working: true } : {}) };
    }),
    slots: slotsOf(definition).map((s) => ({ id: s.id, count: slotCount(definition, data, s), used: slotUsed(definition, data, s.id, names) })),
  };
};

/** The sheet with one item's state, nothing kept for one with none, nothing for a sheet with none. */
const withState = (data, id, state) => {
  const all = { ...(isPlainObject(data[WORN_KEY]) ? data[WORN_KEY] : {}) };
  const kept = { ...(state.worn ? { worn: true } : {}), ...(state.attuned ? { attuned: true } : {}), ...(state.attuned && state.anyway ? { anyway: true } : {}) };
  if (Object.keys(kept).length) all[id] = kept; else delete all[id];
  const { [WORN_KEY]: gone, ...rest } = data;
  return Object.keys(all).length ? { ...rest, [WORN_KEY]: all } : rest;
};

/**
 * Wearing and attuning (7e3): { kind: 'wear' | 'takeOff' | 'attune' | 'end', item } on the player's own or the GM's, and
 * { kind: 'slots', slot, count } the GM's own number of a slot for this character (null: the system's). An item is named
 * by its id. ATTUNE with no slot free is the GM's alone (ATTUNE ANYWAY). Gives { ok: true, data } or { ok: false, error }.
 */
const itemAction = (definition, data, action, { gm = false } = {}) => {
  const sheet = isPlainObject(data) ? data : {};
  const kind = isPlainObject(action) ? action.kind : null;
  const fail = (error) => ({ ok: false, error });
  if (kind === 'slots') {
    if (!gm) return fail('That is the GM\'s to do');
    const slot = slotsOf(definition).find((s) => s.id === action.slot);
    if (!slot) return fail('No such slot');
    const own = { ...(isPlainObject(sheet[SLOTS_KEY]) ? sheet[SLOTS_KEY] : {}) };
    if (action.count === null || action.count === undefined) delete own[slot.id];
    else if (!Number.isInteger(action.count) || action.count < 0 || action.count > LIMITS.count) return fail(`From 0 to ${LIMITS.count}`);
    else own[slot.id] = action.count;
    const { [SLOTS_KEY]: gone, ...rest } = sheet;
    return { ok: true, data: Object.keys(own).length ? { ...rest, [SLOTS_KEY]: own } : rest };
  }
  if (!['wear', 'takeOff', 'attune', 'end'].includes(kind)) return fail('Nothing to do');
  const item = itemsOf(definition).find((i) => i.id === action.item);
  if (!item) return fail('No such item');
  const name = item.label || item.id;
  const state = stateOf(sheet, item.id);
  const names = carriedNames(sheet);
  if (kind === 'wear') {
    if (!carriedIn(names, item)) return fail(`${name} isn't in their gear, readied or stowed`);
    if (item.needs === 'carried') return fail(`${name} works while carried: nothing to wear`);
    if (state.worn) return fail(`${name} is worn already`);
    return { ok: true, data: withState(sheet, item.id, { ...state, worn: true }) };
  }
  if (kind === 'takeOff') {
    if (!state.worn) return fail(`${name} isn't worn`);
    // Still attuned, its slot still used, until it is ENDed.
    return { ok: true, data: withState(sheet, item.id, { ...state, worn: false }) };
  }
  if (kind === 'end') {
    if (!state.attuned) return fail(`${name} isn't attuned`);
    // Anyway goes with it: nothing attuned keeps none (withState).
    return { ok: true, data: withState(sheet, item.id, { ...state, attuned: false }) };
  }
  const slot = slotsOf(definition).find((s) => s.id === item.needs);
  if (!slot) return fail(`${name} needs no slot`);
  if (state.attuned) return fail(`${name} is ${String(slot.label || slot.id).toLowerCase()} already`);
  if (!state.worn || !carriedIn(names, item)) return fail(`Wear ${name} first`);
  const full = slotUsed(definition, sheet, slot.id, names) >= slotCount(definition, sheet, slot);
  if (full && !gm) return fail(`No ${String(slot.label || slot.id).toUpperCase()} free: end one first, or ask your GM`);
  return { ok: true, data: withState(sheet, item.id, { ...state, attuned: true, anyway: full }) };
};

/** What an item needs and its words, as GIVE.EXE and the gift's notice say it: "NEEDS ATTUNED · A heavy iron band." */
const itemWords = (definition, item) => {
  const slot = slotsOf(definition).find((s) => s.id === item.needs);
  const needs = slot ? `NEEDS ${String(slot.label || slot.id).toUpperCase()}` : item.needs === 'carried' ? 'WORKS CARRIED' : 'WORKS WORN';
  return typeof item.description === 'string' && item.description.trim() ? `${needs} · ${item.description.trim()}` : needs;
};

/** The system's items as GIVE.EXE lists them (7e3b): free, each with what it needs and its words. */
const itemsGivable = (definition) => itemsOf(definition).filter((i) => typeof i.label === 'string' && i.label.trim())
  .map((i) => ({ id: i.id, name: i.label.trim(), price: 0, holds: itemWords(definition, i) }));

module.exports = { LIMITS, NEEDS, WORN_KEY, SLOTS_KEY, slotsOf, itemsOf, checkItems, carriedNames, stateOf, slotCount, slotUsed, workingItems, workingFeatures, itemsOwned, itemsShown, itemAction, itemWords, itemsGivable };
