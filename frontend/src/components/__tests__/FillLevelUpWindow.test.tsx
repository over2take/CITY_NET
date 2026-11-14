// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FillLevelUpWindow } from '../FillLevelUpWindow';
import { clearCustomTemplates, registerCustomTemplate, type CustomRender } from '../../sheets/customTemplates';

/**
 * FILL IT IN FOR THEM for a level up (7d7a; approved mockup docs/mockups/level-up.html): a player's LEVEL_UP.EXE opened
 * by the GM on that player's sheet, read through the admin routes, each action naming the player, with every limit off:
 * open with no level ready, FINISH with no roll, pick or points, and what isn't met added anyway.
 */

const ID = 'sys_00000000000000ab';
const STATS = [{ id: 'might', label: 'Might' }];
const TEMPLATE = {
  id: ID, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] },
  levels: { top: 5, table: { 2: 100, 3: 300, 4: 700, 5: 1500 }, health: { gain: 'roll', dieOn: 'class', dice: { soldier: 10 } } },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', picks: 'any', again: true, levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'path', label: 'Path', at: 3, opens: 'paths', opensCount: 1 },
        { id: 'asi', label: 'Ability Score Improvement', at: 3, increase: { points: 2, most: 2, stats: STATS } },
      ] },
      { id: 'rogue', label: 'Rogue', needs: 'WITS >= 13', features: [] },
    ] },
    { id: 'paths', one: 'Path', many: 'Paths', picks: 1, again: false, levelled: false, picked: 'features', options: [
      { id: 'duelist', label: 'Duelist', needs: 'MIGHT >= 15', features: [] },
    ] },
  ],
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

// Soldier 2, no XP: nothing ready for the player.
const SHEET = { name: 'Wren', might: 12, _xp: 0, _worked: { picks: [{ list: 'classes', option: 'soldier', level: 2 }], levels: { level: 2 }, unmet: ['rogue', 'duelist'] } };

const open = async (data: Record<string, unknown> = SHEET) => {
  registerCustomTemplate(TEMPLATE);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'wren', system: ID, data }) })));
  const socket = makeSocket();
  const onClose = vi.fn();
  render(<FillLevelUpWindow token="gm" socket={socket} username="wren" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={onClose} />);
  await screen.findByRole('tablist', { name: 'Folders' });
  return { socket, onClose };
};
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('FILL IT IN FOR THEM, a level up (7d7a)', () => {
  it('opens with no level ready, its place kept on their sheet, naming them', async () => {
    const { socket } = await open();
    expect(screen.getByText('LEVEL_UP.EXE · WREN · SOLDIER 3')).toBeTruthy();
    // The sheet comes by fetch, so the place goes once it's drawn.
    await waitFor(() => expect(socket.said('levelAction')[0]).toEqual({ kind: 'place', list: 'classes', option: 'soldier', username: 'wren' }));
  });

  it('FINISH with nothing rolled, picked or spent, saying what it leaves; the up names them, and it closes', async () => {
    const { socket, onClose } = await open();
    expect(button('NEXT').disabled).toBe(false);
    await userEvent.click(button('NEXT'));
    await userEvent.click(button('NEXT'));
    await userEvent.click(button('NEXT'));
    expect(button('FINISH').disabled).toBe(false);
    expect(button('FINISH').title).toBe('');
    expect(screen.getByText('FOR THE PLAYER, LIMITS OFF: FINISH goes as it is, health at its average, picks left to make on the sheet, points left unspent.')).toBeTruthy();
    await userEvent.click(button('FINISH'));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'up', list: 'classes', option: 'soldier', username: 'wren' });
    expect(onClose).toHaveBeenCalled();
  });

  it('what isn\'t met added anyway: a pick, and a class', async () => {
    const { socket } = await open();
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Folders' })).getByRole('tab', { name: /WHAT IT UNLOCKS/ }));
    expect(screen.getByText('NEEDS MIGHT >= 15 · ADD ANYWAY')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('group', { name: 'Pick a Path' })).getByRole('button', { name: 'DUELIST' }));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'place', list: 'classes', option: 'soldier', picks: [{ list: 'paths', option: 'duelist', from: 'path' }], username: 'wren' });
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Folders' })).getByRole('tab', { name: /WHICH CLASS/ }));
    expect(screen.getByText('NEEDS WITS >= 13 · ADD ANYWAY')).toBeTruthy();
    expect(button('NEW: ROGUE 1').disabled).toBe(false);
  });

  it('another class whatever health roll was kept', async () => {
    await open({ ...SHEET, _leveling: { list: 'classes', option: 'soldier', health: { roll: 7, die: 10 } } });
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Folders' })).getByRole('tab', { name: /WHICH CLASS/ }));
    expect(screen.queryByText(/Health was rolled for/)).toBeNull();
    expect(button('NEW: ROGUE 1').disabled).toBe(false);
  });

  it('a health roll for them, naming them', async () => {
    const { socket } = await open();
    await userEvent.click(within(screen.getByRole('tablist', { name: 'Folders' })).getByRole('tab', { name: /HEALTH/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Health this level' })).getByRole('button', { name: 'ROLL D10' }));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'healthRoll', list: 'classes', option: 'soldier', username: 'wren' });
  });

  it('a player at the highest level has nothing to fill in', async () => {
    registerCustomTemplate(TEMPLATE);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ username: 'wren', system: ID, data: { ...SHEET, _worked: { ...SHEET._worked, picks: [{ list: 'classes', option: 'soldier', level: 5 }], levels: { level: 5 } } } }) })));
    render(<FillLevelUpWindow token="gm" socket={makeSocket()} username="wren" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Nothing to level up right now.')).toBeTruthy();
  });
});
