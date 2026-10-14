import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { SheetPage, formFileName } from '../SheetPage';
import { systemsApi, type Definition } from '../../sheets/systemsApi';

/**
 * DOWNLOAD FORM on the builder's CHARACTER SHEET page (4h2c; approved mockup
 * docs/mockups/sheet-import.html, 2026-10-13): the blank PDF a draft would give players to fill in
 * and upload through IMPORT, so the GM sees it before publishing. Not on NPCS' stat block, and not
 * while the system has SHEET IMPORT off.
 */

const req = createRequire(import.meta.url);
const { starterSheet, effectiveSheet } = req('../../../../backend/systemBuilder/sheet.js');

const HEARTH: Definition = { format: 1, name: 'Hearth Fire', stats: [{ id: 'a', label: 'A', stats: [{ id: 'str', label: 'Strength' }] }] };

const api = (formPdf: (def: Definition) => Promise<unknown>) => ({
  previewSheet: vi.fn(async (def: Definition) => ({ ok: true as const, value: { sheet: effectiveSheet(def), starter: starterSheet(def) } })),
  previewValues: vi.fn(async () => ({ ok: true as const, value: { values: {}, problems: [] } })),
  formPdf: vi.fn(formPdf),
}) as unknown as ReturnType<typeof systemsApi> & { formPdf: ReturnType<typeof vi.fn> };

let made: Blob[];
let clicked: string[];
beforeEach(() => {
  made = [];
  clicked = [];
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: (b: Blob) => { made.push(b); return 'blob:form'; },
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(`${this.href}|${this.download}`); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const button = () => screen.queryByRole('button', { name: 'DOWNLOAD FORM' });

describe('DOWNLOAD FORM', () => {
  it('hands the GM the draft\'s blank form, named for the system', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
    const a = api(async () => ({ ok: true, value: pdf }));
    render(<SheetPage definition={HEARTH} edit={() => {}} api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD FORM' }));
    await waitFor(() => expect(clicked).toEqual(['blob:form|citynet-hearth-fire-form.pdf']));
    expect(a.formPdf).toHaveBeenCalledWith(HEARTH);
    expect(made).toEqual([pdf]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:form');
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is there on a customized sheet too', async () => {
    render(<SheetPage definition={{ ...HEARTH, sheet: starterSheet(HEARTH) }} edit={() => {}} api={api(async () => ({ ok: true, value: new Blob() }))} />);
    await screen.findByText('CUSTOMIZED');
    expect(button()).toBeTruthy();
  });

  it('waits while the form is made, and says why when it can\'t be', async () => {
    let answer: (v: unknown) => void = () => {};
    render(<SheetPage definition={HEARTH} edit={() => {}} api={api(() => new Promise((r) => { answer = r; }))} />);
    await userEvent.click(await screen.findByRole('button', { name: 'DOWNLOAD FORM' }));
    expect((screen.getByRole('button', { name: 'MAKING THE FORM…' }) as HTMLButtonElement).disabled).toBe(true);
    answer({ ok: false, error: 'Could not build the form' });
    expect((await screen.findByRole('alert')).textContent).toBe('Could not build the form');
    expect(clicked).toEqual([]);
    expect(button()).toBeTruthy();
  });

  it('isn\'t offered with SHEET IMPORT off, on NPCS\' stat block, or without the server', async () => {
    render(<SheetPage definition={{ ...HEARTH, parts: { sheet_import: { on: false } } }} edit={() => {}} api={api(async () => ({}))} />);
    await screen.findByText('AUTOMATIC');
    expect(button()).toBeNull();
    cleanup();
    render(<SheetPage definition={HEARTH} edit={() => {}} api={api(async () => ({}))} forNpcs />);
    expect(button()).toBeNull();
    cleanup();
    render(<SheetPage definition={HEARTH} edit={() => {}} />);
    expect(button()).toBeNull();
  });

  it('names the file for the system, or "system" when its name has nothing to spell it', () => {
    expect(formFileName('Hearth Fire!')).toBe('citynet-hearth-fire-form.pdf');
    expect(formFileName('***')).toBe('citynet-system-form.pdf');
    expect(formFileName(undefined)).toBe('citynet-system-form.pdf');
  });
});

describe('asking the server for it', () => {
  it('posts the draft and answers the PDF, or the server\'s reason', async () => {
    const pdf = new Blob(['%PDF']);
    const ok = vi.fn(async () => ({ ok: true, blob: async () => pdf }) as unknown as Response);
    expect(await systemsApi('gm', ok as unknown as typeof fetch).formPdf(HEARTH)).toEqual({ ok: true, value: pdf });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, JSON.parse(String(init.body))]).toEqual(['/api/systems/form.pdf', 'POST', { definition: HEARTH }]);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gm');
    const refused = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Not a definition' }) }) as unknown as Response);
    expect(await systemsApi('gm', refused as unknown as typeof fetch).formPdf(HEARTH)).toEqual({ ok: false, status: 400, error: 'Not a definition' });
    const garbled = vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } }) as unknown as Response);
    expect(await systemsApi('gm', garbled as unknown as typeof fetch).formPdf(HEARTH)).toMatchObject({ ok: false, status: 500, error: 'Could not reach the server.' });
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect(await systemsApi('gm', down as unknown as typeof fetch).formPdf(HEARTH)).toEqual({ ok: false, status: 0, error: 'Could not reach the server.' });
  });
});
