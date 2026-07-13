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
    expect(screen.getByTestId('window-title').textContent).toBe('NPC_LIBRARY');
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
