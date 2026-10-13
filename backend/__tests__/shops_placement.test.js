import { describe, it, expect } from 'vitest';

const placement = require('../shops/placement');

/**
 * Where an item lands on a sheet, on the server (4g1a), for GIVE ITEM. The shop's own placement is
 * the original; frontend/src/sheets/__tests__/serverPlacement.test.ts holds this file to it for the
 * built-in games. These are the parts only the server has: several at once, a custom system, and
 * stacking by a rule of the caller's own.
 */

const CUSTOM = 'sys_aaaaaaaaaaaaaaaa';
const PISTOL = { id: 'pistol', name: 'Pistol', price: 100, fields: { dmg: '1d6', enc: '1' } };

describe('several of something', () => {
  it('fills a row each, one after another', () => {
    const r = placement.placeTimes((d) => placement.placeUploaded('cities_without_number', 'weapons', PISTOL, d), { weapon1_name: 'Knife' }, 2);
    // A CWN weapon row has an Encumbrance field, so the entry's enc lands there too.
    expect(r).toEqual({ ok: true, patch: {
      weapon2_name: 'Pistol', weapon2_dmg: '1d6', weapon2_enc: '1', weapon3_name: 'Pistol', weapon3_dmg: '1d6', weapon3_enc: '1',
    } });
  });

  it('stacks inventory lines into one', () => {
    const r = placement.placeTimes((d) => placement.placeUploaded('generic', 'gear', { name: 'Rope', price: 1, fields: {} }, d), {}, 3);
    expect(JSON.parse(r.patch.inventory)).toEqual([{ name: 'Rope', qty: 3, enc: '', bundled: false, carry: 'stowed', location: '' }]);
  });

  it('places none of them when they don\'t all fit, saying how many would have', () => {
    const five = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`weapon${i}_name`, `Gun ${i}`]));
    expect(placement.placeTimes((d) => placement.placeUploaded('cities_without_number', 'weapons', PISTOL, d), five, 2))
      .toEqual({ ok: false, reason: 'No free weapon slot — all 6 are full. Clear one on the sheet first.', placed: 1 });
  });

  it('reads a quantity below one, or none, as one', () => {
    for (const qty of [0, -2, 'x', undefined, 1.7]) {
      expect(placement.placeTimes((d) => placement.placeUploaded('generic', 'gear', { name: 'Rope', price: 1, fields: {} }, d), {}, qty).ok, String(qty)).toBe(true);
      expect(JSON.parse(placement.placeTimes((d) => placement.placeUploaded('generic', 'gear', { name: 'Rope', price: 1, fields: {} }, d), {}, qty).patch.inventory)[0].qty, String(qty)).toBe(1);
    }
  });
});

describe('a custom system', () => {
  it('takes everything as an inventory line, its numbered rows and cyberware table having no part in it', () => {
    for (const catalogue of ['weapons', 'vehicles', 'cyberware', 'gear']) expect(placement.shapeOf(CUSTOM, catalogue), catalogue).toBe('inventory');
    const r = placement.placeUploaded(CUSTOM, 'weapons', PISTOL, {});
    expect(JSON.parse(r.patch.inventory)).toEqual([{ name: 'Pistol', qty: 1, enc: '1', bundled: false, carry: 'stowed', location: '' }]);
  });
});

describe('stacking', () => {
  it('goes onto a carried line the caller\'s own rule matches, never a stashed one', () => {
    const sheet = { inventory: [{ name: 'Stim (Lift)', qty: 2, carry: 'stash' }, { name: 'Lift dose', qty: 1, carry: 'readied' }] };
    const patch = placement.addToInventory(sheet, 'Lift', '', (item) => item.name.includes('Lift'));
    expect(JSON.parse(patch.inventory).map((i) => [i.name, i.qty])).toEqual([['Stim (Lift)', 2], ['Lift dose', 2]]);
    const fresh = placement.addToInventory({ inventory: [{ name: 'Lift', qty: 1, carry: 'stash' }] }, 'Lift', '0');
    expect(JSON.parse(fresh.inventory).map((i) => [i.name, i.qty, i.carry, i.enc])).toEqual([['Lift', 1, 'stash', ''], ['Lift', 1, 'stowed', '0']]);
  });

  it('keeps the mods fitted to chrome a character already has', () => {
    const sheet = { cyberware: [{ name: 'Body Blades I', type: 'r_arm', hl: 1, placed: true, cyberMods: '["tailored_interface"]' }] };
    const r = placement.placeUploaded('cities_without_number', 'cyberware', { name: 'Cranial Jack', price: 1000, fields: { strain: 1 } }, sheet);
    expect(r.patch.cyberware.map((c) => [c.name, c.cyberMods, c.placed])).toEqual([['Body Blades I', ['tailored_interface'], true], ['Cranial Jack', [], false]]);
  });
});
