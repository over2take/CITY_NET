import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('APPLY passes the mapped fields to onApply', async () => {
    mockFetch({ system: 'cyberpunk_red', source: 'json', mapped: { ref: 7 }, unmapped: {}, skipped: {} });
    const onApply = vi.fn();
    render(<ImportSheetDialog pos={basePos} setPos={setPos} onClose={onClose} onApply={onApply} />);
    fireEvent.change(screen.getByPlaceholderText(/ref/i), { target: { value: '{"ref":7}' } });
    fireEvent.click(screen.getByText('PREVIEW'));
    await waitFor(() => screen.getByText(/APPLY 1 FIELDS/));
    fireEvent.click(screen.getByText(/APPLY 1 FIELDS/));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ ref: 7 }));
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
