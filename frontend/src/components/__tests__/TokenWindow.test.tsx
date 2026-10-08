/**
 * A token's window, in the terminal style.
 *
 * Which folders exist, and which health panel sits in HEALTH, is decided by the caller from
 * tokenView() - tested in tokenActions.test.ts - so these check that the window shows
 * exactly what it is given and that the GM's own controls do what they say.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenWindow } from '../TokenWindow';
import { registerCustomTemplate } from '../../sheets/customTemplates';

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

const baseProps = (): React.ComponentProps<typeof TokenWindow> => ({
  location: player,
  title: 'ID: GHOST',
  pos: { x: 0, y: 0 },
  setPos: vi.fn(),
  onClose: vi.fn(),
  portrait: null,
  description: 'Netrunner.',
  actions: [],
  operator: null,
  socket: makeSocket(),
  health: <div>HEALTH PANEL</div>,
});

const show = (over: Partial<React.ComponentProps<typeof TokenWindow>> = {}) => render(
  <TokenWindow {...baseProps()} {...over} />,
);

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);
const panel = () => screen.getByRole('tabpanel');
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('which folders a viewer gets', () => {
  it('is INFO and HEALTH when nothing else was handed over', () => {
    show();
    expect(tabs()).toEqual(['INFO', 'HEALTH']);
    expect(panel()).toHaveTextContent('Netrunner.');
  });

  it('adds QUICK ACTIONS for your own token and GM NOTES for the main admin', () => {
    show({ quickActions: <div>ROLLS</div>, gmNotesToken: 'admintoken' });
    expect(tabs()).toEqual(['INFO', 'HEALTH', 'QUICK ACTIONS', 'GM NOTES']);
  });

  it('has no ID, DEFENSE or COMBAT folder any more', () => {
    show({ operator: 'ghost', quickActions: <div />, gmNotesToken: 't' });
    for (const gone of ['ID', 'DEFENSE', 'COMBAT']) expect(screen.queryByRole('tab', { name: gone })).toBeNull();
  });

  it('shows what it was handed in HEALTH and QUICK ACTIONS', () => {
    show({ quickActions: <div>ROLLS HERE</div> });
    openTab('HEALTH');
    expect(panel()).toHaveTextContent('HEALTH PANEL');
    openTab('QUICK ACTIONS');
    expect(panel()).toHaveTextContent('ROLLS HERE');
  });
});

describe('INFO', () => {
  it("heads a player's token with the player's name, and an NPC's with its side", () => {
    const { unmount } = show({ operator: 'ghost' });
    expect(screen.getByText('GHOST · DATA')).toBeInTheDocument();
    unmount();
    show({ location: enemy });
    expect(screen.getByText('ENEMY · DATA')).toBeInTheDocument();
  });

  it("starts with the player's public handle and role, asked of the server", () => {
    const socket = makeSocket();
    show({ operator: 'ghost', socket });
    expect(socket.emit).toHaveBeenCalledWith('requestQuickSheet', { username: 'ghost' });
    act(() => socket.handlers.quickSheetData({ username: 'ghost', exists: true, fields: { handle: 'Ghost', role: 'Netrunner' } }));
    const lines = screen.getByTestId('id-lines');
    expect(lines).toHaveTextContent('HANDLEGHOST');
    expect(lines).toHaveTextContent('ROLENETRUNNER');
    // Before the description, not instead of it.
    expect(panel()).toHaveTextContent('Netrunner.');
  });

  describe('in a custom system (4b3e)', () => {
    const SYS = 'sys_cccccccccccccccc';
    const sheet = { header: { nameField: 'name' }, sections: [{ id: 'who', label: 'WHO', layout: 'list' as const, fields: [
      { id: 'reputation', label: 'Reputation', type: 'number' as const, visibility: 'public' as const },
      { id: 'name', label: 'Callsign', type: 'text' as const, visibility: 'public' as const },
      { id: 'secret', label: 'Secret', type: 'text' as const },
      { id: 'ward', label: 'Ward', type: 'number' as const, sensitivity: 'combat' as const },
      { id: 'creed', label: 'Creed', type: 'text' as const, visibility: 'public' as const },
    ] }] };
    const answer = (socket: ReturnType<typeof makeSocket>, fields: Record<string, unknown>) =>
      act(() => socket.handlers.quickSheetData({ username: 'ghost', exists: true, fields }));

    it('shows the name, then every EVERYONE field by its own label, a dash for one not filled in', () => {
      registerCustomTemplate({ id: SYS, name: 'Hearth', words: {}, parts: {}, derived: [], sheet });
      const socket = makeSocket();
      show({ operator: 'ghost', socket, gameSystem: SYS });
      // What the server sends: only fields marked public, never one deciding hits.
      answer(socket, { name: 'Ash', reputation: 0, creed: '' });
      const lines = screen.getByTestId('id-lines');
      expect([...lines.children].map((l) => l.textContent)).toEqual(['CALLSIGNAsh', 'REPUTATION0', 'CREED—']);
      expect(panel()).toHaveTextContent('Netrunner.');
    });

    it('never shows a private field or an attack number, whatever arrives', () => {
      registerCustomTemplate({ id: SYS, name: 'Hearth', words: {}, parts: {}, derived: [], sheet });
      const socket = makeSocket();
      show({ operator: 'ghost', socket, gameSystem: SYS });
      answer(socket, { name: 'Ash', secret: 'debts', ward: 14 });
      expect(screen.getByTestId('id-lines')).not.toHaveTextContent('debts');
      expect(screen.getByTestId('id-lines')).not.toHaveTextContent('14');
      expect(screen.getByTestId('id-lines')).not.toHaveTextContent('WARD');
    });

    it('leaves a built-in system\'s handle and role exactly as they were', () => {
      const socket = makeSocket();
      show({ operator: 'ghost', socket, gameSystem: 'cyberpunk_red' });
      answer(socket, { handle: 'Ghost', name: 'Ada', role: 'Netrunner' });
      expect([...screen.getByTestId('id-lines').children].map((l) => l.textContent)).toEqual(['HANDLEGHOST', 'NAMEAda', 'ROLENETRUNNER']);
    });
  });

  it('ignores an answer about somebody else, and shows nothing extra without a sheet', () => {
    const socket = makeSocket();
    show({ operator: 'ghost', socket });
    act(() => socket.handlers.quickSheetData({ username: 'viper', exists: true, fields: { handle: 'Viper' } }));
    expect(screen.queryByTestId('id-lines')).toBeNull();
    act(() => socket.handlers.quickSheetData({ username: 'ghost', exists: false }));
    expect(screen.queryByTestId('id-lines')).toBeNull();
  });

  it('does not ask about a player for an NPC', () => {
    const socket = makeSocket();
    show({ location: enemy, socket });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('offers the GM the sheet tier for an NPC with no sheet', async () => {
    const onChange = vi.fn();
    show({ location: enemy, tierPicker: { tiers: [{ id: 'mook', label: 'Mook' }, { id: 'boss', label: 'Boss' }], value: 'mook', onChange } });
    await userEvent.selectOptions(screen.getByLabelText('NPC tier'), 'boss');
    expect(onChange).toHaveBeenCalledWith('boss');
    // A built-in system's tiers take no level.
    expect(screen.queryByLabelText('NPC level')).toBeNull();
  });

  it('asks a custom system\'s GM for the level too, from 0 to 99 (4b4e)', () => {
    const onLevelChange = vi.fn();
    show({ location: enemy, tierPicker: { tiers: [{ id: 'mook', label: 'Mook' }], value: 'mook', onChange: vi.fn(), level: 3, onLevelChange } });
    const level = screen.getByLabelText('NPC level') as HTMLInputElement;
    expect(level.value).toBe('3');
    fireEvent.change(level, { target: { value: '6' } });
    fireEvent.change(level, { target: { value: '250' } });
    fireEvent.change(level, { target: { value: '-4' } });
    fireEvent.change(level, { target: { value: '' } });
    expect(onLevelChange.mock.calls).toEqual([[6], [99], [0]]);
  });
});

describe("the GM's part of HEALTH", () => {
  const defense = { label: 'AC', melee: 14, ranged: null };

  it('is not there for anyone else', () => {
    show();
    openTab('HEALTH');
    expect(screen.queryByRole('button', { name: 'EDIT_AC' })).toBeNull();
    expect(screen.queryByLabelText('Initiative score')).toBeNull();
  });

  it('shows ranged as the melee value when none is set', () => {
    show({ gmHealth: { defense, onSaveDefense: vi.fn() } });
    openTab('HEALTH');
    expect(panel()).toHaveTextContent('MELEE_AC14');
    expect(panel()).toHaveTextContent('14 (melee)');
  });

  it('edits and saves defense, blank ranged meaning none', async () => {
    const onSaveDefense = vi.fn();
    show({ gmHealth: { defense, onSaveDefense } });
    await userEvent.click(screen.getByRole('tab', { name: 'HEALTH' }));
    await userEvent.click(screen.getByRole('button', { name: 'EDIT_AC' }));
    const melee = screen.getByLabelText('Melee AC');
    await userEvent.clear(melee);
    await userEvent.type(melee, '16');
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));
    expect(onSaveDefense).toHaveBeenCalledWith(16, null);
  });

  it('CANCEL leaves defense as it was', async () => {
    const onSaveDefense = vi.fn();
    show({ gmHealth: { defense, onSaveDefense } });
    await userEvent.click(screen.getByRole('tab', { name: 'HEALTH' }));
    await userEvent.click(screen.getByRole('button', { name: 'EDIT_AC' }));
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(onSaveDefense).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'EDIT_AC' })).toBeInTheDocument();
  });

  it('adds a sheetless NPC to initiative, with a real score only', async () => {
    const onAddToInit = vi.fn();
    show({ location: enemy, gmHealth: { defense, onSaveDefense: vi.fn(), onAddToInit } });
    await userEvent.click(screen.getByRole('tab', { name: 'HEALTH' }));
    const add = screen.getByRole('button', { name: 'ADD TO INIT' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Initiative score'), '12');
    await userEvent.click(add);
    expect(onAddToInit).toHaveBeenCalledWith(12);
  });
});

describe('an attack being set up', () => {
  it('is one line above the buttons, in whichever folder is open', () => {
    show({ attackStatus: 'SELECT_WEAPON — DICE_ROLLER' });
    expect(screen.getByTestId('attack-status')).toHaveTextContent('SELECT_WEAPON');
    openTab('HEALTH');
    expect(screen.getByTestId('attack-status')).toHaveTextContent('SELECT_WEAPON');
  });

  it('is not there when there is none', () => {
    show();
    expect(screen.queryByTestId('attack-status')).toBeNull();
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

describe('the picture', () => {
  it('is the portrait, with its silhouette setting passed through', () => {
    show({ portrait: { src: '/p.png', silhouette: true } });
    expect(screen.getByTestId('token-preview')).toHaveAttribute('data-kind', 'portrait');
    expect(screen.getByRole('img', { name: 'portrait' })).toHaveAttribute('data-silhouette', 'yes');
  });

  it("is a token in its side's color when there is none", () => {
    show({ location: enemy });
    expect(screen.getByTestId('token-preview')).toHaveAttribute('data-kind', 'token');
    expect(screen.getByRole('img', { name: 'Token' }).style.color).toBe('var(--danger)');
  });
});

describe('opening a folder on request', () => {
  it('opens HEALTH when HIT_POINTS asks, and again after switching away', () => {
    const props = { ...baseProps() };
    const { rerender } = render(<TokenWindow {...props} folderRequest={{ folder: 'health', seq: 1 }} />);
    expect(screen.getByRole('tab', { name: 'HEALTH' })).toHaveAttribute('aria-selected', 'true');
    openTab('INFO');
    rerender(<TokenWindow {...props} folderRequest={{ folder: 'health', seq: 2 }} />);
    expect(screen.getByRole('tab', { name: 'HEALTH' })).toHaveAttribute('aria-selected', 'true');
  });

  it('wins over the reset to INFO when the request comes with another token', () => {
    const props = { ...baseProps() };
    const { rerender } = render(<TokenWindow {...props} />);
    rerender(<TokenWindow {...props} location={enemy} folderRequest={{ folder: 'health', seq: 1 }} />);
    expect(screen.getByRole('tab', { name: 'HEALTH' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says which folder is open, so the sidebar can light HIT_POINTS', () => {
    const onFolderChange = vi.fn();
    render(<TokenWindow {...baseProps()} onFolderChange={onFolderChange} />);
    expect(onFolderChange).toHaveBeenLastCalledWith('info');
    openTab('HEALTH');
    expect(onFolderChange).toHaveBeenLastCalledWith('health');
  });
});
