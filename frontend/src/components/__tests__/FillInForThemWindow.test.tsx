// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FillInForThemWindow } from '../FillInForThemWindow';
import { clearCustomTemplates, registerCustomTemplate, type CustomRender } from '../../sheets/customTemplates';

/**
 * FILL IT IN FOR THEM (7c5): a player's NEW_CHARACTER.EXE opened by the GM on that player's sheet, with
 * every limit off. Read and written through the admin routes, and each action naming the player.
 */

const ID = 'sys_00000000000000aa';
const TEMPLATE = {
  id: ID, name: 'Hearth', words: {}, parts: {}, derived: [],
  sheet: { header: { nameField: 'name' }, sections: [
    { id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }] },
    { id: 'traits', label: 'TRAITS', layout: 'list', fields: [{ id: 'grit', label: 'Grit', type: 'number' }] },
  ] },
  choices: [],
  creation: {
    steps: ['who', 'stats', 'kits', 'money'],
    ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } },
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
    money: [{ id: 'main', name: 'Money', how: 'roll', each: '2d6' }],
    kits: [{ id: 'hard', name: 'HARD', items: [{ name: 'Rope', qty: 1 }], who: 'needs', needs: 'GRIT >= 99' }],
  },
} as unknown as CustomRender;

const makeSocket = () => {
  const handlers: Record<string, ((p: unknown) => void)[]> = {};
  const socket = {
    on: (e: string, fn: (p: unknown) => void) => { (handlers[e] ??= []).push(fn); },
    off: (e: string, fn: (p: unknown) => void) => { handlers[e] = (handlers[e] ?? []).filter((x) => x !== fn); },
    emit: vi.fn(),
    fire: (e: string, p: unknown) => act(() => (handlers[e] ?? []).forEach((fn) => fn(p))),
    said: (e: string) => socket.emit.mock.calls.filter((c) => c[0] === e).map((c) => (c as unknown[])[1]),
  };
  return socket;
};

const open = async (data: Record<string, unknown> = { _creating: { at: 'who' } }) => {
  registerCustomTemplate(TEMPLATE);
  const held = { data };
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'WREN', system: ID, data: held.data }) });
  });
  vi.stubGlobal('fetch', fetcher);
  const socket = makeSocket();
  const onClose = vi.fn();
  render(<FillInForThemWindow token="gm" socket={socket} username="WREN" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={onClose} />);
  await screen.findByRole('tab', { name: /WHO THEY ARE/ });
  return { socket, onClose, fetcher, held };
};
const folder = (name: RegExp) => screen.getByRole('tab', { name }) as HTMLButtonElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('filling it in', () => {
  it('reads their sheet through the admin route, and says whose it is and that the limits are off', async () => {
    const { fetcher } = await open();
    expect(fetcher.mock.calls[0][0]).toBe('/api/sheets/user/WREN');
    expect((fetcher.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer gm' });
    expect(screen.getByText(/NEW_CHARACTER\.EXE · WREN \[GM\]/)).toBeTruthy();
    expect(screen.getByText('FILLING IT IN FOR THEM. EVERY LIMIT IS OFF.')).toBeTruthy();
  });

  it('has no START, with every folder open and NEXT on, nothing answered', async () => {
    await open();
    expect(screen.queryByRole('tab', { name: 'MAKE ONE HERE' })).toBeNull();
    for (const name of [/THE STATS/, /KITS/, /MONEY/]) expect(folder(name).disabled).toBe(false);
    expect(button('NEXT').disabled).toBe(false);
  });

  it('a move names the player', async () => {
    const { socket } = await open();
    await userEvent.click(folder(/THE STATS/));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'at', step: 'stats', username: 'WREN' }));
  });

  it('FINISH is on from the last step, nothing answered: it goes, naming them, and closes', async () => {
    const { socket, onClose } = await open({ _creating: { at: 'money' } });
    expect(button('FINISH').disabled).toBe(false);
    await userEvent.click(button('FINISH'));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'finish', username: 'WREN' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('an edit goes to their sheet, and FINISH never overtakes it', async () => {
    const { socket, fetcher } = await open();
    const order: string[] = [];
    socket.emit.mockImplementation((_e: string, a: { kind: string }) => { order.push(a.kind); });
    fetcher.mockImplementationOnce(() => { order.push('saved'); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Wren' } });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Wren');
    await userEvent.click(folder(/MONEY/));
    await waitFor(() => expect(order).toEqual(['saved', 'at']));
    const put = fetcher.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')!;
    expect(put[0]).toBe('/api/sheets/user/WREN');
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ fields: { name: 'Wren' } });
  });

  it('a sheet read again doesn\'t lose what is waiting to go, and follows what changed', async () => {
    const { socket, held, fetcher } = await open();
    const reads = () => fetcher.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'PUT').length;
    const before = reads();
    socket.fire('sheetUpdated', { username: 'SOMEONE' });
    expect(reads()).toBe(before);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Typing' } });
    held.data = { _creating: { at: 'who' }, name: 'Old' };
    socket.fire('sheetUpdated', { username: 'WREN' });
    expect(reads()).toBe(before + 1);
    await act(async () => { await Promise.resolve(); });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Typing');
  });

  it('closed with an edit waiting, it still goes', async () => {
    const { fetcher } = await open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Late' } });
    cleanup();
    await waitFor(() => expect(fetcher.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')).toBe(true));
  });
});

describe('the stats, whatever the way', () => {
  it('boxes to type in, ROLL THEM naming the player, and what the game would give said', async () => {
    const { socket } = await open({ _creating: { at: 'stats' } });
    expect(screen.getByRole('spinbutton', { name: 'Grit' })).toBeTruthy();
    expect(screen.getByText('3d6 for each stat, or type what you like.')).toBeTruthy();
    await userEvent.click(button('ROLL THEM'));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'roll', step: 'stats', username: 'WREN' }));
  });

  it('rolled: says what came up, and clearing it is the way to another go', async () => {
    const { socket } = await open({ _creating: { at: 'stats', rolled: { stats: [9] } }, grit: 9 });
    expect(screen.getByText(/^Rolled 9\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ROLL THEM' })).toBeNull();
    await userEvent.click(button('CLEAR THE ROLL'));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'clearRoll', step: 'stats', username: 'WREN' }));
  });
});

describe('the other steps', () => {
  it('money rolled: CLEAR THE ROLL, not a word to the player', async () => {
    const { socket } = await open({ _creating: { at: 'money', money: { main: 7 } } });
    expect(screen.queryByText(/YOUR GM CAN CLEAR IT/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear the roll for Money' }));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'clearRoll', money: 'main', username: 'WREN' }));
  });

  it('money not rolled yet: its roll, and it says one left is made at FINISH', async () => {
    const { socket } = await open({ _creating: { at: 'money' } });
    expect(screen.getByText('PAID INTO THEIR BANK AT FINISH. A ROLL NOT MADE IS MADE THEN.')).toBeTruthy();
    await userEvent.click(button('ROLL FOR IT'));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'moneyRoll', id: 'main', username: 'WREN' }));
  });

  it('a kit not met is on, saying so', async () => {
    const { socket } = await open({ _creating: { at: 'kits' }, _worked: { picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: [], kitsUnmet: ['hard'], recovery: null } });
    const kits = within(screen.getByRole('group', { name: 'Kits to pick from' }));
    expect(kits.getByText('NEEDS GRIT >= 99 · ADD ANYWAY')).toBeTruthy();
    expect((kits.getByRole('button', { name: 'HARD' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(kits.getByRole('button', { name: 'HARD' }));
    await waitFor(() => expect(socket.said('creationAction')).toContainEqual({ kind: 'kit', kit: 'hard', username: 'WREN' }));
  });

  it('says what the server refused', async () => {
    const { socket } = await open({ _creating: { at: 'money', money: { main: 7 } } });
    socket.fire('choicesRefused', { error: 'Nothing rolled there to clear' });
    expect(screen.getByRole('alert').textContent).toBe('Nothing rolled there to clear');
  });

  it('closing keeps their place, with nothing said', async () => {
    const { socket, onClose } = await open();
    await userEvent.click(button('LEAVE FOR NOW'));
    expect(onClose).toHaveBeenCalled();
    expect(socket.said('creationAction')).toEqual([]);
  });

  it('closes when the character is done, however that came about', async () => {
    const { onClose } = await open({ _creating: { done: true } });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
