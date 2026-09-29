import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SheetRenderer } from '../../components/SheetRenderer';
import {
  templateFromRender, loadCustomTemplate, registerCustomTemplate, clearCustomTemplates,
  isCustomSystem, CUSTOM_TEMPLATE_EVENT, type CustomRender,
} from '../customTemplates';
import { getTemplate } from '../index';

/**
 * A published custom system's sheet, drawn by the ordinary renderer.
 *
 * The server sends a render copy (layout and words, no formulas); it becomes a template that
 * getTemplate() hands out like a built-in one. Until it has loaded, the generic template stands
 * in, and the load tells the app to redraw.
 */

const ID = 'sys_0123456789abcdef';

const VAULT: CustomRender = {
  id: ID,
  name: 'Vault Knights',
  words: {},
  parts: {},
  derived: ['might_mod', 'guard'],
  sheet: {
    tabs: ['KNIGHT', 'NOTES'],
    header: { nameField: 'name', hpField: 'wounds', hpMaxField: 'wounds_max' },
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', tab: 'KNIGHT', fields: [
        { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
        { id: 'order', label: 'Order', type: 'select', options: [{ value: 'dawn', label: 'Dawn' }, { value: 'dusk', label: 'Dusk' }] },
      ] },
      { id: 'stats', label: 'STATS', layout: 'grid', tab: 'KNIGHT', columns: 4, fields: [
        { id: 'might', label: 'MIGHT', type: 'number' },
        { id: 'might_mod', label: 'MOD', type: 'number' },
        { id: 'armor', label: 'ARMOR', type: 'number', sensitivity: 'combat', source: 'token_ac' },
        { id: 'gold', label: 'GOLD', type: 'number', source: 'bank_balance' },
      ] },
      { id: 'notes', label: 'NOTES', layout: 'notes', tab: 'NOTES', fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }] },
    ],
  },
};

beforeEach(() => clearCustomTemplates());
afterEach(() => vi.unstubAllGlobals());

describe('the render copy as a template', () => {
  it('keeps the layout, marks derived values read-only, and lets only armor write to the token', () => {
    const t = templateFromRender(VAULT);
    expect(t).toMatchObject({ id: ID, name: 'Vault Knights', tabs: ['KNIGHT', 'NOTES'] });
    expect(t.header).toEqual({ nameField: 'name', hpField: 'wounds', hpMaxField: 'wounds_max' });
    const fields = Object.fromEntries(t.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
    expect(fields.might_mod.derived).toBe(true);
    expect(fields.might.derived).toBeUndefined();
    expect(fields.armor).toMatchObject({ source: 'token_ac', sourceWritable: true, sensitivity: 'combat' });
    expect(fields.gold).toMatchObject({ source: 'bank_balance' });
    expect(fields.gold.sourceWritable).toBeUndefined();
    expect(fields.order.options).toHaveLength(2);
    expect(t.sections.find((s) => s.id === 'stats')!.columns).toBe(4);
  });

  it('always has a name field in its header', () => {
    const t = templateFromRender({ ...VAULT, sheet: { sections: [] } });
    expect(t.header).toEqual({ nameField: 'name' });
  });

  it('knows a custom system by its id', () => {
    expect(isCustomSystem(ID)).toBe(true);
    for (const id of ['cities_without_number', 'generic', 'sys_123', undefined, null]) expect(isCustomSystem(id)).toBe(false);
  });
});

describe('loading', () => {
  it('stands the generic template in, fetches the custom one, then hands it out and says so', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VAULT) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const loaded = vi.fn();
    window.addEventListener(CUSTOM_TEMPLATE_EVENT, loaded);

    expect(getTemplate(ID).id).toBe('generic');
    expect(fetchMock).toHaveBeenCalledWith(`/api/systems/render/${ID}`);
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    expect(getTemplate(ID).name).toBe('Vault Knights');
    window.removeEventListener(CUSTOM_TEMPLATE_EVENT, loaded);
  });

  it('asks the server once however many times it is asked for', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VAULT) } as Response));
    await Promise.all([loadCustomTemplate(ID, fetchMock), loadCustomTemplate(ID, fetchMock), loadCustomTemplate(ID, fetchMock)]);
    await loadCustomTemplate(ID, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing from a failed load, and tries again next time', async () => {
    const failing = vi.fn(() => Promise.resolve({ ok: false } as Response));
    expect(await loadCustomTemplate(ID, failing)).toBeNull();
    const working = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VAULT) } as Response));
    expect((await loadCustomTemplate(ID, working))!.name).toBe('Vault Knights');
  });

  it('does not ask the server about a built-in system', async () => {
    const fetchMock = vi.fn();
    expect(await loadCustomTemplate('cities_without_number', fetchMock as never)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getTemplate('cities_without_number').id).toBe('cities_without_number');
  });
});

describe('drawn by the ordinary renderer', () => {
  it("shows the system's own sections and fields, and edits a field", () => {
    const template = registerCustomTemplate(VAULT);
    const onFieldChange = vi.fn();
    render(<SheetRenderer template={template} data={{ name: 'Sir Ash', might: 15, might_mod: 1 } as never} readOnly={false} onFieldChange={onFieldChange} />);
    // Section titles are drawn as "▾ ─── WHO ───".
    expect(screen.getByText(/─── WHO ───/)).toBeTruthy();
    expect(screen.getByText(/─── STATS ───/)).toBeTruthy();
    expect(screen.getByText('MIGHT')).toBeTruthy();
    // The system's own tabs.
    expect(screen.getByText('KNIGHT')).toBeTruthy();
    expect(screen.getByText('Dawn')).toBeTruthy();
    expect(screen.getByDisplayValue('Sir Ash')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('15'), { target: { value: '16' } });
    expect(onFieldChange).toHaveBeenCalled();
  });
});
