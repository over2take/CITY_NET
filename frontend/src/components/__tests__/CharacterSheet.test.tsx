import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { CharacterSheetWindow } from '../CharacterSheetWindow';
import { getTemplate, TEMPLATES } from '../../sheets';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title, titleControls }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      <div data-testid="title-controls">{titleControls}</div>
      {children}
    </div>
  ),
}));

const basePos = { x: 0, y: 0 };
const setPos = vi.fn();
const onClose = vi.fn();
const makeSocket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

beforeEach(() => vi.clearAllMocks());

// ─── Template registry ────────────────────────────────────────────────────────

describe('template registry', () => {
  it('resolves known systems', () => {
    expect(getTemplate('cyberpunk_red').name).toBe('Cyberpunk RED');
    expect(getTemplate('generic').name).toBe('Generic');
  });

  it('falls back to generic for unknown systems', () => {
    expect(getTemplate('who_knows').id).toBe('generic');
  });

  it('every field id is unique within its template', () => {
    Object.values(TEMPLATES).forEach(template => {
      const ids = template.sections.flatMap(s => s.fields.map(f => f.id));
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('every skill stat reference points at a real field', () => {
    Object.values(TEMPLATES).forEach(template => {
      const ids = new Set(template.sections.flatMap(s => s.fields.map(f => f.id)));
      template.sections.flatMap(s => s.fields).forEach(f => {
        if (f.stat) expect(ids.has(f.stat)).toBe(true);
        if (f.maxField) expect(ids.has(f.maxField)).toBe(true);
      });
    });
  });
});

// ─── SheetRenderer ────────────────────────────────────────────────────────────

describe('SheetRenderer', () => {
  const template = getTemplate('cyberpunk_red');

  it('renders section headers', () => {
    render(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} />);
    expect(screen.getByText(/IDENTITY/)).toBeInTheDocument();
    expect(screen.getByText(/STATS/)).toBeInTheDocument();
  });

  it('renders open-section fields and calls onFieldChange on edit', async () => {
    const onFieldChange = vi.fn();
    render(<SheetRenderer template={template} data={{}} onFieldChange={onFieldChange} />);
    const handle = screen.getByLabelText('Handle');
    await userEvent.type(handle, 'V');
    expect(onFieldChange).toHaveBeenCalledWith('handle', 'V');
  });

  it('computes skill BASE as level + stat', async () => {
    const data = { dex: 6, athletics: 2 };
    render(<SheetRenderer template={template} data={data} onFieldChange={vi.fn()} />);
    // open the BODY skills section
    await userEvent.click(screen.getByText(/─── BODY ───/));
    const row = screen.getByLabelText('Athletics').closest('div');
    expect(row?.textContent).toContain('8');
  });

  it('collapsed sections render no fields', () => {
    render(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} />);
    // LIFEPATH is far down the template, collapsed by default
    expect(screen.queryByLabelText(/Lifepath/)).not.toBeInTheDocument();
  });
});

// ─── CharacterSheetWindow ─────────────────────────────────────────────────────

describe('CharacterSheetWindow', () => {
  it('requests the sheet on mount and shows loading state', () => {
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
    expect(screen.getByText('ACCESSING RECORD...')).toBeInTheDocument();
  });

  it('renders the sheet when sheetData arrives, with system badge', () => {
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    const onSheetData = socket.on.mock.calls.find((c: any) => c[0] === 'sheetData')[1];
    act(() => onSheetData({ id: 1, username: 'GHOST', system: 'cyberpunk_red', data: { handle: 'GHOST' }, portrait_url: null, is_npc: 0 }));
    expect(screen.getByTestId('window-title').textContent).toBe('CHARACTER_SHEET // GHOST');
    expect(screen.getByTestId('title-controls').textContent).toContain('CYBERPUNK RED');
    expect(screen.getByLabelText('Handle')).toHaveValue('GHOST');
  });

  it('ignores sheetData for other users', () => {
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    const onSheetData = socket.on.mock.calls.find((c: any) => c[0] === 'sheetData')[1];
    act(() => onSheetData({ id: 2, username: 'VIPER', system: 'generic', data: {}, portrait_url: null, is_npc: 0 }));
    expect(screen.getByText('ACCESSING RECORD...')).toBeInTheDocument();
  });

  it('emits debounced updateSheetField on edit', () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    const onSheetData = socket.on.mock.calls.find((c: any) => c[0] === 'sheetData')[1];
    act(() => onSheetData({ id: 1, username: 'GHOST', system: 'generic', data: {}, portrait_url: null, is_npc: 0 }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'GH' } });

    expect(socket.emit).not.toHaveBeenCalledWith('updateSheetField', expect.anything());
    act(() => { vi.advanceTimersByTime(500); });
    expect(socket.emit).toHaveBeenCalledWith('updateSheetField', { fieldId: 'name', value: 'GH' });
    vi.useRealTimers();
  });

  it('re-requests the sheet when sheetUpdated arrives for this user', () => {
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    socket.emit.mockClear();
    const onSheetUpdated = socket.on.mock.calls.find((c: any) => c[0] === 'sheetUpdated')[1];
    act(() => onSheetUpdated({ username: 'GHOST' }));
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
    act(() => onSheetUpdated({ username: 'VIPER' }));
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('cleans up socket listeners on unmount', () => {
    const socket = makeSocket();
    const { unmount } = render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('sheetData', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('sheetUpdated', expect.any(Function));
  });
});
