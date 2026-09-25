/**
 * A token's window, in the terminal style.
 *
 * Which folders exist is decided by what the caller hands over - a player's ID only for a
 * player's token, DEFENSE only for the GM and the owner, COMBAT only where there is combat -
 * so these check that the window shows exactly what it is given and edits only what it may.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenWindow } from '../TokenWindow';

vi.mock('../TvPortrait', () => ({
  TvPortrait: ({ src, silhouette }: { src: string; silhouette?: boolean }) => (
    <img alt="portrait" src={src} data-silhouette={silhouette ? 'yes' : 'no'} />
  ),
}));

const player = { id: 3, name: 'GHOST', shape: 'rhombus', owner: 'ghost', description: 'Netrunner.' };
const enemy = { id: 9, name: 'GANGER', shape: 'enemy_rhombus', owner: null, description: 'Tyger Claw.' };

const makeSocket = () => {
  const handlers: Record<string, (d: any) => void> = {};
  return {
    handlers,
    on: vi.fn((ev: string, fn: (d: any) => void) => { handlers[ev] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
  };
};

const show = (over: Partial<React.ComponentProps<typeof TokenWindow>> = {}) => render(
  <TokenWindow
    location={player}
    title="ID: GHOST"
    pos={{ x: 0, y: 0 }}
    setPos={vi.fn()}
    onClose={vi.fn()}
    portrait={null}
    description="Netrunner."
    actions={[]}
    playerUsername={null}
    socket={makeSocket()}
    defense={null}
    canEditDefense={false}
    combat={null}
    {...over}
  />,
);

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);
const panel = () => screen.getByRole('tabpanel');

describe('which folders a viewer gets', () => {
  it('is only INFO when nothing else was handed over', () => {
    show();
    expect(tabs()).toEqual(['INFO']);
    expect(panel()).toHaveTextContent('Netrunner.');
  });

  it('adds ID for a player\'s token, DEFENSE where given, COMBAT where there is combat', () => {
    show({
      playerUsername: 'ghost',
      defense: { label: 'AC', melee: 14, ranged: null },
      combat: { active: false, status: null, lastResult: null },
    });
    expect(tabs()).toEqual(['INFO', 'ID', 'DEFENSE', 'COMBAT']);
  });
});

describe('GM notes on an NPC token', () => {
  it('are a folder only when the main admin token is handed over', () => {
    show({ location: enemy });
    expect(screen.queryByRole('tab', { name: 'GM NOTES' })).toBeNull();
  });

  it('are fetched for that token with the admin token when opened', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ notes: 'Owes Vic money.' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      show({ location: enemy, gmNotesToken: 'admintoken' });
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('tab', { name: 'GM NOTES' }));
      expect(await screen.findByText('Owes Vic money.')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith('/api/locations/9/gm-notes', { headers: { Authorization: 'Bearer admintoken' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the ID folder', () => {
  it('asks the server for the public card and shows it', () => {
    const socket = makeSocket();
    show({ playerUsername: 'ghost', socket });
    fireEvent.click(screen.getByRole('tab', { name: 'ID' }));
    expect(socket.emit).toHaveBeenCalledWith('requestQuickSheet', { username: 'ghost' });
    act(() => socket.handlers.quickSheetData({ username: 'ghost', exists: true, fields: { handle: 'Ghost', role: 'Netrunner' } }));
    expect(panel()).toHaveTextContent('HANDLEGHOST');
    expect(panel()).toHaveTextContent('ROLENETRUNNER');
  });

  it('ignores an answer about somebody else', () => {
    const socket = makeSocket();
    show({ playerUsername: 'ghost', socket });
    fireEvent.click(screen.getByRole('tab', { name: 'ID' }));
    act(() => socket.handlers.quickSheetData({ username: 'viper', exists: true, fields: { handle: 'Viper' } }));
    expect(panel()).toHaveTextContent('FETCHING_IDENT');
  });

  it('says so when there is no sheet on file', () => {
    const socket = makeSocket();
    show({ playerUsername: 'ghost', socket });
    fireEvent.click(screen.getByRole('tab', { name: 'ID' }));
    act(() => socket.handlers.quickSheetData({ username: 'ghost', exists: false }));
    expect(panel()).toHaveTextContent('NO_IDENT_ON_FILE');
  });
});

describe('the DEFENSE folder', () => {
  const defense = { label: 'AC', melee: 14, ranged: null };

  it('shows ranged as the melee value when none is set', () => {
    show({ defense });
    fireEvent.click(screen.getByRole('tab', { name: 'DEFENSE' }));
    expect(panel()).toHaveTextContent('MELEE_AC14');
    expect(panel()).toHaveTextContent('14 (melee)');
  });

  it('cannot be edited by the owner', () => {
    show({ defense, canEditDefense: false });
    fireEvent.click(screen.getByRole('tab', { name: 'DEFENSE' }));
    expect(screen.queryByRole('button', { name: 'EDIT_AC' })).toBeNull();
  });

  it('is edited and saved by the GM, blank ranged meaning none', async () => {
    const onSaveDefense = vi.fn();
    show({ defense, canEditDefense: true, onSaveDefense });
    await userEvent.click(screen.getByRole('tab', { name: 'DEFENSE' }));
    await userEvent.click(screen.getByRole('button', { name: 'EDIT_AC' }));
    const melee = screen.getByLabelText('Melee AC');
    await userEvent.clear(melee);
    await userEvent.type(melee, '16');
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));
    expect(onSaveDefense).toHaveBeenCalledWith(16, null);
  });
});

describe('the COMBAT folder', () => {
  it('shows how the last attack went, in the theme\'s colors', () => {
    show({ combat: { active: false, status: null, lastResult: { hit: true, roll: 17, damage: 8, through: 5 } } });
    fireEvent.click(screen.getByRole('tab', { name: 'COMBAT' }));
    const result = screen.getByTestId('attack-result');
    expect(result).toHaveTextContent('HIT! — rolled 17 · DMG 8 (5 through armor)');
    expect(result.style.color).toBe('var(--green)');
  });

  it('opens itself when an attack against this token starts', () => {
    const { rerender } = show({ combat: { active: false, status: null, lastResult: null } });
    expect(screen.getByRole('tab', { name: 'INFO' })).toHaveAttribute('aria-selected', 'true');
    rerender(
      <TokenWindow location={player} title="ID: GHOST" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
        portrait={null} description="" actions={[]} playerUsername={null} socket={makeSocket()}
        defense={null} canEditDefense={false}
        combat={{ active: true, status: 'SELECT_WEAPON — DICE_ROLLER', lastResult: null }} />,
    );
    expect(screen.getByRole('tab', { name: 'COMBAT' })).toHaveAttribute('aria-selected', 'true');
    expect(panel()).toHaveTextContent('SELECT_WEAPON');
  });

  it('lets the GM add a sheetless NPC to initiative, with a real score only', async () => {
    const onAddToInit = vi.fn();
    show({ location: enemy, combat: { active: false, status: null, lastResult: null, onAddToInit } });
    await userEvent.click(screen.getByRole('tab', { name: 'COMBAT' }));
    const add = screen.getByRole('button', { name: 'ADD TO INIT' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Initiative score'), '12');
    await userEvent.click(add);
    expect(onAddToInit).toHaveBeenCalledWith(12);
  });
});

describe('the picture', () => {
  it('is the portrait, with its silhouette setting passed through', () => {
    show({ portrait: { src: '/p.png', silhouette: true } });
    expect(screen.getByTestId('token-preview')).toHaveAttribute('data-kind', 'portrait');
    expect(screen.getByRole('img', { name: 'portrait' })).toHaveAttribute('data-silhouette', 'yes');
  });

  it('is a token in its side\'s color when there is none', () => {
    show({ location: enemy });
    expect(screen.getByTestId('token-preview')).toHaveAttribute('data-kind', 'token');
    expect(screen.getByRole('img', { name: 'Token' }).style.color).toBe('var(--danger)');
  });
});

it('offers the GM the sheet tier in INFO for an NPC with no sheet', async () => {
  const onChange = vi.fn();
  show({ location: enemy, tierPicker: { tiers: [{ id: 'mook', label: 'Mook' }, { id: 'boss', label: 'Boss' }], value: 'mook', onChange } });
  await userEvent.selectOptions(screen.getByLabelText('NPC tier'), 'boss');
  expect(onChange).toHaveBeenCalledWith('boss');
});
