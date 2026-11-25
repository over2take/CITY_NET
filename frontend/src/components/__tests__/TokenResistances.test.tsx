import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';
import { TokenResistances } from '../TokenResistances';

/**
 * RESISTANCES and VULNERABILITIES on a token's HEALTH (8b3c2b; the user, 2026-11-24, draft 2 approved): two rows of chips,
 * each opened to say what it means and where it comes from; + RESISTANCE (RESIST or IMMUNE) and + VULNERABILITY as the
 * server allows; TAKE OFF BY HAND where it does. Answered as the server would (resistancesShown.js).
 */

const req = createRequire(import.meta.url);
const { resistancesShown } = req('../../../../backend/systemBuilder/resistancesShown.js');
const DEF = {
  format: 1, name: 'Rows', damage: { types: { sonic: { name: 'Sonic' } } },
  conditions: { soaked: { name: 'Soaked', resistances: [{ kind: 'vulnerable', type: 'lightning' }] } },
  items: { list: [{ id: 'ring', label: 'Ring of Warmth', needs: 'carried', features: [{ id: 'warm', label: 'Warm', resistances: [{ kind: 'resist', type: 'cold' }] }] }] },
};
const sheet = { inventory: JSON.stringify([{ name: 'Ring of Warmth', qty: 1, carry: 'stowed' }]), _resistances: [{ kind: 'immune', type: 'sonic', by: 'vex' }] };

let answer: unknown;
let calls: { url: string; init?: RequestInit }[];
beforeEach(() => {
  calls = [];
  answer = { on: true, ...resistancesShown(DEF, sheet, ['soaked'], null) };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'PUT') return { ok: !(answer as { refuse?: string }).refuse, json: async () => ({ error: (answer as { refuse?: string }).refuse }) };
    return { ok: true, json: async () => answer };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const draw = (who: string | null = null, more: Partial<React.ComponentProps<typeof TokenResistances>> = {}) => {
  answer = { on: true, ...resistancesShown(DEF, sheet, ['soaked'], who) };
  return render(<TokenResistances locationId={7} authToken="tok" {...more} />);
};
const puts = () => calls.filter((c) => c.init?.method === 'PUT').map((c) => ({ url: c.url, body: JSON.parse(String(c.init!.body)), auth: (c.init!.headers as Record<string, string>).Authorization }));
const gets = () => calls.filter((c) => !c.init?.method).length;
const row = (name: string) => within(screen.getByRole('region', { name }));

describe('the rows', () => {
  it('asked with the sign-in; RESISTANCES and VULNERABILITIES, each chip a type in its ring, the GM\'s with both + buttons', async () => {
    draw();
    const resist = await screen.findByRole('region', { name: 'Resistances' });
    expect(calls[0]).toEqual({ url: '/api/locations/7/resistances', init: { headers: { Authorization: 'Bearer tok' } } });
    expect(within(resist).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['+ RESISTANCE', 'RESIST COLD', 'IMMUNE SONIC']);
    expect(within(resist).getByRole('button', { name: '+ RESISTANCE' })).toBeTruthy();
    expect(row('Vulnerabilities').getByRole('button', { name: 'VULNERABLE LIGHTNING' }).style.color).toBe('var(--danger)');
    expect(row('Vulnerabilities').getByRole('button', { name: '+ VULNERABILITY' })).toBeTruthy();
    expect(within(resist).getByRole('button', { name: 'RESIST COLD' }).style.color).toBe('var(--cyan)');
  });

  it('a chip opened: what it means here and where it comes from; TAKE OFF BY HAND where it was added by hand', async () => {
    draw();
    await userEvent.click(await screen.findByRole('button', { name: 'RESIST COLD' }));
    const cold = screen.getByRole('group', { name: 'RESIST COLD' });
    expect(cold.textContent).toContain('Takes half, rounded down.');
    expect(cold.textContent).toContain('FROM: Ring of Warmth');
    expect(within(cold).queryByRole('button', { name: /off, by hand/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'VULNERABLE LIGHTNING' }));
    expect(screen.getByRole('group', { name: 'VULNERABLE LIGHTNING' }).textContent).toContain('Takes double.');
    await userEvent.click(screen.getByRole('button', { name: 'IMMUNE SONIC' }));
    expect(screen.queryByRole('group', { name: 'RESIST COLD' })).toBeNull();
    const sonic = screen.getByRole('group', { name: 'IMMUNE SONIC' });
    expect(sonic.textContent).toContain('FROM: vex, by hand');
    await userEvent.click(within(sonic).getByRole('button', { name: 'Take IMMUNE SONIC off, by hand' }));
    expect(puts()).toEqual([{ url: '/api/locations/7/resistances', body: { resistances: [] }, auth: 'Bearer tok' }]);
    // Asked again once changed.
    await vi.waitFor(() => expect(gets()).toBe(2));
    expect(screen.queryByRole('group', { name: 'IMMUNE SONIC' })).toBeNull();
  });

  it('+ RESISTANCE: RESIST or IMMUNE, then a type (one with a row by hand already not offered), added to the list kept', async () => {
    draw();
    await userEvent.click(await screen.findByRole('button', { name: '+ RESISTANCE' }));
    const add = screen.getByRole('group', { name: 'Add a resistance' });
    expect(within(add).getAllByRole('button').map((b) => b.textContent)).not.toContain('SONIC');
    await userEvent.click(within(add).getByRole('button', { name: 'IMMUNE' }));
    await userEvent.click(within(add).getByRole('button', { name: 'FIRE' }));
    expect(puts()[0].body).toEqual({ resistances: [{ kind: 'immune', type: 'sonic' }, { kind: 'immune', type: 'fire' }] });
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Add a resistance' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: '+ VULNERABILITY' }));
    const vul = screen.getByRole('group', { name: 'Add a vulnerability' });
    expect(within(vul).queryByRole('button', { name: 'IMMUNE' })).toBeNull();
    await userEvent.click(within(vul).getByRole('button', { name: 'ALL' }));
    expect(puts()[1].body).toEqual({ resistances: [{ kind: 'immune', type: 'sonic' }, { kind: 'vulnerable', type: 'all' }] });
  });

  it('two that cancel: said so, and taken as rolled', async () => {
    answer = { on: true, ...resistancesShown(DEF, { _resistances: [{ kind: 'resist', type: 'lightning' }] }, ['soaked'], null) };
    render(<TokenResistances locationId={7} />);
    await userEvent.click(await screen.findByRole('button', { name: 'LIGHTNING: RESIST AND VULNERABLE CANCEL' }));
    const open = screen.getByRole('group', { name: 'LIGHTNING: RESIST AND VULNERABLE CANCEL' });
    expect(open.textContent).toContain('Taken as rolled.');
    expect(open.textContent).toContain('FROM: Soaked · VULNERABLE · the GM, by hand · RESIST');
  });

  it('what the server refused, said; DONE closes the picker', async () => {
    draw();
    await userEvent.click(await screen.findByRole('button', { name: '+ RESISTANCE' }));
    answer = { ...(answer as object), refuse: 'You can only change the ones you added' };
    await userEvent.click(within(screen.getByRole('group', { name: 'Add a resistance' })).getByRole('button', { name: 'FIRE' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You can only change the ones you added');
    await userEvent.click(screen.getByRole('button', { name: 'DONE' }));
    expect(screen.queryByRole('group', { name: 'Add a resistance' })).toBeNull();
  });
});

describe('a player', () => {
  it('+ RESISTANCE on their own; never + VULNERABILITY; TAKE OFF only on theirs', async () => {
    draw('vex');
    expect(await screen.findByRole('button', { name: '+ RESISTANCE' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ VULNERABILITY' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'IMMUNE SONIC' }));
    expect(screen.getByRole('button', { name: 'Take IMMUNE SONIC off, by hand' })).toBeTruthy();
    cleanup();
    draw('ash');
    await userEvent.click(await screen.findByRole('button', { name: 'IMMUNE SONIC' }));
    expect(screen.queryByRole('button', { name: /off, by hand/ })).toBeNull();
  });

  it('VULNERABILITIES only where their character has one; none, no row', async () => {
    draw('vex');
    expect(await screen.findByRole('region', { name: 'Vulnerabilities' })).toBeTruthy();
    cleanup();
    answer = { on: true, ...resistancesShown(DEF, sheet, [], 'vex') };
    render(<TokenResistances locationId={7} authToken="tok" />);
    expect(await screen.findByRole('region', { name: 'Resistances' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Vulnerabilities' })).toBeNull();
  });
});

describe('REVEAL (8b4b)', () => {
  const NPC = { _resistances: [{ kind: 'resist', type: 'cold' }, { kind: 'vulnerable', type: 'fire' }], _revealed: ['cold'] };
  const as = (look: string, who: string | null = null, data: object = NPC, npc = true) => {
    answer = { on: true, ...resistancesShown(DEF, data, [], who, { look, npc }) };
    return render(<TokenResistances locationId={7} authToken="tok" />);
  };

  it('the GM on an NPC: the unrevealed dotted and marked; opened, REVEAL or HIDE AGAIN, the list sent whole', async () => {
    as('full');
    const fire = await screen.findByRole('button', { name: 'VULNERABLE FIRE, not revealed' });
    expect(fire.style.border).toBe('1px dotted');
    expect(fire.textContent).toContain('GM');
    const cold = screen.getByRole('button', { name: 'RESIST COLD' });
    expect(cold.style.border).toBe('1px solid');
    expect(cold.textContent).not.toContain('GM');
    expect(screen.getByRole('group', { name: 'What players see' }).textContent).toContain('PLAYERS SEE ONLY WHAT YOU REVEAL');
    await userEvent.click(fire);
    const open = screen.getByRole('group', { name: 'VULNERABLE FIRE' });
    expect(open.textContent).toContain("Players don't see it yet.");
    expect(open.textContent).toContain('FIRE: Burns.');
    await userEvent.click(within(open).getByRole('button', { name: 'Reveal VULNERABLE FIRE to players' }));
    expect(puts()).toEqual([{ url: '/api/locations/7/revealed', body: { revealed: ['cold', 'fire'] }, auth: 'Bearer tok' }]);
    // Kept open, to see it change.
    await vi.waitFor(() => expect(gets()).toBe(2));
    expect(screen.getByRole('group', { name: 'VULNERABLE FIRE' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'RESIST COLD' }));
    const coldOpen = screen.getByRole('group', { name: 'RESIST COLD' });
    expect(coldOpen.textContent).toContain('Players see it.');
    await userEvent.click(within(coldOpen).getByRole('button', { name: 'Hide RESIST COLD to players' }));
    expect(puts()[1].body).toEqual({ revealed: [] });
  });

  it('REVEAL ALL every chip shown; all shown, said so and no button', async () => {
    as('full');
    await userEvent.click(await screen.findByRole('button', { name: 'REVEAL ALL' }));
    expect(puts()).toEqual([{ url: '/api/locations/7/revealed', body: { revealed: ['cold', 'fire'] }, auth: 'Bearer tok' }]);
    cleanup();
    as('full', null, { ...NPC, _revealed: ['cold', 'fire'] });
    const seen = await screen.findByRole('group', { name: 'What players see' });
    expect(seen.textContent).toBe('PLAYERS SEE ALL OF THESE');
    expect(screen.queryByRole('button', { name: /not revealed/ })).toBeNull();
    cleanup();
    // Nothing on it: nothing to reveal.
    as('full', null, {});
    await screen.findByRole('region', { name: 'Resistances' });
    expect(screen.queryByRole('group', { name: 'What players see' })).toBeNull();
  });

  it('a player on an NPC: only what is revealed, to read, never where from; nothing at all before', async () => {
    as('revealed', 'vex');
    const cold = await screen.findByRole('button', { name: 'RESIST COLD' });
    expect(cold.textContent).not.toContain('GM');
    expect(screen.queryByRole('region', { name: 'Vulnerabilities' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ RESISTANCE' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'What players see' })).toBeNull();
    await userEvent.click(cold);
    const open = screen.getByRole('group', { name: 'RESIST COLD' });
    expect(open.textContent).toContain('Takes half, rounded down.');
    expect(open.textContent).not.toContain('FROM');
    expect(within(open).queryByRole('button', { name: /Reveal|Hide/ })).toBeNull();
    cleanup();
    as('revealed', 'vex', { ...NPC, _revealed: [] });
    await vi.waitFor(() => expect(gets()).toBe(2));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('another player\'s character: all of it, to read, with where from; nothing to reveal', async () => {
    as('watch', 'ash', { _resistances: [{ kind: 'immune', type: 'sonic', by: 'vex' }] }, false);
    await userEvent.click(await screen.findByRole('button', { name: 'IMMUNE SONIC' }));
    expect(screen.getByRole('group', { name: 'IMMUNE SONIC' }).textContent).toContain('FROM: vex, by hand');
    expect(screen.queryByRole('region', { name: 'Vulnerabilities' })).toBeNull();
    expect(screen.queryByRole('button', { name: /\+ |off, by hand|Reveal/ })).toBeNull();
  });
});

describe('the helper (8b4b)', () => {
  it('on hover and keyboard focus, in the theme\'s root, saying what the chip does; gone on leaving, Esc, or opening it', async () => {
    draw();
    const cold = await screen.findByRole('button', { name: 'RESIST COLD' });
    await userEvent.hover(cold);
    const tip = screen.getByRole('tooltip');
    expect([...tip.children].map((c) => c.textContent)).toEqual(['RESIST COLD', 'Takes half, rounded down.', 'From Ring of Warmth.', 'COLD: Freezes.']);
    expect(tip.parentElement).toBe(document.body);
    await userEvent.unhover(cold);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => cold.focus());
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { cold.blur(); cold.focus(); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => cold.blur());
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Opened, its words are in the chip's own box: no helper over it.
    await userEvent.click(cold);
    expect(screen.getByRole('group', { name: 'RESIST COLD' })).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'RESIST COLD' })).toBeNull();
  });
});

describe('nothing to show', () => {
  it('a built-in game or a refusal: nothing drawn; none: "None."; no sheet: nothing to add, so no row (8b4b)', async () => {
    answer = { on: false };
    render(<TokenResistances locationId={7} />);
    await vi.waitFor(() => expect(gets()).toBe(1));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(calls[0].init).toEqual({ headers: {} });
    expect(screen.queryByRole('region', { name: 'Resistances' })).toBeNull();
    cleanup();
    answer = { on: true, ...resistancesShown(DEF, {}, [], null) };
    render(<TokenResistances locationId={7} />);
    const resist = await screen.findByRole('region', { name: 'Resistances' });
    expect(resist.textContent).toContain('None.');
    cleanup();
    answer = { on: true, ...resistancesShown(DEF, null, [], null) };
    render(<TokenResistances locationId={7} />);
    await vi.waitFor(() => expect(gets()).toBe(3));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: 'Resistances' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Vulnerabilities' })).toBeNull();
  });

  it('asked again when the token\'s conditions change, and on a sheet or map change', async () => {
    const handlers = new Map<string, () => void>();
    const socket = { on: (e: string, fn: () => void) => handlers.set(e, fn), off: vi.fn() };
    const { rerender } = render(<TokenResistances locationId={7} socket={socket} conditionsKey="[]" />);
    await vi.waitFor(() => expect(gets()).toBe(1));
    rerender(<TokenResistances locationId={7} socket={socket} conditionsKey='[{"id":"soaked"}]' />);
    await vi.waitFor(() => expect(gets()).toBe(2));
    handlers.get('sheetUpdated')!();
    handlers.get('dataUpdated')!();
    expect(gets()).toBe(4);
  });
});
