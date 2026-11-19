/**
 * What is worn, summed by column (8a5b; approved mockup item-types, 2026-11-14, decision 6): each NUMBER column of a
 * system's own types read as @<type>_<column>, what the worn items of that type have in it together, so AC can be
 * 10 + @armor_defense. Worn is 7e3's: carried and WORN; one line wears as one; a line made by hand is never worn.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { wornNamesOf, wornSumsOf } = require_('../systemBuilder/wornSums');
const { checkDefinition } = require_('../systemBuilder/definition');
const { metaOf } = require_('../systemBuilder/runtime');
const { namesOf, valueOn } = require_('../systemBuilder/choices');
const { WORN_KEY } = require_('../systemBuilder/items');

const ARMORED = {
  format: 1, name: 'Armored', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'agi', label: 'Agility' }] }],
  derived: [{ id: 'ac', label: 'AC', formula: '10 + @armor_defense + @agi' }],
  items: {
    types: [
      { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [
        { id: 'defense', label: 'DEFENSE', kind: 'number' }, { id: 'kind', label: 'TYPE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      { id: 'gear', label: 'GEAR', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'note', label: 'NOTE', kind: 'text' }] },
    ],
    list: [
      { id: 'leather', label: 'Leather Jacket', type: 'armor', values: { defense: 2, kind: 'LIGHT', weight: 8 } },
      { id: 'shield', label: 'Riot Shield', type: 'armor', values: { defense: 1, weight: 6 } },
      { id: 'plate', label: 'Plate', type: 'armor', values: { defense: 5, kind: 'HEAVY', weight: 40 } },
      { id: 'ring', label: 'Ring of Guarding', type: 'gear', needs: 'attuned', values: { weight: 0.1 } },
    ],
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
  },
};
const line = (name, more = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'readied', location: '', ...more });
const worn = (...ids) => ({ [WORN_KEY]: Object.fromEntries(ids.map((id) => [id, { worn: true }])) });
const sheet = (lines, ...ids) => ({ inventory: JSON.stringify(lines), ...worn(...ids) });

describe('the names', () => {
  it('each NUMBER column of each type, as @type_column, said as the sheet says it', () => {
    expect(wornNamesOf(ARMORED).map((n) => [n.name, n.label])).toEqual([
      ['armor_defense', 'Armor DEFENSE worn'], ['armor_weight', 'Armor WEIGHT worn'], ['gear_weight', 'GEAR WEIGHT worn'],
    ]);
    expect(namesOf(ARMORED).get('armor_defense')).toBe('Armor DEFENSE worn');
    // A system without types of its own has none.
    expect(wornNamesOf({ ...ARMORED, items: { list: [] } })).toEqual([]);
    expect(wornSumsOf({ ...ARMORED, items: { list: [] } }, sheet([line('Rope')]))).toEqual({});
  });

  it('none a stat\'s, a formula\'s or a level\'s', () => {
    expect(checkDefinition(ARMORED).problems).toEqual([]);
    const stat = { ...ARMORED, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'agi', label: 'Agility' }, { id: 'armor_defense', label: 'Armor' }] }] };
    expect(checkDefinition(stat).problems).toEqual([{ where: 'type armor, column defense', message: '@armor_defense is what the worn ARMOR\'s DEFENSE add up to: a stat, formula or level has this name' }]);
    const formula = { ...ARMORED, derived: [...ARMORED.derived, { id: 'gear_weight', label: 'Gear weight', formula: '1' }] };
    expect(checkDefinition(formula).problems).toEqual([{ where: 'type gear, column weight', message: '@gear_weight is what the worn GEAR\'s WEIGHT add up to: a stat, formula or level has this name' }]);
    const levelled = { ...ARMORED, choices: [{ id: 'paths', one: 'Path', many: 'Paths', levelled: true, options: [{ id: 'armor', label: 'Armor path', features: [] }] }],
      items: { ...ARMORED.items, types: [...ARMORED.items.types.slice(0, 1).map((t) => ({ ...t, columns: [...t.columns, { id: 'level', label: 'LEVEL', kind: 'number' }] })), ARMORED.items.types[1]] } };
    expect(checkDefinition(levelled).problems).toContainEqual({ where: 'type armor, column level', message: '@armor_level is what the worn ARMOR\'s LEVEL add up to: a stat, formula or level has this name' });
  });
});

describe('what is worn, added up', () => {
  it('the worn items of a type, each once, as its line has it or its item; carried but not worn, nothing', () => {
    expect(wornSumsOf(ARMORED, sheet([line('Leather Jacket'), line('Riot Shield', { carry: 'stowed' }), line('Plate')], 'leather', 'shield')))
      .toEqual({ armor_defense: 3, armor_weight: 14, gear_weight: 0 });
    // Its line's own DEFENSE over its item's; two of it wear as one; a second line of its name counts nothing more.
    expect(wornSumsOf(ARMORED, sheet([line('Leather Jacket', { values: { defense: 3 }, qty: 2 }), line('Leather Jacket')], 'leather')).armor_defense).toBe(3);
    // Nothing worn: 0, every name there.
    expect(wornSumsOf(ARMORED, sheet([line('Plate')]))).toEqual({ armor_defense: 0, armor_weight: 0, gear_weight: 0 });
  });

  it('stashed, or no line of it, is not worn; a line made by hand is never worn; a line of another type adds there', () => {
    expect(wornSumsOf(ARMORED, sheet([line('Plate', { carry: 'stash' })], 'plate')).armor_defense).toBe(0);
    // A carry the sheet doesn't know reads as stashed there (inventory.ts): not on them.
    expect(wornSumsOf(ARMORED, sheet([line('Plate', { carry: 'pocket' })], 'plate')).armor_defense).toBe(0);
    expect(wornSumsOf(ARMORED, sheet([line('Plate', { carry: 'stash' }), line('Plate', { carry: ' Stowed ' })], 'plate')).armor_defense).toBe(5);
    expect(wornSumsOf(ARMORED, sheet([], 'plate')).armor_defense).toBe(0);
    expect(wornSumsOf(ARMORED, sheet([line('A pot lid', { type: 'armor', values: { defense: 9 } })], 'a_pot_lid')).armor_defense).toBe(0);
    // Worn without being attuned: what it has in its columns still counts; made GEAR, the Plate's WEIGHT is its own there.
    expect(wornSumsOf(ARMORED, sheet([line('Ring of Guarding'), line('Plate', { type: 'gear', values: { weight: 39.95 } })], 'ring', 'plate')))
      .toEqual({ armor_defense: 0, armor_weight: 0, gear_weight: 40.05 });
  });
});

describe('read by formulas', () => {
  it('on every save, in rolls, and changing as armor goes on and off', () => {
    const save = (data) => { metaOf(ARMORED).recompute(data); return data; };
    expect(save({ agi: 2, ...sheet([line('Leather Jacket'), line('Riot Shield')], 'leather', 'shield') }).ac).toBe(15);
    expect(save({ agi: 2, ...sheet([line('Leather Jacket'), line('Riot Shield')], 'leather') }).ac).toBe(14);
    expect(save({ agi: 2, ...sheet([line('Leather Jacket')]) }).ac).toBe(12);
    expect(valueOn(ARMORED, { agi: 2, ...sheet([line('Plate')], 'plate') }, '@armor_defense * 2 + @armor_weight')).toBe(50);
  });
});
