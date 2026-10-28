import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NpcSheetWindow } from '../NpcSheetWindow';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * The GM's window onto a player's sheet (7a3b2): the CHOICES block there asks the server for the player
 * named, the GM's DROP and ADD ANYWAY included, and shows why the server said no. An NPC's sheet asks
 * nothing (picking on NPC sheets comes later).
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const socket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({
    id: HEARTH, name: 'Hearth', parts: {}, derived: [], words: {},
    sheet: { sections: [{ id: 'choices', label: 'CLASSES', layout: 'choices', fields: [] }] },
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: true, levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [] }, { id: 'mage', label: 'Mage', needs: 'INTELLECT >= 13', features: [] },
    ] }],
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/api/settings')
    ? { ok: true, json: async () => [] }
    : { ok: true, json: async () => ({ id: 3, username: 'GHOST', system: HEARTH, portrait_url: null, is_npc: 0,
      data: { name: 'Wren', _worked: { picks: [{ list: 'classes', option: 'soldier', level: 2 }], levels: {}, from: {}, uses: {}, unmet: ['mage'] } } }) })));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const open = async (playerUsername?: string) => {
  const s = socket();
  render(<NpcSheetWindow token="admintoken" npcId={3} npcLabel="Wren" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={s}
    {...(playerUsername ? { playerUsername } : {})} />);
  await waitFor(() => expect(screen.getByRole('group', { name: 'Soldier' })).toBeTruthy());
  return s;
};

describe('the GM on a player\'s sheet', () => {
  it('drops a pick for the player named, asked first', async () => {
    const s = await open('GHOST');
    fireEvent.click(screen.getByRole('button', { name: 'Drop Soldier' }));
    fireEvent.click(screen.getByRole('button', { name: 'YES, DROP' }));
    expect(s.emit).toHaveBeenCalledWith('choicesAction', { kind: 'drop', list: 'classes', option: 'soldier', username: 'GHOST' });
  });

  it('adds an option the player doesn\'t meet, and raises a level, for them', async () => {
    const s = await open('GHOST');
    expect(screen.getByText('NEEDS INTELLECT >= 13 · ADD ANYWAY')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'MAGE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soldier level up' }));
    expect(s.emit).toHaveBeenCalledWith('choicesAction', { kind: 'pick', list: 'classes', option: 'mage', username: 'GHOST' });
    expect(s.emit).toHaveBeenCalledWith('choicesAction', { kind: 'level', list: 'classes', option: 'soldier', level: 3, username: 'GHOST' });
  });

  it('shows why the server said no', async () => {
    const s = await open('GHOST');
    const onRefused = s.on.mock.calls.find((c) => c[0] === 'choicesRefused')![1];
    act(() => onRefused({ error: 'No more Classes can be picked' }));
    expect(screen.getByRole('alert').textContent).toBe('No more Classes can be picked');
  });
});

describe('an NPC\'s sheet', () => {
  it('asks nothing: the block only shows', async () => {
    const s = await open();
    expect(screen.queryByRole('button', { name: 'Drop Soldier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Soldier level up' })).toBeNull();
    expect(s.on.mock.calls.some((c) => c[0] === 'choicesRefused')).toBe(false);
  });
});
