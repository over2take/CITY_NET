/**
 * What a character owns, on both sides of the wire.
 *
 * The window draws the SELL tab from this; the server decides what to pay from its own
 * copy. A disagreement is either an item a player can see and cannot sell, or one the
 * server pays for when it should not - so every sheet below is run through both and the
 * answers compared, rather than each being checked against what it was expected to say.
 *
 * Imported from the real server module, like the price and building-type mirrors.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import {
  ownedItems, sellableAt, findByName, normaliseName, priceOf, labelOf, type OwnedLine,
} from '../ownedItems';
import { loadUploaded, clearUploaded } from '../uploadedCatalogues';

const require_ = createRequire(import.meta.url);
const backend = require_('../../../../backend/shops/owned.js');
const prices = require_('../../../../backend/shops/prices.js');

/**
 * Sheets chosen for the ways they are awkward, not for being typical: the same gun in two
 * places, a renamed vehicle, something no catalogue carries, quantities that are not
 * numbers, and fields simply missing.
 */
const SHEETS: { name: string; data: Record<string, unknown> }[] = [
  { name: 'empty', data: {} },
  {
    name: 'inventory with quantities',
    data: { inventory: JSON.stringify([{ name: 'Climbing kit', qty: 2 }, { name: 'Gas mask', qty: 1 }]) },
  },
  {
    name: 'two rows of the same thing',
    data: {
      inventory: JSON.stringify([
        { name: 'Climbing kit', qty: 2 },
        { name: 'Climbing kit', qty: 3, carry: 'stash' },
      ]),
    },
  },
  { name: 'one weapon', data: { weapon1_name: 'Heavy Pistol' } },
  { name: 'same gun twice', data: { weapon1_name: 'Heavy Pistol', weapon4_name: 'Heavy Pistol' } },
  {
    name: 'carried and stashed',
    data: { weapon2_name: 'Rifle', weapons_stash: JSON.stringify([{ name: 'Rifle' }, { name: 'Rifle' }]) },
  },
  { name: 'installed chrome', data: { cyberware: [{ name: 'Cranial Jack', placed: true }] } },
  { name: 'unplaced chrome', data: { cyberware: [{ name: 'Cranial Jack', placed: false }] } },
  {
    // The case the boxed-first ordering exists for, and the one that was missing: two of
    // the same piece, one in a bag and one in a body.
    name: 'one boxed and one installed of the same piece',
    data: { cyberware: [{ name: 'Cyberlimb', placed: true }, { name: 'Cyberlimb', placed: false }] },
  },
  { name: 'renamed vehicle', data: { vehicle1_type: 'motorcycle', vehicle1_name: 'Betty' } },
  { name: 'two of a model', data: { vehicle1_type: 'car', vehicle1_name: 'Car', vehicle3_type: 'car', vehicle3_name: 'Spare' } },
  { name: 'homebrew', data: { inventory: JSON.stringify([{ name: "Betty's lucky knife", qty: 1 }]) } },
  {
    name: 'the same unknown written two ways',
    data: { inventory: JSON.stringify([{ name: 'Odd  Thing', qty: 1 }, { name: 'odd thing', qty: 2 }]) },
  },
  { name: 'junk quantities', data: { inventory: JSON.stringify([{ name: 'Lockpicks', qty: 'x' }]) } },
  { name: 'unparseable inventory', data: { inventory: 'not json' } },
  { name: 'blank slots', data: { weapon1_name: '', weapon2_name: '   ', vehicle1_type: '' } },
  {
    name: 'a whole character',
    data: {
      inventory: JSON.stringify([{ name: 'Climbing kit', qty: 2 }, { name: "Betty's lucky knife", qty: 1 }]),
      weapon1_name: 'Heavy Pistol',
      weapons_stash: JSON.stringify([{ name: 'Heavy Pistol' }]),
      cyberware: [{ name: 'Cranial Jack', placed: true }, { name: 'Skinmod', placed: false }],
      vehicle1_type: 'motorcycle',
      vehicle1_name: 'Betty',
    },
  },
];

/** Compared on what matters, in a stable order: the same lines, counts and prices. */
const summarise = (lines: OwnedLine[]) =>
  lines
    .map((l) => ({ key: l.key, label: l.label, qty: l.qty, unitPrice: l.unitPrice, catalogue: l.catalogue, id: l.id }))
    .sort((a, b) => a.key.localeCompare(b.key));

describe('the window and the server agree on what you own', () => {
  it('has sheets to check, so an empty pass is not a pass', () => {
    expect(SHEETS.length).toBeGreaterThan(10);
  });

  for (const { name, data } of SHEETS) {
    it(`agrees on: ${name}`, () => {
      expect(summarise(ownedItems(data))).toEqual(summarise(backend.ownedItems(data)));
    });
  }

  it('agrees on where each one is sitting, not just how many', () => {
    // The places are what a sale empties. Agreeing on the count while disagreeing on the
    // slots would take the wrong thing off the sheet.
    for (const { name, data } of SHEETS) {
      const mine = ownedItems(data).sort((a, b) => a.key.localeCompare(b.key));
      const theirs = backend.ownedItems(data).sort((a: OwnedLine, b: OwnedLine) => a.key.localeCompare(b.key));
      expect(mine.map((l) => l.at), name).toEqual(theirs.map((l: OwnedLine) => l.at));
    }
  });
});

describe('the window and the server agree on every system', () => {
  /**
   * The same comparison on the other sheets. Row counts differ - four weapon rows on
   * Cyberpunk RED and Shadowrun, no vehicles on Shadowrun, neither on generic - and the CWN
   * book does not apply, so each side has to leave the same things out as well as find the
   * same things.
   *
   * The uploads are loaded on both sides, the way the server's catalogue broadcast does.
   */
  const store = require_('../../../../backend/shops/catalogueStore.js');
  const UPLOADS = {
    weapons: [{ id: 'unity', name: 'Militech Unity', price: 100, fields: {} }],
    vehicles: [{ id: 'yaiba', name: 'Yaiba Kusanagi', price: 1000, fields: {} }],
    gear: [{ id: 'rope', name: 'Rope', price: 20, fields: {} }],
  };
  const OTHER_SHEETS: { name: string; data: Record<string, unknown> }[] = [
    ...SHEETS,
    { name: 'an uploaded gun in the last row', data: { weapon4_name: 'Militech Unity' } },
    { name: 'a fifth weapon row no sheet but CWN has', data: { weapon5_name: 'Militech Unity' } },
    { name: 'an uploaded vehicle', data: { vehicle2_name: 'Yaiba Kusanagi', vehicle2_type: 'Bike' } },
    { name: 'uploaded gear', data: { inventory: JSON.stringify([{ name: 'Rope', qty: 3 }]) } },
  ];

  afterEach(() => { store.clear(); clearUploaded(); });

  for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
    it(`agrees on ${system}`, () => {
      store.load(system, UPLOADS);
      loadUploaded(UPLOADS);
      for (const { name, data } of OTHER_SHEETS) {
        const mine = ownedItems(data, system);
        const theirs = backend.ownedItems(data, system);
        expect(summarise(mine), name).toEqual(summarise(theirs));
        const byKey = (a: OwnedLine, b: OwnedLine) => a.key.localeCompare(b.key);
        expect(mine.sort(byKey).map((l) => l.at), name)
          .toEqual(theirs.sort(byKey).map((l: OwnedLine) => l.at));
      }
    });
  }

  it('sees nothing from the CWN book outside CWN', () => {
    // A Heavy Pistol on a Cyberpunk RED sheet is unpriced homebrew there, not the book's.
    store.load('cyberpunk_red', {});
    const [line] = ownedItems({ weapon1_name: 'Heavy Pistol' }, 'cyberpunk_red');
    expect(line).toMatchObject({ catalogue: null, id: null, unitPrice: null });
    expect(findByName('Heavy Pistol', 'cyberpunk_red')).toBeNull();
    // Nor by id, which is what the server's own priceOf answers for the same system.
    expect(priceOf('weapons', 'heavy_pistol', 'cyberpunk_red')).toBe(store.priceOf('weapons', 'heavy_pistol'));
    expect(priceOf('weapons', 'heavy_pistol', 'cyberpunk_red')).toBeNull();
    expect(labelOf('weapons', 'heavy_pistol', 'cyberpunk_red')).toBeNull();
  });

  it('reads only the rows each sheet draws', () => {
    loadUploaded(UPLOADS);
    const data = { weapon5_name: 'Militech Unity', vehicle1_name: 'Yaiba Kusanagi' };
    expect(ownedItems(data, 'cyberpunk_red').map((l) => l.label)).toEqual(['Yaiba Kusanagi']);
    expect(ownedItems(data, 'shadowrun_6e')).toEqual([]);
    expect(ownedItems(data, 'generic')).toEqual([]);
  });
});

describe('which one gets sold first', () => {
  it('lists a boxed piece before an installed one, on both sides', () => {
    /**
     * Places are consumed in the order they are listed, so this ordering is a rule rather
     * than an accident: somebody who owns a spare Cranial Jack in a bag and another in
     * their skull, and sells one, sells the one in the bag. Sheet order would have picked
     * whichever happened to come first.
     */
    const data = {
      cyberware: [{ name: 'Cyberlimb', placed: true }, { name: 'Cyberlimb', placed: false }],
    };
    for (const [who, list] of [['window', ownedItems(data)], ['server', backend.ownedItems(data)]] as const) {
      expect((list as OwnedLine[])[0].at.map((a) => a.placed), who).toEqual([false, true]);
    }
  });
});

describe('matching a name the way the server does', () => {
  it('finds the same catalogue entry', () => {
    /**
     * The tie-break is the point here. Two catalogues may legitimately carry the same
     * name, the first one wins, and both sides build their lookup in the same order - so
     * this is checking that they pick the SAME first one, not merely that both find
     * something.
     */
    for (const n of ['Heavy Pistol', 'heavy pistol', '  Climbing   kit', 'CRANIAL JACK', 'nonsense']) {
      expect(findByName(n), n).toEqual(prices.findByName(n));
    }
  });

  it('normalises a name the same way', () => {
    for (const n of ['Heavy  Pistol', '  spaced  ', 'MiXeD', '', null, undefined]) {
      expect(normaliseName(n), String(n)).toBe(prices.normaliseName(n));
    }
  });
});

describe('what a given shop will take', () => {
  const owned = ownedItems({
    inventory: JSON.stringify([{ name: 'Climbing kit', qty: 1 }, { name: 'Odd thing', qty: 1 }]),
    weapon1_name: 'Heavy Pistol',
    cyberware: [{ name: 'Cranial Jack', placed: true }],
  });

  it('offers only the catalogues this storefront deals in', () => {
    // A gun shop does not buy chrome, and a ripperdoc does not buy climbing rope.
    const atGunShop = sellableAt(owned, ['weapons', 'weapon_mods']).map((l) => l.label);
    expect(atGunShop).toContain('Heavy Pistol');
    expect(atGunShop).not.toContain('Cranial Jack');
    expect(atGunShop).not.toContain('Climbing kit');
  });

  it('offers unpriced things anywhere, since no shop is the wrong shop for them', () => {
    // They are worth nothing either way and the GM settles up, so hiding them at every
    // storefront would leave a player with no way to get rid of one.
    for (const cats of [['weapons'], ['cyberware'], ['gear']] as const) {
      expect(sellableAt(owned, [...cats]).map((l) => l.label), cats.join()).toContain('Odd thing');
    }
  });

  it('offers nothing at a shop that deals in nothing', () => {
    expect(sellableAt(owned, []).map((l) => l.label)).toEqual(['Odd thing']);
  });
});
