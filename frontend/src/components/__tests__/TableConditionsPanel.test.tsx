import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { TableConditionsPanel } from '../TableConditionsPanel';
import { AdminPanel } from '../AdminPanel';
import { forgetConditionLists } from '../../hooks/useConditionList';

/**
 * The GAME tab's CONDITIONS panel under a built-in game (4e2c2). Approved mockup builder-conditions,
 * stage 3 (2026-10-09): the standard set, four shown and the rest folded; the table's own listed,
 * added with a name, icon (drawn or uploaded) and description, and removed after asking. The main
 * admin's alone, as the route is. A fake server stands in, running the server's own checks and
 * conditionsOf on what the panel sends.
 */

const req = createRequire(import.meta.url);
const { conditionsOf } = req('../../../../backend/systemBuilder/conditions.js');
const { checkTableConditions } = req('../../../../backend/systemBuilder/tableConditions.js');

const CWN = 'cities_without_number';
const UPLOADED = `/uploads/condition_icons/${'b'.repeat(64)}.png`;

let stored: Record<string, unknown>;
let saves: { url: string; body: any; auth: string | null }[];
let refuse: string | null;
let listAsked: number;
/** The game running, as GET /api/sheets/system answers. */
let running: string;
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const SYSTEMS = [{ id: CWN, name: 'Cities Without Number' }, { id: HEARTH, name: 'Hearth', custom: true, version: 1 }];

beforeEach(() => {
  forgetConditionLists();
  stored = { wired: { name: 'Wired', icon: 'bolt', description: 'Jacked in.' } };
  saves = [];
  refuse = null;
  listAsked = 0;
  running = CWN;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response;
    if (url.startsWith('/api/systems/conditions/')) { listAsked += 1; return answer(200, conditionsOf({ conditions: stored })); }
    if (url === '/api/systems/condition-icons') return answer(200, { icon: UPLOADED });
    if (url.startsWith('/api/systems/table-conditions/')) {
      const body = JSON.parse(String(init!.body));
      saves.push({ url, body, auth });
      if (refuse) return answer(400, { error: refuse });
      const problems = checkTableConditions(body.conditions);
      if (problems.length) return answer(400, { error: `${problems[0].where}: ${problems[0].message}` });
      stored = body.conditions;
      return answer(200, { conditions: conditionsOf({ conditions: stored }) });
    }
    if (url.includes('/api/sheets/system')) return answer(200, { system: running, systems: SYSTEMS });
    return answer(200, []);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = async () => {
  render(<TableConditionsPanel token="admintoken" system={CWN} />);
  await screen.findByText('WIRED');
};
const ownNames = () => within(screen.getByRole('list', { name: 'This table\'s own' })).queryAllByRole('listitem').map((li) => li.textContent?.replace(/×$/, ''));

describe('the GAME tab\'s conditions', () => {
  it('show four standard ones, the rest folded, then the table\'s own with what each means', async () => {
    await open();
    for (const name of ['BLINDED', 'BLEEDING', 'POISONED', 'PRONE']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText('EXHAUSTED')).toBeNull();
    const more = screen.getByRole('button', { name: '…and 6 more standard' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getByText('EXHAUSTED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FEWER' })).toHaveAttribute('aria-expanded', 'true');
    expect(ownNames()).toEqual(['WIRED']);
    expect(screen.getByText('WIRED')).toHaveAttribute('title', 'Jacked in.');
  });

  it('add one with a name, a drawn icon and a description, sent whole with the GM\'s login', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: '+ CONDITION' }));
    const add = screen.getByRole('button', { name: 'ADD' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Hard Wired');
    await userEvent.click(screen.getByRole('radio', { name: 'signal' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Chrome everywhere.');
    await userEvent.click(add);
    expect(saves).toEqual([{
      url: `/api/systems/table-conditions/${CWN}`,
      auth: 'Bearer admintoken',
      body: { conditions: {
        wired: { name: 'Wired', icon: 'bolt', description: 'Jacked in.' },
        hard_wired: { name: 'Hard Wired', icon: 'signal', description: 'Chrome everywhere.' },
      } },
    }]);
    // Asked again, as every screen is, and the form put away.
    await screen.findByText('HARD WIRED');
    expect(ownNames()).toEqual(['WIRED', 'HARD WIRED']);
    expect(listAsked).toBe(2);
    expect(screen.queryByRole('group', { name: 'A condition of this table\'s own' })).toBeNull();
  });

  it('add one with an uploaded icon', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: '+ CONDITION' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Fragged');
    await userEvent.upload(screen.getByLabelText('Upload an icon for Fragged'), new File(['x'], 'frag.png', { type: 'image/png' }));
    expect(await screen.findByRole('radio', { name: 'Uploaded icon' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect(saves[0].body.conditions.fragged).toEqual({ name: 'Fragged', icon: UPLOADED });
    await screen.findByText('FRAGGED');
  });

  it('remove one only once asked, and keep it on KEEP', async () => {
    stored = { ...stored, marked: { name: 'Marked', icon: 'target' } };
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Wired' }));
    expect(screen.getByText('Tokens that have it stop showing it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'KEEP' }));
    expect(saves).toEqual([]);
    expect(ownNames()).toEqual(['WIRED', 'MARKED']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Wired' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE' }));
    expect(saves[0].body).toEqual({ conditions: { marked: { name: 'Marked', icon: 'target' } } });
    await vi.waitFor(() => expect(ownNames()).toEqual(['MARKED']));
    expect(screen.queryByText('Tokens that have it stop showing it.')).toBeNull();
  });

  it('say what the server refused, keeping what was typed', async () => {
    refuse = 'condition hard_wired, name: Too long';
    await open();
    await userEvent.click(screen.getByRole('button', { name: '+ CONDITION' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Hard Wired');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('condition hard_wired, name: Too long');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Hard Wired');
    expect(ownNames()).toEqual(['WIRED']);
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offer no more once the game has 60', async () => {
    stored = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`own_${i}`, { name: `Own ${i}`, icon: 'target' }]));
    render(<TableConditionsPanel token="admintoken" system={CWN} />);
    await screen.findByText('OWN 49');
    expect(screen.getByRole('button', { name: '+ CONDITION' })).toBeDisabled();
  });
});

describe('the GAME tab', () => {
  const props = (system: string, isPrimaryAdmin: boolean): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], setIsAdminPayOpen: vi.fn(), handleSaveDefault: vi.fn(), handleLoadDefault: vi.fn(),
    globalSettings: { game_system: system }, gameSystem: system, isPrimaryAdmin,
  });
  const gameTab = async (system: string, isPrimaryAdmin: boolean) => {
    running = system;
    render(<AdminPanel {...props(system, isPrimaryAdmin)} />);
    await userEvent.click(screen.getByText('GAME'));
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
    // The picker names the running game once the server has said which it is.
    await screen.findByText(SYSTEMS.find((s) => s.id === system)!.name.toUpperCase());
  };

  it('has the conditions for the main admin under a built-in game', async () => {
    await gameTab(CWN, true);
    expect(await screen.findByRole('region', { name: 'Conditions' })).toBeInTheDocument();
    expect(await screen.findByText('WIRED')).toBeInTheDocument();
  });

  it('has none for a granted editor, or under a custom system, whose are edited in the builder', async () => {
    await gameTab(CWN, false);
    expect(screen.queryByRole('region', { name: 'Conditions' })).toBeNull();
    cleanup();
    await gameTab(HEARTH, true);
    expect(screen.queryByRole('region', { name: 'Conditions' })).toBeNull();
  });
});
