import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GameRestsPanel } from '../GameRestsPanel';
import { AdminPanel } from '../AdminPanel';

/**
 * The GAME tab's RESTS panel under a custom game (4f5). Approved mockup builder-rests, stage 3
 * (2026-10-09): one of the game's rests, who rests (every player character, the map's NPCs too, or
 * chosen), what each will get, and CALL. Everyone is previewed once; ticking who rests asks nothing
 * more. A fake server answers as backend/sheets/rests.js does.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const RESTS = [{ id: 'short_rest', name: 'Short rest' }, { id: 'long_rest', name: 'Long rest' }];
const person = (kind: 'player' | 'npc', id: string | number, name: string, changes: unknown[] = [], gone: string[] = []) =>
  (kind === 'player' ? { kind, username: id, name, changes, gone } : { kind, location_id: id, name, changes, gone });

let asked: { url: string; body: any }[];
let refuseCall: string | null;
let rests: typeof RESTS;
let running: string;

beforeEach(() => {
  asked = [];
  refuseCall = null;
  rests = RESTS;
  running = HEARTH;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ url, body });
    const answer = (status: number, json: unknown) => ({ ok: status < 300, status, json: async () => json }) as Response;
    if (url === '/api/sheets/rests') return answer(200, { system: running, rests: running === HEARTH ? rests : [] });
    if (url === '/api/sheets/rest') {
      if (!body.preview && refuseCall) return answer(400, { error: refuseCall });
      const players = body.players === true ? ['ash', 'vex'] : body.players || [];
      const characters = [
        ...players.map((p: string) => person('player', p, p === 'vex' ? 'Vex' : 'Ash',
          p === 'vex' ? [{ what: 'health', label: 'HP', from: 9, to: body.rest === 'long_rest' ? 22 : null, pending: body.rest === 'long_rest' ? undefined : ['1d8 + @con_mod'] }] : [],
          p === 'vex' && body.rest === 'long_rest' ? ['Exhausted'] : [])),
        ...body.npcs.map((id: number) => person('npc', id, id === 7 ? 'GANGER' : 'DOG')),
      ];
      return answer(200, { rest: RESTS.find((r) => r.id === body.rest), preview: !!body.preview, characters: body.preview ? characters : characters.map((c) => ({ ...c, line: `${body.rest} · ${c.name}` })) });
    }
    if (url.includes('/api/sheets/system')) return answer(200, { system: running, systems: [{ id: HEARTH, name: 'Hearth', custom: true, version: 1 }, { id: 'cities_without_number', name: 'Cities Without Number' }] });
    return answer(200, []);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const NPCS = [{ id: 7, name: 'GANGER' }, { id: 9, name: 'DOG' }];
const open = async (npcs = NPCS) => {
  render(<GameRestsPanel token="admintoken" system={HEARTH} npcs={npcs} />);
  await screen.findByRole('region', { name: 'Rests' });
  // The preview has come back.
  await waitFor(() => expect(gets().length).toBeGreaterThan(0));
};
const previews = () => asked.filter((a) => a.url === '/api/sheets/rest' && a.body.preview);
const calls = () => asked.filter((a) => a.url === '/api/sheets/rest' && !a.body.preview);
const gets = () => within(screen.getByRole('list', { name: 'What each one gets' })).queryAllByRole('listitem')
  .map((li) => ({ name: li.querySelector('b')!.textContent, text: li.textContent }));

describe('the rests panel', () => {
  it('offers the game\'s rests and previews every player character and the map\'s NPCs once', async () => {
    await open();
    expect(within(screen.getByLabelText('Rest')).getAllByRole('option').map((o) => o.textContent)).toEqual(['SHORT REST', 'LONG REST']);
    await waitFor(() => expect(gets().map((g) => g.name)).toEqual(['ASH', 'VEX']));
    expect(previews().map((p) => p.body)).toEqual([{ rest: 'short_rest', players: true, npcs: [7, 9], preview: true }]);
    expect(gets()[1].text).toContain('HP 9 + 1d8 + @con_mod');
    expect(gets()[0].text).toContain('Nothing changes.');
  });

  it('previews again for another rest, with what wears off', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Rest'), { target: { value: 'long_rest' } });
    await waitFor(() => expect(gets()[1].text).toContain('HP 9 → 22'));
    expect(gets()[1].text).toContain('EXHAUSTED WEARS OFF');
    expect(screen.getByRole('button', { name: 'CALL LONG REST' })).toBeTruthy();
    expect(previews()).toHaveLength(2);
  });

  it('shows the map\'s NPCs too, or only those ticked, asking the server nothing more', async () => {
    await open();
    await waitFor(() => expect(gets()).toHaveLength(2));
    await userEvent.click(screen.getByRole('radio', { name: /PLAYERS AND THE NPCS ON THIS MAP/ }));
    expect(gets().map((g) => g.name)).toEqual(['ASH', 'VEX', 'GANGER', 'DOG']);
    await userEvent.click(screen.getByRole('radio', { name: /CHOOSE/ }));
    const ticks = within(screen.getByRole('group', { name: 'Characters' }));
    // Every player character starts ticked.
    expect(ticks.getAllByRole('checkbox').filter((t) => t.getAttribute('aria-checked') === 'true').map((t) => t.textContent)).toEqual(['ASH', 'VEX']);
    await userEvent.click(ticks.getByRole('checkbox', { name: 'ASH' }));
    await userEvent.click(ticks.getByRole('checkbox', { name: 'DOG' }));
    expect(gets().map((g) => g.name)).toEqual(['VEX', 'DOG']);
    expect(previews()).toHaveLength(1);
  });

  it('calls the rest for who is chosen, says so, and previews again', async () => {
    await open();
    await waitFor(() => expect(gets()).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'CALL SHORT REST' }));
    expect(await screen.findByRole('status')).toHaveTextContent('SHORT REST CALLED · 2 CHARACTERS');
    expect(calls().map((c) => c.body)).toEqual([{ rest: 'short_rest', players: true, npcs: [] }]);
    await waitFor(() => expect(previews()).toHaveLength(2));

    await userEvent.click(screen.getByRole('radio', { name: /CHOOSE/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Characters' })).getByRole('checkbox', { name: 'ASH' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Characters' })).getByRole('checkbox', { name: 'GANGER' }));
    await userEvent.click(screen.getByRole('button', { name: 'CALL SHORT REST' }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1].body).toEqual({ rest: 'short_rest', players: ['vex'], npcs: [7] });
    expect(await screen.findByText('SHORT REST CALLED · 2 CHARACTERS')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('group', { name: 'Characters' })).getByRole('checkbox', { name: 'GANGER' }));
    await userEvent.click(screen.getByRole('button', { name: 'CALL SHORT REST' }));
    expect(await screen.findByText('SHORT REST CALLED · 1 CHARACTER')).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: /PLAYERS AND THE NPCS ON THIS MAP/ }));
    await userEvent.click(screen.getByRole('button', { name: 'CALL SHORT REST' }));
    await waitFor(() => expect(calls()).toHaveLength(4));
    expect(calls()[3].body).toEqual({ rest: 'short_rest', players: true, npcs: [7, 9] });
    expect(await screen.findByRole('status')).toHaveTextContent('SHORT REST CALLED · 4 CHARACTERS');
  });

  it('can\'t call a rest for nobody, and says what the server refused', async () => {
    await open();
    await waitFor(() => expect(gets()).toHaveLength(2));
    await userEvent.click(screen.getByRole('radio', { name: /CHOOSE/ }));
    for (const name of ['ASH', 'VEX']) await userEvent.click(within(screen.getByRole('group', { name: 'Characters' })).getByRole('checkbox', { name }));
    expect(screen.getByText('Nobody chosen.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'CALL SHORT REST' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(screen.getByRole('group', { name: 'Characters' })).getByRole('checkbox', { name: 'VEX' }));
    refuseCall = 'Not one of this game\'s rests';
    await userEvent.click(screen.getByRole('button', { name: 'CALL SHORT REST' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not one of this game\'s rests');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing for an answer that isn\'t a list of rests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response));
    render(<GameRestsPanel token="admintoken" system={HEARTH} npcs={NPCS} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('region', { name: 'Rests' })).toBeNull();
  });

  it('shows nothing for a game without rests here', async () => {
    rests = [];
    render(<GameRestsPanel token="admintoken" system={HEARTH} npcs={NPCS} />);
    await waitFor(() => expect(asked.some((a) => a.url === '/api/sheets/rests')).toBe(true));
    expect(screen.queryByRole('region', { name: 'Rests' })).toBeNull();
  });
});

describe('the GAME tab', () => {
  const props = (system: string, view = 'list'): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view, setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], setIsAdminPayOpen: vi.fn(), handleSaveDefault: vi.fn(), handleLoadDefault: vi.fn(),
    globalSettings: { game_system: system }, gameSystem: system, isPrimaryAdmin: false, roads: [],
    locations: [
      { id: 7, name: 'GANGER', shape: 'enemy_rhombus', battle_map_id: null },
      { id: 8, name: 'GUARD', shape: 'enemy_rhombus', battle_map_id: 40, floor_index: 0 },
      { id: 3, name: 'VEX', shape: 'rhombus', battle_map_id: null },
    ],
    activeBattleMapData: { locationId: 40, currentFloorIndex: 0, maps: [] },
  });
  const gameTab = async (system: string, view?: string) => {
    running = system;
    render(<AdminPanel {...props(system, view)} />);
    await userEvent.click(screen.getByText('GAME'));
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
  };

  it('has the rests under a custom game, for a granted editor too, with the city map\'s NPCs', async () => {
    await gameTab(HEARTH);
    expect(await screen.findByRole('region', { name: 'Rests' })).toBeTruthy();
    await waitFor(() => expect(previews().at(-1)?.body.npcs).toEqual([7]));
  });

  it('has none under a built-in game, whose rests are its own buttons', async () => {
    await gameTab('cities_without_number');
    await screen.findByText('LONG_REST (STRAIN −1)');
    expect(screen.queryByRole('region', { name: 'Rests' })).toBeNull();
    // Not even asked for.
    expect(asked.some((a) => a.url === '/api/sheets/rests')).toBe(false);
  });
});
