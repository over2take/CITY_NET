import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => <div><div data-testid="window-title">{title}</div>{children}</div>,
}));

import { ControlledNpcSheetWindow } from '../ControlledNpcSheetWindow';
import { NpcSheetWindow } from '../NpcSheetWindow';

/**
 * A friendly NPC's sheet for the player the GM gave it (4b5b4): read-only, fetched with the
 * player's own login, and its rolls made as the NPC. The GM's own NPC sheet window rolls as the
 * NPC too, when opened from its token.
 */

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const REX = { id: 3, system: 'cyberpunk_red', is_npc: 1, npc_label: 'Rex', portrait_url: null, data: { name: 'Rex', ref: 7, handgun: 4, hp: 20, hp_max: 30 } };

/** A server answering the sheet routes, recording what was asked and with which login. */
const serve = (status = 200, body: unknown = REX) => {
  const asked: { url: string; auth?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    if (url === '/api/settings') return { ok: true, json: async () => [] } as Response;
    return { ok: status < 300, status, json: async () => body } as Response;
  }));
  return asked;
};
const socket = () => {
  const handlers: Record<string, (d: any) => void> = {};
  return { handlers, on: vi.fn((e: string, fn: (d: any) => void) => { handlers[e] = fn; }), off: vi.fn(), emit: vi.fn() };
};
const open = (s = socket()) => {
  render(<ControlledNpcSheetWindow token="player-login" locationId={9} name="Rex" socket={s} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} />);
  return s;
};

describe('the controlled NPC\'s sheet', () => {
  it('asks for the NPC\'s sheet with the player\'s own login, and shows it read-only', async () => {
    const asked = serve();
    open();
    expect(screen.getByTestId('window-title').textContent).toBe('NPC_SHEET.EXE · REX [READ-ONLY]');
    await screen.findByDisplayValue('Rex');
    expect(asked.find((a) => a.url === '/api/sheets/npcs/controlled/9')?.auth).toBe('Bearer player-login');
    const inputs = [...document.querySelectorAll('input')].filter((i) => i.type !== 'file');
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.readOnly || i.disabled)).toBe(true);
    expect(screen.getByText(/ONLY THE GM CHANGES ITS SHEET/)).toBeTruthy();
  });

  it('rolls as the NPC: the server is told which token', async () => {
    serve();
    const s = open();
    await screen.findByDisplayValue('Rex');
    fireEvent.click((await screen.findAllByTitle(/^Roll /))[0]);
    expect(s.emit).toHaveBeenCalledWith('requestSheetRoll', expect.objectContaining({ location_id: 9 }));
  });

  it('says when the GM hasn\'t made it a sheet yet, or the server refuses', async () => {
    serve(404, { error: 'This NPC has no sheet yet' });
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('NO_SHEET_YET // THE GM HAS NOT MADE ONE');
    cleanup();
    serve(403, { error: 'Only the GM, or a player the GM gave this NPC to' });
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('Only the GM, or a player the GM gave this NPC to');
  });

  it('reloads when the token or an NPC sheet changes', async () => {
    const asked = serve();
    const s = open();
    await screen.findByDisplayValue('Rex');
    const sheetAsks = () => asked.filter((a) => a.url === '/api/sheets/npcs/controlled/9').length;
    const before = sheetAsks();
    await act(async () => { s.handlers.dataUpdated?.({}); });
    await act(async () => { s.handlers.sheetUpdated?.({ npc_id: 3 }); });
    await act(async () => { s.handlers.sheetUpdated?.({ username: 'someone' }); });
    await waitFor(() => expect(sheetAsks()).toBe(before + 2));
  });
});

describe('the GM\'s NPC sheet window', () => {
  it('rolls as the NPC when it was opened from the NPC\'s token', async () => {
    serve();
    const s = socket();
    render(<NpcSheetWindow token="gm" npcId={3} npcLabel="Rex" locationId={9} socket={s} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} />);
    await screen.findByDisplayValue('Rex');
    fireEvent.click((await screen.findAllByTitle(/^Roll /))[0]);
    expect(s.emit).toHaveBeenCalledWith('requestSheetRoll', expect.objectContaining({ location_id: 9 }));
  });

  it('has nothing to roll as without a token', async () => {
    serve();
    render(<NpcSheetWindow token="gm" npcId={3} npcLabel="Rex" socket={socket()} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} />);
    await screen.findByDisplayValue('Rex');
    expect(screen.queryAllByTitle(/^Roll /)).toEqual([]);
  });
});
