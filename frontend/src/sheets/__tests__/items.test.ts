import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  itemSlots, itemList, itemFeatures, withNewSlot, withSlot, withoutSlot, withNewItem, withItem, withoutItem, needsChoices, needsWords,
  withNewItemFeature, withItemFeature, withoutItemFeature, LIMITS,
} from '../items';
import { takenIds, withNewOption } from '../choices';
import type { Definition } from '../systemsApi';

/**
 * The ITEMS page as logic (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): slots and items read and written
 * back as the server checks them (backend items.js), an item's features kept as a pick's but never at a level.
 */

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const WORN = {
  format: 1, name: 'Worn', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    list: [{ id: 'ring', label: 'Ring', needs: 'attuned', features: [{ id: 'hardy', label: 'Hardy', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] }],
  },
} as unknown as Definition;
const sound = (def: Definition) => expect(checkDefinition(def).problems).toEqual([]);

describe('slots', () => {
  it('read; made one each, never called carried or worn; renamed; counted whole from 0 to 20; removed', () => {
    expect(itemSlots(WORN)).toEqual([{ id: 'attuned', label: 'ATTUNED', count: 3 }]);
    expect(itemSlots({ format: 1, name: 'x' } as Definition)).toEqual([]);
    const made = withNewSlot(WORN)!;
    expect(itemSlots(made.definition)[1]).toEqual({ id: 'new_slot', label: 'NEW SLOT', count: 1 });
    sound(made.definition);
    expect(itemSlots(withSlot(WORN, 'attuned', { label: 'BOUND' }))[0]).toEqual({ id: 'attuned', label: 'BOUND', count: 3 });
    expect(itemSlots(withSlot(WORN, 'attuned', { count: 2.7 }))[0].count).toBe(2);
    expect(itemSlots(withSlot(WORN, 'attuned', { count: 99 }))[0].count).toBe(LIMITS.count);
    expect(itemSlots(withSlot(WORN, 'attuned', { count: -4 }))[0].count).toBe(0);
    expect(itemSlots(withSlot(WORN, 'attuned', { count: NaN }))[0].count).toBe(3);
    expect(itemSlots(withSlot(WORN, 'other', { count: 1 }))).toEqual(itemSlots(WORN));
  });

  it('removed: an item needing it goes back to worn; nothing left, nothing stored', () => {
    const gone = withoutSlot(WORN, 'attuned');
    expect(itemSlots(gone)).toEqual([]);
    expect(itemList(gone)[0]).not.toHaveProperty('needs');
    sound(gone);
    expect('items' in withoutItem(gone, 'ring')).toBe(false);
  });

  it('never more than the most', () => {
    let def = WORN;
    for (let i = 1; i < LIMITS.slots; i += 1) def = withNewSlot(def)!.definition;
    expect(itemSlots(def)).toHaveLength(LIMITS.slots);
    expect(withNewSlot(def)).toBeNull();
    // Each its own id, never carried or worn.
    expect(new Set(itemSlots(def).map((s) => s.id)).size).toBe(LIMITS.slots);
  });
});

describe('items', () => {
  it('made with an id of its own among options, features and items', () => {
    const made = withNewItem(WORN)!;
    expect(made.id).toBe('new_item');
    expect(itemList(made.definition)[1]).toEqual({ id: 'new_item', label: 'NEW ITEM' });
    sound(made.definition);
    // Taken by an option, it takes another.
    const withOpt = { ...WORN, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'new_item', label: 'X' }] }] } as unknown as Definition;
    expect(withNewItem(withOpt)!.id).toBe('new_item_2');
    // An option never takes an item's or its feature's.
    expect(takenIds(WORN)).toEqual(expect.arrayContaining(['ring', 'hardy']));
    const optionMade = withNewOption({ ...WORN, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [] }] } as unknown as Definition, 'feats')!;
    expect(optionMade.id).toBe('new_option');
  });

  it('its name, words and needs; blank words and WORN store nothing', () => {
    expect(itemList(withItem(WORN, 'ring', { label: 'Band' }))[0].label).toBe('Band');
    expect(itemList(withItem(WORN, 'ring', { description: 'Plain.' }))[0].description).toBe('Plain.');
    expect(itemList(withItem(withItem(WORN, 'ring', { description: 'Plain.' }), 'ring', { description: '  ' }))[0]).not.toHaveProperty('description');
    expect(itemList(withItem(WORN, 'ring', { needs: 'worn' }))[0]).not.toHaveProperty('needs');
    expect(itemList(withItem(WORN, 'ring', { needs: 'carried' }))[0].needs).toBe('carried');
    expect(itemList(withItem(WORN, 'other', { label: 'X' }))).toEqual(itemList(WORN));
  });

  it('what it needs in words, and the choices', () => {
    expect(needsChoices(WORN)).toEqual([{ id: 'carried', label: 'CARRIED' }, { id: 'worn', label: 'WORN' }, { id: 'attuned', label: 'WORN AND ATTUNED' }]);
    expect(needsWords(WORN, itemList(WORN)[0])).toBe('WORN AND ATTUNED');
    expect(needsWords(WORN, { id: 'x', label: 'X' })).toBe('WORN');
    expect(needsWords(WORN, { id: 'x', label: 'X', needs: 'gone' })).toBe('WORN AND GONE');
    expect(needsChoices(withSlot(WORN, 'attuned', { label: ' ' }))[2].label).toBe('WORN AND ATTUNED');
  });

  it('removed, and never more than the most', () => {
    expect(itemList(withoutItem(WORN, 'ring'))).toEqual([]);
    const full = { ...WORN, items: { list: Array.from({ length: LIMITS.items }, (_, i) => ({ id: `i${i}`, label: 'I' })) } } as unknown as Definition;
    expect(withNewItem(full)).toBeNull();
  });

  it('reads only those with an id', () => {
    expect(itemList({ items: { list: [null, { label: 'no id' }, { id: 'a', label: 7 }] } } as unknown as Definition)).toEqual([{ id: 'a', label: '' }]);
    expect(itemSlots({ items: { slots: [{ label: 'no id' }, { id: 'b', count: '2' }] } } as unknown as Definition)).toEqual([{ id: 'b', label: '', count: 0 }]);
  });
});

describe('an item\'s features', () => {
  it('made, changed as a pick\'s but never at a level, and removed', () => {
    const made = withNewItemFeature(WORN, 'ring')!;
    expect(made.id).toBe('new_feature');
    expect(itemFeatures(itemList(made.definition)[0]).map((f) => f.id)).toEqual(['hardy', 'new_feature']);
    sound(made.definition);
    const changed = withItemFeature(made.definition, 'ring', 'new_feature', { text: 'Warm.', at: 3, modifiers: [] });
    expect(itemFeatures(itemList(changed)[0])[1]).toEqual({ id: 'new_feature', label: 'NEW FEATURE', text: 'Warm.' });
    const gone = withoutItemFeature(withoutItemFeature(WORN, 'ring', 'hardy'), 'ring', 'nothing');
    expect(itemList(gone)[0]).not.toHaveProperty('features');
    expect(withNewItemFeature(WORN, 'nothing')).toBeNull();
  });

  it('never more than the most', () => {
    const full = { ...WORN, items: { list: [{ id: 'ring', label: 'Ring', features: Array.from({ length: LIMITS.features }, (_, i) => ({ id: `f${i}`, label: 'F' })) }] } } as unknown as Definition;
    expect(withNewItemFeature(full, 'ring')).toBeNull();
    expect(itemFeatures({ id: 'x', label: 'X', features: [null, { label: 'no id' }] } as never)).toEqual([]);
  });
});
