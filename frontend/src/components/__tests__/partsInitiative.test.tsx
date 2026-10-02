import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';
import { Sidebar } from '../Sidebar';
import { InitiativeWindow } from '../../modules/initiative';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * A custom system with initiative turned off, in the windows (3b6a). The tracker, its sidebar
 * button and panel, and the INITIATIVE FOLLOWS BUILDING house rule are there as today under
 * every built-in system and a custom one that kept initiative, and gone where it is off. The
 * server refuses to start or roll one there anyway (system_builder_parts_initiative.test.js).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const NOINIT = 'sys_aaaaaaaaaaaaaaaa';
const KEPT = 'sys_bbbbbbbbbbbbbbbb';
const WITH_INIT = [...BUILT_INS, KEPT];

let pickedSystem = 'generic';

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: NOINIT, name: 'Hearth', parts: { initiative: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
  registerCustomTemplate({ id: KEPT, name: 'Kept', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: pickedSystem, systems: [] }) };
    return { ok: true, json: async () => [] };
  }));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('the tracker window', () => {
  const drawn = (system: string) => {
    const { container } = render(<InitiativeWindow state={null} activeCombats={[]} sceneKey="city:0" sceneLabel="CITY MAP" isAdmin
      onClose={vi.fn()} onStart={vi.fn()} onListCombats={vi.fn()} onNext={vi.fn()} onEnd={vi.fn()} onRemove={vi.fn()} onReorder={vi.fn()}
      system={system} />);
    const there = container.firstChild !== null;
    cleanup();
    return there;
  };

  it('opens as today wherever the game has initiative, and draws nothing where it does not', () => {
    for (const system of WITH_INIT) expect(drawn(system), system).toBe(true);
    expect(drawn(NOINIT)).toBe(false);
  });
});

describe('the sidebar', () => {
  const props = (gameSystem: string, activeMenu: string | null): any => ({
    activeMenu, setActiveMenu: vi.fn(), locations: [], onSelect: vi.fn(), onZoom: vi.fn(), selectedLocation: null,
    userName: 'GM', token: 'admintoken', onLogout: vi.fn(), audioEnabled: false, setAudioEnabled: vi.fn(), masterVolume: 1,
    setMasterVolume: vi.fn(), musicVolume: 1, setMusicVolume: vi.fn(), rhombusState: { color: '#00ff00' }, setRhombusState: vi.fn(),
    refreshLocations: vi.fn(), socketRef: { current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }, isChatOpen: false,
    setIsChatOpen: vi.fn(), hasUnreadChat: false, syncRhombusToDB: vi.fn(), view: 'list', activeBattleMapData: null,
    isHitPointsOpen: false, setIsHitPointsOpen: vi.fn(), activeUsers: [], setIsDiceTrayOpen: vi.fn(), setNotification: vi.fn(),
    measureMode: false, setMeasureMode: vi.fn(), isBankOpen: false, setIsBankOpen: vi.fn(), isSheetOpen: false,
    setIsSheetOpen: vi.fn(), gameSystem, activeCombats: [], initiativeActive: true,
  });
  const read = (system: string) => {
    render(<Sidebar {...props(system, 'initiative_tracker')} />);
    const out = {
      button: screen.queryByLabelText('INITIATIVE_TRACKER') !== null,
      panel: screen.queryByRole('heading', { level: 3, name: 'INITIATIVE' }) !== null,
    };
    cleanup();
    return out;
  };

  it('has the tracker button and panel as today wherever the game has initiative, even with a combat on', () => {
    for (const system of WITH_INIT) expect(read(system), system).toEqual({ button: true, panel: true });
    expect(read(NOINIT)).toEqual({ button: false, panel: false });
  });
});

describe('the house rules', () => {
  const rules = async (system: string) => {
    pickedSystem = system;
    const props: any = {
      socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
      refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
      editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
      selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
      fetchGlobalSettings: vi.fn(), activeUsers: [], globalSettings: { game_system: system }, gameSystem: system,
    };
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GAME'));
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
    await userEvent.click(screen.getByText('HOUSE RULES'));
    await screen.findByText('BUY WITH MONEY YOU DO NOT HAVE');
    const out = {
      follows: screen.queryByText(/FOLLOWS BUILDING/) !== null,
      overdraft: screen.queryByText('BUY WITH MONEY YOU DO NOT HAVE') !== null,
    };
    cleanup();
    return out;
  };

  it('offer INITIATIVE FOLLOWS BUILDING only where the game has initiative', async () => {
    for (const system of WITH_INIT) expect(await rules(system), system).toEqual({ follows: true, overdraft: true });
    expect(await rules(NOINIT)).toEqual({ follows: false, overdraft: true });
  });
});
