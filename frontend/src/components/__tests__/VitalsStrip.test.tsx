import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import type { SheetTemplate } from '../../sheets';
import type { SheetVitals } from '../../sheets/vitals';
import type { SheetToken } from '../../sheets/types';
import { createRequire } from 'module';
import { forgetConditionLists } from '../../hooks/useConditionList';
import { REST_CALL_KEY, WORKED_KEY, type RestingShown } from '../../sheets/choicesShown';

// The game's conditions as the server lists them (as TokenConditions.test.tsx gets them).
const GAME = createRequire(import.meta.url)('../../../../backend/systemBuilder/conditions.js').conditionsOf({
  conditions: { poisoned: { ends: 'rounds', rounds: 3, description: 'Sick.', modifiers: [{ target: 'all_rolls', amount: -1 }] } },
});

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
  forgetConditionLists();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.startsWith('/api/systems/conditions/')) return { ok: true, status: 200, json: async () => GAME };
    fetched.push({ url, init });
    return { ok: answer.ok, status: answer.ok ? 200 : 403, json: async () => answer.body };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const draw = (over: Partial<SheetVitals> = {}, more: { onOpenLink?: () => void; readOnly?: boolean; onRestTake?: (rest: string) => void; gm?: boolean; resting?: RestingShown; data?: Record<string, unknown> } = {}) => {
  const vitals: SheetVitals = { token: TOKEN, owner: 'kes', system: 'generic', authToken: 'tok', socket: socketWith(null), reload: vi.fn(), ...over };
  const { resting, data = {}, ...rest } = more;
  render(<SheetRenderer template={{ ...template, resting } as SheetTemplate} data={{ name: 'Kes', hp: 14, hp_max: 20, ...data } as never} onFieldChange={() => {}} vitals={vitals} {...rest} />);
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
    // TEMP: click it, type, Enter.
    await userEvent.click(screen.getByRole('button', { name: 'Temp HP: 3. Click to set it' }));
    const temp = screen.getByRole('spinbutton', { name: 'Temp HP' });
    expect((temp as HTMLInputElement).value).toBe('3');
    await userEvent.clear(temp);
    await userEvent.type(temp, '4{Enter}');
    expect(healthCalls().slice(1).map((c) => c.body)).toEqual([{ action: 'heal', amount: 3 }, { action: 'set_temp', amount: 4, hp_temp: 4 }]);
    // Back to the number once set.
    await vi.waitFor(() => expect(screen.queryByRole('spinbutton', { name: 'Temp HP' })).toBeNull());
  });

  it('Enter damages; no amount damages or heals nothing, but TEMP emptied clears it; Escape leaves it', async () => {
    const { socket } = draw();
    await userEvent.type(amount(), '2{Enter}');
    expect(healthCalls().map((c) => c.body)).toEqual([{ action: 'damage', amount: 2 }]);
    // A built-in game is one pool: no custom model asked for.
    expect((socket as unknown as { emit: ReturnType<typeof vi.fn> }).emit).not.toHaveBeenCalledWith('requestHealthView', expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    await userEvent.click(screen.getByRole('button', { name: 'HEAL' }));
    await userEvent.click(screen.getByRole('button', { name: /^Temp HP/ }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Temp HP' }), '9{Escape}');
    expect(screen.queryByRole('spinbutton', { name: 'Temp HP' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Temp HP/ }));
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Temp HP' }));
    await userEvent.keyboard('{Enter}');
    expect(healthCalls().map((c) => c.body)).toEqual([{ action: 'damage', amount: 2 }, { action: 'set_temp', amount: 0, hp_temp: 0 }]);
  });

  it('shows the token\'s CURRENT, MAX and TEMP (-- with none), and what the server refused', async () => {
    draw({ token: { ...TOKEN, hp_temp: 0 } });
    expect(screen.getByLabelText('Current HP').textContent).toBe('14');
    expect(screen.getByLabelText('Max HP').textContent).toBe('20');
    expect(screen.getByRole('button', { name: 'Temp HP: 0. Click to set it' }).textContent).toBe('--');
    // CURRENT colored as the bar is: over half, a quarter to half, a quarter or less.
    for (const [hp, color] of [[14, 'var(--green)'], [8, 'var(--warning)'], [5, 'var(--danger)']] as const) {
      cleanup();
      draw({ token: { ...TOKEN, hp_current: hp } });
      expect(screen.getByLabelText('Current HP').style.color, String(hp)).toBe(color);
    }
    cleanup();
    draw();
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
  it('HIT POINTS ▾ and a click on the HP bar open and close HEALTH\'s own panel; the linked window isn\'t asked', async () => {
    const onOpenLink = vi.fn();
    draw({}, { onOpenLink });
    expect(screen.queryByRole('region', { name: 'Health' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^HIT POINTS/ }));
    const region = screen.getByRole('region', { name: 'Health' });
    // HEALTH's own panel: its numbers and MAX; not a second DAMAGE, HEAL, amount or TEMP (the user, 2026-11-17), nor the
    // conditions, chips under the box (8s3c).
    expect(region.textContent).toContain('14 / 20');
    expect(within(region).queryByRole('region', { name: 'Conditions' })).toBeNull();
    expect(within(region).queryByRole('button', { name: '+ CONDITION' })).toBeNull();
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
    // Its conditions under it, as chips, and not again in HEALTH (8s3c).
    expect(screen.getAllByRole('region', { name: 'Conditions' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^HEALTH/ }));
    const health = screen.getByRole('region', { name: 'Health' });
    expect(within(health).queryByRole('region', { name: 'Conditions' })).toBeNull();
  });

  it('no health at all: no strip, the conditions still (8s3c)', async () => {
    draw({ system: SYS, socket: socketWith('none') });
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Vitals' })).toBeNull());
    expect(screen.getByRole('region', { name: 'Conditions' })).toBeTruthy();
  });
});

describe('conditions under the box (8s3c)', () => {
  const conditionCalls = () => fetched.filter((f) => f.url === '/api/locations/7/conditions').map((f) => ({ body: JSON.parse(String(f.init.body)), auth: (f.init.headers as Record<string, string>).Authorization }));

  it('the token\'s as chips, what each means on hover; × takes one off with the player\'s sign-in, then the sheet is asked again', async () => {
    const vitals = draw({ token: { ...TOKEN, conditions: '[{"id":"poisoned"}]' } });
    const chips = await screen.findByRole('region', { name: 'Conditions' });
    const chip = await within(chips).findByRole('note', { name: 'Poisoned' });
    expect(chip.getAttribute('title')).toContain('Sick.');
    await userEvent.click(within(chips).getByRole('button', { name: 'Take Poisoned off' }));
    expect(conditionCalls()).toEqual([{ body: { conditions: [] }, auth: 'Bearer tok' }]);
    await vi.waitFor(() => expect(vitals.reload).toHaveBeenCalled());
  });

  it('+ CONDITION ▾ opens the game\'s list and ▴ closes it, as REST ▾ does; picking one puts it on', async () => {
    draw();
    const chips = await screen.findByRole('region', { name: 'Conditions' });
    const add = within(chips).getByRole('button', { name: 'Put on a condition' });
    expect([add.textContent, add.getAttribute('aria-expanded')]).toEqual(['+ CONDITION ▾', 'false']);
    await userEvent.click(add);
    expect([add.textContent, add.getAttribute('aria-expanded')]).toEqual(['+ CONDITION ▴', 'true']);
    await userEvent.click(await screen.findByRole('option', { name: /POISONED/ }));
    expect(conditionCalls().map((c) => c.body.conditions.map((x: { id: string }) => x.id))).toEqual([['poisoned']]);
    await userEvent.click(add);
    expect(screen.queryByRole('listbox', { name: 'Put on a condition' })).toBeNull();
    expect(add.textContent).toBe('+ CONDITION ▾');
  });

  it('none with no token, as nothing to put them on', () => {
    draw({ token: null });
    expect(screen.queryByRole('region', { name: 'Conditions' })).toBeNull();
  });
});

describe('REST ▾ (8s3c)', () => {
  const RESTING: RestingShown = { finish: 'sheet', rests: [{ id: 'short_rest', name: 'Short rest', spends: false }, { id: 'long_rest', name: 'Long rest', spends: false }] };

  it('opens the sheet\'s own RESTS in place: asked first, then taken', async () => {
    const onRestTake = vi.fn();
    draw({}, { resting: RESTING, onRestTake });
    expect(screen.queryByRole('region', { name: 'Take a rest' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^REST/ }));
    const rests = screen.getByRole('region', { name: 'Take a rest' });
    await userEvent.click(within(rests).getByRole('button', { name: 'LONG REST' }));
    await userEvent.click(within(rests).getByRole('button', { name: 'REST' }));
    expect(onRestTake).toHaveBeenCalledWith('long_rest');
  });

  it('none where the game has no rests, nothing can take them, or rests are at the GM\'s call and none is called', () => {
    draw({}, { onRestTake: vi.fn() });
    expect(screen.queryByRole('button', { name: /^REST/ })).toBeNull();
    cleanup();
    draw({}, { resting: RESTING });
    expect(screen.queryByRole('button', { name: /^REST/ })).toBeNull();
    cleanup();
    draw({}, { resting: { ...RESTING, finish: 'call' }, onRestTake: vi.fn() });
    expect(screen.queryByRole('button', { name: /^REST/ })).toBeNull();
  });

  it('a rest the GM called says so, in the warning color, and opens by itself, a call that comes later too', async () => {
    const called = { [REST_CALL_KEY]: { rest: 'short_rest', name: 'Short rest' } };
    draw({}, { resting: { ...RESTING, finish: 'call' }, onRestTake: vi.fn(), data: called });
    const button = screen.getByRole('button', { name: /^REST · CALLED/ });
    // Open by itself, so filled in the warning color; solid, as the box's other buttons.
    expect([button.style.background, button.style.border, button.getAttribute('aria-expanded')]).toEqual(['var(--warning)', '1px solid var(--warning)', 'true']);
    expect(screen.getByRole('region', { name: 'Take a rest' })).toBeTruthy();
    cleanup();
    // Open, no call; then the GM calls one.
    const vitals: SheetVitals = { token: TOKEN, owner: 'kes', system: 'generic', authToken: 'tok', socket: socketWith(null), reload: vi.fn() };
    const t = { ...template, resting: RESTING } as SheetTemplate;
    const { rerender } = render(<SheetRenderer template={t} data={{ name: 'Kes' } as never} onFieldChange={() => {}} vitals={vitals} onRestTake={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Take a rest' })).toBeNull();
    rerender(<SheetRenderer template={t} data={{ name: 'Kes', ...called } as never} onFieldChange={() => {}} vitals={vitals} onRestTake={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Take a rest' })).toBeTruthy();
  });

  it("with REST ▾, the tab's RESTS section isn't drawn as well; without the strip it is (the user, 2026-11-17)", () => {
    const withRests = { ...template, resting: RESTING, sections: [...template.sections, { id: 'rests', label: 'RESTS', layout: 'rests', tab: 'STATS', fields: [] }] } as unknown as SheetTemplate;
    const vitals: SheetVitals = { token: TOKEN, owner: 'kes', system: 'generic', authToken: 'tok', socket: socketWith(null), reload: vi.fn() };
    render(<SheetRenderer template={withRests} data={{ name: 'Kes' } as never} onFieldChange={() => {}} vitals={vitals} onRestTake={vi.fn()} />);
    expect(screen.queryByText(/─── RESTS ───/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rests' })).toBeNull();
    cleanup();
    render(<SheetRenderer template={withRests} data={{ name: 'Kes' } as never} onFieldChange={() => {}} onRestTake={vi.fn()} />);
    expect(screen.getByText(/─── RESTS ───/)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Rests' })).toBeTruthy();
  });

  it('with no token too: a rest needs none', async () => {
    draw({ token: null }, { resting: RESTING, onRestTake: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: /^REST/ }));
    expect(screen.getByRole('region', { name: 'Take a rest' })).toBeTruthy();
  });
});

describe('the box stands in for the HEALTH section, and shows the AC (8s3c, the user, 2026-11-17)', () => {
  const pair = { id: 'health', label: 'HEALTH', layout: 'grid', tab: 'STATS', columns: 2, fields: [
    { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
    { id: 'hp_max', label: 'HP MAX', type: 'number', source: 'token_hp_max' },
  ] };
  const vitals = (): SheetVitals => ({ token: TOKEN, owner: 'kes', system: 'generic', authToken: 'tok', socket: socketWith(null), reload: vi.fn() });
  const withSections = (sections: unknown[]) => ({ ...template, sections: [...template.sections, ...sections] } as unknown as SheetTemplate);

  it('a section of only the token\'s HP and max isn\'t drawn beside the box; one with more is; without the strip it is', () => {
    render(<SheetRenderer template={withSections([pair])} data={{ name: 'Kes', hp: 14, hp_max: 20 } as never} onFieldChange={() => {}} vitals={vitals()} />);
    expect(screen.queryByText(/─── HEALTH ───/)).toBeNull();
    cleanup();
    const mixed = { ...pair, fields: [...pair.fields, { id: 'stun', label: 'STUN', type: 'number' }] };
    render(<SheetRenderer template={withSections([mixed])} data={{ name: 'Kes', hp: 14, hp_max: 20 } as never} onFieldChange={() => {}} vitals={vitals()} />);
    expect(screen.getByText(/─── HEALTH ───/)).toBeTruthy();
    cleanup();
    render(<SheetRenderer template={withSections([pair])} data={{ name: 'Kes', hp: 14, hp_max: 20 } as never} onFieldChange={() => {}} />);
    expect(screen.getByText(/─── HEALTH ───/)).toBeTruthy();
    cleanup();
    render(<SheetRenderer template={withSections([pair])} data={{ name: 'Kes', hp: 14, hp_max: 20 } as never} onFieldChange={() => {}} vitals={vitals()} readOnly />);
    expect(screen.getByText(/─── HEALTH ───/)).toBeTruthy();
  });

  it('MAX says on hover what made it, in cyan, as the section did; plain with nothing added', () => {
    draw();
    expect(screen.getByLabelText('Max HP').getAttribute('title')).toBeNull();
    cleanup();
    // A feat adding 6 to the maximum, as SheetRenderer.health.test.tsx carries it; the section itself not drawn.
    const feats = { ...withSections([pair]), choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [] }] } as unknown as SheetTemplate;
    render(<SheetRenderer template={feats} data={{ name: 'Kes', hp: 14, hp_max: 26, [WORKED_KEY]: { from: { hp_max: [{ feature: 'Tough', amount: 6 }] } } } as never}
      onFieldChange={() => {}} vitals={vitals()} />);
    const max = screen.getByLabelText('Max HP');
    expect(max.getAttribute('title')).toBe('20 → 26 (Tough +6)');
    expect(max.style.color).toBe('var(--cyan)');
  });

  it("the token's armor class as the game has it: one in its own words, two (both always), or none", () => {
    const acField = (source: string, label: string, id: string) => ({ id, label, type: 'number', source });
    const armored = (fields: unknown[], more: Partial<SheetTemplate> = {}) =>
      ({ ...withSections([{ id: 'defense', label: 'DEFENSE', layout: 'list', tab: 'STATS', fields }]), ...more } as unknown as SheetTemplate);
    const show = (t: SheetTemplate, token: Partial<SheetToken>) => {
      cleanup();
      render(<SheetRenderer template={t} data={{ name: 'Kes' } as never} onFieldChange={() => {}} vitals={{ ...vitals(), token: { ...TOKEN, ...token } }} />);
      return screen.queryByRole('note', { name: /\d/ });
    };
    // One, named by its field: a built system's GUARD.
    expect(show(armored([acField('token_ac', 'Guard', 'guard')]), { melee_ac: 14, ranged_ac: 16 })?.textContent).toBe('GUARD14');
    // Two (CWN): both, always, an unset ranged being the melee one.
    const two = armored([acField('token_ac', 'Melee AC', 'ac'), acField('token_ac_ranged', 'Ranged AC', 'ac_ranged')]);
    expect(show(two, { melee_ac: 13, ranged_ac: 13 })?.textContent).toBe('MELEE AC13RANGED AC13');
    expect(show(two, { melee_ac: 13, ranged_ac: null })?.getAttribute('aria-label')).toBe('MELEE AC 13, RANGED AC 13');
    // None: no field and no defense on the token (a built system without one; Cyberpunk's SP on the sheet).
    expect(show(armored([]), { melee_ac: 14 })).toBeNull();
    expect(show(armored([], { tokenDefense: { editOnToken: false, label: 'DV' } }), { melee_ac: 14 })).toBeNull();
    // No field, a defense kept on the token (generic): its word.
    expect(show(armored([], { tokenDefense: { editOnToken: true, label: 'AC' } }), { melee_ac: 12 })?.textContent).toBe('AC12');
    // None set on the token: nothing to show.
    expect(show(armored([acField('token_ac', 'Guard', 'guard')]), { melee_ac: null })).toBeNull();
  });
});
