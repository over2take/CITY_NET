import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiceMenu } from '../Sidebar';

/**
 * ATTACK AS (4b5b4b; asked for by the user 2026-10-07): a player attacks with a friendly NPC the
 * GM gave them, the GM with an NPC on the target's map. Picking one reads its sheet (the
 * read-only route, with the viewer's login), lists its weapons and LUCK, and fires as it.
 */

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const REX = { data: { name: 'Rex', ref: 6, luck: 2, weapon1_name: 'Bite', weapon1_dmg: '2d6', weapon1_skill: 'brawling' } };
const OWN = { username: 'vex', data: { ref: 8, weapon1_name: 'Pistol', weapon1_dmg: '3d6', weapon1_skill: 'handgun' } };

/** A socket answering `requestMySheet` with the player's own sheet, recording what was sent. */
const makeSocket = (user = 'vex') => {
  const handlers: Record<string, (d: any) => void> = {};
  const socket = {
    handlers,
    on: vi.fn((e: string, fn: (d: any) => void) => { handlers[e] = fn; }),
    off: vi.fn(),
    emit: vi.fn((e: string) => { if (e === 'requestMySheet') queueMicrotask(() => handlers.sheetData?.({ ...OWN, username: user })); }),
  };
  return socket;
};
const serve = (npc: unknown = REX, ok = true) => {
  const asked: { url: string; auth?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    if (url === '/api/settings') return { ok: true, json: async () => [] } as Response;
    return { ok, status: ok ? 200 : 403, json: async () => npc } as Response;
  }));
  return asked;
};

const TOKENS = [
  { id: 5, name: 'TARGET', shape: 'enemy_rhombus', battle_map_id: null },
  { id: 9, name: 'Rex', shape: 'friendly_rhombus', controllers: JSON.stringify({ all: false, users: ['vex'] }), battle_map_id: null },
  { id: 11, name: 'Ghoul', shape: 'enemy_rhombus', sheet_data: '{}', battle_map_id: null },
];
const open = (over: Partial<React.ComponentProps<typeof DiceMenu>> = {}) => {
  const socket = makeSocket(over.userName ?? 'vex');
  render(
    <DiceMenu
      userName="vex" token="" writeToken="player-login" locations={TOKENS}
      socketRef={{ current: socket } as never} rhombusState={{ color: '#00ff00' }}
      setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} gameSystem="cyberpunk_red"
      attackPending={{ targetId: 5, targetName: 'TARGET', attackType: 'ranged', ac: 13 } as never} onCancelAttack={vi.fn()}
      {...over}
    />,
  );
  return socket;
};
const weaponNames = () => [...(screen.getByLabelText('Weapon') as HTMLSelectElement).options].map((o) => o.textContent);

describe('ATTACK AS', () => {
  it('offers a player themselves and each friendly NPC the GM gave them, never an enemy', async () => {
    serve();
    open();
    const picker = await screen.findByLabelText('Attack as') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['YOU', 'REX']);
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^PISTOL/));
  });

  it('isn\'t shown to a player with no NPC', async () => {
    serve();
    open({ userName: 'ash' });
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^PISTOL/));
    expect(screen.queryByLabelText('Attack as')).toBeNull();
  });

  it('reads the NPC\'s sheet with the player\'s login, lists its weapons and LUCK, and fires as it', async () => {
    const asked = serve();
    const socket = open();
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^PISTOL/));
    await userEvent.selectOptions(screen.getByLabelText('Attack as'), '9');
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^BITE/));
    expect(asked.find((a) => a.url === '/api/sheets/npcs/controlled/9')?.auth).toBe('Bearer player-login');
    expect([...(screen.getByLabelText('Spend LUCK') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['NONE', '+1', '+2']);
    await userEvent.click(screen.getByRole('button', { name: /FIRE|SWING/ }));
    expect(socket.emit).toHaveBeenCalledWith('sheetAttack', expect.objectContaining({ targetId: 5, weaponIndex: 1, location_id: 9 }));
  });

  it('goes back to the player\'s own sheet, firing as them again', async () => {
    serve();
    const socket = open();
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^PISTOL/));
    await userEvent.selectOptions(screen.getByLabelText('Attack as'), '9');
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^BITE/));
    await userEvent.selectOptions(screen.getByLabelText('Attack as'), '');
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^PISTOL/));
    await userEvent.click(screen.getByRole('button', { name: /FIRE|SWING/ }));
    const sent = socket.emit.mock.calls.filter((c) => c[0] === 'sheetAttack').at(-1)![1];
    expect('location_id' in sent).toBe(false);
  });

  it('says when the NPC has nothing to fire, and fires nothing while its sheet is coming', async () => {
    let answer!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/settings'
      ? Promise.resolve({ ok: true, json: async () => [] })
      : new Promise((r) => { answer = r; }))));
    open();
    await waitFor(() => expect(weaponNames()[0]).toMatch(/^PISTOL/));
    await userEvent.selectOptions(screen.getByLabelText('Attack as'), '9');
    expect(screen.getByText('READING ITS SHEET…')).toBeTruthy();
    await act(async () => { answer({ ok: true, json: async () => ({ data: { name: 'Rex' } }) }); });
    expect(await screen.findByText(/its sheet has no weapon row/)).toBeTruthy();
    expect(screen.getByLabelText('Attack as')).toBeTruthy();
  });

  it('offers the GM the NPCs with sheets on the target\'s map', async () => {
    serve();
    open({ userName: 'gm', token: 'gm-token', writeToken: 'gm-token' });
    const picker = await screen.findByLabelText('Attack as') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['YOU', 'GHOUL']);
  });
});
