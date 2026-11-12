import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * A system's items (7e2a; approved mockup docs/mockups/items.html, 2026-11-10): slots each character has so many of, and
 * items whose features need carrying, wearing, or wearing in a slot; the features checked as a pick's, but for what only
 * a pick has; carried in the system file.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { slotsOf, itemsOf, LIMITS } = require_('../systemBuilder/items');
const { buildFile, readFile } = require_('../systemBuilder/citysys');

const RING = { id: 'ring_of_constitution', label: 'Ring of Constitution', description: 'A plain band.', needs: 'attuned',
  features: [{ id: 'hardy', label: 'Hardy', text: '+2 Con, never past 20.', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] };
const WORN = {
  format: 1, name: 'Worn', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
  rests: { long_rest: { name: 'Long rest' } },
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    list: [RING, { id: 'boots', label: 'Boots of Elvenkind', needs: 'worn', features: [{ id: 'quiet', label: 'Quiet', uses: { count: '1', refill: 'long_rest' } }] },
      { id: 'rope', label: 'Rope', needs: 'carried' }, { id: 'lantern', label: 'Lantern' }],
  },
};
const said = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
const withItems = (items) => ({ ...WORN, items });

describe('a sound system', () => {
  it('has no problems, with or without lists to pick from', () => {
    expect(said(WORN)).toEqual([]);
    expect(said({ ...WORN, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough' }] }] })).toEqual([]);
    // Lists and no items at all.
    const { items: _none, ...noItems } = WORN;
    expect(said({ ...noItems, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough' }] }] })).toEqual([]);
  });

  it('reads its slots and items', () => {
    expect(slotsOf(WORN)).toEqual([{ id: 'attuned', label: 'ATTUNED', count: 3 }]);
    expect(itemsOf(WORN).map((i) => i.id)).toEqual(['ring_of_constitution', 'boots', 'rope', 'lantern']);
    expect(slotsOf({})).toEqual([]);
    expect(slotsOf({ items: { slots: [{ label: 'no id', count: 1 }, null, WORN.items.slots[0]] } })).toEqual([WORN.items.slots[0]]);
    expect(itemsOf({ items: { list: [null, { label: 'no id' }, RING] } }).map((i) => i.id)).toEqual(['ring_of_constitution']);
  });
});

describe('the items, checked even with no lists', () => {
  it('a shape it can read', () => {
    expect(said(withItems([]))).toEqual(['items: Must say its slots and its items']);
    expect(said(withItems({ slots: 'x', list: 'y', more: 1 }))).toEqual([
      'items, more: Not part of the items', 'items, slots: Must be a list of slots', 'items, list: Must be a list of items',
    ]);
  });

  it('a slot: an id, a name, how many each character has; never called carried or worn', () => {
    const slot = (s) => said(withItems({ slots: [s] }));
    expect(slot({ id: 'Attuned', label: 'A', count: 1 })).toEqual(['slot Attuned: Ids use lowercase letters, digits and _, starting with a letter']);
    expect(slot({ id: 'worn', label: 'Worn', count: 1 })).toEqual(['slot worn: worn is what an item needs without a slot: call it something else']);
    expect(slot({ id: 'attuned', count: 1 })).toEqual(['slot attuned, label: Required']);
    for (const count of [-1, 21, 1.5, '3', undefined]) expect(slot({ id: 'attuned', label: 'A', count }), String(count)).toEqual(['slot attuned, count: How many each character has: 0 to 20']);
    expect(slot({ id: 'attuned', label: 'A', count: 0 })).toEqual([]);
    expect(slot({ id: 'attuned', label: 'A', count: 1, size: 2 })).toEqual(['slot attuned, size: Not part of a slot']);
    expect(said(withItems({ slots: [{ id: 'a', label: 'A', count: 1 }, { id: 'a', label: 'B', count: 1 }] }))).toEqual(['slot a: Another slot has this id already']);
    // Only the first ten are read: an eleventh broken one says nothing more.
    expect(said(withItems({ slots: [...Array.from({ length: LIMITS.slots }, (_, i) => ({ id: `s${i}`, label: 'S', count: 1 })), { id: 'BAD' }] }))).toEqual([`items, slots: At most ${LIMITS.slots} slots`]);
    expect(said(withItems({ slots: [null] }))).toEqual(['slot 1: Must be a slot']);
  });

  it('an item: an id of its own among options and features, a name, what it needs', () => {
    const item = (i) => said(withItems({ slots: WORN.items.slots, list: [i] }));
    expect(item({ id: 'ring', label: 'Ring', needs: 'pocket' })).toEqual(['item ring, needs: carried, worn, or one of this system\'s slots or installs']);
    expect(item({ id: 'ring', label: 'Ring', needs: 'attuned' })).toEqual([]);
    expect(item({ id: 'ring' })).toEqual(['item ring, label: Required']);
    expect(item({ id: 'ring', label: 'Ring', description: 'x'.repeat(2001) })[0]).toMatch(/^item ring, description: Longer than/);
    expect(item({ id: 'ring', label: 'Ring', weight: 1 })).toEqual(['item ring, weight: Not part of an item']);
    expect(item(null)).toEqual(['item 1: Must be an item']);
    expect(item({ id: 'ring', label: 'Ring', features: 'x' })).toEqual(['item ring, features: Must be a list of features']);
    expect(item({ id: 'ring', label: 'Ring', features: [null] })).toEqual(['item ring, feature 1: Must be a feature']);
    expect(said(withItems({ list: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }))).toEqual(['item a: Another item, option or feature has this id already']);
    // Sharing the names options and features have, as has() reads them.
    expect(said({ ...WORN, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'boots', label: 'Boots' }] }] })).toEqual(['item boots: Another item, option or feature has this id already']);
    expect(said(withItems({ list: Array.from({ length: LIMITS.items + 1 }, (_, i) => ({ id: `i${i}`, label: 'I' })) }))).toEqual([`items, list: At most ${LIMITS.items} items`]);
    expect(said(withItems({ list: [{ id: 'a', label: 'A', features: Array.from({ length: LIMITS.features + 1 }, (_, i) => ({ id: `f${i}`, label: 'F' })) }] }))).toEqual([`item a, features: At most ${LIMITS.features} features`]);
  });

  it('its features checked as a pick\'s: what they change, their uses, their ids', () => {
    const feature = (f) => said(withItems({ list: [{ id: 'ring', label: 'Ring', features: [f] }] }));
    expect(feature({ id: 'x', label: 'X', modifiers: [{ target: 'nope', amount: '1' }] })).toEqual(['item ring, feature x, modifier 1, target: Not one of this system\'s stats, formulas or health fields']);
    expect(feature({ id: 'x', label: 'X', modifiers: [{ target: 'con', amount: '19', how: 'least' }] })).toEqual([]);
    expect(feature({ id: 'x', label: 'X', uses: { count: '1', refill: 'nap' } })).toEqual(['item ring, feature x, uses, refill: Not one of this system\'s rests']);
    expect(feature({ id: 'ring', label: 'X' })).toEqual(['item ring, feature ring: Another option or feature has this id already']);
  });

  it('never what only a pick has: a level, a list it opens, an increase', () => {
    const feature = (f) => said(withItems({ list: [{ id: 'ring', label: 'Ring', features: [f] }] }));
    const no = 'An item\'s feature counts while it is worn: no level, list or increase';
    expect(feature({ id: 'x', label: 'X', at: 3 })).toEqual([`item ring, feature x, at: ${no}`]);
    expect(feature({ id: 'x', label: 'X', choice: 'feats', choice_count: 2 })).toEqual([`item ring, feature x, choice: ${no}`, `item ring, feature x, choice_count: ${no}`]);
    expect(feature({ id: 'x', label: 'X', increase: { points: 2 } })).toEqual([`item ring, feature x, increase: ${no}`]);
  });

  it('a system with items but nothing in them, or slots only, is fine', () => {
    expect(said(withItems({}))).toEqual([]);
    expect(said(withItems({ slots: WORN.items.slots }))).toEqual([]);
  });
});

describe('the system file', () => {
  it('carries the items beside the definition, for a CITY_NET from before them, and back unchanged', () => {
    const file = buildFile({ definition: WORN, version: 1, origin: 'sys_wornwornwornworn' });
    expect(file.items).toEqual(WORN.items);
    expect(file.definition).not.toHaveProperty('items');
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.items).toEqual(WORN.items);
  });
});
