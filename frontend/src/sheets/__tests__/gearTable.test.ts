import { describe, it, expect } from 'vitest';
import { tablePlan, gridTemplate, reserveOf, reserveWords, WIDE_AT, NAME_ROOM } from '../gearTable';
import type { ColumnShown, TypeShown } from '../gearTypes';
import type { InventoryItem } from '../inventory';

// A type's gear as a table (8e2a; approved mockup docs/mockups/gear-table.html, answered 2026-11-25): heads once, every
// DAMAGE under one head, what the width can't hold folded under the row; and what a COUNT reloads from, carried.

const col = (id: string, kind: ColumnShown['kind'], more: Partial<ColumnShown> = {}): ColumnShown => ({ id, label: id.toUpperCase(), kind, ...more });
const WEAPONS: TypeShown = {
  id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
    col('hit', 'dice'), col('one', 'damage', { label: 'One handed' }), col('two', 'damage', { label: 'Two handed' }),
    col('range', 'text'), col('ammo', 'count', { reload: ['Arrows'] }), col('notes', 'text'),
  ],
};
const heads = (t: TypeShown, w: number) => tablePlan(t, w).heads.map((h) => h.label);
const folded = (t: TypeShown, w: number) => tablePlan(t, w).folded.map((c) => c.id);

describe('the table\'s heads', () => {
  it('wide: every column its head, every DAMAGE under one, where the first is', () => {
    expect(heads(WEAPONS, WIDE_AT)).toEqual(['HIT', 'DAMAGE', 'RANGE', 'AMMO', 'NOTES']);
    expect(folded(WEAPONS, WIDE_AT)).toEqual([]);
    expect(tablePlan(WEAPONS, WIDE_AT).heads[1].columns.map((c) => c.id)).toEqual(['one', 'two']);
    expect(tablePlan(WEAPONS, WIDE_AT).wide).toBe(true);
  });
  it('one DAMAGE: its own name for its head', () => {
    const one = { ...WEAPONS, columns: [col('hurt', 'damage', { label: 'Hurts' }), col('range', 'text')] };
    expect(heads(one, WIDE_AT)).toEqual(['HURTS', 'RANGE']);
  });
  it('narrow: what fits stays, never words nor a COUNT that reloads; a COUNT that doesn\'t stays', () => {
    expect(heads(WEAPONS, 500)).toEqual(['HIT', 'DAMAGE']);
    expect(folded(WEAPONS, 500)).toEqual(['range', 'ammo', 'notes']);
    expect(tablePlan(WEAPONS, 500).wide).toBe(false);
    const potions: TypeShown = { id: 'p', label: 'POTIONS', one: 'Potion', columns: [col('heals', 'dice'), col('doses', 'count', { button: 'DRINK' })] };
    expect(heads(potions, 500)).toEqual(['HEALS', 'DOSES']);
    // A COUNT that reloads folds even with room for it: what is carried goes beside it.
    const bow: TypeShown = { id: 'b', label: 'BOWS', one: 'Bow', columns: [col('ammo', 'count', { reload: ['Arrows'] })] };
    expect(heads(bow, 600)).toEqual([]);
    expect(folded(bow, 600)).toEqual(['ammo']);
  });
  it('the first that won\'t fit folds, and every one after it, so a row never skips to a later one', () => {
    // Room for HIT (80) and not the two DAMAGE (160): DAMAGE and all after fold.
    expect(heads(WEAPONS, NAME_ROOM + 100)).toEqual(['HIT']);
    expect(folded(WEAPONS, NAME_ROOM + 100)).toEqual(['one', 'two', 'range', 'ammo', 'notes']);
    // Two DAMAGE buttons, each named, want more room than one.
    expect(heads(WEAPONS, NAME_ROOM + 80 + 120)).toEqual(['HIT']);
    expect(heads(WEAPONS, NAME_ROOM + 80 + 160)).toEqual(['HIT', 'DAMAGE']);
    const numbers: TypeShown = { id: 'a', label: 'ARMOR', one: 'Armor', columns: [col('ac', 'number'), col('grade', 'pick'), col('weight', 'number')] };
    expect(heads(numbers, NAME_ROOM + 140)).toEqual(['AC']);
    expect(heads(numbers, NAME_ROOM + 150)).toEqual(['AC', 'GRADE']);
    expect(heads(numbers, NAME_ROOM + 220)).toEqual(['AC', 'GRADE', 'WEIGHT']);
  });
  it('not measured (0): everything folded, as the line was', () => {
    expect(heads(WEAPONS, 0)).toEqual([]);
    expect(folded(WEAPONS, 0)).toEqual(['hit', 'one', 'two', 'range', 'ammo', 'notes']);
  });
  it('its columns: the name\'s, then words given room to wrap, the rest as wide as their cells', () => {
    expect(gridTemplate(tablePlan(WEAPONS, WIDE_AT))).toBe('minmax(110px, 1fr) auto auto minmax(0, 1.2fr) auto minmax(0, 1.2fr)');
    expect(gridTemplate(tablePlan(WEAPONS, 0))).toBe('minmax(110px, 1fr)');
  });
});

describe('what a COUNT reloads from, carried', () => {
  const l = (name: string, qty: number, carry: InventoryItem['carry'] = 'stowed'): InventoryItem => ({ name, qty, enc: '', bundled: false, carry, location: '' });
  const items = [l('Shortbow', 1, 'readied'), l('Arrows', 600), l(' arrows ', 200, 'readied'), l('Arrows', 50, 'stash'), l('AP Rounds', 6), l('Bolts', 9)];
  it('every other line of each name it reloads from, readied or stowed, not stashed, by name whatever its case', () => {
    expect(reserveOf(items, ['Arrows'], 0)).toEqual([{ name: 'Arrows', qty: 800 }]);
    expect(reserveOf(items, ['Pistol Rounds', 'AP Rounds'], 0)).toEqual([{ name: 'Pistol Rounds', qty: 0 }, { name: 'AP Rounds', qty: 6 }]);
    // Not itself: a line of Arrows that reloads from Arrows.
    expect(reserveOf(items, ['Arrows'], 1)).toEqual([{ name: 'Arrows', qty: 200 }]);
    // A quantity that isn't one: as one, as the sheet reads it.
    expect(reserveOf([l('Shortbow', 1), { ...l('Arrows', 1), qty: 'x' as unknown as number }], ['Arrows'], 0)).toEqual([{ name: 'Arrows', qty: 1 }]);
  });
  it('said beside the count: each with some, joined; none at all, said so', () => {
    expect(reserveWords([{ name: 'Arrows', qty: 800 }])).toBe('ARROWS ×800 CARRIED');
    expect(reserveWords([{ name: 'Pistol Rounds', qty: 24 }, { name: 'AP Rounds', qty: 6 }])).toBe('PISTOL ROUNDS ×24 · AP ROUNDS ×6 CARRIED');
    expect(reserveWords([{ name: 'Pistol Rounds', qty: 0 }, { name: 'AP Rounds', qty: 6 }])).toBe('AP ROUNDS ×6 CARRIED');
    expect(reserveWords([{ name: 'Arrows', qty: 0 }])).toBe('NONE CARRIED');
  });
});
