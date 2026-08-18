import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportSheetDialog } from '../ImportSheetDialog';

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

const mockFetch = (response: any, ok = true) => {
  global.fetch = vi.fn().mockResolvedValue({ ok, json: async () => response });
};

beforeEach(() => vi.clearAllMocks());

describe('ImportSheetDialog', () => {
  it('previews pasted JSON and shows mapped fields', async () => {
    mockFetch({ system: 'cyberpunk_red', source: 'json', mapped: { ref: 7, handgun: 5 }, unmapped: {}, skipped: {} });
    render(<ImportSheetDialog pos={basePos} setPos={setPos} onClose={onClose} onApply={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/ref/i), { target: { value: '{"ref":7,"handgun":5}' } });
    fireEvent.click(screen.getByText('PREVIEW'));
    await waitFor(() => expect(screen.getByText(/2 FIELDS RECOGNIZED/)).toBeTruthy());
    expect((global.fetch as any).mock.calls[0][1].body).toContain('json');
  });

  it('sends non-JSON paste as text', async () => {
    mockFetch({ system: 'cyberpunk_red', source: 'text', mapped: { ref: 7 }, unmapped: {}, skipped: {} });
    render(<ImportSheetDialog pos={basePos} setPos={setPos} onClose={onClose} onApply={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/ref/i), { target: { value: 'REF 7' } });
    fireEvent.click(screen.getByText('PREVIEW'));
    await waitFor(() => expect(screen.getByText(/1 FIELD RECOGNIZED/)).toBeTruthy());
    expect((global.fetch as any).mock.calls[0][1].body).toContain('"text"');
  });

  it('opens the preview in its own window and applies from there', async () => {
    // The preview is what a player has to read before a destructive choice, so it gets a
    // window rather than a block below three inputs in a pane that scrolls.
    mockFetch({ system: 'cyberpunk_red', source: 'json', mapped: { ref: 7 }, unmapped: {}, skipped: {} });
    const onApply = vi.fn();
    render(<ImportSheetDialog pos={basePos} setPos={setPos} onClose={onClose} onApply={onApply} />);
    fireEvent.change(screen.getByPlaceholderText(/ref/i), { target: { value: '{"ref":7}' } });
    fireEvent.click(screen.getByText('PREVIEW'));

    await waitFor(() => expect(screen.getAllByTestId('window-title').map(n => n.textContent))
      .toContain('IMPORT_PREVIEW'));
    fireEvent.click(screen.getByText(/REPLACE SHEET WITH 1 FIELDS/));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ ref: 7 }, { replace: true }));
    await waitFor(() => expect(screen.getByText('✓ APPLIED')).toBeTruthy());
  });

  it('shows server errors and skipped linked fields', async () => {
    mockFetch({ error: 'No importer for generic yet' }, false);
    render(<ImportSheetDialog pos={basePos} setPos={setPos} onClose={onClose} onApply={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/ref/i), { target: { value: '{"x":1}' } });
    fireEvent.click(screen.getByText('PREVIEW'));
    await waitFor(() => expect(screen.getByText(/No importer/)).toBeTruthy());
  });
});

/**
 * The Companion code.
 *
 * Offered only under Cyberpunk RED, because the Companion is a Cyberpunk tool — a button
 * that could only ever fail is worse than no button. Everything else about it is the same
 * as the other two sources: a preview, then APPLY, and nothing written before that.
 */
describe('the Companion code', () => {
  const open = (gameSystem?: string) =>
    render(
      <ImportSheetDialog
        pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
        onApply={vi.fn()} gameSystem={gameSystem}
      />
    );

  it('is offered under Cyberpunk RED', () => {
    open('cyberpunk_red');
    expect(screen.getByLabelText('Companion code')).toBeInTheDocument();
    expect(screen.getByText(/cyberpunkred\.com/)).toBeInTheDocument();
  });

  it('is not offered under any other system', () => {
    open('cities_without_number');
    expect(screen.queryByLabelText('Companion code')).not.toBeInTheDocument();
  });

  it('keeps the box to six letters and digits, upper-cased', async () => {
    open('cyberpunk_red');
    const box = screen.getByLabelText('Companion code') as HTMLInputElement;
    await userEvent.type(box, '6lz-kp7xyz');
    expect(box.value).toBe('6LZKP7');
  });

  it('will not fetch until there are six characters', async () => {
    open('cyberpunk_red');
    expect(screen.getByText('FETCH')).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Companion code'), '6LZKP7');
    expect(screen.getByText('FETCH')).toBeEnabled();
  });

  it('previews what came back, and applies nothing on its own', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        system: 'cyberpunk_red', source: 'companion',
        mapped: { name: 'Nyx', int: 8 }, unmapped: {}, skipped: {},
        missing: ['vehicle SDP, SP and seats'],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onApply = vi.fn();
    render(
      <ImportSheetDialog
        pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
        onApply={onApply} gameSystem="cyberpunk_red"
      />
    );

    await userEvent.type(screen.getByLabelText('Companion code'), '6LZKP7');
    await userEvent.click(screen.getByText('FETCH'));

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/import/companion', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/2 FIELDS RECOGNIZED/)).toBeInTheDocument();
    // The gap the export could not fill, said plainly rather than left to be noticed.
    expect(screen.getByText(/TYPE IN YOURSELF/)).toHaveTextContent('vehicle SDP');
    expect(onApply).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('says the backend may need restarting when the reply is not JSON', async () => {
    // An unknown route falls through to the single-page app and answers with HTML. Calling
    // that a network problem sends someone hunting the wrong fault entirely.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => { throw new Error('unexpected token <'); },
    })));
    open('cyberpunk_red');
    await userEvent.type(screen.getByLabelText('Companion code'), '6LZKP7');
    await userEvent.click(screen.getByText('FETCH'));
    expect(await screen.findByText(/needs restarting/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows the reason the server gave when a code does not resolve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'No character for that code. Check it and try exporting again.' }),
    })));
    open('cyberpunk_red');
    await userEvent.type(screen.getByLabelText('Companion code'), 'ZZZZZZ');
    await userEvent.click(screen.getByText('FETCH'));
    expect(await screen.findByText(/No character for that code/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

/**
 * Applying replaces the sheet.
 *
 * That is destructive by design — a merge leaves a skill you dropped at the source sitting
 * on the sheet forever — so the confirmation is not a formality. It names what will be lost
 * by field, because "are you sure?" tells a player nothing they can act on and
 * "you will lose weapon2_dmg" tells them exactly what to write down.
 */
describe('replacing rather than merging', () => {
  const preview = {
    system: 'cyberpunk_red', source: 'companion',
    mapped: { name: 'Nyx', int: 8 }, unmapped: {}, skipped: {},
  };

  const openWith = (currentData: Record<string, unknown>, onApply = vi.fn()) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => preview })));
    render(
      <ImportSheetDialog
        pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
        onApply={onApply} gameSystem="cyberpunk_red" currentData={currentData}
      />
    );
    return onApply;
  };

  const getPreview = async () => {
    await userEvent.type(screen.getByLabelText('Companion code'), '6LZKP7');
    await userEvent.click(screen.getByText('FETCH'));
    await screen.findByText(/FIELDS RECOGNIZED/);
  };

  it('says plainly that it replaces, before anything is applied', async () => {
    const onApply = openWith({ weapon2_dmg: '3d6' });
    await getPreview();
    expect(screen.getByText(/THIS REPLACES THE SHEET/)).toBeInTheDocument();
    // Reaching the preview is not applying it.
    expect(onApply).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('names the fields that would be lost, rather than just warning', async () => {
    openWith({ weapon2_dmg: '3d6', vehicle1_hp_max: 50, int: 4 });
    await getPreview();

    const loss = screen.getByText(/YOU WILL LOSE/);
    expect(loss).toHaveTextContent('weapon2_dmg');
    expect(loss).toHaveTextContent('vehicle1_hp_max');
    // `int` is in the import, so it is overwritten rather than lost.
    expect(loss).not.toHaveTextContent('int');
    vi.unstubAllGlobals();
  });

  it('does not count occupancy as a loss, because it survives', async () => {
    // Which car you are sitting in is not character data, and re-importing a sheet is not
    // a statement about it. The server keeps it; the warning must not claim otherwise.
    openWith({ in_vehicle: 'own:1', vehicle_seat: 'driver' });
    await getPreview();
    expect(screen.getByText(/Nothing on the sheet would be lost/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('cancels without applying, and closes the window', async () => {
    const onApply = openWith({ weapon2_dmg: '3d6' });
    await getPreview();
    await userEvent.click(screen.getByText('CANCEL'));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText(/THIS REPLACES THE SHEET/)).not.toBeInTheDocument();
    // The import dialog is still there to try again from.
    expect(screen.getByLabelText('Companion code')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('replaces when told to, naming the count on the button', async () => {
    const onApply = openWith({ weapon2_dmg: '3d6' });
    await getPreview();
    await userEvent.click(screen.getByText(/REPLACE SHEET WITH 2 FIELDS/));

    expect(onApply).toHaveBeenCalledWith({ name: 'Nyx', int: 8 }, { replace: true });
    vi.unstubAllGlobals();
  });
});
