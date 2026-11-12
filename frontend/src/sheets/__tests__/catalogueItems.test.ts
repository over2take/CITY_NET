import { describe, it, expect, afterEach } from 'vitest';
import { distance, itemsInPreview, itemsShelf, itemsCatalogue, landsAsGear } from '../catalogueItems';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';
import type { ItemsShown } from '../gearItems';

/**
 * A system's items in the shops' catalogues (7e3c): which preview lines are items and which only nearly are, and a
 * starter catalogue of the items, prices to fill in.
 */

const HEARTH = 'sys_bbbbbbbbbbbbbbbb';
const ITEMS: ItemsShown = {
  slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
  list: [
    { id: 'ring', label: 'Ring of Might', description: 'A heavy iron band.', needs: 'attuned', features: [] },
    { id: 'ring2', label: 'Ring of Night', needs: 'attuned', features: [] },
    { id: 'coin', label: 'Coin', needs: 'carried', features: [] },
    { id: 'blank', label: '  ', needs: 'worn', features: [] },
  ],
};
const hearth = (buildings = {}) => registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {}, buildings });

afterEach(() => clearCustomTemplates());

describe('how far apart two names are', () => {
  it('a letter added, taken away or changed is one', () => {
    expect(distance('might', 'might')).toBe(0);
    expect(distance('might', 'mite')).toBe(3);
    expect(distance('coin', 'coins')).toBe(1);
    expect(distance('', 'abc')).toBe(3);
    expect(distance('kitten', 'sitting')).toBe(3);
  });
});

describe('the preview\'s lines read against the items', () => {
  it('a line named as an item, in any case and trimmed, is it; where it lands as gear said', () => {
    hearth();
    const { matched } = itemsInPreview(HEARTH, ITEMS, { gear: [{ name: '  ring of MIGHT ', line: 4 }, { name: 'Rope', line: 5 }] });
    expect(matched).toEqual([{ catalogue: 'gear', name: '  ring of MIGHT ', item: 'Ring of Might', lands: true, line: 4 }]);
  });

  it('one landing in its own rows, not the gear, says so: on Cities Without Number, a weapon', () => {
    expect(landsAsGear('cities_without_number', 'weapons')).toBe(false);
    expect(landsAsGear('cities_without_number', 'gear')).toBe(true);
    expect(itemsInPreview('cities_without_number', ITEMS, { weapons: [{ name: 'Ring of Might' }] }).matched)
      .toEqual([{ catalogue: 'weapons', name: 'Ring of Might', item: 'Ring of Might', lands: false }]);
  });

  it('nearly named: the same but for marks, a letter or two off a long name, one off a short; the closest item named', () => {
    hearth();
    const { matched, near } = itemsInPreview(HEARTH, ITEMS, { gear: [
      { name: 'Ring-of-Might.', line: 1 }, { name: 'Ring of Migt', line: 2 }, { name: 'Ring of Nigh', line: 3 },
      { name: 'Coins', line: 4 }, { name: 'Coat', line: 5 }, { name: 'Ring of Mite', line: 6 }, { name: 'Rope', line: 7 },
      { name: 'Ring of Mihgt', line: 8 },
    ] });
    expect(matched).toEqual([]);
    expect(near.map((n) => [n.line, n.name, n.item])).toEqual([
      [1, 'Ring-of-Might.', 'Ring of Might'], [2, 'Ring of Migt', 'Ring of Might'], [3, 'Ring of Nigh', 'Ring of Night'], [4, 'Coins', 'Coin'], [8, 'Ring of Mihgt', 'Ring of Might'],
    ]);
  });

  it('nothing without items, and a line without a name passed over', () => {
    hearth();
    expect(itemsInPreview(HEARTH, undefined, { gear: [{ name: 'Ring of Might' }] })).toEqual({ matched: [], near: [] });
    expect(itemsInPreview(HEARTH, { slots: [], list: [] }, { gear: [{ name: 'Ring of Might' }] })).toEqual({ matched: [], near: [] });
    expect(itemsInPreview(HEARTH, ITEMS, undefined)).toEqual({ matched: [], near: [] });
    expect(itemsInPreview(HEARTH, ITEMS, { gear: [{ name: '' }, { name: '   ' }, null as never], weapons: undefined as never })).toEqual({ matched: [], near: [] });
    // An item without a name is nothing to match: a blank line never "is" it.
    expect(itemsInPreview(HEARTH, ITEMS, { gear: [{ name: 'xx' }] }).near).toEqual([]);
    // Nor one of marks only, against another: nothing of either to compare.
    expect(itemsInPreview(HEARTH, { slots: [], list: [{ id: 'q', label: '??', needs: 'worn', features: [] }] }, { gear: [{ name: '!!' }] })).toEqual({ matched: [], near: [] });
  });
});

describe('a starter catalogue of the items', () => {
  it('on the gear\'s shelf, each a row of its name and words, its price left to fill in, said so', () => {
    hearth();
    expect(itemsShelf(HEARTH)).toBe('gear');
    const file = itemsCatalogue(HEARTH, ITEMS)!;
    expect(file).toContain('[gear]');
    expect(file).not.toContain('[weapons]');
    expect(file).toMatch(/^Ring of Might\s*,\s*,\s*,\s*A heavy iron band\.$/m);
    expect(file).toMatch(/^Ring of Night[\s,]*$/m);
    expect(file).toMatch(/^Coin[\s,]*$/m);
    expect(file).toContain("# Your system's items, to sell in its shops. Fill in each price, then upload this.");
    expect(file).toContain('# A row without a price is left out, so nothing is sold free by mistake.');
  });

  it('with the gear turned off, the first catalogue that lands as gear; none with nothing to sell or nowhere', () => {
    hearth({ catalogues: { gear: { on: false } } });
    expect(itemsShelf(HEARTH)).not.toBe('gear');
    expect(itemsShelf(HEARTH)).not.toBeNull();
    expect(itemsCatalogue(HEARTH, ITEMS)).toContain(`[${itemsShelf(HEARTH)}]`);
    expect(itemsCatalogue(HEARTH, undefined)).toBeNull();
    expect(itemsCatalogue(HEARTH, { slots: [], list: [{ id: 'b', label: ' ', needs: 'worn', features: [] }] })).toBeNull();
  });
});
