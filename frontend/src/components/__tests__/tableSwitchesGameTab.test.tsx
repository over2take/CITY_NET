import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: { id: number }) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * The GAME tab's SHOW ENCUMBRANCE, BAND CONDITIONS and APPLY CONDITION MODIFIERS (8a6b; approved mockup
 * docs/mockups/carrying-on-sheet.html, the user: "yes to all"): with the other house rules, all on to start, each only where
 * the system has what it switches; switched off and APPLY, written to the table's settings.
 */

const PACKS = 'sys_bbbbbbbbbbbbbbbb';
const packs = (switches: object | undefined) => registerCustomTemplate({ id: PACKS, name: 'Packs', parts: {}, derived: [], sheet: { sections: [] }, words: {}, ...(switches ? { switches } : {}) } as never);

let settings: { key: string; value: string }[];
let posted: { key: string; value: string; auth: string | null }[];

beforeEach(() => {
  clearCustomTemplates();
  settings = [];
  posted = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: PACKS, systems: [{ id: PACKS, name: 'Packs', custom: true, version: 1 }] }) };
    if (u === '/api/settings' && init?.method === 'POST') {
      posted.push({ ...JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>)?.Authorization ?? null });
      return { ok: true, json: async () => ({}) };
    }
    if (u === '/api/settings') return { ok: true, json: async () => settings };
    return { ok: true, json: async () => [] };
  }));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const openRules = async () => {
  const props = {
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], globalSettings: { game_system: PACKS }, gameSystem: PACKS,
  };
  render(<AdminPanel {...(props as never)} />);
  await userEvent.click(screen.getByText('GAME'));
  await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
  await userEvent.click(screen.getByText('HOUSE RULES'));
  await screen.findByText(/FOLLOWS BUILDING/);
};
const box = (name: RegExp) => screen.queryByRole('checkbox', { name }) as HTMLInputElement | null;

describe('the GAME tab\'s encumbrance and condition switches', () => {
  it('all three where the system has all three, on to start, with what each means', async () => {
    packs({ encumbrance: true, band_conditions: true, applied_conditions: true });
    await openRules();
    for (const name of [/^SHOW ENCUMBRANCE/, /^BAND CONDITIONS/, /^APPLY CONDITION MODIFIERS/]) {
      expect(await screen.findByRole('checkbox', { name }), String(name)).toBeTruthy();
      expect(box(name)!.checked, String(name)).toBe(true);
    }
    expect(box(/^SHOW ENCUMBRANCE/)!.closest('label')!.getAttribute('title')).toMatch(/^CARRYING at the top of GEAR/);
  });

  it('only those the system has anything for; none for a system without', async () => {
    packs({ encumbrance: true, band_conditions: false, applied_conditions: false });
    await openRules();
    expect(await screen.findByRole('checkbox', { name: /^SHOW ENCUMBRANCE/ })).toBeTruthy();
    expect(box(/^BAND CONDITIONS/)).toBeNull();
    expect(box(/^APPLY CONDITION MODIFIERS/)).toBeNull();
    cleanup();
    packs(undefined);
    await openRules();
    expect(box(/^SHOW ENCUMBRANCE/)).toBeNull();
  });

  it('as the table has them: one switched off shows off', async () => {
    settings = [{ key: 'band_conditions', value: '0' }];
    packs({ encumbrance: true, band_conditions: true, applied_conditions: false });
    await openRules();
    await screen.findByRole('checkbox', { name: /^BAND CONDITIONS/ });
    await vi.waitFor(() => expect(box(/^BAND CONDITIONS/)!.checked).toBe(false));
    expect(box(/^SHOW ENCUMBRANCE/)!.checked).toBe(true);
  });

  it('switched off and APPLY: written to the settings as the GM, the others kept on', async () => {
    packs({ encumbrance: true, band_conditions: true, applied_conditions: true });
    await openRules();
    await userEvent.click(await screen.findByRole('checkbox', { name: /^SHOW ENCUMBRANCE/ }));
    await userEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await screen.findByText('HOUSE RULES APPLIED');
    const mine = posted.filter((p) => ['show_encumbrance', 'band_conditions', 'apply_condition_modifiers'].includes(p.key));
    expect(mine).toEqual([
      { key: 'show_encumbrance', value: '0', auth: 'Bearer admintoken' },
      { key: 'band_conditions', value: '1', auth: 'Bearer admintoken' },
      { key: 'apply_condition_modifiers', value: '1', auth: 'Bearer admintoken' },
    ]);
  });

  it('CONDITION TURN EFFECTS (8a9c): where a condition has an EACH TURN, on to start; switched off and APPLY, written', async () => {
    packs({ encumbrance: false, band_conditions: false, applied_conditions: false, turn_effects: true });
    await openRules();
    const turns = await screen.findByRole('checkbox', { name: /^CONDITION TURN EFFECTS/ });
    expect((turns as HTMLInputElement).checked).toBe(true);
    expect(turns.closest('label')!.getAttribute('title')).toMatch(/rolled on NEXT and BEGIN/);
    await userEvent.click(turns);
    await userEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await screen.findByText('HOUSE RULES APPLIED');
    expect(posted.filter((p) => p.key === 'condition_turn_effects')).toEqual([{ key: 'condition_turn_effects', value: '0', auth: 'Bearer admintoken' }]);
    cleanup();
    packs({ encumbrance: true, band_conditions: false, applied_conditions: false, turn_effects: false });
    await openRules();
    await screen.findByRole('checkbox', { name: /^SHOW ENCUMBRANCE/ });
    expect(box(/^CONDITION TURN EFFECTS/)).toBeNull();
  });

  it('PLAYERS CHANGE GEAR (G6b): where the system makes its own item types, on to start; switched off and APPLY, written', async () => {
    packs({ encumbrance: false, band_conditions: false, applied_conditions: false, gear: true });
    await openRules();
    const gear = await screen.findByRole('checkbox', { name: /^PLAYERS CHANGE GEAR/ });
    expect((gear as HTMLInputElement).checked).toBe(true);
    expect(gear.closest('label')!.getAttribute('title')).toMatch(/Off: only the GM changes them/);
    await userEvent.click(gear);
    await userEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    await screen.findByText('HOUSE RULES APPLIED');
    expect(posted.filter((p) => p.key === 'players_change_gear')).toEqual([{ key: 'players_change_gear', value: '0', auth: 'Bearer admintoken' }]);
    cleanup();
    packs({ encumbrance: true, band_conditions: false, applied_conditions: false, gear: false });
    await openRules();
    await screen.findByRole('checkbox', { name: /^SHOW ENCUMBRANCE/ });
    expect(box(/^PLAYERS CHANGE GEAR/)).toBeNull();
  });
});
