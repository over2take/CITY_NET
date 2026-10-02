import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));
vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));

import { AdminPanel } from '../AdminPanel';
import { Sidebar } from '../Sidebar';
import { AdminBankWindow, AdminPayWindow, BankWindow } from '../BankWindows';
import { tokenActionKeys, type TokenViewer } from '../tokenActions';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';
import { OVERDRAFT_RULE } from '../../data/shopRules';

/**
 * A custom system with the bank turned off, in the windows (3b2b). Every way to reach money
 * reads exactly as today under each built-in system and a custom system that kept its bank;
 * with the bank off none of it is offered. The server already refuses money there (3b2a).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const NOBANK = 'sys_aaaaaaaaaaaaaaaa';
const KEPT = 'sys_bbbbbbbbbbbbbbbb';
const WITH_BANK = [...BUILT_INS, KEPT];

let pickedSystem = 'generic';
let posted: { key: string; value: unknown }[] = [];

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: NOBANK, name: 'Hearth', parts: { bank: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
  registerCustomTemplate({ id: KEPT, name: 'Kept', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
  posted = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: pickedSystem, systems: [] }) };
    if (init?.method === 'POST' && String(url).includes('/api/settings')) posted.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => [] };
  }));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('the token\'s VIEW_BANK', () => {
  const gm: TokenViewer = {
    isAdmin: true, isPrimaryAdmin: true, isOwner: false, isLoggedIn: true, isPlayerToken: true, hasOwner: true,
    sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: true,
    hasRoster: false, systemHasVehicles: false, systemHasBank: true, systemHasCombat: true, hasBattleMaps: false,
  };

  it('is offered to the GM on a player\'s token only while the system has a bank', () => {
    expect(tokenActionKeys(gm)).toContain('bank');
    expect(tokenActionKeys({ ...gm, systemHasBank: false })).not.toContain('bank');
    // Nothing else changes with it.
    expect(tokenActionKeys({ ...gm, systemHasBank: false })).toEqual(tokenActionKeys(gm).filter((k) => k !== 'bank'));
  });
});

describe('the sidebar\'s BANK button', () => {
  const props = (gameSystem: string): any => ({
    activeMenu: null, setActiveMenu: vi.fn(), locations: [], onSelect: vi.fn(), onZoom: vi.fn(), selectedLocation: null,
    userName: 'GHOST', token: '', onLogout: vi.fn(), audioEnabled: false, setAudioEnabled: vi.fn(), masterVolume: 1,
    setMasterVolume: vi.fn(), musicVolume: 1, setMusicVolume: vi.fn(), rhombusState: { color: '#00ff00' }, setRhombusState: vi.fn(),
    refreshLocations: vi.fn(), socketRef: { current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }, isChatOpen: false,
    setIsChatOpen: vi.fn(), hasUnreadChat: false, syncRhombusToDB: vi.fn(), view: 'list', activeBattleMapData: null,
    isHitPointsOpen: false, setIsHitPointsOpen: vi.fn(), activeUsers: [], setIsDiceTrayOpen: vi.fn(), setNotification: vi.fn(),
    measureMode: false, setMeasureMode: vi.fn(), isBankOpen: false, setIsBankOpen: vi.fn(), isSheetOpen: false,
    setIsSheetOpen: vi.fn(), gameSystem, activeCombats: [],
  });
  const shown = (system: string) => {
    render(<Sidebar {...props(system)} />);
    const there = screen.queryByLabelText('CITY_NET // BANK') !== null;
    cleanup();
    return there;
  };

  it('is there as today wherever the system has a bank, and gone where it does not', () => {
    for (const system of WITH_BANK) expect(shown(system), system).toBe(true);
    expect(shown(NOBANK)).toBe(false);
  });
});

describe('the bank windows', () => {
  const socket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
  const drawn = (el: React.ReactElement) => {
    const { container } = render(el);
    const there = container.firstChild !== null;
    cleanup();
    return there;
  };
  const windows = (system: string) => ({
    player: drawn(<BankWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} bankData={{ balance: 5, debt: 0 }} socket={socket()}
      userName="GHOST" isBankOpen system={system} />),
    account: drawn(<AdminBankWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} targetUser="GHOST" socket={socket()} token="t" system={system} />),
    pay: drawn(<AdminPayWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={socket()} token="t" activeUsers={[]} system={system} />),
  });

  it('open as today wherever the system has a bank, and draw nothing where it does not', () => {
    for (const system of WITH_BANK) expect(windows(system), system).toEqual({ player: true, account: true, pay: true });
    expect(windows(NOBANK)).toEqual({ player: false, account: false, pay: false });
  });
});

describe('the admin panel', () => {
  const props = (system: string, view: string): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view, setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], setIsAdminPayOpen: vi.fn(), handleSaveDefault: vi.fn(), handleLoadDefault: vi.fn(),
    globalSettings: { game_system: system }, gameSystem: system,
  });
  /** The money controls each view's tabs show; by text, as a role lookup trips on a button style in jsdom. */
  const money = () => ({
    pay: screen.queryAllByText('PAY_PLAYERS').length,
    currency: screen.queryAllByText('CURRENCY_ICON').length,
    sounds: screen.queryAllByText(/ SOUNDS$/).length,
  });

  const listView = async (system: string) => {
    pickedSystem = system;
    render(<AdminPanel {...props(system, 'list')} />);
    await userEvent.click(screen.getByText('GAME'));
    const out = money();
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
    await userEvent.click(screen.getByText('HOUSE RULES'));
    await screen.findByText(/ FOLLOWS BUILDING /);
    const overdraft = screen.queryByText('BUY WITH MONEY YOU DO NOT HAVE') !== null;
    cleanup();
    return { ...out, overdraft };
  };

  const battleView = async (system: string) => {
    render(<AdminPanel {...props(system, 'battle_map')} />);
    const map = screen.queryAllByText('PAY_PLAYERS').length;
    await userEvent.click(screen.getByText('GAME'));
    const out = { map, ...money() };
    cleanup();
    return out;
  };

  it('offers the money controls as today wherever the system has a bank', async () => {
    for (const system of WITH_BANK) {
      expect(await listView(system), system).toEqual({ pay: 1, currency: 1, sounds: 1, overdraft: true });
      expect(await battleView(system), system).toEqual({ map: 1, pay: 1, currency: 1, sounds: 1 });
    }
  });

  it('offers none of them where the system has the bank off', async () => {
    expect(await listView(NOBANK)).toEqual({ pay: 0, currency: 0, sounds: 0, overdraft: false });
    expect(await battleView(NOBANK)).toEqual({ map: 0, pay: 0, currency: 0, sounds: 0 });
  });

  it('leaves the hidden overdraft rule as it was when the other house rules are applied', async () => {
    pickedSystem = NOBANK;
    render(<AdminPanel {...props(NOBANK, 'list')} />);
    await userEvent.click(screen.getByText('GAME'));
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
    await userEvent.click(screen.getByText('HOUSE RULES'));
    fireEvent.click(await screen.findByText(/ FOLLOWS BUILDING /));
    await userEvent.click(screen.getByText('APPLY'));
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted.map((p) => p.key)).not.toContain(OVERDRAFT_RULE);
  });
});
