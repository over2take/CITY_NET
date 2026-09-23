/**
 * Selling a basket back to a shop.
 *
 * Two things are being defended. **The payout cannot be talked up** - ownership is
 * re-derived from the sheet and the price comes from the book table, so nothing the
 * client sends decides what it is worth. And **the sheet cannot end up wrong** - an item
 * sold has to actually leave, a row that reaches zero has to go rather than read x0, and a
 * basket that fails half way must not have emptied anything.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { planSale, WEAPON_FIELDS, VEHICLE_FIELDS } = require_('../shops/sell');
const owned = require_('../shops/owned');

/** Every catalogue, for the cases where the shop is not what is being tested. */
const ALL = ['cyberware', 'weapons', 'armor', 'gear', 'vehicles', 'vehicle_fittings',
  'vehicle_weapons', 'pharmaceuticals', 'armor_mods', 'weapon_mods'];

const sell = (data, items, over = {}) =>
  planSale({ data, items, catalogues: ALL, locationPct: null, globalPct: null, ...over });

/** The inventory a patch would leave behind. */
const inventoryAfter = (out) => JSON.parse(out.patch[owned.INVENTORY_FIELD] ?? '[]');

describe('what a sale is worth', () => {
  it('pays the buy-back percentage of the book price', () => {
    // Climbing kit is 150. At the default 45% that is 67, rounded down from 67.5.
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 1 }]);
    expect(out).toMatchObject({ ok: true, payout: 67 });
  });

  it('multiplies by how many are being sold', () => {
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 3 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 3 }]);
    expect(out.payout).toBe(67 * 3);
  });

  it('uses this shop\'s own rate over the global one', () => {
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 1 }],
      { locationPct: 100, globalPct: 10 });
    expect(out.payout).toBe(150);
  });

  it('pays nothing at a shop set to zero, which is a real storefront', () => {
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 1 }], { locationPct: 0, globalPct: 45 });
    expect(out).toMatchObject({ ok: true, payout: 0 });
    // Still sold: the item leaves even though it paid nothing.
    expect(inventoryAfter(out)).toEqual([]);
  });

  it('ignores a price the client tried to name', () => {
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 1, price: 999999, each: 999999, payout: 999999 }]);
    expect(out.payout).toBe(67);
  });

  it('adds up a mixed basket', () => {
    const data = {
      inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]),
      weapon1_name: 'Heavy Pistol',
    };
    const out = sell(data, [
      { catalogue: 'gear', id: 'climbing_kit', qty: 1 },
      { catalogue: 'weapons', id: 'heavy_pistol', qty: 1 },
    ]);
    // 150 and 200 at 45% = 67 and 90.
    expect(out.payout).toBe(67 + 90);
  });
});

describe('what leaves the sheet', () => {
  it('drops an inventory row that reaches zero', () => {
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 1 }]);
    expect(inventoryAfter(out)).toEqual([]);
  });

  it('decrements a row that has some left', () => {
    const out = sell({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 5 }]) },
      [{ catalogue: 'gear', id: 'climbing_kit', qty: 2 }]);
    expect(inventoryAfter(out)).toEqual([{ name: 'Climbing kit', qty: 3 }]);
  });

  it('leaves other rows alone', () => {
    const data = {
      inventory: JSON.stringify([
        { name: 'Climbing kit', qty: 1 }, { name: 'Gas mask', qty: 2 },
      ]),
    };
    const out = sell(data, [{ catalogue: 'gear', id: 'climbing_kit', qty: 1 }]);
    expect(inventoryAfter(out)).toEqual([{ name: 'Gas mask', qty: 2 }]);
  });

  it('clears every field of a weapon slot, not just the name', () => {
    // A slot left holding damage and a skill with no name is a half-deleted gun.
    const data = {
      weapon1_name: 'Heavy Pistol', weapon1_dmg: '1d8', weapon1_skill: 'shoot',
      weapon1_enc: '1', weapon1_carry: 'readied',
    };
    const out = sell(data, [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }]);
    for (const f of WEAPON_FIELDS(1)) expect(out.patch[f], f).toBe('');
  });

  it('sells a weapon even though it is readied', () => {
    const out = sell({ weapon1_name: 'Heavy Pistol', weapon1_carry: 'readied' },
      [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }]);
    expect(out.ok).toBe(true);
    expect(out.patch.weapon1_name).toBe('');
  });

  it('takes one from the stash', () => {
    const data = { weapons_stash: JSON.stringify([{ name: 'Rifle' }, { name: 'Knife' }]) };
    const out = sell(data, [{ catalogue: 'weapons', id: 'rifle', qty: 1 }]);
    expect(JSON.parse(out.patch[owned.STASH_FIELD])).toEqual([{ name: 'Knife' }]);
  });

  it('removes a cyberware row, installed or not', () => {
    const data = { cyberware: [{ name: 'Cranial Jack', placed: true }, { name: 'Skinmod', placed: false }] };
    const out = sell(data, [{ catalogue: 'cyberware', id: 'cranial-jack', qty: 1 }]);
    expect(out.patch.cyberware).toEqual([{ name: 'Skinmod', placed: false }]);
  });

  it('clears a vehicle slot and the guns bolted to it', () => {
    // Selling the car and leaving three mounted weapons behind would describe guns
    // attached to nothing.
    const data = {
      vehicle1_type: 'motorcycle', vehicle1_name: 'Betty', vehicle1_hp: 10,
      vehicle1_weapon1_name: 'Autocannon',
    };
    const out = sell(data, [{ catalogue: 'vehicles', id: 'motorcycle', qty: 1 }]);
    for (const f of VEHICLE_FIELDS(1)) expect(out.patch[f], f).toBe('');
  });

  it('empties two places when one line spans both', () => {
    const data = {
      weapon1_name: 'Heavy Pistol',
      weapons_stash: JSON.stringify([{ name: 'Heavy Pistol' }]),
    };
    const out = sell(data, [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 2 }]);
    expect(out.patch.weapon1_name).toBe('');
    expect(JSON.parse(out.patch[owned.STASH_FIELD])).toEqual([]);
  });

  it('takes only as many as asked for when more are owned', () => {
    const data = { weapon1_name: 'Rifle', weapon2_name: 'Rifle' };
    const out = sell(data, [{ catalogue: 'weapons', id: 'rifle', qty: 1 }]);
    expect(out.patch.weapon1_name).toBe('');
    // The second is untouched; the patch does not mention it at all.
    expect(out.patch.weapon2_name).toBeUndefined();
  });
});

describe('what a shop refuses', () => {
  it('refuses a catalogue it does not deal in', () => {
    const out = sell({ weapon1_name: 'Heavy Pistol' },
      [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
      { catalogues: ['cyberware'] });
    expect(out).toMatchObject({ ok: false, reason: 'not_sold' });
  });

  it('refuses something the player does not have', () => {
    const out = sell({}, [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }]);
    expect(out).toMatchObject({ ok: false, reason: 'not_owned' });
  });

  it('refuses more than they have', () => {
    const out = sell({ weapon1_name: 'Rifle' },
      [{ catalogue: 'weapons', id: 'rifle', qty: 2 }]);
    expect(out).toMatchObject({ ok: false, reason: 'not_owned' });
  });

  it('will not let the same line be sold twice in one basket', () => {
    // Two entries of one each, against a character who owns one.
    const out = sell({ weapon1_name: 'Rifle' }, [
      { catalogue: 'weapons', id: 'rifle', qty: 1 },
      { catalogue: 'weapons', id: 'rifle', qty: 1 },
    ]);
    expect(out).toMatchObject({ ok: false, reason: 'not_owned' });
  });

  it('refuses an empty basket', () => {
    expect(sell({}, [])).toMatchObject({ ok: false, reason: 'empty' });
    expect(sell({}, null)).toMatchObject({ ok: false, reason: 'empty' });
    expect(sell({}, [{ catalogue: 'gear', id: 'climbing_kit', qty: 0 }]))
      .toMatchObject({ ok: false, reason: 'empty' });
  });

  it('empties nothing when a basket fails part way', () => {
    // The first line is fine and the second is not. Neither should happen.
    const data = {
      inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }]),
      weapon1_name: 'Rifle',
    };
    const out = sell(data, [
      { catalogue: 'gear', id: 'climbing_kit', qty: 1 },
      { catalogue: 'weapons', id: 'rifle', qty: 5 },
    ]);
    expect(out.ok).toBe(false);
    expect(out.patch).toBeUndefined();
  });
});

describe('chrome coming out of a body', () => {
  /**
   * The book puts surgery and a complications roll on taking cyberware out, and the app
   * models neither - the row goes, the strain goes with it, nothing is rolled. That gap is
   * only fillable at the table if the player is told it exists, so the sale counts what
   * came out of a body and the window says so before and after. Counted rather than
   * refused: selling installed chrome is allowed, it just is not the whole procedure.
   */
  it('counts an installed piece', () => {
    const out = sell({ cyberware: [{ name: 'Cranial Jack', placed: true }] },
      [{ catalogue: 'cyberware', id: 'cranial-jack', qty: 1 }]);
    expect(out).toMatchObject({ ok: true, fromBody: 1 });
  });

  it('does not count one that was never installed', () => {
    // A boxed piece in a bag is just goods. No surgery, nothing to warn about.
    const out = sell({ cyberware: [{ name: 'Cranial Jack', placed: false }] },
      [{ catalogue: 'cyberware', id: 'cranial-jack', qty: 1 }]);
    expect(out).toMatchObject({ ok: true, fromBody: 0 });
  });

  it('counts only the installed ones when both are sold at once', () => {
    const data = {
      cyberware: [
        { name: 'Cyberlimb', placed: true },
        { name: 'Cyberlimb', placed: false },
      ],
    };
    const out = sell(data, [{ catalogue: 'cyberware', id: 'cyberlimb', qty: 2 }]);
    expect(out.fromBody).toBe(1);
  });

  it('is zero for a sale that touches no chrome at all', () => {
    const out = sell({ weapon1_name: 'Rifle' }, [{ catalogue: 'weapons', id: 'rifle', qty: 1 }]);
    expect(out.fromBody).toBe(0);
  });
});

describe('things no catalogue carries', () => {
  const data = { inventory: JSON.stringify([{ name: "Betty's lucky knife", qty: 2 }]) };

  it('sells for nothing rather than being refused', () => {
    // The player gets it off their sheet; the GM settles up directly.
    const out = sell(data, [{ catalogue: null, id: null, label: "Betty's lucky knife", qty: 1 }]);
    expect(out).toMatchObject({ ok: true, payout: 0 });
    expect(inventoryAfter(out)).toEqual([{ name: "Betty's lucky knife", qty: 1 }]);
  });

  it('can be sold at any shop, since no storefront is the right one for it', () => {
    const out = sell(data, [{ catalogue: null, id: null, label: "Betty's lucky knife", qty: 2 }],
      { catalogues: ['cyberware'] });
    expect(out.ok).toBe(true);
    expect(inventoryAfter(out)).toEqual([]);
  });

  it('still cannot be sold in numbers they do not have', () => {
    const out = sell(data, [{ catalogue: null, id: null, label: "Betty's lucky knife", qty: 9 }]);
    expect(out).toMatchObject({ ok: false, reason: 'not_owned' });
  });
});
