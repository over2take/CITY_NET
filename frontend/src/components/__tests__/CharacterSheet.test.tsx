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

  it('frontend roll formulas match the server roll map exactly (no drift)', async () => {
    // The server is roll-authoritative; the frontend formulas are display
    // copies. This guards the two definitions against diverging.
    const { ROLLS } = await import('../../../../backend/sheets/rolls.js');
    Object.entries(TEMPLATES).forEach(([systemId, template]) => {
      const serverRolls = ROLLS[systemId] ?? {};
      const frontendRollFields = template.sections.flatMap(s => s.fields).filter(f => f.roll);
      frontendRollFields.forEach(f => {
        expect(serverRolls[f.id], `server roll map missing ${systemId}.${f.id}`).toBeTruthy();
        expect(serverRolls[f.id].formula).toBe(f.roll!.formula);
      });
      // And nothing rollable server-side that the sheet can't click
      Object.keys(serverRolls).forEach(fieldId => {
        expect(frontendRollFields.some(f => f.id === fieldId), `frontend missing roll on ${systemId}.${fieldId}`).toBe(true);
      });
    });
  });
});

// ─── SheetRenderer ────────────────────────────────────────────────────────────

describe('SheetRenderer', () => {
  const template = getTemplate('cyberpunk_red');

  it('renders section headers and the tab bar', () => {
    render(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} />);
    expect(screen.getByText(/─── IDENTITY ───/)).toBeInTheDocument();
    expect(screen.getByText(/─── STATS ───/)).toBeInTheDocument();
    expect(screen.getByText('SKILLS')).toBeInTheDocument();
    expect(screen.getByText('GEAR')).toBeInTheDocument();
  });

  it('renders open-section fields and calls onFieldChange on edit', async () => {
    const onFieldChange = vi.fn();
    render(<SheetRenderer template={template} data={{}} onFieldChange={onFieldChange} />);
    const handle = screen.getByLabelText('Handle');
    await userEvent.type(handle, 'V');
    expect(onFieldChange).toHaveBeenCalledWith('handle', 'V');
  });

  it('computes skill BASE as level + stat on the SKILLS tab', async () => {
    const data = { dex: 6, athletics: 2 };
    render(<SheetRenderer template={template} data={data} onFieldChange={vi.fn()} />);
    await userEvent.click(screen.getByText('SKILLS'));
    const row = screen.getByLabelText('Athletics').closest('div');
    expect(row?.textContent).toContain('+8');
  });

  it('inactive tabs render no fields', () => {
    render(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} />);
    // LIFEPATH lives on the NOTES tab; STATS is active by default
    expect(screen.queryByLabelText(/Lifepath/)).not.toBeInTheDocument();
  });

  it('shows the identity header with name, HP bar, and chips', () => {
    const data = { handle: 'Viper', role: 'Rogue', hp: 27, hp_max: 38, move: 4, body: 6, luck: 5 };
    render(<SheetRenderer template={template} data={data} onFieldChange={vi.fn()} />);
    expect(screen.getByText('VIPER')).toBeInTheDocument();
    expect(screen.getByText('ROGUE')).toBeInTheDocument();
    expect(screen.getByText('27/38')).toBeInTheDocument();
    expect(screen.getAllByText(/MOVE/).length).toBeGreaterThan(0);
  });

  it('renders linked fields read-only with a LINKED marker (cash on GEAR tab)', async () => {
    render(<SheetRenderer template={template} data={{ cash: 250 }} onFieldChange={vi.fn()} />);
    await userEvent.click(screen.getByText('GEAR'));
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('LINKED')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cash (eb)')).not.toBeInTheDocument(); // no input
  });

  it('linked field click calls onOpenLink with its source', async () => {
    const onOpenLink = vi.fn();
    render(<SheetRenderer template={template} data={{ cash: 250 }} onFieldChange={vi.fn()} onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByText('GEAR'));
    await userEvent.click(screen.getByText('250'));
    expect(onOpenLink).toHaveBeenCalledWith('bank_balance');
  });

  it('HP bar click calls onOpenLink with token_hp', async () => {
    const onOpenLink = vi.fn();
    render(<SheetRenderer template={template} data={{ handle: 'V', hp: 10, hp_max: 20 }} onFieldChange={vi.fn()} onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByText('10/20'));
    expect(onOpenLink).toHaveBeenCalledWith('token_hp');
  });

  it('clicking a stat roll button calls onRoll with the field id', async () => {
    const onRoll = vi.fn();
    render(<SheetRenderer template={template} data={{ ref: 7 }} onFieldChange={vi.fn()} onRoll={onRoll} />);
    await userEvent.click(screen.getByLabelText('Roll REF'));
    expect(onRoll).toHaveBeenCalledWith('ref');
  });

  it('clicking a skill BASE calls onRoll; buttons disabled without onRoll', async () => {
    const onRoll = vi.fn();
    const { rerender } = render(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} onRoll={onRoll} />);
    await userEvent.click(screen.getByText('SKILLS'));
    await userEvent.click(screen.getByLabelText('Roll Handgun'));
    expect(onRoll).toHaveBeenCalledWith('handgun');

    rerender(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} />);
    expect(screen.getByLabelText('Roll Handgun')).toBeDisabled();
  });

  it('sections collapse on header click', async () => {
    render(<SheetRenderer template={template} data={{}} onFieldChange={vi.fn()} />);
    expect(screen.getByLabelText('Handle')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/─── IDENTITY ───/));
    expect(screen.queryByLabelText('Handle')).not.toBeInTheDocument();
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

  it('re-requests the sheet on bankUpdate for this user (cash mirror)', () => {
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    socket.emit.mockClear();
    const onBankUpdate = socket.on.mock.calls.find((c: any) => c[0] === 'bankUpdate')[1];
    act(() => onBankUpdate({ username: 'GHOST', balance: 500 }));
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
  });

  it('a sheet re-fetch does not stomp a field with a pending debounced edit', () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    const onSheetData = socket.on.mock.calls.find((c: any) => c[0] === 'sheetData')[1];
    act(() => onSheetData({ id: 1, username: 'GHOST', system: 'generic', data: { name: 'OLD' }, portrait_url: null, is_npc: 0 }));

    // Player types; debounce timer now pending on 'name'
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'NEW' } });
    // A re-fetch lands (e.g. HP changed) carrying the stale name
    act(() => onSheetData({ id: 1, username: 'GHOST', system: 'generic', data: { name: 'OLD', hp: 5 }, portrait_url: null, is_npc: 0 }));

    expect(screen.getByLabelText('Name')).toHaveValue('NEW'); // local edit preserved
    act(() => { vi.advanceTimersByTime(500); });
    expect(socket.emit).toHaveBeenCalledWith('updateSheetField', { fieldId: 'name', value: 'NEW' });
    vi.useRealTimers();
  });

  it('cleans up socket listeners on unmount', () => {
    const socket = makeSocket();
    const { unmount } = render(<CharacterSheetWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} userName="GHOST" />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('sheetData', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('sheetUpdated', expect.any(Function));
  });
});

// ─── Portrait upload ──────────────────────────────────────────────────────────

describe('SheetRenderer portrait upload', () => {
  const cyberpunkRed = getTemplate('cyberpunk_red');

  it('shows UPLOAD label when onPortraitUpload is provided', () => {
    const onUpload = vi.fn();
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST' }}
        onFieldChange={vi.fn()}
        onPortraitUpload={onUpload}
      />
    );
    expect(screen.getByText('UPLOAD')).toBeTruthy();
  });

  it('hides UPLOAD label when onPortraitUpload is absent', () => {
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST' }}
        onFieldChange={vi.fn()}
      />
    );
    expect(screen.queryByText('UPLOAD')).toBeNull();
  });

  it('calls onPortraitUpload with the selected file', () => {
    const onUpload = vi.fn();
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST' }}
        onFieldChange={vi.fn()}
        onPortraitUpload={onUpload}
      />
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['pixel'], 'avatar.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(onUpload).toHaveBeenCalledWith(file);
  });
});

// ─── LUCK pips ────────────────────────────────────────────────────────────────

describe('SheetRenderer LUCK pips', () => {
  const cyberpunkRed = getTemplate('cyberpunk_red');

  it('renders pip buttons equal to luck_max', () => {
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST', luck: 3, luck_max: 5 }}
        onFieldChange={vi.fn()}
      />
    );
    const pips = screen.getAllByRole('button', { name: /LUCK/ });
    expect(pips).toHaveLength(5);
  });

  it('filled pips match luck current value', () => {
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST', luck: 2, luck_max: 4 }}
        onFieldChange={vi.fn()}
      />
    );
    const spendable = screen.getAllByRole('button', { name: /Spend LUCK/ });
    expect(spendable).toHaveLength(2);
    const spent = screen.getAllByRole('button', { name: /LUCK spent/ });
    expect(spent).toHaveLength(2);
  });

  it('clicking a filled pip calls onFieldChange with luck - 1', () => {
    const onChange = vi.fn();
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST', luck: 3, luck_max: 5 }}
        onFieldChange={onChange}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Spend LUCK/ })[0]);
    expect(onChange).toHaveBeenCalledWith('luck', 2);
  });

  it('clicking a spent pip does nothing', () => {
    const onChange = vi.fn();
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST', luck: 2, luck_max: 4 }}
        onFieldChange={onChange}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: /LUCK spent/ })[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows RESET button when onResetLuck is provided', () => {
    const onReset = vi.fn();
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST', luck: 2, luck_max: 5 }}
        onFieldChange={vi.fn()}
        onResetLuck={onReset}
      />
    );
    const resetBtn = screen.getByTitle(/reset luck/i);
    expect(resetBtn).toBeTruthy();
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalled();
  });

  it('hides RESET button when onResetLuck is absent', () => {
    render(
      <SheetRenderer
        template={cyberpunkRed}
        data={{ handle: 'GHOST', luck: 2, luck_max: 5 }}
        onFieldChange={vi.fn()}
      />
    );
    expect(screen.queryByTitle(/reset luck/i)).toBeNull();
  });
});
