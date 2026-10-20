import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SheetRenderer } from '../../components/SheetRenderer';
import {
  templateFromRender, loadCustomTemplate, refreshCustomTemplate, registerCustomTemplate, clearCustomTemplates,
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

describe('fetching again after a change on the server (3c2c3)', () => {
  const renamed = { ...VAULT, name: 'Vault Knights II' };

  it('replaces the one held with the server\'s new copy, says so, and keeps the old one meanwhile', async () => {
    registerCustomTemplate(VAULT);
    let answer!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const loaded = vi.fn();
    window.addEventListener(CUSTOM_TEMPLATE_EVENT, loaded);
    const pending = refreshCustomTemplate(ID, fetchMock as never);
    expect(fetchMock).toHaveBeenCalledWith(`/api/systems/render/${ID}`);
    expect(getTemplate(ID).name).toBe('Vault Knights');
    answer({ ok: true, json: () => Promise.resolve(renamed) } as Response);
    expect((await pending)!.name).toBe('Vault Knights II');
    expect(getTemplate(ID).name).toBe('Vault Knights II');
    expect(loaded).toHaveBeenCalledTimes(1);
    window.removeEventListener(CUSTOM_TEMPLATE_EVENT, loaded);
  });

  it('keeps the old one when the server can\'t be reached or says no', async () => {
    registerCustomTemplate(VAULT);
    // A refusal with a body is still a refusal, whatever the body says.
    expect(await refreshCustomTemplate(ID, vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(renamed) } as Response)) as never)).toBeNull();
    expect(await refreshCustomTemplate(ID, vi.fn(() => Promise.reject(new Error('offline'))) as never)).toBeNull();
    expect(getTemplate(ID).name).toBe('Vault Knights');
  });

  it('leaves a system this browser never loaded for whoever first asks, and never asks about a built-in', async () => {
    const fetchMock = vi.fn();
    expect(await refreshCustomTemplate(ID, fetchMock as never)).toBeNull();
    expect(await refreshCustomTemplate('cities_without_number', fetchMock as never)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('a custom system\'s rolls on its sheet (6b2a)', () => {
  const ROLLING: CustomRender = {
    ...VAULT,
    rolls: [
      { id: 'check', label: 'Might check', fields: ['might', 'might_mod'], changes: [] },
      { id: 'push', label: 'Pushed check', fields: ['might'], changes: [{ id: 'push', label: 'Push', cost: { from: 'stress', amount: 2 } }] },
    ],
  };
  const field = (t: ReturnType<typeof templateFromRender>, id: string) => t.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;

  it('gives each field a roll is rolled by its die button, with every roll it has; the others none', () => {
    const t = templateFromRender(ROLLING);
    expect(field(t, 'might').roll).toEqual({ formula: '', label: 'Might check' });
    expect(field(t, 'might').customRolls).toEqual([
      { id: 'check', label: 'Might check', changes: [] },
      { id: 'push', label: 'Pushed check', changes: [{ id: 'push', label: 'Push', cost: { from: 'stress', amount: 2 } }] },
    ]);
    expect(field(t, 'might_mod').customRolls!.map((r) => r.id)).toEqual(['check']);
    expect(field(t, 'armor').roll).toBeUndefined();
    expect(field(templateFromRender(VAULT), 'might').roll).toBeUndefined();
  });

  it('draws ROLL by a rolled field, which asks for that field\'s roll', () => {
    const onRoll = vi.fn();
    render(<SheetRenderer template={templateFromRender(ROLLING)} data={{ might: 14 }} onFieldChange={() => {}} onRoll={onRoll} />);
    const roll = screen.getAllByRole('button', { name: 'Roll Might check' });
    expect(roll).toHaveLength(2);
    // MOD has one roll and no changes, so it rolls on the first click (MIGHT asks first: 6b2b).
    fireEvent.click(roll[1]);
    expect(onRoll).toHaveBeenCalledWith('might_mod', undefined, undefined);
    expect(screen.queryByRole('button', { name: /Roll ARMOR/ })).toBeNull();
  });
});

describe('the chooser by the sheet (6b2b)', () => {
  const CHOOSING: CustomRender = {
    ...VAULT,
    rolls: [
      { id: 'check', label: 'Might check', fields: ['might', 'might_mod'], changes: [{ id: 'advantage', label: 'Advantage' }] },
      { id: 'push', label: 'Pushed check', fields: ['might'], changes: [{ id: 'push', label: 'Push', cost: { from: 'stress', amount: 2, label: 'Stress' } }] },
      { id: 'plain', label: 'Plain', fields: ['armor'], changes: [] },
      { id: 'blades', label: 'Action', fields: ['gold'], changes: [{ id: 'push', label: 'Push yourself', cost: { from: 'stress', amount: 2, label: 'Stress', adds: true, max: 9 } }] },
    ],
  };
  const draw = (data: Record<string, unknown> = { might: 14 }) => {
    const onRoll = vi.fn();
    render(<SheetRenderer template={templateFromRender(CHOOSING)} data={data} onFieldChange={() => {}} onRoll={onRoll} />);
    return onRoll;
  };

  it('a field with one roll and no changes rolls on the first click, asking nothing', () => {
    const onRoll = draw();
    fireEvent.click(screen.getByRole('button', { name: 'Roll Plain' }));
    expect(onRoll).toHaveBeenCalledWith('armor', undefined, undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks which roll and which changes first, then rolls with them', () => {
    const onRoll = draw();
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    expect(onRoll).not.toHaveBeenCalled();
    const ask = screen.getByRole('dialog', { name: 'Roll MIGHT' });
    expect(within(ask).getAllByRole('radio').map((r) => r.textContent)).toEqual(['MIGHT CHECK', 'PUSHED CHECK']);
    fireEvent.click(within(ask).getByRole('switch', { name: 'ADVANTAGE' }));
    fireEvent.click(within(ask).getByRole('button', { name: 'ROLL MIGHT CHECK' }));
    expect(onRoll).toHaveBeenCalledWith('might', undefined, undefined, { rollId: 'check', changes: ['advantage'] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('another roll starts with no changes picked; a cost says what the sheet has, and is picked like any change (6b3a)', () => {
    const onRoll = draw({ might: 14, stress: 4 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    const ask = screen.getByRole('dialog');
    fireEvent.click(within(ask).getByRole('switch', { name: 'ADVANTAGE' }));
    fireEvent.click(within(ask).getByRole('radio', { name: 'PUSHED CHECK' }));
    const push = within(ask).getByRole('switch', { name: 'PUSH · COSTS 2 STRESS · YOU HAVE 4' }) as HTMLButtonElement;
    expect(push.disabled).toBe(false);
    fireEvent.click(push);
    fireEvent.click(within(ask).getByRole('button', { name: 'ROLL PUSHED CHECK' }));
    expect(onRoll).toHaveBeenCalledWith('might', undefined, undefined, { rollId: 'push', changes: ['push'] });
  });

  it('a cost the sheet can\'t pay is off: too little to take, or too much to add', () => {
    const onRoll = draw({ might: 14, stress: 8 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'PUSHED CHECK' }));
    // 8 is enough to take 2 from.
    expect((screen.getByRole('switch', { name: 'PUSH · COSTS 2 STRESS · YOU HAVE 8' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    // GOLD's Action adds 2 Stress, past its highest of 9 from 8.
    fireEvent.click(screen.getByRole('button', { name: 'Roll Action' }));
    const adds = screen.getByRole('switch', { name: 'PUSH YOURSELF · ADDS 2 STRESS · 8 OF 9' }) as HTMLButtonElement;
    expect(adds.disabled).toBe(true);
    expect(adds.title).toBe('That would take it past its highest');
    fireEvent.click(adds);
    fireEvent.click(screen.getByRole('button', { name: 'ROLL ACTION' }));
    expect(onRoll).toHaveBeenCalledWith('gold', undefined, undefined, { rollId: 'blades', changes: [] });
  });

  it('one short is too little to take', () => {
    draw({ might: 14, stress: 1 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'PUSHED CHECK' }));
    expect((screen.getByRole('switch', { name: 'PUSH · COSTS 2 STRESS · YOU HAVE 1' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with nothing on the sheet, a cost to take is off and one to add is on', () => {
    draw();
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'PUSHED CHECK' }));
    const push = screen.getByRole('switch', { name: 'PUSH · COSTS 2 STRESS · YOU HAVE 0' }) as HTMLButtonElement;
    expect([push.disabled, push.title]).toEqual([true, 'There is not enough to pay it']);
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll Action' }));
    expect((screen.getByRole('switch', { name: 'PUSH YOURSELF · ADDS 2 STRESS · 0 OF 9' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a field with one roll that has changes asks too, without a choice of roll', () => {
    const onRoll = draw();
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[1]);
    const ask = screen.getByRole('dialog', { name: 'Roll MOD' });
    expect(within(ask).queryByRole('radio')).toBeNull();
    fireEvent.click(within(ask).getByRole('button', { name: 'ROLL MIGHT CHECK' }));
    expect(onRoll).toHaveBeenCalledWith('might_mod', undefined, undefined, { rollId: 'check', changes: [] });
  });

  it('CANCEL or Escape closes it, rolling nothing', () => {
    const onRoll = draw();
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Roll Might check' })[0]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRoll).not.toHaveBeenCalled();
  });
});
