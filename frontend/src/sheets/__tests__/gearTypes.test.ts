import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { typesOf, fits, itemOfLine, lineColumns, gearTables, valueText, withLineValue, newLineOf, countOf, cellWords, LIMITS, type ColumnShown , gearBands } from '../gearTypes';
import { normaliseItem, readInventory, type InventoryItem } from '../inventory';
import type { ItemsShown } from '../gearItems';

/**
 * A custom system's gear as a table per item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14): each
 * line's type and columns, held to the server's own lineColumns (backend systemBuilder/itemTypes.js) on the same lines.
 */

const require_ = createRequire(import.meta.url);
const server = require_('../../../../backend/systemBuilder/itemTypes.js');
const { itemsRenderedOf, namesOf } = require_('../../../../backend/systemBuilder/choices.js');
const placement = require_('../../../../backend/shops/placement.js');

const DEFINITION = {
  format: 1, name: 'Typed', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
        { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' },
        { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
        { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
      { id: 'gear', label: 'GEAR', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
    ],
    list: [
      { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6 + @might', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT' } },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05 } },
      { id: 'rope', label: 'Rope' },
    ],
  },
};
const SHOWN = itemsRenderedOf(DEFINITION) as ItemsShown;
const line = (l: Partial<InventoryItem>): InventoryItem => normaliseItem({ carry: 'stowed', ...l });
const valuesOf = (l: InventoryItem) => Object.fromEntries(lineColumns(SHOWN, l)!.cells.filter((c) => c.value !== undefined).map((c) => [c.column.id, c.value]));

describe('the types, from the render copy', () => {
  it('each with its columns; none where the render copy has none', () => {
    expect(typesOf(SHOWN).map((t) => `${t.id}:${t.one}`)).toEqual(['weapons:Weapon', 'gear:GEAR']);
    expect(typesOf(null)).toEqual([]);
    expect(typesOf({ slots: [], list: [] })).toEqual([]);
    expect(typesOf({ slots: [], list: [], types: ['x', { id: 'y', label: '', columns: [{ id: 'a', label: 'A', kind: 'odd' }] }, { id: 'z', label: 'Z' }] } as unknown as ItemsShown))
      .toEqual([{ id: 'y', label: 'y', one: 'y', columns: [] }]);
    expect(lineColumns(null, line({ name: 'Pistol' }))).toBeNull();
  });

  it('what fits each kind, as the server\'s check', () => {
    const col = (kind: ColumnShown['kind'], more = {}): ColumnShown => ({ id: 'c', label: 'C', kind, ...more });
    const cases: [ColumnShown, unknown, boolean][] = [
      [col('number'), 2.5, true], [col('number'), '2', false], [col('number'), Infinity, false],
      [col('text'), 'melee', true], [col('text'), 'x'.repeat(LIMITS.text + 1), false], [col('text'), 3, false],
      [col('damage'), '1d8', true], [col('damage'), ' ', false], [col('dice'), 'x'.repeat(LIMITS.text + 1), false],
      [col('count'), 0, true], [col('count'), LIMITS.count, true], [col('count'), LIMITS.count + 1, false], [col('count'), -1, false], [col('count'), 1.5, false],
      [col('pick', { options: ['LIGHT'] }), 'LIGHT', true], [col('pick', { options: ['LIGHT'] }), 'HEAVY', false], [col('pick'), 'LIGHT', false],
    ];
    for (const [c, v, ok] of cases) {
      expect(fits(c, v), `${c.kind} ${String(v)}`).toBe(ok);
      if (c.kind !== 'damage' && c.kind !== 'dice') expect(server.valueProblem(c, v) === null, `server ${c.kind} ${String(v)}`).toBe(ok);
    }
  });
});

describe('a line\'s type and columns, as the server\'s lineColumns', () => {
  const LINES: Partial<InventoryItem>[] = [
    { name: '  pistol ' }, { name: 'Pistol Rounds' }, { name: 'Rope' }, { name: 'Mystery' }, { name: '' },
    { name: 'Pistol', values: { range: '50 m', weight: 'heavy' } },
    { name: 'A stick', type: 'weapons', values: { damage: '1d4', grade: 'MEDIUM' } },
    { name: 'Pistol', type: 'gear' },
    { name: 'Boots', type: 'gone', values: { weight: 1 } },
  ];
  it('each the same type and values', () => {
    for (const l of LINES) {
      const mine = lineColumns(SHOWN, line(l))!;
      const theirs = server.lineColumns(DEFINITION, l, DEFINITION.items.list, { known: (n: string) => namesOf(DEFINITION).has(n), refused: (n: string) => `@${n}` });
      expect(mine.type.id, JSON.stringify(l)).toBe(theirs.type);
      expect(mine.item?.id, JSON.stringify(l)).toBe(theirs.item);
      // A COUNT is the most it holds, which the server says under counts.
      const counts = mine.cells.filter((c) => c.column.kind === 'count');
      expect(Object.fromEntries(Object.entries(valuesOf(line(l))).filter(([id]) => !counts.some((c) => c.column.id === id))), JSON.stringify(l)).toEqual(theirs.values);
      expect(Object.fromEntries(counts.map((c) => [c.column.id, c.value ?? 0])), JSON.stringify(l))
        .toEqual(Object.fromEntries(Object.entries(theirs.counts as Record<string, { most: number }>).map(([id, c]) => [id, c.most])));
    }
  });

  it('its own value over its item\'s, each said apart', () => {
    const range = lineColumns(SHOWN, line({ name: 'Pistol', values: { range: '50 m' } }))!.cells.find((c) => c.column.id === 'range')!;
    expect(range).toMatchObject({ own: '50 m', given: '30 m', value: '50 m' });
    const damage = lineColumns(SHOWN, line({ name: 'Pistol' }))!.cells.find((c) => c.column.id === 'damage')!;
    expect(damage).toEqual({ column: expect.objectContaining({ id: 'damage' }), given: '2d6 + @might', value: '2d6 + @might' });
    expect(lineColumns(SHOWN, line({ name: 'Mystery' }))!.cells[0]).toEqual({ column: expect.objectContaining({ id: 'damage' }) });
    expect(itemOfLine(SHOWN, line({ name: '' }))).toBeUndefined();
  });

  it('a COUNT left as the server counts it (8a4b): its own, held to 0 to the most; all of it where unsaid; in words, "4 / 6"', () => {
    const lines: Partial<InventoryItem>[] = [
      { name: 'Pistol' }, { name: 'Pistol', counts: { ammo: 4 } }, { name: 'Pistol', counts: { ammo: 0 } }, { name: 'Pistol', counts: { ammo: 9 } },
      { name: 'Pistol', counts: { ammo: -2 } }, { name: 'Pistol', counts: { ammo: 2.5 } }, { name: 'Pistol', counts: { ammo: 'x' as never } },
      { name: 'Pistol', values: { ammo: 12 }, counts: { ammo: 8 } }, { name: 'A stick', type: 'weapons', counts: { ammo: 3 } },
    ];
    for (const l of lines) {
      const cell = lineColumns(SHOWN, line(l))!.cells.find((c) => c.column.id === 'ammo')!;
      const theirs = server.lineColumns(DEFINITION, l, DEFINITION.items.list, { known: () => true, refused: () => '' }).counts.ammo;
      expect(countOf(line(l), cell), JSON.stringify(l)).toEqual(theirs);
    }
    const at = (l: Partial<InventoryItem>) => { const c = lineColumns(SHOWN, line(l))!.cells.find((x) => x.column.id === 'ammo')!; return cellWords(c, line(l)); };
    expect(at({ name: 'Pistol', counts: { ammo: 4 } })).toBe('4 / 6');
    expect(at({ name: 'Pistol' })).toBe('6 / 6');
    // Without its line, a COUNT is the most it holds, as before.
    expect(cellWords(lineColumns(SHOWN, line({ name: 'Pistol' }))!.cells.find((x) => x.column.id === 'ammo')!)).toBe('6');
  });
});

describe('the tables', () => {
  it('a table per type in the system\'s order, every type there, each line where it is', () => {
    const lines = [line({ name: 'Rope' }), line({ name: 'Pistol' }), line({ name: 'A stick', type: 'weapons' }), line({ name: 'Pistol Rounds' })];
    const tables = gearTables(SHOWN, lines);
    expect(tables.map((t) => `${t.type.id}:${t.rows.map((r) => r.index).join(',')}`)).toEqual(['weapons:0,1,2', 'gear:3']);
    expect(gearTables(SHOWN, [line({ name: 'Pistol Rounds' })]).map((t) => t.rows.length)).toEqual([0, 1]);
    expect(gearTables(null, lines)).toEqual([]);
  });
});

describe('a line\'s values typed', () => {
  const cols = typesOf(SHOWN)[0].columns;
  const by = (id: string) => cols.find((c) => c.id === id)!;
  it('a NUMBER a number, a COUNT whole and held, words cut to the most; blank takes it away', () => {
    let l = line({ name: 'A stick', type: 'weapons' });
    l = withLineValue(l, by('weight'), '1.5');
    l = withLineValue(l, by('ammo'), '7.9');
    l = withLineValue(l, by('range'), 'x'.repeat(250));
    l = withLineValue(l, by('grade'), 'HEAVY');
    expect(l.values).toEqual({ weight: 1.5, ammo: 7, range: 'x'.repeat(LIMITS.text), grade: 'HEAVY' });
    expect(withLineValue(l, by('ammo'), '5000').values!.ammo).toBe(LIMITS.count);
    expect(withLineValue(l, by('ammo'), '-3').values!.ammo).toBe(0);
    // What doesn't read as a number leaves the line as it was.
    expect(withLineValue(l, by('weight'), 'heavy')).toBe(l);
    let gone = l;
    for (const c of ['weight', 'ammo', 'range', 'grade']) gone = withLineValue(gone, by(c), ' ');
    expect(gone).not.toHaveProperty('values');
    expect(gone).toMatchObject({ name: 'A stick', type: 'weapons' });
  });

  it('a new line of a type: one, stowed, its type said; a value shown as typed', () => {
    expect(newLineOf(typesOf(SHOWN)[0])).toEqual({ name: '', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: 'weapons' });
    expect(valueText(undefined)).toBe('');
    expect(valueText(2.5)).toBe('2.5');
  });
});

describe('a line keeps its type, values and counts', () => {
  it('read on the sheet and on the server alike, as they are; a line without them has none', () => {
    const rows = [
      { name: 'A stick', qty: 1, carry: 'readied', type: 'weapons', values: { damage: '1d4' }, counts: { ammo: 2 } },
      { name: 'Rope', qty: 1, carry: 'stowed', type: '', values: 'x', counts: [1] },
    ];
    const mine = readInventory({ inventory: JSON.stringify(rows) });
    expect(mine[0]).toMatchObject({ type: 'weapons', values: { damage: '1d4' }, counts: { ammo: 2 } });
    expect(Object.keys(mine[1]).sort()).toEqual(['bundled', 'carry', 'enc', 'location', 'name', 'qty']);
    expect(placement.readInventory({ inventory: JSON.stringify(rows) })).toEqual(mine);
    // Bought one more of: its type and values still there.
    const bought = placement.readInventory(placement.addToInventory({ inventory: JSON.stringify(rows) }, 'A stick', ''));
    expect(bought[0]).toMatchObject({ qty: 2, type: 'weapons', values: { damage: '1d4' }, counts: { ammo: 2 } });
  });
});

describe('the GEAR tab\'s bands (G2)', () => {
  const SHOWN = {
    slots: [], list: [],
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', on_sheet: 'equipped', columns: [] },
      { id: 'potions', label: 'POTIONS', one: 'Potion', on_sheet: 'usable', columns: [] },
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [] },
      { id: 'odd', label: 'ODD', one: 'Odd', on_sheet: 'belt', columns: [] },
    ],
  } as never;
  const at = (name: string, type: string, carry = 'stowed') => ({ name, qty: 1, enc: '', bundled: false, carry, location: '', type }) as never;

  it('each type\'s lines in its band, in hand first and otherwise as listed; a band\'s groups only for types with lines; the STASH whatever the type', () => {
    const bands = gearBands(SHOWN, [at('Sword', 'weapons'), at('Rope', 'gear'), at('Pistol', 'weapons', 'readied'), at('Knife', 'weapons'), at('Old Map', 'potions', 'stash'), at('Thing', 'odd')]);
    expect(bands.map((b) => [b.band, b.count])).toEqual([['equipped', 3], ['usable', 0], ['pack', 2], ['stash', 1]]);
    expect(bands[0].groups.map((g) => [g.type.id, g.rows.map((r) => r.line.name)])).toEqual([['weapons', ['Pistol', 'Sword', 'Knife']]]);
    // POTIONS' only line is in the stash: no POTIONS group in USABLE, its one line counted in the STASH.
    expect(bands[1].groups).toEqual([]);
    expect(bands[1].count).toBe(0);
    // A band that isn't one of the three is PACK.
    expect(bands[2].groups.map((g) => g.type.id)).toEqual(['gear', 'odd']);
    expect(bands[3].loose.map(({ type, row }) => [type.id, row.line.name, row.index])).toEqual([['potions', 'Old Map', 4]]);
  });
});
