import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * A custom system's own house rules in the GAME tab (4j5a; approved mockup
 * docs/mockups/optional-rules.html, 2026-10-14): under TTRPG_SYSTEM's HOUSE RULES beside the shared
 * ones, each with what it means; one APPLY sends the ones changed through the systems route, and
 * the boxes follow the game when the server says it changed.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const RULES = [
  { id: 'magic', name: 'Magic', description: 'Characters can learn spells.', starts: false, on: false },
  { id: 'markets', name: 'Town markets', description: '', starts: true, on: true },
];
const hearth = (rules = RULES) => registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {}, house_rules: rules });

let picked = HEARTH;
let sent: { url: string; method: string; body: unknown; auth: string | null }[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  clearCustomTemplates();
  hearth();
  sent = [];
  answer = { status: 200, body: { house_rules: RULES } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: picked, systems: [{ id: HEARTH, name: 'Hearth', custom: true, version: 2 }] }) };
    if (u.includes('/house-rules')) {
      sent.push({ url: u, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
      return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
    }
    return { ok: true, json: async () => [] };
  }));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); picked = HEARTH; });

const openRules = async (system = HEARTH) => {
  picked = system;
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
  await screen.findByText(/FOLLOWS BUILDING/);
};
const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('a custom system\'s own house rules', () => {
  it('sit beside the shared ones, each as the game runs it, with what it means', async () => {
    await openRules();
    expect(await screen.findByText('HEARTH\'S OWN')).toBeTruthy();
    expect(box(/^MAGIC/).checked).toBe(false);
    expect(box(/^TOWN MARKETS/).checked).toBe(true);
    expect(screen.getByText('Characters can learn spells.')).toBeTruthy();
  });

  it('APPLY sends only the ones changed, as the GM, and says so', async () => {
    await openRules();
    await screen.findByText('HEARTH\'S OWN');
    await userEvent.click(box(/^MAGIC/));
    expect(screen.getByText('UNSAVED CHANGES')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(sent).toEqual([{ url: `/api/systems/${HEARTH}/house-rules`, method: 'PUT', body: { rules: { magic: true } }, auth: 'Bearer admintoken' }]);
    expect(await screen.findByText('HOUSE RULES APPLIED')).toBeTruthy();
  });

  it('REVERT puts the boxes back as the game runs them', async () => {
    await openRules();
    await screen.findByText('HEARTH\'S OWN');
    await userEvent.click(box(/^TOWN MARKETS/));
    await userEvent.click(screen.getByRole('button', { name: 'REVERT' }));
    expect(box(/^TOWN MARKETS/).checked).toBe(true);
    expect(screen.queryByText('UNSAVED CHANGES')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('follow the game when it changes, from this screen or another', async () => {
    await openRules();
    await screen.findByText('HEARTH\'S OWN');
    act(() => { hearth([{ ...RULES[0], on: true }, RULES[1]]); });
    expect(box(/^MAGIC/).checked).toBe(true);
    expect(screen.queryByText('UNSAVED CHANGES')).toBeNull();
  });

  it('say so when the server refuses', async () => {
    answer = { status: 400, body: { error: '"magic" is not one of this system\'s house rules' } };
    await openRules();
    await screen.findByText('HEARTH\'S OWN');
    await userEvent.click(box(/^MAGIC/));
    await userEvent.click(screen.getByRole('button', { name: 'APPLY' }));
    expect(await screen.findByText('APPLY FAILED')).toBeTruthy();
  });

  it('aren\'t there for a built-in game', async () => {
    await openRules('cities_without_number');
    expect(screen.queryByText(/'S OWN$/)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^MAGIC/ })).toBeNull();
  });
});
