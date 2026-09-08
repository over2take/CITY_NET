import { describe, it, expect } from 'vitest';
import {
  INVENTORY_FIELD, readInventory, writeInventory, normaliseItem, itemEnc,
  inventoryEnc, blankItem, CARRY_STATES,
} from '../inventory';
import { getTemplate } from '../index';

/**
 * The inventory that replaced a textarea on all four sheets.
 *
 * Prose is fine for "a photo of her daughter" and useless for anything the sheet has to
 * count. Weapons are deliberately elsewhere - they carry combat stats and feed the attack
 * picker - but share the Readied / Stowed / Stash vocabulary.
 */

const inv = (rows: unknown[]) => ({ [INVENTORY_FIELD]: JSON.stringify(rows) });

describe('reading the list', () => {
  it('round-trips through the sheet', () => {
    const item = normaliseItem({ name: 'Medkit', qty: 2, enc: '1', carry: 'readied' });
    expect(readInventory({ [INVENTORY_FIELD]: writeInventory([item]) })[0]).toEqual(item);
  });

  it('reads a malformed field as empty rather than throwing', () => {
    for (const v of [undefined, null, '', 'nonsense', 42, {}, [1, 'x']]) {
      expect(readInventory({ [INVENTORY_FIELD]: v }), String(v)).toEqual([]);
    }
  });

  it('fills in what a hand-edited row left out', () => {
    expect(normaliseItem({ name: 'Rope' })).toEqual({
      name: 'Rope', qty: 1, enc: '', bundled: false, carry: 'stash', location: '',
    });
  });

  it('never stores less than one of something', () => {
    // A row that exists is a thing you have. Zero of something is a deleted row.
    expect(normaliseItem({ name: 'Stim', qty: 0 }).qty).toBe(1);
    expect(normaliseItem({ name: 'Stim', qty: -4 }).qty).toBe(1);
    expect(normaliseItem({ name: 'Stim', qty: 2.7 }).qty).toBe(2);
  });

  it('treats an unknown carry state as stashed rather than as carried', () => {
    // The safe way round: it costs nothing until somebody says it is on them.
    expect(normaliseItem({ name: 'x', carry: 'nonsense' }).carry).toBe('stash');
    expect(normaliseItem({ name: 'x' }).carry).toBe('stash');
  });
});

describe('what a stack weighs', () => {
  const item = (over = {}) =>
    normaliseItem({ name: 'Thing', qty: 1, enc: '1', carry: 'stowed', ...over });

  it('is the quantity times the Enc of one', () => {
    expect(itemEnc(item({ qty: 4, enc: '2' }))).toBe(8);
  });

  it('is nothing at all while stashed', () => {
    // The stash is not on you.
    expect(itemEnc(item({ qty: 99, enc: '5', carry: 'stash' }))).toBe(0);
  });

  it('is nothing for pocket-sized things', () => {
    // "Any reasonable amount of these can be carried" (p48).
    expect(itemEnc(item({ qty: 50, enc: '0' }))).toBe(0);
    expect(itemEnc(item({ qty: 50, enc: '' }))).toBe(0);
  });

  it('bundles three into one, and rounds a part-bundle up', () => {
    // "Three such items can be tied into a bundle that only counts as one item of
    // encumbrance" - so six grenades are two, not six, and four are two as well.
    expect(itemEnc(item({ qty: 3, bundled: true }))).toBe(1);
    expect(itemEnc(item({ qty: 6, bundled: true }))).toBe(2);
    expect(itemEnc(item({ qty: 4, bundled: true }))).toBe(2);
    expect(itemEnc(item({ qty: 1, bundled: true }))).toBe(1);
  });

  it('does not bundle unless the row says so', () => {
    expect(itemEnc(item({ qty: 6, bundled: false }))).toBe(6);
  });
});

describe('what the whole list adds to each track', () => {
  it('keeps readied and stowed apart, because the limits are', () => {
    expect(inventoryEnc(inv([
      { name: 'a', qty: 2, enc: '1', carry: 'readied' },
      { name: 'b', qty: 3, enc: '1', carry: 'stowed' },
      { name: 'c', qty: 9, enc: '9', carry: 'stash' },
    ]))).toEqual({ readied: 2, stowed: 3 });
  });

  it('is nothing at all for an empty sheet', () => {
    expect(inventoryEnc({})).toEqual({ readied: 0, stowed: 0 });
  });
});

describe('a new row', () => {
  it('starts stowed with one of it', () => {
    // Stowed rather than Readied: adding a row should not silently put a thing in
    // somebody's hands, and Stowed is the more forgiving limit.
    expect(blankItem()).toMatchObject({ qty: 1, carry: 'stowed', bundled: false });
  });

  it('offers the same three states weapons use', () => {
    expect(CARRY_STATES.map((c) => c.value)).toEqual(['readied', 'stowed', 'stash']);
  });
});

describe('where it lives', () => {
  it('is on every system, because every system had the textarea it replaced', () => {
    for (const id of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const t = getTemplate(id);
      const section = t.sections.find((s) => s.layout === 'inventory');
      expect(section, id).toBeTruthy();
      expect(section!.tab, id).toBe('GEAR');
    }
  });

  it('counts Encumbrance only where the game has a carrying rule', () => {
    // Cyberpunk RED and Shadowrun have no Encumbrance, so they get the table without the
    // column rather than a rule invented for them.
    const encOf = (id: string) =>
      getTemplate(id).sections.find((s) => s.layout === 'inventory')!.inventoryEnc;
    expect(encOf('cities_without_number')).toBe(true);
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(encOf(id), id).toBeFalsy();
    }
  });
});
