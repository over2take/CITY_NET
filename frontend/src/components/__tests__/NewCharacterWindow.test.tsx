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

const render_ = (parts: Record<string, { on: boolean }> = {}): CustomRender => ({
  id: ID, name: 'Hearth', words: {}, parts, derived: [],
  sheet: { header: { nameField: 'name' }, sections: [
    { id: 'identity', label: 'IDENTITY', layout: 'list', fields: [
      { id: 'name', label: 'Name', type: 'text' }, { id: 'concept', label: 'Concept', type: 'text' }, { id: 'description', label: 'Description', type: 'textarea' },
    ] },
    { id: 'traits', label: 'TRAITS', layout: 'grid', fields: [{ id: 'grit', label: 'Grit', type: 'number' }] },
  ] },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: false, levelled: false, options: [{ id: 'soldier', label: 'Soldier', features: [] }, { id: 'mage', label: 'Mage', features: [], needs: 'GRIT >= 13' }] }],
  creation: { steps: ['who', 'stats', 'list:classes'], stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }] },
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

const open = async (data: Record<string, unknown> = { _creating: {} }, parts?: Record<string, { on: boolean }>, authToken: string | null = 'tok') => {
  registerCustomTemplate(render_(parts));
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
