import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { RestsPage } from '../RestsPage';
import type { Definition } from '../../sheets/systemsApi';

/**
 * The builder's RESTS page (4f4a). Approved mockup builder-rests (2026-10-09): the standard four with
 * switches and a system's own, each one's name, the rests it also counts as (never in a loop), its
 * refills in order (what, how, amount, a track where there are two) and the conditions it wears off.
 * What a rest can refill comes from the sheet the server says the system plays with. Every change is
 * held to the server's checks.
 */

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { effectiveSheet } = req('../../../../backend/systemBuilder/sheet.js');
afterEach(cleanup);

const H: Definition = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  sheet: {
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }] },
      { id: 'body', label: 'BODY', layout: 'grid', fields: [
        { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
        { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
        { id: 'fatigue', label: 'Fatigue', type: 'number' },
      ] },
      { id: 'magic', label: 'MAGIC', layout: 'grid', fields: [
        { id: 'slots', label: 'Spell slots', type: 'number', maxField: 'slots_max' },
        { id: 'slots_max', label: 'Slots max', type: 'number' },
      ] },
    ],
  },
  rests: { short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] }, long_rest: { counts_as: ['short_rest'] } },
  conditions: { exhausted: { ends: 'rest', at: ['short_rest'] }, stunned: { ends: 'rounds', rounds: 1 } },
};
const serverApi = () => ({ previewSheet: vi.fn(async (def: Definition) => ({ ok: true as const, value: { sheet: effectiveSheet(def), starter: effectiveSheet(def) } })) });

/** `api` null for a page with no server to ask (a default only fills in for undefined). */
const open = (start: Definition = H, api: ReturnType<typeof serverApi> | null = serverApi()) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <RestsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={(api ?? undefined) as never} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1], api };
};
const list = () => within(screen.getByRole('list', { name: 'Rests' }));
const detail = (name: string) => within(screen.getByRole('region', { name }));
const stored = (def: Definition) => def.rests as Record<string, Record<string, unknown>> | undefined;
const publishes = (def: Definition) => expect(checkDefinition(def).problems).toEqual([]);
/** The page once the server has said what the sheet holds. */
const sheetLoaded = async (api: ReturnType<typeof serverApi> | null) => {
  await waitFor(() => expect(api!.previewSheet).toHaveBeenCalled());
  await act(async () => { await api!.previewSheet.mock.results[0].value; });
};

describe('the list', () => {
  it('shows the four standard rests with switches, all on, the long rest open', () => {
    open();
    expect(list().getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual(['Short rest on', 'Long rest on', 'End of scene on', 'End of session on']);
    expect(screen.getByText('4 ON · 4 OF 12')).toBeTruthy();
    expect(detail('Long rest rest').getByText('STANDARD REST')).toBeTruthy();
  });

  it('turns a standard one off and on, storing only that it is off', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('switch', { name: 'End of scene on' }));
    expect(stored(last())!.end_of_scene).toEqual({ on: false });
    expect(screen.getByText('3 ON · 4 OF 12')).toBeTruthy();
    await userEvent.click(list().getByRole('switch', { name: 'End of scene on' }));
    expect(last()).toEqual(H);
  });

  it('adds one of its own, opens it, and deletes it only once asked', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ REST' }));
    expect(stored(last())!.new_rest).toEqual({ name: 'New rest' });
    expect(detail('New rest rest').getByText('ONE OF THIS SYSTEM\'S OWN')).toBeTruthy();
    // One of the system's own is deleted, never switched off.
    expect(list().getAllByRole('switch')).toHaveLength(4);
    publishes(last());
    await userEvent.click(detail('New rest rest').getByRole('button', { name: 'DELETE' }));
    await userEvent.click(detail('New rest rest').getByRole('button', { name: 'KEEP' }));
    expect(stored(last())!.new_rest).toBeDefined();
    await userEvent.click(detail('New rest rest').getByRole('button', { name: 'DELETE' }));
    await userEvent.click(detail('New rest rest').getByRole('button', { name: 'DELETE' }));
    expect(stored(last())!.new_rest).toBeUndefined();
  });

  it('stops adding at twelve', async () => {
    const full: Definition = { ...H, rests: { ...(H.rests as object), ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`own_${i}`, { name: `Own ${i}` }])) } };
    open(full);
    expect((screen.getByRole('button', { name: '+ REST' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('12 ON · 12 OF 12')).toBeTruthy();
  });
});

describe('a rest', () => {
  it('is renamed, a standard one\'s own name the placeholder and a blank one put back', async () => {
    const { last } = open();
    const name = detail('Long rest rest').getByLabelText('NAME') as HTMLInputElement;
    expect(name.placeholder).toBe('Long rest');
    expect(name.value).toBe('');
    fireEvent.change(name, { target: { value: 'Night\'s sleep' } });
    expect(stored(last())!.long_rest).toEqual({ name: 'Night\'s sleep', counts_as: ['short_rest'] });
    publishes(last());
    fireEvent.change(detail('Night\'s sleep rest').getByLabelText('NAME'), { target: { value: '' } });
    expect(stored(last())!.long_rest).toEqual({ counts_as: ['short_rest'] });
  });

  it('counts as other rests that are on, never one that would loop back', async () => {
    const { last } = open();
    const counts = within(detail('Long rest rest').getByRole('group', { name: 'Also counts as' }));
    expect(counts.getAllByRole('checkbox').map((c) => c.textContent)).toEqual(['SHORT REST', 'END OF SCENE', 'END OF SESSION']);
    await userEvent.click(counts.getByRole('checkbox', { name: 'END OF SESSION' }));
    expect(stored(last())!.long_rest).toEqual({ counts_as: ['short_rest', 'end_of_session'] });
    await userEvent.click(counts.getByRole('checkbox', { name: 'SHORT REST' }));
    expect(stored(last())!.long_rest).toEqual({ counts_as: ['end_of_session'] });
    await userEvent.click(counts.getByRole('checkbox', { name: 'SHORT REST' }));
    // A rest turned off isn't offered.
    await userEvent.click(list().getByRole('switch', { name: 'End of scene on' }));
    expect(within(detail('Long rest rest').getByRole('group', { name: 'Also counts as' })).queryByRole('checkbox', { name: 'END OF SCENE' })).toBeNull();
    await userEvent.click(list().getByRole('switch', { name: 'End of scene on' }));
    // The short rest can't count as the long rest, which already counts as it.
    await userEvent.click(list().getByRole('button', { name: 'SHORT REST' }));
    const back = within(detail('Short rest rest').getByRole('group', { name: 'Also counts as' })).getByRole('checkbox', { name: 'LONG REST' }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(back.title).toBe('That rest already counts as this one');
    publishes(last());
  });
});

describe('refills', () => {
  it('show the ones from rests it counts as, then its own, added and fitted to what they name', async () => {
    const { last, api } = open();
    await sheetLoaded(api);
    const d = detail('Long rest rest');
    expect(d.getByText('SHORT REST: HEALTH up by 1d8 + @con_mod')).toBeTruthy();
    await userEvent.click(d.getByRole('button', { name: '+ REFILL' }));
    expect(stored(last())!.long_rest.refills).toEqual([{ what: 'health', how: 'full' }]);
    fireEvent.change(d.getByLabelText('Refill 1: what'), { target: { value: 'fatigue' } });
    expect(stored(last())!.long_rest.refills).toEqual([{ what: 'fatigue', how: 'by', amount: '1' }]);
    fireEvent.change(d.getByLabelText('Refill 1: amount'), { target: { value: '-2' } });
    expect(stored(last())!.long_rest.refills).toEqual([{ what: 'fatigue', how: 'by', amount: '-2' }]);
    fireEvent.change(d.getByLabelText('Refill 1: how'), { target: { value: 'to' } });
    expect(stored(last())!.long_rest.refills).toEqual([{ what: 'fatigue', how: 'to', amount: '-2' }]);
    publishes(last());
    fireEvent.change(d.getByLabelText('Refill 1: what'), { target: { value: 'section:magic' } });
    expect(stored(last())!.long_rest.refills).toEqual([{ what: 'section:magic', how: 'max' }]);
    expect(within(d.getByLabelText('Refill 1: how')).getAllByRole('option').map((o) => o.textContent)).toEqual(['ALL TO THEIR MAXIMUMS']);
    expect(d.queryByLabelText('Refill 1: amount')).toBeNull();
    publishes(last());
    await userEvent.click(d.getByRole('button', { name: 'Remove refill 1' }));
    expect(stored(last())!.long_rest).toEqual({ counts_as: ['short_rest'] });
  });

  it('offer what the server\'s sheet holds, and only health before it answers or without it', async () => {
    open(H, null);
    await userEvent.click(detail('Long rest rest').getByRole('button', { name: '+ REFILL' }));
    expect(within(detail('Long rest rest').getByLabelText('Refill 1: what')).getAllByRole('option').map((o) => o.textContent)).toEqual(['HEALTH']);
    cleanup();
    const { api } = open();
    await sheetLoaded(api);
    await userEvent.click(detail('Long rest rest').getByRole('button', { name: '+ REFILL' }));
    expect(within(detail('Long rest rest').getByLabelText('Refill 1: what')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['HEALTH', 'Fatigue', 'Spell slots', 'Slots max', 'SECTION · MAGIC']);
  });

  it('name a track in a system with two, for health up by an amount', async () => {
    const tracks: Definition = { format: 1, name: 'T', core: { health: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }] } },
      rests: { short_rest: { refills: [{ what: 'health', how: 'by', amount: '2' }] } } };
    const { last } = open(tracks);
    await userEvent.click(list().getByRole('button', { name: 'SHORT REST' }));
    const track = detail('Short rest rest').getByLabelText('Refill 1: track');
    expect(within(track).getAllByRole('option').map((o) => o.textContent)).toEqual(['PHYSICAL', 'STUN']);
    fireEvent.change(track, { target: { value: 'stun' } });
    expect(stored(last())!.short_rest.refills).toEqual([{ what: 'health', how: 'by', amount: '2', track: 'stun' }]);
    publishes(last());
    fireEvent.change(detail('Short rest rest').getByLabelText('Refill 1: track'), { target: { value: '' } });
    expect(stored(last())!.short_rest.refills).toEqual([{ what: 'health', how: 'by', amount: '2' }]);
  });

  it('say when one names something the sheet no longer has', async () => {
    const { api } = open({ ...H, rests: { long_rest: { refills: [{ what: 'gold', how: 'to', amount: '1' }] } } });
    await sheetLoaded(api);
    expect(within(detail('Long rest rest').getByLabelText('Refill 1: what')).getByRole('option', { name: 'gold (GONE)' })).toBeTruthy();
  });

  it('say there is nothing to refill with no health and no numbers', () => {
    open({ format: 1, name: 'Bare', parts: { token_health: { on: false } } }, null);
    expect((detail('Long rest rest').getByRole('button', { name: '+ REFILL' }) as HTMLButtonElement).disabled).toBe(true);
    expect(detail('Long rest rest').getByText(/Nothing to refill/)).toBeTruthy();
  });
});

describe('what wears off', () => {
  it('is ticked here as on the CONDITIONS page, a rounds one greyed and one from a counted rest said so', async () => {
    const { last } = open();
    const off = within(detail('Long rest rest').getByRole('group', { name: 'Wears off' }));
    const exhausted = off.getByRole('checkbox', { name: /EXHAUSTED/ });
    expect(exhausted.getAttribute('aria-checked')).toBe('false');
    expect(exhausted.textContent).toContain('(as short rest)');
    expect((off.getByRole('checkbox', { name: /STUNNED/ }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(off.getByRole('checkbox', { name: /POISONED/ }));
    expect((last().conditions as Record<string, unknown>).poisoned).toEqual({ ends: 'rest', at: ['long_rest'] });
    await userEvent.click(off.getByRole('checkbox', { name: /EXHAUSTED/ }));
    expect((last().conditions as Record<string, unknown>).exhausted).toEqual({ ends: 'rest', at: ['short_rest', 'long_rest'] });
    publishes(last());
    await userEvent.click(off.getByRole('checkbox', { name: /POISONED/ }));
    expect((last().conditions as Record<string, unknown>).poisoned).toBeUndefined();
  });
});
