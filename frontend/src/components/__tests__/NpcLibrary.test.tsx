import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { NpcLibrary } from '../NpcLibrary';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  ),
}));

const basePos = { x: 0, y: 0 };
const setPos = vi.fn();
const onClose = vi.fn();
const TOKEN = 'fake-admin-token';

const mockFetch = (response: any, ok = true) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch([]);
});

describe('NpcLibrary', () => {
  it('renders title and shows loading then empty state', async () => {
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByTestId('window-title').textContent).toBe('NPC_LIBRARY.EXE');
    await waitFor(() => expect(screen.getByText(/NO NPC SHEETS/)).toBeTruthy());
  });

  it('fetches NPCs on mount', async () => {
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/sheets/npcs', expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } })));
  });

  it('displays NPC rows', async () => {
    mockFetch([
      { id: 1, npc_label: 'Gang Member', folder: null, portrait_url: null, updated_at: '' },
      { id: 2, npc_label: 'Fixer', folder: 'Contacts', portrait_url: null, updated_at: '' },
    ]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('GANG MEMBER')).toBeTruthy());
    expect(screen.getByText('FIXER')).toBeTruthy();
  });

  it('groups NPCs into folders', async () => {
    mockFetch([
      { id: 1, npc_label: 'Gang Member', folder: 'Gangs', portrait_url: null, updated_at: '' },
      { id: 2, npc_label: 'Booster', folder: 'Gangs', portrait_url: null, updated_at: '' },
    ]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/GANGS/)).toBeTruthy());
    expect(screen.getByText('GANG MEMBER')).toBeTruthy();
    expect(screen.getByText('BOOSTER')).toBeTruthy();
  });

  it('creates a new NPC on form submit', async () => {
    mockFetch([]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => screen.getByText(/NO NPC SHEETS/));

    const labelInput = screen.getByPlaceholderText(/Label/);
    fireEvent.change(labelInput, { target: { value: 'Fixer' } });

    // Now mock the POST + the subsequent GET
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 10, npc_label: 'Fixer', folder: null, system: 'cyberpunk_red' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 10, npc_label: 'Fixer', folder: null, portrait_url: null, updated_at: '' }] });

    const createBtn = screen.getByText('CREATE NPC');
    fireEvent.click(createBtn);

    await waitFor(() => {
      const postCall = (global.fetch as any).mock.calls[0];
      expect(postCall[0]).toBe('/api/sheets/npcs');
      expect(postCall[1].method).toBe('POST');
    });
  });

  it('shows ATTACH button when attachLocationId is provided', async () => {
    mockFetch([{ id: 1, npc_label: 'Gang Member', folder: null, portrait_url: null, updated_at: '' }]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} attachLocationId={42} />);
    await waitFor(() => expect(screen.getByText('ATTACH')).toBeTruthy());
  });

  it('does not show ATTACH button when attachLocationId is absent', async () => {
    mockFetch([{ id: 1, npc_label: 'Gang Member', folder: null, portrait_url: null, updated_at: '' }]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('GANG MEMBER')).toBeTruthy());
    expect(screen.queryByText('ATTACH')).toBeNull();
  });
});

describe('NpcLibrary OPEN button', () => {
  it('shows OPEN on each row when onOpenNpc is provided and calls it with the npc', async () => {
    mockFetch([
      { id: 7, npc_label: 'Gang Member', folder: null, portrait_url: null, updated_at: '' },
    ]);
    const onOpenNpc = vi.fn();
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} onOpenNpc={onOpenNpc} />);
    await waitFor(() => expect(screen.getByText('GANG MEMBER')).toBeTruthy());
    fireEvent.click(screen.getByText('OPEN'));
    expect(onOpenNpc).toHaveBeenCalledWith(expect.objectContaining({ id: 7, npc_label: 'Gang Member' }));
  });

  it('hides OPEN when onOpenNpc is absent', async () => {
    mockFetch([
      { id: 7, npc_label: 'Gang Member', folder: null, portrait_url: null, updated_at: '' },
    ]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('GANG MEMBER')).toBeTruthy());
    expect(screen.queryByText('OPEN')).toBeNull();
  });
});

describe('NpcLibrary MOVE to folder', () => {
  it('MOVE opens a folder select and PUTs the chosen folder', async () => {
    mockFetch([
      { id: 7, npc_label: 'Gang Member', folder: null, portrait_url: null, updated_at: '' },
      { id: 8, npc_label: 'Fixer', folder: 'Contacts', portrait_url: null, updated_at: '' },
    ]);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('GANG MEMBER')).toBeTruthy());
    fireEvent.click(screen.getAllByText('MOVE')[0]);
    const select = screen.getByLabelText('Move to folder') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('Contacts');
    expect(values).toContain('__none__');
    expect(values).toContain('__new__');
    fireEvent.change(select, { target: { value: 'Contacts' } });
    await waitFor(() => {
      const put = (global.fetch as any).mock.calls.find((c: any) => c[1]?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(put[0]).toBe('/api/sheets/npcs/7');
      expect(JSON.parse(put[1].body)).toEqual({ folder: 'Contacts' });
    });
  });
});

describe('NpcLibrary FIND and PLACE (2026-11-24: "selecting a specific generated or created NPC on demand")', () => {
  const LIB = [
    { id: 1, npc_label: 'Gang Member', folder: 'Tygers', portrait_url: null, updated_at: '' },
    { id: 2, npc_label: 'Gang Boss', folder: 'Tygers', portrait_url: null, updated_at: '' },
    { id: 3, npc_label: 'Fixer', folder: null, portrait_url: null, updated_at: '' },
  ];

  it('FIND narrows the list by name or folder, every word; Escape clears it; none found said so', async () => {
    mockFetch(LIB);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('FIXER')).toBeTruthy());
    const find = screen.getByLabelText('Find an NPC');
    fireEvent.change(find, { target: { value: 'tygers boss' } });
    expect(screen.getByText('GANG BOSS')).toBeTruthy();
    expect(screen.queryByText('GANG MEMBER')).toBeNull();
    expect(screen.queryByText('FIXER')).toBeNull();
    fireEvent.change(find, { target: { value: 'nobody' } });
    expect(screen.getByText(/NO NPC MATCHES “nobody”/)).toBeTruthy();
    fireEvent.keyDown(find, { key: 'Escape' });
    expect(screen.getByText('FIXER')).toBeTruthy();
    expect(screen.getByText('GANG MEMBER')).toBeTruthy();
  });

  it('PLACE AS ENEMY (to start) or FRIENDLY; PLACE on a row hands that NPC on, and says what happened', async () => {
    mockFetch(LIB);
    const onPlace = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('NOT PLACED: NO CONNECTION');
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} onPlace={onPlace} />);
    await waitFor(() => expect(screen.getByText('FIXER')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'ENEMY' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Place Fixer' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Placed' }).textContent).toBe('FIXER PLACED AS AN ENEMY IN THE MIDDLE OF YOUR VIEW'));
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), 'enemy');
    fireEvent.click(screen.getByRole('button', { name: 'FRIENDLY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place Gang Boss' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Placed' }).textContent).toBe('NOT PLACED: NO CONNECTION'));
    expect(onPlace).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }), 'friendly');
  });

  it('no PLACE without onPlace; how ATTACH works said with no token selected, not with one', async () => {
    mockFetch(LIB);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('FIXER')).toBeTruthy());
    expect(screen.queryByText('PLACE')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Place as' })).toBeNull();
    expect(screen.getByRole('note').textContent).toMatch(/select it there: ATTACH then shows on each row/);
    mockFetch(LIB);
    render(<NpcLibrary token={TOKEN} pos={basePos} setPos={setPos} onClose={onClose} attachLocationId={42} />);
    await waitFor(() => expect(screen.getAllByText('ATTACH').length).toBe(3));
    expect(screen.getAllByRole('note')).toHaveLength(1);
  });
});
