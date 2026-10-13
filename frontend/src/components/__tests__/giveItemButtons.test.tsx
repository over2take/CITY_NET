import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * GIVE ITEM in the GAME tab (4g4b): a GIVE_ITEM button beside PAY_PLAYERS, on the city's GAME tab
 * and a battle map's, wherever GIVE ITEM is on; and SHOP_CATALOGUES wherever there are shops or GIVE
 * ITEM, so a game with no shops can still upload loot to give (the user's call, 2026-10-13). The
 * buy-back rate stays with the shops.
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const OPEN = 'sys_aaaaaaaaaaaaaaaa';
const NOSHOPS = 'sys_bbbbbbbbbbbbbbbb';
const NOGIVE = 'sys_cccccccccccccccc';
const NEITHER = 'sys_dddddddddddddddd';
const system = (id: string, parts: CustomRender['parts']): CustomRender =>
  ({ id, name: 'Hearth', parts, derived: [], sheet: { sections: [] }, words: {} } as unknown as CustomRender);

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate(system(OPEN, {}));
  registerCustomTemplate(system(NOSHOPS, { shops: { on: false } }));
  registerCustomTemplate(system(NOGIVE, { give_items: { on: false } }));
  registerCustomTemplate(system(NEITHER, { shops: { on: false }, give_items: { on: false } }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const gameTab = async (gameSystem: string, view = 'list') => {
  const setIsGiveOpen = vi.fn();
  const setIsCatalogueOpen = vi.fn();
  const props: any = {
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view, setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], globalSettings: { game_system: gameSystem }, gameSystem,
    activeBattleMapData: { locationId: 1, currentFloorIndex: 0, maps: [] }, tempBattleMapScale: null,
    setIsGiveOpen, setIsCatalogueOpen, setIsAdminPayOpen: vi.fn(), setIsAdminXpOpen: vi.fn(),
  };
  render(<AdminPanel {...props} />);
  await userEvent.click(screen.getByText('GAME'));
  return { setIsGiveOpen, setIsCatalogueOpen };
};
const has = (text: RegExp) => screen.queryByRole('button', { name: text }) !== null;

describe('GIVE_ITEM', () => {
  it('is in the GAME tab of every built-in game, and opens GIVE.EXE', async () => {
    for (const s of BUILT_INS) {
      const { setIsGiveOpen } = await gameTab(s);
      await userEvent.click(screen.getByRole('button', { name: 'GIVE_ITEM' }));
      expect(setIsGiveOpen, s).toHaveBeenCalledWith(true);
      cleanup();
    }
  });

  it('is in a custom game with GIVE ITEM on, shops or not, and not where it is off', async () => {
    for (const [s, shown] of [[OPEN, true], [NOSHOPS, true], [NOGIVE, false], [NEITHER, false]] as const) {
      await gameTab(s);
      expect(has(/^GIVE_ITEM$/), s).toBe(shown);
      cleanup();
    }
  });

  it('is on a battle map\'s GAME tab too', async () => {
    const { setIsGiveOpen } = await gameTab('cities_without_number', 'battle_map');
    await userEvent.click(screen.getByRole('button', { name: 'GIVE_ITEM' }));
    expect(setIsGiveOpen).toHaveBeenCalledWith(true);
    cleanup();
    await gameTab(NOGIVE, 'battle_map');
    expect(has(/^GIVE_ITEM$/)).toBe(false);
  });
});

describe('SHOP_CATALOGUES', () => {
  it('stays for a game with no shops while GIVE ITEM is on, without the buy-back rate', async () => {
    const { setIsCatalogueOpen } = await gameTab(NOSHOPS);
    await userEvent.click(screen.getByRole('button', { name: /_CATALOGUES$/ }));
    expect(setIsCatalogueOpen).toHaveBeenCalledWith(true);
    expect(screen.queryByText(/_BUY_BACK/)).toBeNull();
  });

  it('is there with the buy-back rate wherever there are shops, and gone with neither', async () => {
    for (const [s, catalogues, buyback] of [
      ['cities_without_number', true, true], [OPEN, true, true], [NOGIVE, true, true], [NEITHER, false, false],
    ] as const) {
      await gameTab(s);
      expect(has(/_CATALOGUES$/), `${s} catalogues`).toBe(catalogues);
      expect(screen.queryByText(/_BUY_BACK/) !== null, `${s} buy-back`).toBe(buyback);
      cleanup();
    }
  });
});
