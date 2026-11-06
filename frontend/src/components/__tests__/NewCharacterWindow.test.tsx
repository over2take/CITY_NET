import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NewCharacterWindow } from '../NewCharacterWindow';
import { CharacterSheetWindow } from '../CharacterSheetWindow';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * NEW_CHARACTER.EXE (7c2). Approved mockup new-character (2026-11-03), a terminal window (the user's call,
 * 2026-11-04): it starts with the ways in as folders, each saying what it is with a button to go ahead;
 * making one, the steps are the folders, opening once those before are answered, NEXT off until it is; a
 * place kept on the sheet, so leaving loses nothing; finished or uploaded, it closes on the sheet.
 */

const ID = 'sys_0123456789abcdef';

const render_ = (parts: Record<string, { on: boolean }> = {}, creation?: object): CustomRender => ({
  id: ID, name: 'Hearth', words: {}, parts, derived: [],
  sheet: { header: { nameField: 'name' }, sections: [
    { id: 'identity', label: 'IDENTITY', layout: 'list', fields: [
      { id: 'name', label: 'Name', type: 'text' }, { id: 'concept', label: 'Concept', type: 'text' }, { id: 'description', label: 'Description', type: 'textarea' },
    ] },
    { id: 'traits', label: 'TRAITS', layout: 'grid', fields: [{ id: 'grit', label: 'Grit', type: 'number' }] },
  ] },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: false, levelled: false, options: [{ id: 'soldier', label: 'Soldier', features: [] }, { id: 'mage', label: 'Mage', features: [], needs: 'GRIT >= 13' }] }],
  creation: creation ?? { steps: ['who', 'stats', 'list:classes'], stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }] },
} as unknown as CustomRender);

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

const open = async (data: Record<string, unknown> = { _creating: {} }, parts?: Record<string, { on: boolean }>, authToken: string | null = 'tok', creation?: object) => {
  registerCustomTemplate(render_(parts, creation));
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
  const socket = makeSocket(data);
  const onLeave = vi.fn();
  const onDone = vi.fn();
  render(<NewCharacterWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} socket={socket as never} userName="WREN" authToken={authToken} onLeave={onLeave} onDone={onDone} />);
  await screen.findByRole('tablist', { name: 'Folders' });
  return { socket, onLeave, onDone };
};

afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const folders = () => within(screen.getByRole('tablist', { name: 'Folders' })).getAllByRole('tab') as HTMLButtonElement[];
const shape = () => folders().map((t) => [t.textContent, t.getAttribute('aria-selected') === 'true', t.disabled]);
const answers = (over: object = {}) => ({ picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: [], recovery: null, ...over });
const ALL_BEFORE_CLASS = { name: 'Wren', grit: 12 };
const way = (name: string) => userEvent.click(screen.getByRole('tab', { name }));
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('START', () => {
  it('names itself as a program, with the three ways in as its folders and no steps to walk yet', async () => {
    await open();
    expect(screen.getByText('NEW_CHARACTER.EXE · HEARTH')).toBeTruthy();
    expect(screen.getByText(/HOW DO YOU WANT TO START/)).toBeTruthy();
    expect(shape()).toEqual([['MAKE ONE HERE', true, false], ['UPLOAD A SHEET', false, false], ['THE BLANK FORM', false, false]]);
    expect(screen.queryByRole('button', { name: 'NEXT' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'BACK' })).toBeNull();
    expect(button('LEAVE FOR NOW')).toBeTruthy();
  });

  it('each way says what it is; nothing happens until its button is pressed', async () => {
    const { socket } = await open();
    expect(screen.getByRole('tabpanel').textContent).toContain('Step by step');
    expect(screen.getByRole('tabpanel').textContent).toContain('WHO THEY ARE · THE STATS · CLASS');
    await way('UPLOAD A SHEET');
    expect(screen.getByRole('tabpanel').textContent).toContain('taken as it is');
    expect(screen.queryByText('IMPORT.EXE')).toBeNull();
    await way('THE BLANK FORM');
    expect(screen.getByRole('tabpanel').textContent).toContain('outside the game');
    expect(socket.said('creationAction')).toEqual([]);
  });

  it('BEGIN goes to the first step, saves that, and the steps become the folders', async () => {
    const { socket } = await open();
    await userEvent.click(button('BEGIN'));
    expect(socket.said('creationAction')).toEqual([{ kind: 'at', step: 'who' }]);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(shape()).toEqual([['WHO THEY ARE', true, false], ['THE STATS', false, true], ['CLASS', false, true]]);
    expect(screen.getByText('WHO THEY ARE · STEP 1 OF 3')).toBeTruthy();
  });

  it('THE BLANK FORM hands it over and says what to do with it', async () => {
    await open();
    await way('THE BLANK FORM');
    expect(screen.queryByRole('status')).toBeNull();
    const link = screen.getByRole('link', { name: 'DOWNLOAD THE FORM' });
    expect(link.getAttribute('href')).toBe('/api/sheets/import/template.pdf');
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(screen.getByRole('status').textContent).toContain('UPLOAD A SHEET');
  });

  it('UPLOAD A SHEET opens today\'s IMPORT', async () => {
    await open();
    await way('UPLOAD A SHEET');
    expect(screen.queryByText('IMPORT.EXE')).toBeNull();
    await userEvent.click(button('CHOOSE A SHEET'));
    expect(screen.getByText('IMPORT.EXE')).toBeTruthy();
    await userEvent.click(within(screen.getByText('IMPORT.EXE').parentElement!).getByRole('button', { name: '×' }));
    expect(screen.queryByText('IMPORT.EXE')).toBeNull();
  });

  it('without SHEET IMPORT there is nothing to ask: straight to the first step', async () => {
    await open({ _creating: {} }, { sheet_import: { on: false } });
    expect(screen.queryByText(/HOW DO YOU WANT TO START/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'WHO THEY ARE' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'MAKE ONE HERE' })).toBeNull();
  });
});

describe('the steps', () => {
  it('opens where they left it, those answered ticked, saying which step of how many', async () => {
    await open({ ...ALL_BEFORE_CLASS, _creating: { at: 'list:classes' } });
    expect(shape()).toEqual([['✓ WHO THEY ARE', false, false], ['✓ THE STATS', false, false], ['CLASS', true, false]]);
    expect(screen.getByText('CLASS · STEP 3 OF 3')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'THE STATS, answered' })).toBeTruthy();
  });

  it('a name opens the next folder, and a folder opened is saved as their place', async () => {
    const { socket } = await open({ name: 'Wren', _creating: { at: 'who' } });
    expect(shape().map((f) => f[2])).toEqual([false, false, true]);
    await way('THE STATS');
    expect(socket.said('creationAction')).toEqual([{ kind: 'at', step: 'stats' }]);
    expect(screen.getByRole('spinbutton', { name: 'Grit' })).toBeTruthy();
  });

  it('the arrow keys walk the ways in, and the steps, passing over those shut', async () => {
    await open();
    screen.getByRole('tab', { name: 'MAKE ONE HERE' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'UPLOAD A SHEET' }).getAttribute('aria-selected')).toBe('true');
    cleanup();
    await open({ name: 'Wren', _creating: { at: 'stats' } });
    screen.getByRole('tab', { name: 'THE STATS' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /^WHO THEY ARE/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('with a step before it unanswered again, FINISH waits', async () => {
    const { socket } = await open({ ...ALL_BEFORE_CLASS, _creating: { at: 'list:classes' }, _worked: answers({ picks: [{ list: 'classes', option: 'soldier' }] }) });
    expect(button('FINISH').disabled).toBe(false);
    socket.fire('sheetData', { username: 'WREN', system: ID, data: { grit: 12, _creating: { at: 'list:classes' }, _worked: answers({ picks: [{ list: 'classes', option: 'soldier' }] }) } });
    expect(button('FINISH').disabled).toBe(true);
    expect(button('FINISH').title).toBe('Finish this step first');
  });

  it('says which folder is open inside the panel, so the panel is level with the folders and each lead-in meets it', async () => {
    await open();
    expect(within(screen.getByRole('tabpanel')).getByText('A NEW CHARACTER. HOW DO YOU WANT TO START?')).toBeTruthy();
    await userEvent.click(button('BEGIN'));
    expect(within(screen.getByRole('tabpanel')).getByText('WHO THEY ARE · STEP 1 OF 3')).toBeTruthy();
  });

  describe('a portrait', () => {
    const PICTURE = /UPLOAD · MAX 8MB/;
    const portraitCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === '/api/sheets/portrait');

    it('WHO THEY ARE uploads one, as the sheet does, under the name of who is signed in', async () => {
      await open({ _creating: { at: 'who' } });
      await userEvent.upload(screen.getByLabelText(PICTURE), new File(['x'], 'wren.png', { type: 'image/png' }));
      expect(portraitCalls()).toHaveLength(1);
      expect(portraitCalls()[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('frames what they have, and their initial until then', async () => {
      const { socket } = await open({ name: 'wren', _creating: { at: 'who' } });
      expect(screen.getByText('W')).toBeTruthy();
      socket.fire('sheetData', { username: 'WREN', system: ID, portrait_url: '/uploads/wren.png', data: { name: 'wren', _creating: { at: 'who' } } });
      expect(screen.getByRole('tabpanel').innerHTML).toContain('/uploads/wren.png');
      expect(screen.queryByText('W')).toBeNull();
    });

    it('? with no name yet', async () => {
      await open({ _creating: { at: 'who' } });
      expect(screen.getByText('?')).toBeTruthy();
    });

    it('offers no upload to someone with no token to send', async () => {
      await open({ _creating: { at: 'who' } }, undefined, null);
      expect(screen.queryByLabelText(PICTURE)).toBeNull();
    });

    it('is only on WHO THEY ARE, and never above the folders', async () => {
      const { socket } = await open({ _creating: {} });
      const withPortrait = (at: object) => socket.fire('sheetData', { username: 'WREN', system: ID, portrait_url: '/uploads/wren.png', data: { name: 'W', ...at } });
      withPortrait({ _creating: {} });
      expect(document.body.innerHTML).not.toContain('/uploads/wren.png');
      withPortrait({ _creating: { at: 'stats' } });
      expect(screen.getByRole('spinbutton', { name: 'Grit' })).toBeTruthy();
      expect(document.body.innerHTML).not.toContain('/uploads/wren.png');
      expect(screen.queryByLabelText(PICTURE)).toBeNull();
    });
  });

  it('WHO THEY ARE writes the sheet\'s own fields, with NEXT off until there is a name', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { socket } = await open({ _creating: { at: 'who' } });
    expect(button('NEXT').disabled).toBe(true);
    expect(button('NEXT').title).toBe('Finish this step first');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'W');
    expect(button('NEXT').disabled).toBe(false);
    expect(button('NEXT').title).toBe('');
    expect(screen.getByRole('textbox', { name: 'Concept' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Description' }).tagName).toBe('TEXTAREA');
    await userEvent.click(button('NEXT'));
    expect(socket.said('creationAction')).toEqual([{ kind: 'at', step: 'stats' }]);
    expect(screen.getByRole('spinbutton', { name: 'Grit' })).toBeTruthy();
    timers.mockRestore();
  });

  describe('a fixed array (7c3b)', () => {
    const ARRAY = {
      steps: ['who', 'stats', 'list:classes'],
      ways: { stats: { way: 'array', numbers: [15, 14, 9] } },
      stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    };
    const at = { name: 'Wren', _creating: { at: 'stats' } };
    const pool = () => within(screen.getByRole('group', { name: 'Numbers to place' }));
    const stat = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

    it('a number is picked, then the stat it goes on, and the server is asked', async () => {
      const { socket } = await open(at, undefined, 'tok', ARRAY);
      expect(pool().getAllByRole('button').map((b) => b.textContent)).toEqual(['15', '14', '9']);
      await userEvent.click(pool().getByRole('button', { name: '14' }));
      expect(pool().getByRole('button', { name: '14' }).getAttribute('aria-pressed')).toBe('true');
      await userEvent.click(stat(/^Grit:/));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'place', step: 'stats', stat: 'grit', value: 14 });
      expect(pool().getByRole('button', { name: '14' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('a number picked twice is put down; a stat clicked with none held and none on it asks nothing', async () => {
      const { socket } = await open(at, undefined, 'tok', ARRAY);
      await userEvent.click(pool().getByRole('button', { name: '14' }));
      await userEvent.click(pool().getByRole('button', { name: '14' }));
      expect(pool().getByRole('button', { name: '14' }).getAttribute('aria-pressed')).toBe('false');
      await userEvent.click(stat(/^Grit:/));
      expect(socket.said('creationAction')).toEqual([]);
    });

    it('what the sheet holds is on its stat and out of the pool; clicked, it comes back', async () => {
      const { socket } = await open({ ...at, grit: 15 }, undefined, 'tok', ARRAY);
      expect(stat(/^Grit:/).getAttribute('aria-label')).toBe('Grit: 15');
      expect(stat(/^Wits:/).getAttribute('aria-label')).toBe('Wits: no number yet');
      expect(pool().getAllByRole('button').map((b) => b.textContent)).toEqual(['14', '9']);
      await userEvent.click(stat(/^Grit:/));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'place', step: 'stats', stat: 'grit', value: null });
    });

    it('NEXT holds until every stat has one; a number left over is no matter', async () => {
      await open({ ...at, grit: 15 }, undefined, 'tok', ARRAY);
      expect(button('NEXT').disabled).toBe(true);
      cleanup();
      await open({ ...at, grit: 15, wits: 14 }, undefined, 'tok', ARRAY);
      expect(button('NEXT').disabled).toBe(false);
      expect(pool().getAllByRole('button').map((b) => b.textContent)).toEqual(['9']);
    });

    it('with none left, says so', async () => {
      await open({ ...at, grit: 15, wits: 14 }, undefined, 'tok', { ...ARRAY, ways: { stats: { way: 'array', numbers: [15, 14] } } });
      expect(screen.getByText('EVERY NUMBER IS PLACED')).toBeTruthy();
    });

    it('a number repeated is two to pick, one at a time', async () => {
      await open(at, undefined, 'tok', { ...ARRAY, ways: { stats: { way: 'array', numbers: [10, 10] } } });
      const tens = pool().getAllByRole('button', { name: '10' });
      await userEvent.click(tens[1]);
      expect(pool().getAllByRole('button', { name: '10' }).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    });

    it('says why the server said no', async () => {
      const { socket } = await open(at, undefined, 'tok', ARRAY);
      socket.fire('choicesRefused', { error: 'That number is already placed' });
      expect(screen.getByRole('alert').textContent).toBe('That number is already placed');
    });

    it('names each group on THE STATS, and not on a group\'s own step', async () => {
      await open(at, undefined, 'tok', ARRAY);
      expect(within(screen.getByRole('tabpanel')).getByText('TRAITS')).toBeTruthy();
      cleanup();
      await open({ name: 'Wren', _creating: { at: 'stats:traits' } }, undefined, 'tok', { ...ARRAY, steps: ['who', 'stats:traits'], ways: { 'stats:traits': ARRAY.ways.stats } });
      expect(within(screen.getByRole('tabpanel')).queryByText('TRAITS')).toBeNull();
    });
  });

  describe('rolled (7c3c)', () => {
    const ROLL = (placed: string) => ({
      steps: ['who', 'stats', 'list:classes'],
      ways: { stats: { way: 'roll', each: '4d6 drop lowest', placed } },
      stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    });
    const at = { name: 'Wren', _creating: { at: 'stats' } };
    const rolled = (over: object = {}) => ({ name: 'Wren', _creating: { at: 'stats', rolled: { stats: [14, 8] } }, ...over });
    const roll = () => screen.queryByRole('button', { name: 'ROLL THEM' }) as HTMLButtonElement | null;
    const pool = () => screen.queryByRole('group', { name: 'Numbers to place' });

    it('before rolling: says what it will do, the stats empty, nothing to place, NEXT held', async () => {
      await open(at, undefined, 'tok', ROLL('order'));
      expect(screen.getByText('4d6 drop lowest for each stat, in order. What comes up is yours.')).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Grit: no number yet' })).toBeTruthy();
      expect(pool()).toBeNull();
      expect(button('NEXT').disabled).toBe(true);
      cleanup();
      await open(at, undefined, 'tok', ROLL('arrange'));
      expect(screen.getByText('4d6 drop lowest, once for each stat, then placed as you like.')).toBeTruthy();
      expect(pool()).toBeNull();
      expect(screen.queryByText('EVERY NUMBER IS PLACED')).toBeNull();
      expect(screen.getByRole('group', { name: 'Grit: no number yet' })).toBeTruthy();
    });

    it('ROLL THEM asks the server, for this step', async () => {
      const { socket } = await open(at, undefined, 'tok', ROLL('arrange'));
      await userEvent.click(roll()!);
      expect(socket.said('creationAction')).toContainEqual({ kind: 'roll', step: 'stats' });
    });

    it('rolled in order: on the stats, kept, with no way to roll or place again', async () => {
      await open(rolled({ grit: 14, wits: 8 }), undefined, 'tok', ROLL('order'));
      expect(screen.getByText(/^Rolled, and kept/)).toBeTruthy();
      expect(roll()).toBeNull();
      expect(pool()).toBeNull();
      expect(screen.getByRole('group', { name: 'Grit: 14' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Grit/ })).toBeNull();
      expect(button('NEXT').disabled).toBe(false);
    });

    it('rolled to arrange: what came up to place, as an array is, asked of the server', async () => {
      const { socket } = await open(rolled(), undefined, 'tok', ROLL('arrange'));
      expect(screen.getByText(/^Rolled, and kept/)).toBeTruthy();
      expect(roll()).toBeNull();
      expect(within(pool() as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['14', '8']);
      expect(button('NEXT').disabled).toBe(true);
      await userEvent.click(within(pool() as HTMLElement).getByRole('button', { name: '8' }));
      await userEvent.click(screen.getByRole('button', { name: /^Grit:/ }));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'place', step: 'stats', stat: 'grit', value: 8 });
    });

    it('placed, NEXT opens', async () => {
      await open(rolled({ grit: 8, wits: 14 }), undefined, 'tok', ROLL('arrange'));
      expect(button('NEXT').disabled).toBe(false);
    });

    it('says why the server said no', async () => {
      const { socket } = await open(at, undefined, 'tok', ROLL('order'));
      socket.fire('choicesRefused', { error: 'Rolled, and kept: rolling again is the GM\'s' });
      expect(screen.getByRole('alert').textContent).toBe('Rolled, and kept: rolling again is the GM\'s');
    });
  });

  describe('a point buy (7c3d)', () => {
    const BUY = {
      steps: ['who', 'stats', 'list:classes'],
      ways: { stats: { way: 'buy', points: 5, lowest: 8, highest: 12, costs: { 8: 0, 9: 1, 10: 2, 11: 4, 12: 6 } } },
      stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    };
    const at = (over: object = {}) => ({ name: 'Wren', _creating: { at: 'stats' }, ...over });
    const up = (name: string) => button(`${name} up`);
    const down = (name: string) => button(`${name} down`);

    it('says the points left, each stat at the lowest, what it has cost and what the next costs', async () => {
      await open(at(), undefined, 'tok', BUY);
      const panel = within(screen.getByRole('tabpanel'));
      expect(panel.getByRole('status').textContent).toBe('5 OF 5 POINTS LEFT');
      const grit = within(screen.getByRole('group', { name: 'Grit: 8' }));
      expect(grit.getByText('COST 0 · NEXT +1')).toBeTruthy();
      expect(down('Grit').disabled).toBe(true);
      expect(up('Grit').disabled).toBe(false);
    });

    it('asks the server, a number at a time', async () => {
      const { socket } = await open(at({ grit: 10 }), undefined, 'tok', BUY);
      await userEvent.click(up('Grit'));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'buy', step: 'stats', stat: 'grit', value: 11 });
      await userEvent.click(down('Grit'));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'buy', step: 'stats', stat: 'grit', value: 9 });
    });

    it('stops at what the points allow and at the highest, saying the last has no next', async () => {
      await open(at({ grit: 11, wits: 9 }), undefined, 'tok', BUY);
      expect(screen.getByRole('status').textContent).toBe('0 OF 5 POINTS LEFT');
      expect(up('Grit').disabled).toBe(true);
      expect(up('Wits').disabled).toBe(true);
      expect(button('NEXT').disabled).toBe(false);
      cleanup();
      await open(at({ grit: 12 }), undefined, 'tok', { ...BUY, ways: { stats: { ...BUY.ways.stats, points: 50 } } });
      expect(up('Grit').disabled).toBe(true);
      expect(within(screen.getByRole('group', { name: 'Grit: 12' })).getByText('COST 6')).toBeTruthy();
    });

    it('with too many spent, says by how many, and holds NEXT until they come down', async () => {
      await open(at({ grit: 12, wits: 12 }), undefined, 'tok', BUY);
      expect(screen.getByRole('status').textContent).toBe('7 POINTS TOO MANY');
      expect(button('NEXT').disabled).toBe(true);
      expect(down('Grit').disabled).toBe(false);
    });

    it('points left over hold nothing', async () => {
      await open(at(), undefined, 'tok', BUY);
      expect(button('NEXT').disabled).toBe(false);
    });

    it('says why the server said no', async () => {
      const { socket } = await open(at(), undefined, 'tok', BUY);
      socket.fire('choicesRefused', { error: 'Not enough points left' });
      expect(screen.getByRole('alert').textContent).toBe('Not enough points left');
    });

    it('names each group on THE STATS, and not on a group\'s own step', async () => {
      await open(at(), undefined, 'tok', BUY);
      expect(within(screen.getByRole('tabpanel')).getByText('TRAITS')).toBeTruthy();
      cleanup();
      await open({ name: 'Wren', _creating: { at: 'stats:traits' } }, undefined, 'tok', { ...BUY, steps: ['who', 'stats:traits'], ways: { 'stats:traits': BUY.ways.stats } });
      expect(within(screen.getByRole('tabpanel')).queryByText('TRAITS')).toBeNull();
    });
  });

  describe('kits (7c4b)', () => {
    const KITTED = {
      steps: ['who', 'stats', 'kits'],
      stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
      kits: [
        { id: 'essentials', name: 'Essentials', items: [{ name: 'Knife', qty: 1 }, { name: 'Torch', qty: 2 }], who: 'all' },
        { id: 'traveler', name: 'Traveler', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' },
        { id: 'potions', name: 'Potion Maker', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', needs: 'GRIT >= 13' },
      ],
    };
    const at = (place: object = {}, over: object = {}) => ({ name: 'Wren', grit: 12, _creating: { at: 'kits', ...place }, _worked: answers({ kitsUnmet: ['potions'] }), ...over });
    const picks = () => within(screen.getByRole('group', { name: 'Kits to pick from' }));
    const kit = (name: string) => picks().getByRole('button', { name }) as HTMLButtonElement;

    it('is a step of its own, saying what everyone gets, and what each to pick has in it', async () => {
      await open(at(), undefined, 'tok', KITTED);
      expect(screen.getByRole('tab', { name: 'KITS' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('Everyone gets ESSENTIALS: Knife, 2x Torch.')).toBeTruthy();
      expect(kit('TRAVELER').nextElementSibling?.textContent).toBe('Rope, 3x Rations');
      expect(screen.getByText('IT ALL GOES IN YOUR INVENTORY WHEN YOU FINISH.')).toBeTruthy();
    });

    it('one not met is off, saying what it needs', async () => {
      await open(at(), undefined, 'tok', KITTED);
      expect(kit('POTION MAKER').disabled).toBe(true);
      expect(kit('POTION MAKER').className).toBe('choice-off');
      expect(kit('POTION MAKER').nextElementSibling?.textContent).toBe('MortarNEEDS GRIT >= 13');
      expect(kit('TRAVELER').disabled).toBe(false);
      expect(kit('TRAVELER').className).toBe('');
    });

    it('a pick is asked of the server; pressed again it is put back', async () => {
      const { socket } = await open(at(), undefined, 'tok', KITTED);
      expect(button('FINISH').disabled).toBe(true);
      await userEvent.click(kit('TRAVELER'));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'kit', kit: 'traveler' });
      cleanup();
      const again = await open(at({ kit: 'traveler' }), undefined, 'tok', KITTED);
      expect(kit('TRAVELER').getAttribute('aria-pressed')).toBe('true');
      expect(button('FINISH').disabled).toBe(false);
      await userEvent.click(kit('TRAVELER'));
      expect(again.socket.said('creationAction')).toContainEqual({ kind: 'kit', kit: null });
    });

    it('one picked and since out of reach stays pressable, to put back, holding FINISH', async () => {
      await open(at({ kit: 'potions' }), undefined, 'tok', KITTED);
      expect(kit('POTION MAKER').disabled).toBe(false);
      expect(kit('POTION MAKER').className).toBe('');
      expect(button('FINISH').disabled).toBe(true);
    });

    it('with only what everyone gets, nothing to pick, FINISH open', async () => {
      await open(at(), undefined, 'tok', { ...KITTED, kits: [KITTED.kits[0]] });
      expect(screen.getByText('Nothing to pick here.')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Kits to pick from' })).toBeNull();
      expect(button('FINISH').disabled).toBe(false);
    });

    it('says why the server said no', async () => {
      const { socket } = await open(at(), undefined, 'tok', KITTED);
      socket.fire('choicesRefused', { error: 'Pick a kit first' });
      expect(screen.getByRole('alert').textContent).toBe('Pick a kit first');
    });
  });

  describe('starting money (7c4d)', () => {
    const MONEY = (money: object[]) => ({ steps: ['who', 'money'], stats: [], money });
    const at = (held?: object) => ({ name: 'Wren', _creating: { at: 'money', ...(held ? { money: held } : {}) } });

    it('a number is said, and holds nothing', async () => {
      await open(at(), undefined, 'tok', MONEY([{ id: 'main', name: 'Money', how: 'number', amount: 100 }]));
      expect(screen.getByRole('tab', { name: 'MONEY' }).getAttribute('aria-selected')).toBe('true');
      expect(within(screen.getByRole('region', { name: 'Money' })).getByText('100')).toBeTruthy();
      expect(screen.getByText('PAID INTO YOUR BANK WHEN YOU FINISH.')).toBeTruthy();
      expect(button('FINISH').disabled).toBe(false);
    });

    it('a roll is asked of the server, holding FINISH; rolled, it says what came up with no way to roll again', async () => {
      const roll = MONEY([{ id: 'main', name: 'Money', how: 'roll', each: '3d6 * 10' }]);
      const { socket } = await open(at(), undefined, 'tok', roll);
      expect(screen.getByText('3d6 * 10, rolled once.')).toBeTruthy();
      expect(button('FINISH').disabled).toBe(true);
      await userEvent.click(button('ROLL FOR IT'));
      expect(socket.said('creationAction')).toContainEqual({ kind: 'moneyRoll', id: 'main' });
      cleanup();
      await open(at({ main: 120 }), undefined, 'tok', roll);
      expect(within(screen.getByRole('region', { name: 'Money' })).getByText('120')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'ROLL FOR IT' })).toBeNull();
      expect(screen.getByText(/^ROLLED, AND KEPT/)).toBeTruthy();
      expect(button('FINISH').disabled).toBe(false);
    });

    it('typed: each amount asked as it reads, one that doesn\'t said and not sent, cleared when emptied', async () => {
      const { socket } = await open(at(), undefined, 'tok', MONEY([{ id: 'main', name: 'Money', how: 'typed' }]));
      const box = screen.getByRole('textbox', { name: 'Money' }) as HTMLInputElement;
      expect(button('FINISH').disabled).toBe(true);
      await userEvent.type(box, '75');
      expect(socket.said('creationAction')).toContainEqual({ kind: 'moneyTyped', id: 'main', amount: 75 });
      await userEvent.type(box, 'x');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText("THAT DOESN'T READ AS AN AMOUNT")).toBeTruthy();
      expect(socket.said('creationAction').filter((c) => (c as { amount?: number }).amount === undefined)).toEqual([]);
      await userEvent.clear(box);
      expect(socket.said('creationAction')).toContainEqual({ kind: 'moneyTyped', id: 'main', amount: null });
      expect(box.getAttribute('aria-invalid')).toBeNull();
    });

    it('a minus isn\'t an amount, on its way to one or not; in a currency of its own as well', async () => {
      registerCustomTemplate(render_());
      const { socket } = await open(at(), undefined, 'tok', MONEY([{ id: 'main', name: 'Money', how: 'typed' }]));
      const box = screen.getByRole('textbox', { name: 'Money' }) as HTMLInputElement;
      await userEvent.type(box, '-');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      await userEvent.type(box, '5');
      expect(socket.said('creationAction').filter((c) => (c as { kind: string }).kind === 'moneyTyped')).toEqual([]);
    });

    it('in a currency, read as it writes itself and said as it writes itself', async () => {
      const coined = { ...render_({}, MONEY([{ id: 'gold', name: 'Gold', how: 'typed' }, { id: 'tin', name: 'Tin', how: 'number', amount: 250 }])),
        currencies: [
          { id: 'gold', name: 'Gold', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] },
          { id: 'tin', name: 'Tin', symbol: '$', decimals: 2 },
        ] } as unknown as CustomRender;
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
      registerCustomTemplate(coined);
      const socket = makeSocket(at({ gold: 502 }));
      render(<NewCharacterWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} socket={socket as never} userName="WREN" authToken="tok" onLeave={vi.fn()} onDone={vi.fn()} />);
      const box = await screen.findByRole('textbox', { name: 'Gold' }) as HTMLInputElement;
      expect(box.value).toBe('5 gp 2 cp');
      expect(within(screen.getByRole('region', { name: 'Tin' })).getByText('$2.50')).toBeTruthy();
      await userEvent.clear(box);
      await userEvent.type(box, '3gp');
      expect(socket.said('creationAction')).toContainEqual({ kind: 'moneyTyped', id: 'gold', amount: 300 });
      await userEvent.clear(box);
      await userEvent.type(box, '7');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      // A lone minus reads as 0 in a currency's own reading, so it is turned away first.
      await userEvent.clear(box);
      const before = socket.said('creationAction').length;
      await userEvent.type(box, '-');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(socket.said('creationAction')).toHaveLength(before);
    });

    it('shows what was typed before', async () => {
      await open(at({ main: 75 }), undefined, 'tok', MONEY([{ id: 'main', name: 'Money', how: 'typed' }]));
      expect((screen.getByRole('textbox', { name: 'Money' }) as HTMLInputElement).value).toBe('75');
      expect(button('FINISH').disabled).toBe(false);
    });

    it('says why the server said no', async () => {
      const { socket } = await open(at(), undefined, 'tok', MONEY([{ id: 'main', name: 'Money', how: 'typed' }]));
      socket.fire('choicesRefused', { error: 'Say how much Money first' });
      expect(screen.getByRole('alert').textContent).toBe('Say how much Money first');
    });
  });

  it('a group\'s own step shows that group alone, named at its head (7c3a)', async () => {
    await open({ name: 'Wren', grit: 12, _creating: { at: 'stats:skills' } }, undefined, 'tok', {
      steps: ['who', 'stats:traits', 'stats:skills', 'list:classes'],
      stats: [
        { id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] },
        { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] },
      ],
    });
    expect(screen.getByRole('tab', { name: 'SKILLS' }).getAttribute('aria-selected')).toBe('true');
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByText('SKILLS · STEP 3 OF 4')).toBeTruthy();
    expect(panel.queryByText('SKILLS')).toBeNull();
    expect(panel.getByRole('spinbutton', { name: 'Climb' })).toBeTruthy();
    expect(panel.queryByRole('spinbutton', { name: 'Grit' })).toBeNull();
    expect(button('NEXT').disabled).toBe(true);
  });

  it('THE STATS name each group, as there may be several (7c3a)', async () => {
    await open({ name: 'Wren', _creating: { at: 'stats' } });
    expect(within(screen.getByRole('tabpanel')).getByText('TRAITS')).toBeTruthy();
  });

  it('THE STATS are typed in, a number out of range said and holding NEXT', async () => {
    await open({ _creating: { at: 'stats' } });
    expect(screen.getByRole('region', { name: 'TRAITS' })).toBeTruthy();
    const grit = screen.getByRole('spinbutton', { name: 'Grit' });
    expect(button('NEXT').disabled).toBe(true);
    await userEvent.type(grit, '2');
    expect(screen.getByText('At least 3')).toBeTruthy();
    expect(button('NEXT').disabled).toBe(true);
    await userEvent.clear(grit);
    expect(screen.queryByText('At least 3')).toBeNull();
    await userEvent.type(grit, '12');
    expect(button('NEXT').disabled).toBe(false);
  });

  it('BACK goes back, saved; from the first step to the ways in; and with none, nowhere', async () => {
    const { socket } = await open({ _creating: { at: 'stats' } });
    await userEvent.click(button('BACK'));
    expect(socket.said('creationAction')).toEqual([{ kind: 'at', step: 'who' }]);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    await userEvent.click(button('BACK'));
    expect(screen.getByText(/HOW DO YOU WANT TO START/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'BACK' })).toBeNull();
    expect(socket.said('creationAction')).toHaveLength(1);
    cleanup();
    await open({ _creating: { at: 'who' } }, { sheet_import: { on: false } });
    expect(button('BACK').disabled).toBe(true);
  });

  it('a list\'s step is today\'s picking of that list, asking the server; one not met is off', async () => {
    const { socket } = await open({ ...ALL_BEFORE_CLASS, _creating: { at: 'list:classes' }, _worked: answers({ unmet: ['mage'] }) });
    await userEvent.click(button('SOLDIER'));
    expect(socket.said('choicesAction')).toEqual([{ kind: 'pick', list: 'classes', option: 'soldier' }]);
    expect(button('MAGE').disabled).toBe(true);
    expect(screen.getByText(/NEEDS GRIT >= 13/)).toBeTruthy();
  });

  it('on a list\'s step, a pick made can be taken back, the last step saying FINISH', async () => {
    const { socket, onDone } = await open({ ...ALL_BEFORE_CLASS, _creating: { at: 'list:classes' }, _worked: answers({ picks: [{ list: 'classes', option: 'soldier' }] }) });
    expect(screen.queryByRole('button', { name: 'NEXT' })).toBeNull();
    await userEvent.click(button('Drop Soldier'));
    await userEvent.click(button('YES, DROP'));
    expect(socket.said('choicesAction')).toEqual([{ kind: 'drop', list: 'classes', option: 'soldier' }]);
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(button('FINISH'));
    expect(socket.said('creationAction')).toEqual([{ kind: 'finish' }]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says why the server said no', async () => {
    const { socket } = await open({ _creating: { at: 'list:classes' } });
    socket.fire('choicesRefused', { error: 'No more Classes can be picked' });
    expect(screen.getByRole('alert').textContent).toBe('No more Classes can be picked');
  });
});

describe('leaving and ending', () => {
  it('LEAVE FOR NOW and the window\'s × both keep the place, saving nothing new', async () => {
    const { socket, onLeave, onDone } = await open({ _creating: { at: 'stats' } });
    await userEvent.click(button('LEAVE FOR NOW'));
    await userEvent.click(button('×'));
    expect(onLeave).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
    expect(socket.said('creationAction')).toEqual([]);
  });

  it('closes on the sheet once the sheet says it is done, as an upload does', async () => {
    const { socket, onDone } = await open({ _creating: {} });
    expect(onDone).not.toHaveBeenCalled();
    socket.fire('sheetData', { username: 'WREN', system: ID, data: { name: 'Wren', _creating: { done: true, uploaded: true } } });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('waits for the record, saying so', () => {
    registerCustomTemplate(render_());
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
    render(<NewCharacterWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} socket={socket as never} userName="WREN" onLeave={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('ACCESSING RECORD...')).toBeTruthy();
  });
});

describe('the sheet\'s own line', () => {
  const sheet = async (data: Record<string, unknown>, onContinueCreating?: () => void) => {
    registerCustomTemplate(render_());
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
    const socket = makeSocket(data);
    render(<CharacterSheetWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={socket} userName="WREN" onContinueCreating={onContinueCreating} />);
    await screen.findByRole('textbox', { name: /name/i }).catch(() => undefined);
  };

  it('CREATING · CONTINUE while it is under way, opening the window', async () => {
    const onContinue = vi.fn();
    await sheet({ _creating: { at: 'stats' } }, onContinue);
    await userEvent.click(await screen.findByRole('button', { name: 'CREATING · CONTINUE' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('nothing once done, nor on a sheet never asked, nor where it can\'t open (the standalone tab)', async () => {
    await sheet({ name: 'Wren', _creating: { done: true } }, vi.fn());
    expect(screen.queryByRole('button', { name: 'CREATING · CONTINUE' })).toBeNull();
    cleanup();
    await sheet({ name: 'Wren' }, vi.fn());
    expect(screen.queryByRole('button', { name: 'CREATING · CONTINUE' })).toBeNull();
    cleanup();
    await sheet({ _creating: {} });
    expect(screen.queryByRole('button', { name: 'CREATING · CONTINUE' })).toBeNull();
  });
});
