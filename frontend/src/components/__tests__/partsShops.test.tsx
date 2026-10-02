import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';
import { shopsAvailable } from '../../data/buildingTypes';
import { refusalText } from '../../data/shopRules';
import { slotsOf } from '../../sheets/sheetSlots';
import { rowGroupsOf, columnsFor } from '../../sheets/catalogueSchema';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * Shops under custom systems, in the browser (3b3a). A custom system has shops, as the generic
 * sheet does, with every purchase an inventory line; it can turn them off, and with the bank off
 * it has none. The built-in systems keep theirs, slots and all. Mirrors the server's
 * shops/availability.js (system_builder_parts_shops.test.js).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const OPEN = 'sys_aaaaaaaaaaaaaaaa';
const NOSHOPS = 'sys_bbbbbbbbbbbbbbbb';
const NOBANK = 'sys_cccccccccccccccc';
const NOBANK_SHOPS_ON = 'sys_dddddddddddddddd';

// A sheet with fields shaped like slot rows, which a custom system's shops still do not fill.
const slotShaped: CustomRender['sheet'] = { sections: [{ id: 'arms', label: 'ARMS', layout: 'list', fields: [
  { id: 'weapon1_name', label: 'Weapon', type: 'text' }, { id: 'weapon1_dmg', label: 'Damage', type: 'text' },
] }] } as CustomRender['sheet'];
const system = (id: string, parts: CustomRender['parts'], words = {}): CustomRender =>
  ({ id, name: 'Hearth', parts, derived: [], sheet: slotShaped, words });

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate(system(OPEN, {}, { shop: { singular: 'Merchant', plural: 'Merchants', short: 'Merchant' } }));
  registerCustomTemplate(system(NOSHOPS, { shops: { on: false } }));
  registerCustomTemplate(system(NOBANK, { bank: { on: false } }));
  registerCustomTemplate(system(NOBANK_SHOPS_ON, { bank: { on: false }, shops: { on: true } }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('which systems have shops', () => {
  it('every built-in system, and a custom one, unless it turned shops or the bank off', () => {
    for (const s of [...BUILT_INS, OPEN]) expect(shopsAvailable(s), s).toBe(true);
    for (const s of [NOSHOPS, NOBANK, NOBANK_SHOPS_ON, 'dnd_5e', '', null]) expect(shopsAvailable(s), String(s)).toBe(false);
  });
});

describe('where a custom system\'s purchases go', () => {
  it('always the inventory, even on a sheet with fields shaped like slot rows', () => {
    expect(slotsOf(OPEN)).toEqual({});
    expect(rowGroupsOf(OPEN)).toEqual({});
    expect(columnsFor(OPEN, 'weapons')).toMatchObject({
      shape: 'inventory', unavailable: 'Hearth has no weapon rows, so these land in the inventory',
    });
  });

  it('leaves the built-in systems\' slots as they are', () => {
    expect(slotsOf('cities_without_number').weapon?.rows).toBe(6);
    expect(columnsFor('cyberpunk_red', 'weapons').shape).toBe('slots');
    expect(columnsFor('shadowrun_6e', 'vehicles')).toMatchObject({
      shape: 'inventory', unavailable: 'shadowrun_6e has no vehicle rows, so these land in the inventory',
    });
  });
});

describe('the checkout refusing a system without shops', () => {
  it('says so, in the system\'s own word for shops', () => {
    expect(refusalText().no_shops).toBe('This game has no shops. Nothing was bought or sold.');
    expect(refusalText((term, form, builtIn) => (term === 'shop' && form === 'plural' ? 'Merchants' : builtIn)).no_shops)
      .toBe('This game has no Merchants. Nothing was bought or sold.');
  });
});

describe('the buy-back rate in the GAME tab', () => {
  const read = async (gameSystem: string) => {
    const props: any = {
      socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
      refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
      editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
      selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
      fetchGlobalSettings: vi.fn(), activeUsers: [], globalSettings: { game_system: gameSystem }, gameSystem,
    };
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GAME'));
    const box = screen.queryByRole('spinbutton', { name: /buy-back percentage$/ });
    const out = {
      // The label holds its hint's '?' too.
      label: screen.queryByText(/_BUY_BACK$/)?.textContent?.replace(/\?$/, '') ?? null,
      aria: box?.getAttribute('aria-label') ?? null,
      hint: screen.queryByRole('note', { name: /sold back to it/ })?.getAttribute('title')?.split(' pays')[0] ?? null,
    };
    cleanup();
    return out;
  };

  it('reads as today under every built-in system', async () => {
    for (const s of BUILT_INS) {
      expect(await read(s), s).toEqual({ label: 'SHOP_BUY_BACK', aria: 'Shop buy-back percentage', hint: 'What every shop' });
    }
  });

  it('is shown under a custom system with shops, in its own word for them', async () => {
    expect(await read(OPEN)).toEqual({ label: 'MERCHANT_BUY_BACK', aria: 'Merchant buy-back percentage', hint: 'What every Merchant' });
  });

  it('is not shown where the system has no shops', async () => {
    for (const s of [NOSHOPS, NOBANK]) expect(await read(s), s).toEqual({ label: null, aria: null, hint: null });
  });
});
