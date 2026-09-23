/**
 * The shop's prices, on both sides of the wire.
 *
 * The window prints a price; the server charges one. If those two ever disagree, a player
 * sees one number and pays another, and nothing else in the app would notice. So this
 * walks every catalogue the shop can sell from and compares the figure the shelf shows
 * against the figure `priceOf` would take out of the bank.
 *
 * Imported from the real server module rather than from a copy of it, the same way the
 * building-type mirror is checked. `backend/shops/prices.js` requires only two other
 * backend data modules and no third-party package, which is what lets a frontend suite
 * reach for it - see crossBoundaryImports.test.ts for why that rule exists.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { CWN_CYBERWARE } from '../cwnCyberwarePresets';
import { CWN_WEAPONS } from '../cwnWeaponPresets';
import { CWN_ARMOR } from '../cwnArmorPresets';
import { CWN_GEAR } from '../cwnGearPresets';
import { CWN_PHARMACEUTICALS } from '../cwnPharma';
import { CWN_ARMOR_MODS, CWN_WEAPON_MODS } from '../cwnGearMods';
import { VEHICLE_PRESETS } from '../vehiclePresets';
import { VEHICLE_FITTINGS } from '../vehicleFittings';
import { VEHICLE_WEAPONS } from '../vehicleWeapons';
import { OVERDRAFT_RULE, SETTLE_BALANCE, SETTLE_DEBT } from '../../data/shopRules';

const prices = createRequire(import.meta.url)('../../../../backend/shops/prices.js');

/** Every shelf, as { catalogue, id, price the window shows }. */
const SHELVES: { catalogue: string; rows: { id: string; price: number | undefined }[] }[] = [
  { catalogue: 'cyberware', rows: CWN_CYBERWARE.map((c) => ({ id: c.id, price: c.price })) },
  { catalogue: 'weapons', rows: CWN_WEAPONS.map((w) => ({ id: w.id, price: w.price })) },
  { catalogue: 'armor', rows: CWN_ARMOR.map((a) => ({ id: a.id, price: a.cost })) },
  { catalogue: 'gear', rows: CWN_GEAR.map((g) => ({ id: g.id, price: g.cost })) },
  { catalogue: 'pharmaceuticals', rows: CWN_PHARMACEUTICALS.map((p) => ({ id: p.id, price: p.cost })) },
  { catalogue: 'armor_mods', rows: CWN_ARMOR_MODS.map((m) => ({ id: m.id, price: m.cost })) },
  { catalogue: 'weapon_mods', rows: CWN_WEAPON_MODS.map((m) => ({ id: m.id, price: m.cost })) },
  { catalogue: 'vehicles', rows: VEHICLE_PRESETS.map((v) => ({ id: v.id, price: v.cost })) },
  { catalogue: 'vehicle_fittings', rows: VEHICLE_FITTINGS.map((f) => ({ id: f.id, price: f.cost })) },
  { catalogue: 'vehicle_weapons', rows: VEHICLE_WEAPONS.map((w) => ({ id: w.id, price: w.cost })) },
];

describe('what the shelf says and what the bank charges', () => {
  it('finds every catalogue on the server side, so an empty pass is not a pass', () => {
    for (const { catalogue } of SHELVES) {
      expect(Object.keys(prices.PRICES[catalogue] ?? {}).length, catalogue).toBeGreaterThan(0);
    }
  });

  it('charges exactly what the shelf prints, line by line', () => {
    const wrong: string[] = [];
    for (const { catalogue, rows } of SHELVES) {
      for (const row of rows) {
        // A line with no price is not sold - the vehicle weapons that come with the hull.
        if (row.price === undefined) continue;
        const charged = prices.priceOf(catalogue, row.id);
        if (charged !== row.price) {
          wrong.push(`${catalogue}/${row.id}: shelf ${row.price}, bank ${charged}`);
        }
      }
    }
    // Named rather than counted, so a failure says which line drifted.
    expect(wrong).toEqual([]);
  });

  it('knows nothing it should not sell', () => {
    // The other direction: a price on the server for something no shelf carries would be
    // a line nobody can see and nobody can check.
    const onShelf = new Set(SHELVES.flatMap(({ catalogue, rows }) =>
      rows.map((r) => `${catalogue}/${r.id}`)));
    const extra: string[] = [];
    for (const [catalogue, table] of Object.entries(prices.PRICES)) {
      for (const id of Object.keys(table as Record<string, number>)) {
        if (!onShelf.has(`${catalogue}/${id}`)) extra.push(`${catalogue}/${id}`);
      }
    }
    expect(extra).toEqual([]);
  });

  it('names the house rule and the settlement modes the same way the server does', () => {
    // Three strings that have to agree across the wire: the key the admin toggle writes
    // and the server reads, and the two words the shop sends to say how a shortfall was
    // covered. A typo in any of them fails silently as "rule is off" or "no choice made".
    const purchase = createRequire(import.meta.url)('../../../../backend/shops/purchase.js');
    expect(OVERDRAFT_RULE).toBe(purchase.OVERDRAFT_RULE);
    expect(SETTLE_BALANCE).toBe(purchase.SETTLE_BALANCE);
    expect(SETTLE_DEBT).toBe(purchase.SETTLE_DEBT);
  });

  it('answers null for something that is not on any shelf', () => {
    // Null and not zero: "free" and "no such thing" must not be the same answer, or a
    // typo'd id would buy a Tank for nothing.
    expect(prices.priceOf('weapons', 'railgun-of-doom')).toBeNull();
    expect(prices.priceOf('nonsense', 'heavy_pistol')).toBeNull();
    expect(prices.priceOf('', '')).toBeNull();
    expect(prices.priceOf(null, null)).toBeNull();
  });
});
