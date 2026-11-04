import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NewCharacterWindow } from '../NewCharacterWindow';
import { CharacterSheetWindow } from '../CharacterSheetWindow';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * NEW_CHARACTER.EXE (7c2). Approved mockup new-character (2026-11-03): START offers an upload and the
 * blank form; each step asks, NEXT off until it is answered; a place kept on the sheet, so leaving
 * loses nothing; finished or uploaded, it closes on the sheet.
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

const open = async (data: Record<string, unknown> = { _creating: {} }, parts?: Record<string, { on: boolean }>) => {
  registerCustomTemplate(render_(parts));
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
  const socket = makeSocket(data);
  const onLeave = vi.fn();
  const onDone = vi.fn();
  render(<NewCharacterWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} socket={socket as never} userName="WREN" onLeave={onLeave} onDone={onDone} />);
  await screen.findByRole('list', { name: 'The steps' });
  return { socket, onLeave, onDone };
};

afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const crumbs = () => within(screen.getByRole('list', { name: 'The steps' })).getAllByRole('listitem');
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('START', () => {
  it('names itself as a program, and offers the three ways in', async () => {
    await open();
    expect(screen.getByText('NEW_CHARACTER.EXE · HEARTH')).toBeTruthy();
    expect(screen.getByText(/HOW DO YOU WANT TO START/)).toBeTruthy();
    expect(button('MAKE ONE HERE')).toBeTruthy();
    expect(button('UPLOAD A SHEET')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'THE BLANK FORM' }).getAttribute('href')).toBe('/api/sheets/import/template.pdf');
    expect(screen.queryByRole('button', { name: 'NEXT' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'BACK' })).toBeNull();
  });

  it('MAKE ONE HERE goes to the first step, and saves that', async () => {
    const { socket } = await open();
    await userEvent.click(button('MAKE ONE HERE'));
    expect(socket.said('creationAction')).toEqual([{ kind: 'at', step: 'who' }]);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('THE BLANK FORM says what to do with it', async () => {
    await open();
    expect(screen.queryByRole('status')).toBeNull();
    const link = screen.getByRole('link', { name: 'THE BLANK FORM' });
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(screen.getByRole('status').textContent).toContain('UPLOAD A SHEET');
  });

  it('UPLOAD A SHEET opens today\'s IMPORT', async () => {
    await open();
    expect(screen.queryByText('IMPORT.EXE')).toBeNull();
    await userEvent.click(button('UPLOAD A SHEET'));
    expect(screen.getByText('IMPORT.EXE')).toBeTruthy();
    await userEvent.click(within(screen.getByText('IMPORT.EXE').parentElement!).getByRole('button', { name: '×' }));
    expect(screen.queryByText('IMPORT.EXE')).toBeNull();
  });

  it('without SHEET IMPORT there is nothing to ask: straight to the first step', async () => {
    await open({ _creating: {} }, { sheet_import: { on: false } });
    expect(screen.queryByText(/HOW DO YOU WANT TO START/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(crumbs()[0].getAttribute('aria-current')).toBe('step');
  });
});

describe('the steps', () => {
  it('opens where they left it, the ones before ticked', async () => {
    await open({ _creating: { at: 'list:classes' } });
    expect(crumbs().map((li) => li.textContent)).toEqual(['✓ WHO THEY ARE', '✓ THE STATS', 'CLASS']);
    expect(crumbs()[2].getAttribute('aria-current')).toBe('step');
    expect(crumbs()[0].getAttribute('aria-current')).toBeNull();
  });

  it('marks no step while on START', async () => {
    await open();
    expect(crumbs().map((li) => [li.textContent, li.getAttribute('aria-current')])).toEqual([['WHO THEY ARE', null], ['THE STATS', null], ['CLASS', null]]);
  });

  it('WHO THEY ARE writes the sheet\'s own fields, with NEXT off until there is a name', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { socket } = await open({ _creating: { at: 'who' } });
    expect(button('BACK').disabled).toBe(true);
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

  it('BACK goes back, saved', async () => {
    const { socket } = await open({ _creating: { at: 'stats' } });
    await userEvent.click(button('BACK'));
    expect(socket.said('creationAction')).toEqual([{ kind: 'at', step: 'who' }]);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('a list\'s step is today\'s picking of that list, asking the server; one not met is off', async () => {
    const { socket } = await open({ _creating: { at: 'list:classes' }, _worked: { picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: ['mage'], recovery: null } });
    await userEvent.click(button('SOLDIER'));
    expect(socket.said('choicesAction')).toEqual([{ kind: 'pick', list: 'classes', option: 'soldier' }]);
    expect(button('MAGE').disabled).toBe(true);
    expect(screen.getByText(/NEEDS GRIT >= 13/)).toBeTruthy();
  });

  it('on a list\'s step, a pick made can be taken back, the last step saying FINISH', async () => {
    const { socket, onDone } = await open({
      _creating: { at: 'list:classes' }, _worked: { picks: [{ list: 'classes', option: 'soldier' }], opens: [], levels: {}, from: {}, uses: {}, unmet: [], recovery: null },
    });
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
