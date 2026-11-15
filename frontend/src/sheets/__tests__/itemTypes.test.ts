import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  GEAR, PRESETS, LIMITS, itemTypes, ownTypes, typeOf, itemValues, withNewType, withType, withoutType, withNewColumn, withColumn,
  withoutColumn, withItemType, withItemValue, wordsFrom, withoutRefillBy, withoutReloadFrom, withDefaultType, type ItemType,
} from '../itemTypes';
import { withoutItem } from '../items';
import { withNewRest, withoutRest } from '../rests';
import type { Definition } from '../systemsApi';

/**
 * ITEM TYPES as logic (8a2; approved mockup docs/mockups/item-types.html, 2026-11-14): types from a preset or blank,
 * their names and columns, each column's kind and what it has, an item's type and values. Each step is held to the
 * server's own checks (backend/systemBuilder/itemTypes.js, through definition.js).
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../../../../backend/systemBuilder/definition.js');
const server = require_('../../../../backend/systemBuilder/itemTypes.js');

const BASE = {
  format: 1, name: 'Typed', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: { list: [{ id: 'sword', label: 'Sword' }, { id: 'rounds', label: 'Pistol Rounds' }] },
} as unknown as Definition;
const sound = (def: Definition) => expect(checkDefinition(def).problems).toEqual([]);
const typesIn = (def: Definition) => (def.items as { types?: ItemType[] } | undefined)?.types;
const listIn = (def: Definition) => (def.items as { list?: Record<string, unknown>[] }).list!;
const weapons = () => withNewType(BASE, 'weapon')!.definition;

describe('the types', () => {
  it('GEAR where the system makes none, as the server has it, stored only once changed', () => {
    expect(itemTypes(BASE)).toEqual([GEAR]);
    expect(GEAR).toEqual(server.GEAR);
    expect(ownTypes(BASE)).toBe(false);
    expect(ownTypes({ ...BASE, items: { types: ['x', { label: 'no id' }] } } as unknown as Definition)).toBe(false);
    // A column of a kind there isn't is passed over.
    expect(itemTypes({ items: { types: [{ id: 't', label: 'T', columns: [{ id: 'a', label: 'A', kind: 'odd' }, { id: 'b', label: 'B', kind: 'text' }] }] } } as unknown as Definition)[0].columns.map((c) => c.id)).toEqual(['b']);
    // What it hands out is a copy: changed, GEAR stays.
    itemTypes(BASE)[0].columns[0].label = 'CHANGED';
    expect(GEAR.columns[0].label).toBe('WEIGHT');
    expect(typeOf(BASE, 'gone').id).toBe('gear');
    // The same limits as the server's.
    for (const k of ['types', 'columns', 'options', 'word', 'text', 'count', 'reload', 'unit'] as const) expect(LIMITS[k], k).toBe(server.LIMITS[k]);
  });

  it('a preset beside GEAR, its id its own; each preset sound as it comes', () => {
    const made = withNewType(BASE, 'weapon')!;
    expect(made.id).toBe('weapons');
    expect(typesIn(made.definition)!.map((t) => t.id)).toEqual(['gear', 'weapons']);
    expect(typesIn(made.definition)![1].columns.map((c) => `${c.id}:${c.kind}`)).toEqual(['damage:damage', 'range:text', 'ammo:count', 'weight:number', 'price:number']);
    sound(made.definition);
    typesIn(made.definition)![1].columns[0].label = 'CHANGED';
    expect(PRESETS[0].type.columns[0].label).toBe('DAMAGE');
    let def = BASE;
    for (const p of PRESETS) def = withNewType(def, p.id)!.definition;
    expect(typesIn(def)!.map((t) => t.id)).toEqual(['gear', 'weapons', 'armor', 'gear_2', 'consumables', 'spells']);
    sound(def);
    // The preset is copied, never shared.
    typesIn(def)![2].columns[0].label = 'CHANGED';
    expect(PRESETS[1].type.columns[0].label).toBe('DEFENSE');
  });

  it('blank: NEW TYPE, a Thing, with a WEIGHT; none past the most', () => {
    const made = withNewType(BASE)!;
    expect(typesIn(made.definition)![1]).toEqual({ id: 'new_type', label: 'NEW TYPE', one: 'Thing', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] });
    let def = BASE;
    for (let i = 1; i < LIMITS.types; i += 1) def = withNewType(def)!.definition;
    expect(itemTypes(def)).toHaveLength(LIMITS.types);
    expect(withNewType(def)).toBeNull();
    sound(def);
  });

  it('a name and ONE changed, the id kept; a blank ONE stores nothing', () => {
    let def = withType(weapons(), 'weapons', { label: 'ARMS', one: 'Arm' });
    expect(typesIn(def)![1]).toMatchObject({ id: 'weapons', label: 'ARMS', one: 'Arm' });
    def = withType(def, 'weapons', { one: '  ' });
    expect(typesIn(def)![1]).not.toHaveProperty('one');
    sound(def);
    // GEAR changed is GEAR stored.
    expect(typesIn(withType(BASE, 'gear', { label: 'STUFF' }))).toEqual([{ ...GEAR, label: 'STUFF' }]);
  });

  it('removed: its items to the first type left, with nothing filled in; the last stays', () => {
    let def = withItemType(weapons(), 'sword', 'weapons');
    def = withItemValue(def, 'sword', 'damage', '1d8');
    def = withItemValue(def, 'rounds', 'weight', 0.05);
    const gone = withoutType(def, 'weapons');
    expect(typesIn(gone)!.map((t) => t.id)).toEqual(['gear']);
    expect(listIn(gone)).toEqual([{ id: 'sword', label: 'Sword' }, { id: 'rounds', label: 'Pistol Rounds', values: { weight: 0.05 } }]);
    sound(gone);
    // The first gone: an item that said nothing was it, and keeps nothing either.
    const first = withoutType(def, 'gear');
    expect(listIn(first)).toEqual([{ id: 'sword', label: 'Sword', type: 'weapons', values: { damage: '1d8' } }, { id: 'rounds', label: 'Pistol Rounds' }]);
    sound(first);
    expect(withoutType(BASE, 'gear')).toBe(BASE);
    expect(withoutType(gone, 'gear')).toBe(gone);
  });
});

describe('the DEFAULT type (8aL1)', () => {
  it('moved to the top; an item that said nothing, or named a type gone, is said to be the old default, its values kept', () => {
    let def = withNewType(weapons(), 'armor')!.definition;
    def = withItemValue(def, 'rounds', 'weight', 0.05);
    def = withItemType(def, 'sword', 'weapons');
    def = { ...def, items: { ...(def.items as object), list: [...listIn(def), { id: 'old', label: 'Old', type: 'gone' }] } } as unknown as Definition;
    const moved = withDefaultType(def, 'armor');
    expect(typesIn(moved)!.map((t) => t.id)).toEqual(['armor', 'gear', 'weapons']);
    expect(listIn(moved)).toEqual([
      { id: 'sword', label: 'Sword', type: 'weapons' },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05 } },
      { id: 'old', label: 'Old', type: 'gear' },
    ]);
    // Nobody changed type.
    listIn(def).forEach((i, k) => expect(typeOf(moved, listIn(moved)[k].type).id, String(i.id)).toBe(typeOf(def, i.type).id));
    // Already the default, or gone: as it was.
    expect(withDefaultType(def, 'gear')).toBe(def);
    expect(withDefaultType(def, 'nope')).toBe(def);
    sound(withDefaultType(weapons(), 'weapons'));
  });
});

describe('the columns', () => {
  it('a new NUMBER column, its id from its name; none past the most', () => {
    const made = withNewColumn(weapons(), 'weapons')!;
    expect(made.id).toBe('new_column');
    expect(itemTypes(made.definition)[1].columns.at(-1)).toEqual({ id: 'new_column', label: 'NEW COLUMN', kind: 'number' });
    expect(withNewColumn(made.definition, 'weapons')!.id).toBe('new_column_2');
    expect(withNewColumn(BASE, 'gone')).toBeNull();
    let def = BASE;
    for (let i = 2; i < LIMITS.columns; i += 1) def = withNewColumn(def, 'gear')!.definition;
    expect(itemTypes(def)[0].columns).toHaveLength(LIMITS.columns);
    expect(withNewColumn(def, 'gear')).toBeNull();
    sound(def);
  });

  it('a new kind keeps only its own parts, and the items lose their value for it', () => {
    let def = withItemType(weapons(), 'sword', 'weapons');
    def = withItemValue(def, 'sword', 'ammo', 6);
    def = withItemValue(def, 'sword', 'range', 'melee');
    def = withColumn(def, 'weapons', 'ammo', { refill: 'long_rest', reload: ['rounds'] });
    expect(itemTypes(def)[1].columns[2]).toEqual({ id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', refill: 'long_rest', reload: ['rounds'] });
    sound(def);
    const text = withColumn(def, 'weapons', 'ammo', { kind: 'text' });
    expect(itemTypes(text)[1].columns[2]).toEqual({ id: 'ammo', label: 'AMMO', kind: 'text' });
    expect(listIn(text)[0].values).toEqual({ range: 'melee' });
    sound(text);
    // PICK ONE starts with no words, which the server asks for.
    const pick = withColumn(def, 'weapons', 'range', { kind: 'pick' });
    expect(itemTypes(pick)[1].columns[1]).toEqual({ id: 'range', label: 'RANGE', kind: 'pick', options: [] });
    expect(checkDefinition(pick).problems).toEqual([{ where: 'type weapons, column range, options', message: 'The words to pick one of' }]);
    expect(listIn(pick)[0].values).toEqual({ ammo: 6 });
    // The same kind again changes nothing of the items.
    expect(listIn(withColumn(def, 'weapons', 'ammo', { kind: 'count' }))[0].values).toEqual({ ammo: 6, range: 'melee' });
    // Only the type's own items: GEAR's Pistol Rounds keep a WEIGHT of the same id.
    const geared = withItemValue(withItemValue(def, 'rounds', 'weight', 0.05), 'sword', 'weight', 3);
    expect(listIn(withColumn(geared, 'weapons', 'weight', { kind: 'text' }))).toEqual([
      { id: 'sword', label: 'Sword', type: 'weapons', values: { ammo: 6, range: 'melee' } }, { id: 'rounds', label: 'Pistol Rounds', values: { weight: 0.05 } }]);
  });

  it('a name, a unit, a button: kept to their most, a blank one storing nothing', () => {
    let def = withColumn(BASE, 'gear', 'weight', { label: 'HEFT', unit: 'KILOGRAMS AND MORE' });
    expect(itemTypes(def)[0].columns[0]).toEqual({ id: 'weight', label: 'HEFT', kind: 'number', unit: 'KILOGRAMS AN' });
    def = withColumn(def, 'gear', 'weight', { unit: ' ' });
    expect(itemTypes(def)[0].columns[0]).not.toHaveProperty('unit');
    def = withColumn(weapons(), 'weapons', 'ammo', { button: '' });
    expect(itemTypes(def)[1].columns[2]).not.toHaveProperty('button');
    def = withColumn(def, 'weapons', 'ammo', { button: 'X'.repeat(40), refill: '' });
    expect(itemTypes(def)[1].columns[2]).toEqual({ id: 'ammo', label: 'AMMO', kind: 'count', button: 'X'.repeat(LIMITS.word) });
    sound(def);
    expect(withColumn(BASE, 'gear', 'gone', { label: 'X' })).toBe(BASE);
  });

  it('the items it reloads from: each once, at most ten', () => {
    const many = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const def = withColumn(weapons(), 'weapons', 'ammo', { reload: ['rounds', 'rounds', ...many] });
    expect(itemTypes(def)[1].columns[2].reload).toEqual(['rounds', ...many.slice(0, 9)]);
    expect(itemTypes(withColumn(def, 'weapons', 'ammo', { reload: [] }))[1].columns[2]).not.toHaveProperty('reload');
  });

  it('PICK ONE\'s words: typed with commas; a word gone goes from the items', () => {
    expect(wordsFrom(' LIGHT, HEAVY ,, LIGHT,')).toEqual(['LIGHT', 'HEAVY']);
    let def = withNewType(BASE, 'armor')!.definition;
    def = withItemType(def, 'sword', 'armor');
    def = withItemValue(def, 'sword', 'type', 'HEAVY');
    def = withItemValue(def, 'sword', 'defense', 2);
    sound(def);
    const kept = withColumn(def, 'armor', 'type', { options: ['LIGHT', 'HEAVY'] });
    expect(listIn(kept)[0].values).toEqual({ type: 'HEAVY', defense: 2 });
    const gone = withColumn(def, 'armor', 'type', { options: ['LIGHT'] });
    expect(listIn(gone)[0].values).toEqual({ defense: 2 });
    sound(gone);
    expect(itemTypes(withColumn(def, 'armor', 'type', { options: Array.from({ length: 25 }, (_, i) => `W${i}`) }))[1].columns[1].options).toHaveLength(LIMITS.options);
  });

  it('removed, with each item\'s value for it', () => {
    let def = withItemValue(BASE, 'sword', 'weight', 3);
    def = withItemValue(def, 'sword', 'price', 15);
    def = withoutColumn(def, 'gear', 'weight');
    expect(itemTypes(def)[0].columns.map((c) => c.id)).toEqual(['price']);
    expect(listIn(def)[0].values).toEqual({ price: 15 });
    sound(def);
  });
});

describe('an item\'s type and values', () => {
  it('values filled and taken away; with GEAR alone, no types stored', () => {
    let def = withItemValue(BASE, 'sword', 'weight', 3);
    expect(listIn(def)[0]).toEqual({ id: 'sword', label: 'Sword', values: { weight: 3 } });
    expect(typesIn(def)).toBeUndefined();
    def = withItemValue(def, 'sword', 'weight', undefined);
    expect(listIn(def)[0]).toEqual({ id: 'sword', label: 'Sword' });
    def = withItemValue(withItemType(weapons(), 'sword', 'weapons'), 'sword', 'damage', '1d8 + @might');
    def = withItemValue(def, 'sword', 'range', '  ');
    expect(listIn(def)[0]).toEqual({ id: 'sword', label: 'Sword', type: 'weapons', values: { damage: '1d8 + @might' } });
    sound(def);
    expect(itemValues(def, listIn(def)[0])).toStrictEqual({ damage: '1d8 + @might' });
  });

  it('made another type: only the values of columns both have, of the same kind, kept', () => {
    let def = withNewType(weapons(), 'armor')!.definition;
    def = withColumn(def, 'armor', 'weight', { kind: 'text' });
    def = withItemType(def, 'sword', 'weapons');
    for (const [c, v] of [['damage', '1d8'], ['weight', 3], ['price', 15]] as const) def = withItemValue(def, 'sword', c, v);
    const armor = withItemType(def, 'sword', 'armor');
    expect(listIn(armor)[0]).toEqual({ id: 'sword', label: 'Sword', type: 'armor', values: { price: 15 } });
    sound(armor);
    expect(withItemType(def, 'sword', 'gone')).toBe(def);
    // Back to GEAR where the system makes none: its type named, its values kept, and still no types stored.
    const back = withItemType(withItemValue(BASE, 'sword', 'weight', 3), 'sword', 'gear');
    expect(listIn(back)[0]).toEqual({ id: 'sword', label: 'Sword', type: 'gear', values: { weight: 3 } });
    expect(typesIn(back)).toBeUndefined();
  });
});

describe('what goes with a rest or an item', () => {
  it('a rest removed refills nothing; an item removed is reloaded from no longer', () => {
    const { definition: rested, id: restId } = withNewRest(weapons())!;
    let def = withColumn(rested, 'weapons', 'ammo', { refill: restId, reload: ['rounds', 'sword'] });
    sound(def);
    def = withoutRest(def, restId);
    expect(itemTypes(def)[1].columns[2]).toEqual({ id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', reload: ['rounds', 'sword'] });
    def = withoutItem(def, 'rounds');
    expect(itemTypes(def)[1].columns[2].reload).toEqual(['sword']);
    def = withoutItem(def, 'sword');
    expect(itemTypes(def)[1].columns[2]).not.toHaveProperty('reload');
    sound(def);
    // Nothing to change: the same definition back.
    expect(withoutRefillBy(BASE, 'x')).toBe(BASE);
    const armed = weapons();
    expect(withoutRefillBy(armed, 'x')).toBe(armed);
    expect(withoutReloadFrom(armed, 'x')).toBe(armed);
  });
});
