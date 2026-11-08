import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LevelUpWindow } from '../LevelUpWindow';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * LEVEL_UP.EXE (7d3a; approved mockup docs/mockups/level-up.html, 2026-11-07): WHICH CLASS when there's a choice,
 * WHAT IT UNLOCKS at the new level, the place kept on the sheet from the moment it opens, and FINISH going up. From
 * 7d3b a class not held yet among them, and the picks a new level opens made in the window.
 */

const ID = 'sys_0123456789abcdef';

const system = (choices: object[] = [CLASSES]) => registerCustomTemplate({
  id: ID, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] },
  levels: { top: 5, table: { 2: 100, 3: 300, 4: 700, 5: 1500 } }, choices,
} as unknown as CustomRender);

const CLASSES = { id: 'classes', one: 'Class', many: 'Classes', picks: 'any', again: true, levelled: true, options: [
  { id: 'soldier', label: 'Soldier', features: [{ id: 'extra', label: 'Extra Attack', at: 3, text: 'Attack twice.' }] },
  { id: 'mage', label: 'Mage', features: [{ id: 'spark', label: 'Spark', at: 2 }, { id: 'school', label: 'School', at: 2, opens: 'schools', opensCount: 1 }] },
  { id: 'rogue', label: 'Rogue', needs: 'WITS >= 13', features: [] },
] };
const SCHOOLS = { id: 'schools', one: 'School', many: 'Schools', picks: 1, again: false, levelled: false, picked: 'features', options: [
  { id: 'fire', label: 'Fire', features: [] }, { id: 'frost', label: 'Frost', features: [] },
] };
/** One class to a character: nothing new to take up. */
const ONE = { ...CLASSES, picks: 1, again: false };

/** A socket that hands over one sheet, and hears what the window says. */
const makeSocket = (data: Record<string, unknown>) => {
  const handlers: Record<string, ((p: unknown) => void)[]> = {};
  const socket = {
    on: (e: string, fn: (p: unknown) => void) => { (handlers[e] ??= []).push(fn); },
    off: (e: string, fn: (p: unknown) => void) => { handlers[e] = (handlers[e] ?? []).filter((x) => x !== fn); },
    emit: vi.fn((e: string) => {
      if (e === 'requestMySheet') queueMicrotask(() => act(() => (handlers.sheetData ?? []).forEach((fn) => fn({ username: 'WREN', system: ID, data: socket.data }))));
    }),
    data,
    fire: (e: string, p: unknown) => act(() => (handlers[e] ?? []).forEach((fn) => fn(p))),
    said: (e: string) => socket.emit.mock.calls.filter((c) => c[0] === e).map((c) => (c as unknown[])[1]),
  };
  return socket;
};

const holding = (picks: [string, number][], xp = 9000, more: object = {}) => ({
  name: 'Wren', _xp: xp,
  _worked: { picks: picks.map(([option, level]) => ({ list: 'classes', option, level })), levels: { level: picks.reduce((n, [, l]) => n + l, 0) }, unmet: ['rogue'] },
  ...more,
});

const open = async (data: Record<string, unknown>, choices?: object[]) => {
  system(choices);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
  const socket = makeSocket(data);
  const onLeave = vi.fn();
  const onDone = vi.fn();
  render(<LevelUpWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} socket={socket as never} userName="WREN" onLeave={onLeave} onDone={onDone} />);
  await screen.findByRole('tablist', { name: 'Folders' });
  return { socket, onLeave, onDone };
};

afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const folders = () => within(screen.getByRole('tablist', { name: 'Folders' })).getAllByRole('tab').map((t) => t.textContent);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('LEVEL_UP.EXE', () => {
  it('with several classes, WHICH CLASS first, the first chosen, and its place kept as it opens', async () => {
    const { socket } = await open(holding([['soldier', 2], ['mage', 1]]));
    await screen.findByText('LEVEL_UP.EXE · WREN · SOLDIER 3');
    expect(folders()).toEqual(['WHICH CLASS', 'WHAT IT UNLOCKS']);
    expect(screen.getByText('WHICH CLASS · STEP 1 OF 2')).toBeTruthy();
    const which = screen.getByRole('group', { name: 'Which class goes up' });
    expect(within(which).getByRole('button', { name: 'SOLDIER 2 → 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(socket.said('levelAction')).toEqual([{ kind: 'place', list: 'classes', option: 'soldier' }]);
    expect(button('BACK').disabled).toBe(true);
  });

  it('another class chosen is kept, and the title follows at once', async () => {
    const { socket } = await open(holding([['soldier', 2], ['mage', 1]]));
    await userEvent.click(within(screen.getByRole('group', { name: 'Which class goes up' })).getByRole('button', { name: 'MAGE 1 → 2' }));
    expect(screen.getByText('LEVEL_UP.EXE · WREN · MAGE 2')).toBeTruthy();
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'place', list: 'classes', option: 'mage' });
  });

  it('opens where it was left, asking nothing again', async () => {
    const { socket } = await open(holding([['soldier', 2], ['mage', 1]], 9000, { _leveling: { list: 'classes', option: 'mage' } }));
    await screen.findByText('LEVEL_UP.EXE · WREN · MAGE 2');
    expect(within(screen.getByRole('group', { name: 'Which class goes up' })).getByRole('button', { name: 'MAGE 1 → 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(socket.said('levelAction')).toEqual([]);
  });

  it('WHAT IT UNLOCKS: the new level\'s features, and a list one opens that isn\'t picked under it, said', async () => {
    await open(holding([['soldier', 2], ['mage', 1]], 9000, { _leveling: { list: 'classes', option: 'mage' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    expect(screen.getByText('WHAT IT UNLOCKS · STEP 2 OF 2')).toBeTruthy();
    expect(screen.getByText('Mage 2 brings:')).toBeTruthy();
    expect(screen.getByText('SPARK')).toBeTruthy();
    expect(screen.getByText('Opens the schools: picked on its own, on your sheet.')).toBeTruthy();
    await userEvent.click(button('BACK'));
    expect(screen.getByText('WHICH CLASS · STEP 1 OF 2')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'WHAT IT UNLOCKS' }));
    expect(screen.getByText('Mage 2 brings:')).toBeTruthy();
  });

  it('one class, and none to take up: no WHICH CLASS, and FINISH goes up and closes on the sheet', async () => {
    const { socket, onDone } = await open(holding([['soldier', 2]]), [ONE]);
    expect(folders()).toEqual(['WHAT IT UNLOCKS']);
    expect(await screen.findByText('Soldier 3 brings:')).toBeTruthy();
    expect(screen.getByText('Attack twice.')).toBeTruthy();
    await userEvent.click(button('FINISH'));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'up', list: 'classes', option: 'soldier' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('with no class list, the level itself, and nothing new said so', async () => {
    const { socket } = await open({ name: 'Wren', _xp: 100, level: 1 }, []);
    await screen.findByText('LEVEL_UP.EXE · WREN · LEVEL 2');
    expect(screen.getByText('Level 2. Nothing new comes with it.')).toBeTruthy();
    expect(socket.said('levelAction')).toEqual([{ kind: 'place' }]);
    await userEvent.click(button('FINISH'));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'up' });
  });

  it('LEAVE FOR NOW and the close button leave it, keeping the place', async () => {
    const { onLeave, onDone, socket } = await open(holding([['soldier', 2]]), [ONE]);
    await screen.findByText('Soldier 3 brings:');
    await userEvent.click(button('LEAVE FOR NOW'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(socket.said('levelAction').some((a) => (a as { kind: string }).kind === 'up')).toBe(false);
  });

  it('says why the server said no', async () => {
    const { socket } = await open(holding([['soldier', 2]]), [ONE]);
    await screen.findByText('Soldier 3 brings:');
    socket.fire('choicesRefused', { error: 'Already the highest level' });
    expect(screen.getByRole('alert').textContent).toBe('Already the highest level');
  });

  it('nothing to do when it isn\'t available, or with no class picked yet', async () => {
    const { socket } = await open(holding([['soldier', 2]], 5));
    expect(await screen.findByText('Nothing to level up right now.')).toBeTruthy();
    expect(screen.getByText('LEVEL_UP.EXE · WREN')).toBeTruthy();
    expect(socket.said('levelAction')).toEqual([]);
    cleanup();
    await open(holding([]));
    expect(await screen.findByText('Pick a Class first, on your sheet.')).toBeTruthy();
  });
});

describe('a class not held yet (7d3b)', () => {
  it('offered beside those held, one they don\'t meet greyed with what it needs, and chosen at level 1', async () => {
    const { socket } = await open(holding([['soldier', 2]]));
    await screen.findByText('LEVEL_UP.EXE · WREN · SOLDIER 3');
    expect(folders()).toEqual(['WHICH CLASS', 'WHAT IT UNLOCKS']);
    const fresh = screen.getByRole('group', { name: 'Or a new class' });
    expect(within(fresh).getByRole('button', { name: 'NEW: ROGUE 1' }).hasAttribute('disabled')).toBe(true);
    expect(within(fresh).getByText('NEEDS WITS >= 13')).toBeTruthy();
    await userEvent.click(within(fresh).getByRole('button', { name: 'NEW: MAGE 1' }));
    expect(screen.getByText('LEVEL_UP.EXE · WREN · MAGE 1')).toBeTruthy();
    expect(within(fresh).getByRole('button', { name: 'NEW: MAGE 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'place', list: 'classes', option: 'mage' });
  });

  it('what it brings at level 1, and FINISH takes it up', async () => {
    const { socket } = await open(holding([['soldier', 2]], 9000, { _leveling: { list: 'classes', option: 'mage' } }), [{ ...CLASSES, options: [CLASSES.options[0], { id: 'mage', label: 'Mage', features: [{ id: 'cantrip', label: 'Cantrip' }] }] }]);
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    expect(screen.getByText('Mage 1 brings:')).toBeTruthy();
    expect(screen.getByText('CANTRIP')).toBeTruthy();
    await userEvent.click(button('FINISH'));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'up', list: 'classes', option: 'mage' });
  });
});

describe('the picks a new level opens (7d3b)', () => {
  const MAGE_AT_1 = holding([['soldier', 1], ['mage', 1]], 9000, { _leveling: { list: 'classes', option: 'mage' } });
  const lists = (schools = SCHOOLS) => [ONE_PLUS, schools];
  const ONE_PLUS = { ...CLASSES, options: CLASSES.options.slice(0, 2) };

  it('made right there, FINISH waiting for them, each kept with the place', async () => {
    const { socket } = await open(MAGE_AT_1, lists());
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    expect(screen.getByText('Pick a School.')).toBeTruthy();
    expect(button('FINISH').disabled).toBe(true);
    expect(button('FINISH').title).toBe('Make the picks first');
    const school = screen.getByRole('group', { name: 'Pick a School' });
    await userEvent.click(within(school).getByRole('button', { name: 'FIRE' }));
    expect(within(school).getByRole('button', { name: 'FIRE' }).getAttribute('aria-pressed')).toBe('true');
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'place', list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'fire', from: 'school' }] });
    // One only: another waits until it's taken back.
    await userEvent.click(within(school).getByRole('button', { name: 'FROST' }));
    expect(within(school).getByRole('button', { name: 'FROST' }).getAttribute('aria-pressed')).toBe('false');
    expect(button('FINISH').disabled).toBe(false);
    await userEvent.click(button('FINISH'));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'up', list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'fire', from: 'school' }] });
  });

  it('taken back, FINISH waits again; reopened, the picks are as they were left', async () => {
    const { socket } = await open({ ...MAGE_AT_1, _leveling: { list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'frost', from: 'school' }] } }, lists());
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    const school = screen.getByRole('group', { name: 'Pick a School' });
    expect(within(school).getByRole('button', { name: 'FROST' }).getAttribute('aria-pressed')).toBe('true');
    expect(button('FINISH').disabled).toBe(false);
    await userEvent.click(within(school).getByRole('button', { name: 'FROST' }));
    expect(button('FINISH').disabled).toBe(true);
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'place', list: 'classes', option: 'mage' });
  });

  it('another class chosen starts its picks afresh', async () => {
    const { socket } = await open({ ...MAGE_AT_1, _leveling: { list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'frost', from: 'school' }] } }, lists());
    await userEvent.click(within(await screen.findByRole('group', { name: 'Which class goes up' })).getByRole('button', { name: 'SOLDIER 1 → 2' }));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'place', list: 'classes', option: 'soldier' });
    await userEvent.click(button('NEXT'));
    await userEvent.click(button('FINISH'));
    expect(socket.said('levelAction').at(-1)).toEqual({ kind: 'up', list: 'classes', option: 'soldier' });
  });

  it('several to pick, said as how many; one they don\'t meet greyed', async () => {
    const two = { ...SCHOOLS, picks: 'any', options: [...SCHOOLS.options, { id: 'storm', label: 'Storm', needs: 'WITS >= 15', features: [] }] };
    const data = { ...MAGE_AT_1, _worked: { ...MAGE_AT_1._worked, unmet: ['storm'] } };
    await open(data, [{ ...ONE_PLUS, options: [ONE_PLUS.options[0], { ...ONE_PLUS.options[1], features: [{ id: 'school', label: 'School', at: 2, opens: 'schools', opensCount: 3 }] }] }, two]);
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    expect(screen.getByText('Pick 2 Schools.')).toBeTruthy();
    const school = screen.getByRole('group', { name: 'Pick a School' });
    expect(within(school).getByRole('button', { name: 'STORM' }).hasAttribute('disabled')).toBe(true);
    expect(within(school).getByText('NEEDS WITS >= 15')).toBeTruthy();
    await userEvent.click(within(school).getByRole('button', { name: 'FIRE' }));
    expect(button('FINISH').disabled).toBe(true);
    await userEvent.click(within(school).getByRole('button', { name: 'FROST' }));
    expect(button('FINISH').disabled).toBe(false);
  });

  it('a list picked by roll is left to the sheet, and one with nothing left says so', async () => {
    await open(MAGE_AT_1, lists({ ...SCHOOLS, table: 'd6', players: 'roll' } as typeof SCHOOLS));
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    expect(screen.getByText('The Schools are rolled for: ROLL FOR IT on your sheet once you finish.')).toBeTruthy();
    expect(button('FINISH').disabled).toBe(false);
    cleanup();
    await open(MAGE_AT_1, lists({ ...SCHOOLS, options: [] }));
    await userEvent.click(await screen.findByRole('button', { name: 'NEXT' }));
    expect(screen.getByText('Nothing left to pick from the Schools.')).toBeTruthy();
    expect(button('FINISH').disabled).toBe(false);
  });
});
