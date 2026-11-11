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
// as it is. Wearing and attuning on the sheet are 7e3's.
//
// Pure: checks and reads only.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

const LIMITS = { items: 200, slots: 10, count: 20, features: 20 };
const ITEMS_KEYS = new Set(['slots', 'list']);
const SLOT_KEYS = new Set(['id', 'label', 'count']);
const ITEM_KEYS = new Set(['id', 'label', 'description', 'needs', 'features']);
/** What an item's features need, other than a slot. */
const NEEDS = ['carried', 'worn'];

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

module.exports = { LIMITS, NEEDS, slotsOf, itemsOf, checkItems };
