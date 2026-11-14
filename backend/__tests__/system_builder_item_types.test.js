import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * Item types on the server (8a1; approved mockup docs/mockups/item-types.html, 2026-11-14): types with their columns
 * (NUMBER, TEXT, DAMAGE, DICE, COUNT, PICK ONE), GEAR where a system makes none, an item's type and values, checked;
 * told to the sheet; carried in the system file; and a line of gear's columns, its own or its item's, a COUNT's now and
 * most.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { GEAR, typesOf, ownTypes, typeNamed, valueProblem, lineColumns, itemValues } = require_('../systemBuilder/itemTypes');
const { itemsRenderedOf, namesOf } = require_('../systemBuilder/choices');
const { buildFile, readFile } = require_('../systemBuilder/citysys');

const WEAPONS = { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
  { id: 'damage', label: 'DAMAGE', kind: 'damage' },
  { id: 'heals', label: 'HEALS', kind: 'dice' },
  { id: 'range', label: 'RANGE', kind: 'text' },
  { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', refill: 'long_rest', reload: ['rounds', 'ap_rounds'] },
  { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
  { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
] };
const GEARED = { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] };
const TYPED = {
  format: 1, name: 'Typed', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [WEAPONS, GEARED],
    list: [
      { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6 + @might', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT' } },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05 } },
      { id: 'ap_rounds', label: 'AP Rounds', type: 'gear' },
      { id: 'rope', label: 'Rope' },
    ],
  },
};
const withTypes = (types, list = TYPED.items.list) => ({ ...TYPED, items: { types, list } });
const problemsOf = (def) => checkDefinition(def).problems.filter((p) => /^(type|item|items)/.test(p.where));
const NAMES = { known: (n) => n === 'might', refused: (n) => `@${n}` };

describe('item types, checked', () => {
  it('a sound system has none; GEAR where a system makes no types of its own', () => {
    expect(checkDefinition(TYPED).problems).toEqual([]);
    expect(typesOf({}).map((t) => t.id)).toEqual(['gear']);
    expect(typesOf({ items: { types: [] } })).toEqual([GEAR]);
    expect(ownTypes(TYPED)).toBe(true);
    expect(ownTypes({ items: { types: ['x'] } })).toBe(false);
    expect(typesOf(TYPED).map((t) => t.id)).toEqual(['weapons', 'gear']);
    // An item names its type, or is the first.
    expect(typeNamed(TYPED, 'gear').id).toBe('gear');
    expect(typeNamed(TYPED, undefined).id).toBe('weapons');
    expect(typeNamed(TYPED, 'gone').id).toBe('weapons');
    // A column of a kind there isn't is passed over.
    expect(typesOf(withTypes([{ id: 't', label: 'T', columns: [{ id: 'a', label: 'A', kind: 'odd' }, { id: 'b', label: 'B', kind: 'text' }] }]))[0].columns.map((c) => c.id)).toEqual(['b']);
  });

  it('the list and each type: its id, its names, its columns', () => {
    expect(problemsOf({ ...TYPED, items: { types: 'x' } })).toEqual([{ where: 'items, types', message: 'Must be a list of item types' }]);
    // Past the most, only that is said: the eleventh isn't looked at.
    expect(problemsOf(withTypes([...Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `T${i}`, columns: [] })), 'x'], []))).toEqual([{ where: 'items, types', message: 'At most 10 item types' }]);
    expect(problemsOf(withTypes(['x', { id: 'Bad', label: 'B' }, { id: 'a', label: 'A' }, { id: 'a', label: 'A2', one: 5, other: 1 }, { id: 'b', label: ' ' }, { id: 'c', label: 'C', columns: 'x' }], []))).toEqual([
      { where: 'type 1', message: 'Must be an item type' },
      { where: 'type Bad', message: 'Ids use lowercase letters, digits and _, starting with a letter' },
      { where: 'type a, other', message: 'Not part of an item type' },
      { where: 'type a', message: 'Another item type has this id already' },
      { where: 'type a, one', message: 'Must be text' },
      { where: 'type b, label', message: 'Cannot be blank' },
      { where: 'type c, columns', message: 'Must be a list of columns' },
    ]);
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, kind: 'text' }));
    expect(problemsOf(withTypes([{ id: 't', label: 'T', columns: many }], []))).toEqual([{ where: 'type t, columns', message: 'At most 20 columns' }]);
  });

  it('each column: its id, name and kind, and only what its kind has', () => {
    const cols = (columns) => problemsOf(withTypes([{ id: 't', label: 'T', columns }], [{ id: 'rounds', label: 'R' }]));
    expect(cols(['x', { id: 'Bad', label: 'B', kind: 'text' }, { id: 'a', label: 'A', kind: 'text' }, { id: 'a', label: 'A', kind: 'text' }, { id: 'b', label: '', kind: 'text' }, { id: 'c', label: 'C', kind: 'odd' }])).toEqual([
      { where: 'type t, column 1', message: 'Must be a column' },
      { where: 'type t, column Bad', message: 'Ids use lowercase letters, digits and _, starting with a letter' },
      { where: 'type t, column a', message: 'Another column of this type has this id already' },
      { where: 'type t, column b, label', message: 'Cannot be blank' },
      { where: 'type t, column c, kind', message: 'NUMBER, TEXT, DAMAGE, DICE, COUNT or PICK ONE' },
    ]);
    expect(cols([{ id: 'a', label: 'A', kind: 'text', unit: 'LB', options: ['X'] }, { id: 'b', label: 'B', kind: 'number', button: 'GO' }])).toEqual([
      { where: 'type t, column a, unit', message: 'Not part of a TEXT column' },
      { where: 'type t, column a, options', message: 'Not part of a TEXT column' },
      { where: 'type t, column b, button', message: 'Not part of a NUMBER column' },
    ]);
    expect(cols([{ id: 'a', label: 'A', kind: 'number', unit: 'POUNDS AND OUNCES' }])).toEqual([{ where: 'type t, column a, unit', message: 'Longer than 12 characters' }]);
    expect(cols([{ id: 'p', label: 'P', kind: 'pick', reload: [] }])).toEqual([
      { where: 'type t, column p, reload', message: 'Not part of a PICK ONE column' },
      { where: 'type t, column p, options', message: 'The words to pick one of' },
    ]);
    expect(cols([{ id: 'p', label: 'P', kind: 'pick', options: [] }])).toEqual([{ where: 'type t, column p, options', message: 'The words to pick one of' }]);
  });

  it('PICK ONE\'s words; a COUNT\'s button, rest and the items it reloads from', () => {
    const cols = (columns) => problemsOf(withTypes([{ id: 't', label: 'T', columns }], [{ id: 'rounds', label: 'R' }]));
    expect(cols([{ id: 'p', label: 'P', kind: 'pick', options: Array.from({ length: 21 }, (_, i) => `W${i}`) }])).toEqual([{ where: 'type t, column p, options', message: 'At most 20 words' }]);
    expect(cols([{ id: 'p', label: 'P', kind: 'pick', options: ['OK', ' '] }])).toEqual([{ where: 'type t, column p, options', message: 'Each a word or two, at most 30 characters' }]);
    expect(cols([{ id: 'p', label: 'P', kind: 'pick', options: ['A', 'A'] }])).toEqual([{ where: 'type t, column p, options', message: 'A word is there twice' }]);
    expect(cols([{ id: 'c', label: 'C', kind: 'count', button: '', refill: 'nap', reload: ['rounds', 'gone', 3] }])).toEqual([
      { where: 'type t, column c, button', message: 'Cannot be blank' },
      { where: 'type t, column c, refill', message: 'No rest is called nap' },
      { where: 'type t, column c, reload', message: 'No item is called gone' },
      { where: 'type t, column c, reload', message: 'An item of this system' },
    ]);
    expect(cols([{ id: 'c', label: 'C', kind: 'count', refill: 4, reload: 'rounds' }])).toEqual([
      { where: 'type t, column c, refill', message: 'A rest, or nothing' },
      { where: 'type t, column c, reload', message: 'The items it reloads from' },
    ]);
    expect(cols([{ id: 'c', label: 'C', kind: 'count', reload: Array.from({ length: 11 }, () => 'rounds') }])).toEqual([{ where: 'type t, column c, reload', message: 'At most 10 items' }]);
  });

  it('an item\'s type and each value by its column\'s kind', () => {
    const item = (more) => problemsOf(withTypes([WEAPONS, GEARED], [{ id: 'rounds', label: 'R' }, { id: 'ap_rounds', label: 'AP' }, { id: 'x', label: 'X', ...more }]));
    expect(item({ type: 'gone' })).toEqual([{ where: 'item x, type', message: 'No item type is called gone' }]);
    expect(item({ type: 4 })).toEqual([{ where: 'item x, type', message: 'One of this system\'s item types' }]);
    expect(item({ values: 'x' })).toEqual([{ where: 'item x, values', message: 'Must say each column\'s value' }]);
    expect(item({ type: 'gear', values: { damage: '1d4' } })).toEqual([{ where: 'item x, values, damage', message: 'Gear has no column called damage' }]);
    expect(item({ values: { damage: '1d4 + @nope', heals: '', range: 5, ammo: 1.5, weight: '2', grade: 'MEDIUM' } })).toEqual([
      { where: 'item x, values, damage', message: '@nope: no stat or formula is called that' },
      { where: 'item x, values, heals', message: 'Dice, like 1d8 + @might_mod' },
      { where: 'item x, values, range', message: 'Words, at most 200 characters' },
      { where: 'item x, values, ammo', message: 'How many it holds: 0 to 1000' },
      { where: 'item x, values, weight', message: 'A number' },
      { where: 'item x, values, grade', message: 'One of LIGHT, HEAVY' },
    ]);
    expect(item({ values: { damage: '1d1' } })).toEqual([{ where: 'item x, values, damage', message: 'A die has 2 to 1000 sides' }]);
    expect(item({ values: { damage: 'd'.repeat(201) } })).toEqual([{ where: 'item x, values, damage', message: 'At most 200 characters' }]);
    expect(item({ values: { damage: '1d8 + @might', heals: '2d4 + 2', range: 'melee', ammo: 0, weight: 0.5, grade: 'HEAVY' } })).toEqual([]);
  });

  it('a value fits its column, or says how', () => {
    expect(valueProblem({ kind: 'number' }, 1e10, NAMES)).toBe('A number');
    expect(valueProblem({ kind: 'number' }, Infinity, NAMES)).toBe('A number');
    expect(valueProblem({ kind: 'text' }, 'x'.repeat(201), NAMES)).toBe('Words, at most 200 characters');
    expect(valueProblem({ kind: 'count' }, 1001, NAMES)).toBe('How many it holds: 0 to 1000');
    expect(valueProblem({ kind: 'count' }, -1, NAMES)).toBe('How many it holds: 0 to 1000');
    expect(valueProblem({ kind: 'pick' }, 'A', NAMES)).toBe('One of its words');
    expect(valueProblem({ kind: 'odd' }, 'A', NAMES)).toBe('Not a kind of column');
    expect(valueProblem({ kind: 'dice' }, '2d6', NAMES)).toBeNull();
  });
});

describe('the sheet is told them', () => {
  it('each type\'s columns by name and kind, a COUNT\'s button and the items it reloads from by name; each item\'s type and values', () => {
    const shown = itemsRenderedOf(TYPED);
    expect(shown.types[0]).toEqual({ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' },
      { id: 'heals', label: 'HEALS', kind: 'dice' },
      { id: 'range', label: 'RANGE', kind: 'text' },
      { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', refill: 'long_rest', reload: ['Pistol Rounds', 'AP Rounds'] },
      { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
      { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
    ] });
    expect(shown.list.map((i) => [i.id, i.type, i.values])).toEqual([
      ['pistol', 'weapons', { damage: '2d6 + @might', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT' }],
      ['rounds', 'gear', { weight: 0.05 }],
      ['ap_rounds', 'gear', {}],
      ['rope', 'weapons', {}],
    ]);
    // A COUNT with nothing said: USE, no rest, no reload; a type with no singular: its name.
    const plain = itemsRenderedOf(withTypes([{ id: 'w', label: 'WANDS', columns: [{ id: 'charges', label: 'CHARGES', kind: 'count' }] }], []));
    expect(plain.types).toEqual([{ id: 'w', label: 'WANDS', one: 'WANDS', columns: [{ id: 'charges', label: 'CHARGES', kind: 'count', button: 'USE' }] }]);
    // Types alone are enough to tell; nothing at all, nothing to tell; GEAR where none are made.
    expect(itemsRenderedOf({ ...TYPED, items: { list: [{ id: 'rope', label: 'Rope' }] } }).types).toEqual([{ id: 'gear', label: 'GEAR', one: 'Gear', columns: [
      { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'price', label: 'PRICE', kind: 'number' },
    ] }]);
    expect(itemsRenderedOf({ ...TYPED, items: {} })).toBeNull();
  });

  it('only values that fit their columns', () => {
    const names = { known: (n) => namesOf(TYPED).has(n), refused: (n) => `@${n}` };
    expect(itemValues(TYPED, { type: 'weapons', values: { damage: '1d4 + @gone', range: 'far', ammo: 'x', other: 1 } }, names)).toEqual({ range: 'far' });
    expect(itemValues(TYPED, { type: 'gear' }, names)).toEqual({});
  });
});

describe('a line of gear\'s columns', () => {
  const items = TYPED.items.list;
  const cols = (line) => lineColumns(TYPED, line, items, NAMES);

  it('one named like an item: that item\'s type and values, its COUNT full, any case or spacing', () => {
    expect(cols({ name: '  pistol ' })).toEqual({ type: 'weapons', item: 'pistol', values: { damage: '2d6 + @might', range: '30 m', weight: 2, grade: 'LIGHT' }, counts: { ammo: { now: 6, most: 6 } } });
    expect(cols({ name: 'Pistol Rounds' })).toEqual({ type: 'gear', item: 'rounds', values: { weight: 0.05 }, counts: {} });
  });

  it('its own values over the item\'s, its COUNT left as kept and held to most', () => {
    expect(cols({ name: 'Pistol', values: { range: '50 m' }, counts: { ammo: 4 } })).toMatchObject({ values: { range: '50 m', damage: '2d6 + @might' }, counts: { ammo: { now: 4, most: 6 } } });
    expect(cols({ name: 'Pistol', counts: { ammo: 9 } }).counts.ammo).toEqual({ now: 6, most: 6 });
    expect(cols({ name: 'Pistol', counts: { ammo: -2 } }).counts.ammo).toEqual({ now: 0, most: 6 });
    expect(cols({ name: 'Pistol', counts: { ammo: 'x' } }).counts.ammo).toEqual({ now: 6, most: 6 });
    // A value of its own that doesn't fit is passed over for the item's.
    expect(cols({ name: 'Pistol', values: { damage: '1d4 + @gone', weight: 'heavy' } }).values).toMatchObject({ damage: '2d6 + @might', weight: 2 });
  });

  it('one made by hand: its own type and values, or the first type; a COUNT it fills or empty', () => {
    expect(cols({ name: 'A stick', type: 'weapons', values: { damage: '1d4', ammo: 3 } })).toEqual({ type: 'weapons', values: { damage: '1d4' }, counts: { ammo: { now: 3, most: 3 } } });
    expect(cols({ name: 'Mystery' })).toEqual({ type: 'weapons', values: {}, counts: { ammo: { now: 0, most: 0 } } });
    expect(cols({ name: 'Boots', type: 'gear', values: { weight: 1 } })).toEqual({ type: 'gear', values: { weight: 1 }, counts: {} });
    expect(cols(null)).toEqual({ type: 'weapons', values: {}, counts: { ammo: { now: 0, most: 0 } } });
    // A line named like an item but made another type keeps none of the item's values.
    expect(cols({ name: 'Pistol', type: 'gear', values: { weight: 9 } })).toEqual({ type: 'gear', item: 'pistol', values: { weight: 9 }, counts: {} });
    // Not even a column of the same name: the pistol's WEIGHT stays the pistol's.
    expect(cols({ name: 'Pistol', type: 'gear' })).toEqual({ type: 'gear', item: 'pistol', values: {}, counts: {} });
  });
});

describe('the system file', () => {
  it('carries the types and each item\'s type and values, and back unchanged', () => {
    const file = buildFile({ definition: TYPED, version: 1, origin: 'sys_typedtypedtyped1' });
    expect(file.items).toEqual(TYPED.items);
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.items).toEqual(TYPED.items);
  });
});
