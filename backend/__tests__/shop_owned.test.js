/**
 * What a character owns, read off the sheet.
 *
 * This is the thing a sale is checked against, so the cases that matter are the ones
 * where a sheet does not say what it appears to say: the same gun in two slots, a vehicle
 * somebody renamed, an inventory row for something no catalogue carries, and a sheet with
 * fields simply missing.
 *
 * Derived rather than cached on purpose - see the note at the top of shops/owned.js - so
 * there is no "stale manifest" case to test, which is the point.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { ownedItems, ownedLine, SOURCES } = require_('../shops/owned');
const prices = require_('../shops/prices');

/** A line by catalogue/id, for readability below. */
const line = (data, cat, id) => ownedLine(data, cat, id);

describe('inventory rows', () => {
  it('counts a row by its quantity', () => {
    const owned = line({ inventory: JSON.stringify([{ name: 'Climbing kit', qty: 2 }]) },
      'gear', 'climbing_kit');
    expect(owned).toMatchObject({ qty: 2, label: 'Climbing kit', unitPrice: 150 });
  });

  it('adds two rows of the same thing into one line', () => {
    // Buying stacks onto an existing row, but an import or a hand edit can leave two.
    const owned = line({
      inventory: JSON.stringify([
        { name: 'Climbing kit', qty: 2 },
        { name: 'Climbing kit', qty: 3, carry: 'stash' },
      ]),
    }, 'gear', 'climbing_kit');
    expect(owned.qty).toBe(5);
    expect(owned.at).toHaveLength(2);
  });

  it('counts a stashed row, because a locker is still yours', () => {
    const owned = line({ inventory: JSON.stringify([{ name: 'Gas mask', qty: 1, carry: 'stash' }]) },
      'gear', 'gas_mask');
    expect(owned.qty).toBe(1);
  });

  it('reads a quantity of zero or nonsense as one', () => {
    // A row exists because somebody put it there. Reading a blank qty as nothing would
    // hide an item its owner can plainly see.
    for (const qty of [0, undefined, null, 'x', -3]) {
      const owned = line({ inventory: JSON.stringify([{ name: 'Lockpicks', qty }]) },
        'gear', 'lockpicks');
      expect(owned.qty, String(qty)).toBe(1);
    }
  });

  it('survives an inventory that is not JSON at all', () => {
    for (const bad of ['', 'not json', null, undefined, 42, {}]) {
      expect(() => ownedItems({ inventory: bad })).not.toThrow();
      expect(ownedItems({ inventory: bad })).toEqual([]);
    }
  });
});

describe('weapons', () => {
  it('finds a weapon in a carried slot', () => {
    expect(line({ weapon1_name: 'Heavy Pistol' }, 'weapons', 'heavy_pistol'))
      .toMatchObject({ qty: 1, unitPrice: 200 });
  });

  it('counts the same gun in two slots as one line of two', () => {
    const owned = line({ weapon1_name: 'Heavy Pistol', weapon4_name: 'Heavy Pistol' },
      'weapons', 'heavy_pistol');
    expect(owned.qty).toBe(2);
    expect(owned.at.map((a) => a.slot).sort()).toEqual([1, 4]);
  });

  it('finds a weapon in the stash', () => {
    const owned = line({ weapons_stash: JSON.stringify([{ name: 'Rifle' }]) }, 'weapons', 'rifle');
    expect(owned).toMatchObject({ qty: 1 });
    expect(owned.at[0].source).toBe(SOURCES.STASH);
  });

  it('adds a carried one and a stashed one together', () => {
    const owned = line({
      weapon2_name: 'Rifle',
      weapons_stash: JSON.stringify([{ name: 'Rifle' }, { name: 'Rifle' }]),
    }, 'weapons', 'rifle');
    expect(owned.qty).toBe(3);
  });

  it('ignores empty and whitespace-only slots', () => {
    expect(ownedItems({ weapon1_name: '', weapon2_name: '   ', weapon3_name: null })).toEqual([]);
  });
});

describe('cyberware', () => {
  /**
   * Cyberware is stored as a real array on the sheet, not as a JSON string the way the
   * inventory is. cyberware.rows() - the canonical reader, reused here rather than
   * reimplemented - takes it at its word and returns nothing for a string, which is
   * correct: nothing in the app writes one.
   */
  const rows = (list) => ({ cyberware: list });

  it('finds an unplaced piece', () => {
    const owned = line(rows([{ name: 'Cranial Jack', placed: false }]), 'cyberware', 'cranial-jack');
    expect(owned).toMatchObject({ qty: 1, unitPrice: 1000 });
    expect(owned.at[0].placed).toBe(false);
  });

  it('finds an installed piece too, and says that it is installed', () => {
    // Installed chrome sells. The app does not model surgery on the way out, and the line
    // carries `placed` so a window can say so before somebody clicks.
    const owned = line(rows([{ name: 'Cranial Jack', placed: true }]), 'cyberware', 'cranial-jack');
    expect(owned.qty).toBe(1);
    expect(owned.at[0].placed).toBe(true);
  });

  it('counts two of the same piece as one line of two', () => {
    const owned = line(
      rows([{ name: 'Cyberlimb', placed: true }, { name: 'Cyberlimb', placed: false }]),
      'cyberware', 'cyberlimb',
    );
    expect(owned.qty).toBe(2);
  });
});

describe('vehicles', () => {
  it('finds one by its type, not by what it has been named', () => {
    // A Motorcycle called Betty is still a Motorcycle and still worth what one is worth.
    const owned = line({ vehicle1_type: 'motorcycle', vehicle1_name: 'Betty' },
      'vehicles', 'motorcycle');
    expect(owned).toMatchObject({ qty: 1, label: 'MOTORCYCLE', unitPrice: 1000 });
    expect(owned.at[0].named).toBe('Betty');
  });

  it('counts two of the same model across slots', () => {
    const owned = line(
      { vehicle1_type: 'car', vehicle1_name: 'Car', vehicle3_type: 'car', vehicle3_name: 'Spare' },
      'vehicles', 'car',
    );
    expect(owned.qty).toBe(2);
  });

  it('ignores an empty slot', () => {
    expect(ownedItems({ vehicle1_type: '', vehicle1_name: '' })).toEqual([]);
  });

  it('keeps a slot that has a name but no recognised type', () => {
    // Half-filled by hand. It is still something the player can see and sell.
    const owned = ownedItems({ vehicle2_name: 'Rust Bucket' });
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ catalogue: null, label: 'Rust Bucket', unitPrice: null });
  });
});

describe('things no catalogue carries', () => {
  it('lists them with no price rather than dropping them', () => {
    // Players rename things, write in homebrew and carry quest items. The GM settles up
    // for those directly, so they are worth nothing here but must still be visible.
    const owned = ownedItems({ inventory: JSON.stringify([{ name: "Betty's lucky knife", qty: 1 }]) });
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ catalogue: null, id: null, unitPrice: null, qty: 1 });
    expect(owned[0].label).toBe("Betty's lucky knife");
  });

  it('keeps two differently named unknowns apart', () => {
    const owned = ownedItems({
      inventory: JSON.stringify([{ name: 'Odd thing', qty: 1 }, { name: 'Other thing', qty: 1 }]),
    });
    expect(owned).toHaveLength(2);
  });

  it('merges the same unknown written two ways', () => {
    const owned = ownedItems({
      inventory: JSON.stringify([{ name: 'Odd  Thing', qty: 1 }, { name: 'odd thing', qty: 2 }]),
    });
    expect(owned).toHaveLength(1);
    expect(owned[0].qty).toBe(3);
  });
});

describe('a whole character', () => {
  const sheet = {
    inventory: JSON.stringify([
      { name: 'Climbing kit', qty: 2 },
      { name: "Betty's lucky knife", qty: 1 },
    ]),
    weapon1_name: 'Heavy Pistol',
    weapons_stash: JSON.stringify([{ name: 'Heavy Pistol' }]),
    cyberware: [{ name: 'Cranial Jack', placed: true }],
    vehicle1_type: 'motorcycle',
    vehicle1_name: 'Betty',
  };

  it('gathers every kind into one list', () => {
    const owned = ownedItems(sheet);
    const byLabel = Object.fromEntries(owned.map((l) => [l.label, l.qty]));
    expect(byLabel).toEqual({
      'Climbing kit': 2,
      "Betty's lucky knife": 1,
      'Heavy Pistol': 2,
      'Cranial Jack': 1,
      MOTORCYCLE: 1,
    });
  });

  it('prices everything the catalogues know and nothing else', () => {
    for (const l of ownedItems(sheet)) {
      if (l.catalogue) expect(l.unitPrice, l.label).toBe(prices.priceOf(l.catalogue, l.id));
      else expect(l.unitPrice, l.label).toBeNull();
    }
  });

  it('records a place for every one of them', () => {
    // The count and the places have to agree, or a sale would empty the wrong number.
    for (const l of ownedItems(sheet)) {
      expect(l.at.reduce((n, a) => n + a.qty, 0), l.label).toBe(l.qty);
    }
  });

  it('says a character with nothing owns nothing', () => {
    for (const empty of [{}, null, undefined, 'nonsense', 7]) {
      expect(ownedItems(empty), String(empty)).toEqual([]);
    }
  });
});
