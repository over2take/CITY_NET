import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useFormulaReads, type FormulaToRead } from '../useFormulaReads';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import type { FormulaRead } from '../../sheets/formulaBox';

/**
 * Many formulas read at once (formula box 3): one request a moment after typing stops, twenty
 * formulas to a request, empty ones never asked about, and an answer kept only for the text it was
 * for.
 */
const DEF = { format: 1, name: 'Hearth' } as Definition;
const answering = (answer: (text: string) => FormulaRead) => ({
  previewFormulas: vi.fn(async (_d: Definition, formulas: { text: string }[]) => ({ ok: true, value: { results: formulas.map((f) => answer(f.text)), sampleLevel: 3 } })),
}) as unknown as ReturnType<typeof systemsApi> & { previewFormulas: ReturnType<typeof vi.fn> };

function Probe({ api, items }: { api?: Pick<ReturnType<typeof systemsApi>, 'previewFormulas'>; items: FormulaToRead[] }) {
  return <pre data-testid="reads">{JSON.stringify(useFormulaReads(DEF, api, items))}</pre>;
}
const reads = (): Record<string, FormulaRead | null> => JSON.parse(screen.getByTestId('reads').textContent!);
const item = (key: string, text: string): FormulaToRead => ({ key, text, kind: 'formula' });

describe('reading many formulas', () => {
  it('asks once for up to twenty, more in another request, never an empty one', async () => {
    const api = answering((text) => ({ ok: true, value: Number(text), reads: [] }));
    const items = [...Array.from({ length: 23 }, (_, i) => item(`f${i}`, String(i))), item('blank', '  ')];
    render(<Probe api={api} items={items} />);
    await waitFor(() => expect(reads().f22).toEqual({ ok: true, value: 22, reads: [] }));
    expect(api.previewFormulas.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([20, 3]);
    expect(reads().blank).toBeNull();
  });

  it('gives an answer back only while its text is still the text', async () => {
    const api = answering(() => ({ ok: true, value: 1, reads: [] }));
    const { rerender } = render(<Probe api={api} items={[item('a', '1')]} />);
    await waitFor(() => expect(reads().a).not.toBeNull());
    rerender(<Probe api={api} items={[item('a', '2')]} />);
    expect(reads().a).toBeNull();
  });

  it('reads nothing with no api, or one without the call', async () => {
    render(<Probe api={{} as never} items={[item('a', '1')]} />);
    await new Promise((r) => setTimeout(r, 450));
    expect(reads()).toEqual({ a: null });
  });
});
