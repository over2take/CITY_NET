import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import type { SheetTemplate } from '../../sheets';
import type { SheetVitals } from '../../sheets/vitals';
import type { SheetToken } from '../../sheets/types';

/**
 * The vitals strip (8s3b; mockup vitals-strip.html, approved 2026-11-17): under the sheet header's HP bar, an amount,
 * DAMAGE (the HEALTH window's word), HEAL and TEMP sent through the HEALTH window's own route; HEALTH ▾ or a click on the HP bar opening HEALTH's own
 * panel in place; CREATE HEALTH RECORD with no token; and another health model changed in that panel instead.
 */

const TOKEN: SheetToken = { id: 7, name: 'KES', shape: 'rhombus', owner: 'kes', hp_current: 14, hp_max: 20, hp_temp: 3, conditions: '[]', injuries: '{}' };
const template = {
  id: 'generic', name: 'Generic', tabs: ['STATS'],
  header: { nameField: 'name', hpField: 'hp', hpMaxField: 'hp_max' },
  sections: [{ id: 'stats', label: 'STATS', layout: 'list', tab: 'STATS', fields: [{ id: 'name', label: 'Name', type: 'text' }] }],
} as unknown as SheetTemplate;

/** A socket that answers a custom system's health view with `model`, as the server does. */
const socketWith = (model: string | null) => {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  return {
    emit: vi.fn((e: string, p: { location_id: number }) => {
      if (e === 'requestHealthView' && model) queueMicrotask(() => (handlers.get('healthView') ?? []).forEach((fn) => fn({ location_id: p.location_id, model })));
    }),
    on: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, [...(handlers.get(e) ?? []), fn]); },
    off: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, (handlers.get(e) ?? []).filter((f) => f !== fn)); },
  };
};

let fetched: { url: string; init: RequestInit }[];
let answer: { ok: boolean; body: unknown };
beforeEach(() => {
  fetched = [];
  answer = { ok: true, body: {} };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    fetched.push({ url, init });
    return { ok: answer.ok, status: answer.ok ? 200 : 403, json: async () => answer.body };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const draw = (over: Partial<SheetVitals> = {}, more: { onOpenLink?: () => void; readOnly?: boolean } = {}) => {
  const vitals: SheetVitals = { token: TOKEN, owner: 'kes', system: 'generic', authToken: 'tok', socket: socketWith(null), reload: vi.fn(), ...over };
  render(<SheetRenderer template={template} data={{ name: 'Kes', hp: 14, hp_max: 20 } as never} onFieldChange={() => {}} vitals={vitals} {...more} />);
  return vitals;
};
const healthCalls = () => fetched.filter((f) => f.url === '/api/locations/7/health').map((f) => ({ body: JSON.parse(String(f.init.body)), auth: (f.init.headers as Record<string, string>).Authorization, method: f.init.method }));
const amount = () => screen.getByRole('spinbutton', { name: 'Amount of HP' });

describe('DAMAGE, HEAL and TEMP', () => {
  it('each sent through the health route on the player\'s token, with their sign-in, the amount cleared after', async () => {
    draw();
    await userEvent.type(amount(), '5');
    await userEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    expect(healthCalls()).toEqual([{ method: 'PUT', auth: 'Bearer tok', body: { action: 'damage', amount: 5 } }]);
    expect((amount() as HTMLInputElement).value).toBe('');
    await userEvent.type(amount(), '3');
    await userEvent.click(screen.getByRole('button', { name: 'HEAL' }));
    await userEvent.type(amount(), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Set temp to the amount' }));
    expect(healthCalls().slice(1).map((c) => c.body)).toEqual([{ action: 'heal', amount: 3 }, { action: 'set_temp', amount: 4, hp_temp: 4 }]);
  });

  it('Enter damages; no amount takes or heals nothing, but SET with none clears TEMP', async () => {
    const { socket } = draw();
    await userEvent.type(amount(), '2{Enter}');
    expect(healthCalls().map((c) => c.body)).toEqual([{ action: 'damage', amount: 2 }]);
    // A built-in game is one pool: no custom model asked for.
    expect((socket as unknown as { emit: ReturnType<typeof vi.fn> }).emit).not.toHaveBeenCalledWith('requestHealthView', expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    await userEvent.click(screen.getByRole('button', { name: 'HEAL' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set temp to the amount' }));
    expect(healthCalls().map((c) => c.body)).toEqual([{ action: 'damage', amount: 2 }, { action: 'set_temp', amount: 0, hp_temp: 0 }]);
  });

  it('shows the token\'s TEMP, and what the server refused', async () => {
    draw();
    expect(screen.getByLabelText('Temp HP').textContent).toBe('+3');
    answer = { ok: false, body: { error: 'Not your token' } };
    await userEvent.type(amount(), '1');
    await userEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    expect(screen.getByRole('alert').textContent).toBe('Not your token');
    // Kept for another go.
    expect((amount() as HTMLInputElement).value).toBe('1');
  });
});

describe('CWN\'s STIM', () => {
  it('on the strip in CWN alone, sent as HEALTH\'s STIM_HEAL; strain maxed said as the server says it', async () => {
    draw();
    expect(screen.queryByRole('button', { name: 'STIM +1 STRAIN' })).toBeNull();
    cleanup();
    draw({ system: 'cities_without_number' });
    await userEvent.type(amount(), '4');
    await userEvent.click(screen.getByRole('button', { name: 'STIM +1 STRAIN' }));
    expect(healthCalls().map((c) => c.body)).toEqual([{ action: 'stim_heal', amount: 4 }]);
    answer = { ok: false, body: { error: 'STRAIN MAXED — NO STIM BENEFIT' } };
    await userEvent.type(amount(), '2');
    await userEvent.click(screen.getByRole('button', { name: 'STIM +1 STRAIN' }));
    expect(screen.getByRole('alert').textContent).toBe('STRAIN MAXED — NO STIM BENEFIT');
  });
});

describe('HEALTH here', () => {
  it('HEALTH ▾ and a click on the HP bar open and close HEALTH\'s own panel; the linked window isn\'t asked', async () => {
    const onOpenLink = vi.fn();
    draw({}, { onOpenLink });
    expect(screen.queryByRole('region', { name: 'Health' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^HEALTH/ }));
    const region = screen.getByRole('region', { name: 'Health' });
    // HEALTH's own panel: its numbers, conditions and MAX; not a second DAMAGE, HEAL, amount or TEMP (the user, 2026-11-17).
    expect(region.textContent).toContain('14 / 20');
    expect(within(region).getByRole('button', { name: '+ CONDITION' })).toBeTruthy();
    expect(within(region).getByRole('spinbutton', { name: 'Max HP' })).toBeTruthy();
    for (const name of ['DAMAGE', 'HEAL']) expect(within(region).queryByRole('button', { name }), name).toBeNull();
    for (const name of ['Amount', 'Temp HP']) expect(within(region).queryByRole('spinbutton', { name }), name).toBeNull();
    const bar = screen.getByTitle('Synced with your token: click to open HEALTH here');
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(bar);
    expect(screen.queryByRole('region', { name: 'Health' })).toBeNull();
    await userEvent.click(bar);
    expect(screen.getByRole('region', { name: 'Health' })).toBeTruthy();
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('without the strip (another\'s sheet, or read only) the HP bar opens the linked window as before, and there is no strip', async () => {
    const onOpenLink = vi.fn();
    render(<SheetRenderer template={template} data={{ name: 'Kes', hp: 14, hp_max: 20 } as never} onFieldChange={() => {}} onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByTitle(/click to open/));
    expect(onOpenLink).toHaveBeenCalledWith('token_hp');
    expect(screen.queryByRole('group', { name: 'Vitals' })).toBeNull();
    cleanup();
    draw({}, { readOnly: true });
    expect(screen.queryByRole('group', { name: 'Vitals' })).toBeNull();
  });
});

describe('no token on the map', () => {
  it('says so, and CREATE HEALTH RECORD makes the player\'s, then asks for the sheet again', async () => {
    const onOpenLink = vi.fn();
    const vitals = draw({ token: null }, { onOpenLink });
    // The HP bar opens the map's HEALTH as before, which offers the same.
    await userEvent.click(screen.getByTitle(/click to open/));
    expect(onOpenLink).toHaveBeenCalledWith('token_hp');
    expect(screen.getByRole('group', { name: 'Vitals' }).textContent).toContain('NO TOKEN ON THE MAP');
    expect(screen.queryByRole('button', { name: 'DAMAGE' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'CREATE HEALTH RECORD' }));
    const made = fetched.find((f) => f.url === '/api/locations');
    expect(made?.init.method).toBe('POST');
    expect(JSON.parse(String(made!.init.body))).toMatchObject({ shape: 'rhombus', owner: 'kes', name: 'kes' });
    await vi.waitFor(() => expect(vitals.reload).toHaveBeenCalled());
    // The bar opens nothing: there is no token to show.
    expect(screen.queryByTitle('Synced with your token: click to open HEALTH here')).toBeNull();
  });
});

describe('a custom system\'s other health models', () => {
  const SYS = 'sys_0a1b2c3d4e5f6a7b';
  it('one pool: DAMAGE and HEAL as any', async () => {
    draw({ system: SYS, socket: socketWith('pool') });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'DAMAGE' })).toBeTruthy();
  });

  it('another model: no amount, changed in HEALTH ▾', async () => {
    draw({ system: SYS, socket: socketWith('wounds') });
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'DAMAGE' })).toBeNull());
    expect(screen.queryByRole('spinbutton', { name: 'Amount of HP' })).toBeNull();
    expect(screen.getByRole('button', { name: /^HEALTH/ })).toBeTruthy();
  });

  it('no health at all: no strip', async () => {
    draw({ system: SYS, socket: socketWith('none') });
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Vitals' })).toBeNull());
  });
});
