import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { TryItPage, TRY_IT_DELAY_MS } from '../TryItPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { tierList } from '../../sheets/npcs';

/**
 * The builder's TRY IT page (4c3). Approved mockup builder-try-it (2026-10-08): a throwaway
 * character on the draft, formulas from what is typed; health on a pretend token in the HEALTH
 * folder's own panels; an NPC from a tier at a level. Every answer comes from the server's own code.
 */

const req = createRequire(import.meta.url);
const { starterSheet, effectiveSheet, fieldsOf } = req('../../../../backend/systemBuilder/sheet.js');
const { previewDerived } = req('../../../../backend/systemBuilder/derived.js');
const { tryHealth } = req('../../../../backend/systemBuilder/tryHealth.js');
const { npcSheetOf } = req('../../../../backend/systemBuilder/npc.js');
const { rollTier } = req('../../../../backend/systemBuilder/tierRolls.js');

afterEach(() => { cleanup(); vi.useRealTimers(); });

const H: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'level', label: 'Level' }, { id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - (@level + @str)' }],
  samples: { level: 3, str: 2 },
};
const TRACKS: Definition = { ...H, core: { health: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true } } };
const WITH_TIERS: Definition = { ...H, npc: { tiers: [
  { id: 'boss', label: 'BOSS', hp: '@level d10 + 10', defense: '14 + floor(@level / 2)', values: { level: '@level', str: '4d6' } },
  { id: 'mook', label: 'MOOK', hp: 5, defense: 10 },
] } };

type Api = ReturnType<typeof systemsApi>;
const serverApi = () => ({
  previewSheet: vi.fn(async (def: Definition) => ({ ok: true as const, value: { sheet: effectiveSheet(def), starter: starterSheet(def) } })),
  previewValues: vi.fn(async (def: Definition) => ({ ok: true as const, value: previewDerived({ lookups: def.lookups, derived: def.derived }, (def.samples ?? {}) as object) })),
  tryHealth: vi.fn(async (def: Definition, state: object) => ({ ok: true as const, value: tryHealth(def, state) })),
  tryTier: vi.fn(async (def: Definition, tier: string, level: number) => {
    const t = tierList(def).find((x) => x.id === tier);
    if (!t) return { ok: false as const, error: 'No such tier', status: 404 };
    const fields = new Map(fieldsOf(npcSheetOf(def)).map((f: { id: string }) => [f.id, f]));
    return { ok: true as const, value: rollTier(t, level, fields, { hp: 9999, defense: 99 }) };
  }),
});

const open = (start: Definition = H, api: ReturnType<typeof serverApi> | null = serverApi()) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <TryItPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={(api ?? undefined) as unknown as Api | undefined} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1], api };
};
const character = () => within(screen.getByRole('region', { name: 'Made-up character' }));
const health = () => within(screen.getByRole('region', { name: 'Health' }));
const npcBox = () => within(screen.getByRole('region', { name: 'An NPC to fight' }));
const valueOf = (label: string) => (character().getByLabelText(label) as HTMLInputElement).value;

describe('the made-up character', () => {
  it('starts as the sample on the draft\'s own sheet, its formulas worked out by the server', async () => {
    open();
    expect(await character().findByDisplayValue('Sample character')).toBeTruthy();
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    expect(valueOf('Strength')).toBe('2');
    expect(screen.queryByRole('button', { name: 'SAVE AS THE SAMPLE CHARACTER' })).toBeNull();
  });

  it('works formulas out again from what is typed, saving nothing', async () => {
    const { edits } = open();
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    fireEvent.change(character().getByLabelText('Strength'), { target: { value: '6' } });
    await waitFor(() => expect(valueOf('Save')).toBe('7'));
    expect(edits).toEqual([]);
  });

  it('saves its stats as the sample when asked, and only its stats', async () => {
    const { last } = open();
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    fireEvent.change(character().getByLabelText('Strength'), { target: { value: '6' } });
    fireEvent.change(character().getByDisplayValue('Sample character'), { target: { value: 'Vex' } });
    await userEvent.click(screen.getByRole('button', { name: 'SAVE AS THE SAMPLE CHARACTER' }));
    expect(last().samples).toEqual({ level: 3, str: 6 });
    expect(screen.queryByRole('button', { name: 'SAVE AS THE SAMPLE CHARACTER' })).toBeNull();
  });

  it('offers no SAVE AS THE SAMPLE CHARACTER with nowhere to save it, as on a built-in example', async () => {
    render(<TryItPage definition={H} api={serverApi() as unknown as Api} />);
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    fireEvent.change(character().getByLabelText('Strength'), { target: { value: '6' } });
    await waitFor(() => expect(valueOf('Save')).toBe('7'));
    expect(screen.queryByRole('button', { name: 'SAVE AS THE SAMPLE CHARACTER' })).toBeNull();
    expect(screen.getByRole('button', { name: 'RESET TO THE SAMPLE' })).toBeTruthy();
  });

  it('goes back to the sample on RESET, health and all', async () => {
    open();
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    fireEvent.change(character().getByLabelText('Strength'), { target: { value: '6' } });
    await userEvent.click(await health().findByRole('button', { name: 'DAMAGE' }));
    await health().findByTestId('health-log');
    await userEvent.click(screen.getByRole('button', { name: 'RESET TO THE SAMPLE' }));
    expect(valueOf('Strength')).toBe('2');
    expect(health().queryByTestId('health-log')).toBeNull();
    expect(health().getByText('10 / 10')).toBeTruthy();
  });

  it('shows a formula\'s mistake', async () => {
    open({ ...H, derived: [{ id: 'save', label: 'Save', formula: '16 - (' }] });
    expect((await screen.findByRole('alert')).textContent).toMatch(/derived save/);
  });

  it('works formulas out only a moment after the last keystroke', async () => {
    vi.useFakeTimers();
    const { api } = open();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const before = api!.previewValues.mock.calls.length;
    const str = character().getByLabelText('Strength');
    fireEvent.change(str, { target: { value: '4' } });
    fireEvent.change(str, { target: { value: '5' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(TRY_IT_DELAY_MS - 1); });
    expect(api!.previewValues.mock.calls.length).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api!.previewValues.mock.calls.length).toBe(before + 1);
    expect(api!.previewValues.mock.calls.at(-1)![0].samples).toEqual({ level: 3, str: 5 });
  });
});

describe('health on a pretend token', () => {
  it('one pool: DAMAGE takes temp HP first, HEAL, and the maximum as the game sets it', async () => {
    open();
    const amount = await health().findByLabelText('Amount');
    fireEvent.change(amount, { target: { value: '4' } });
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    await waitFor(() => expect(health().getByText('6 / 10')).toBeTruthy());
    await userEvent.click(health().getByRole('button', { name: 'HEAL' }));
    await waitFor(() => expect(health().getByText('10 / 10')).toBeTruthy());
    fireEvent.change(health().getByLabelText('Max HP'), { target: { value: '7' } });
    await userEvent.click(health().getByRole('button', { name: 'SET' }));
    await waitFor(() => expect(health().getByText('7 / 7')).toBeTruthy());
    expect(health().getByTestId('health-log').textContent).toContain('DAMAGE 4 → 6/10');
    expect(health().getByTestId('health-log').lastElementChild!.textContent).toBe('MAX → 7');
  });

  it('says why the server refused', async () => {
    open();
    fireEvent.change(await health().findByLabelText('Amount'), { target: { value: '0' } });
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    expect((await health().findByRole('alert')).textContent).toBe('An amount above 0');
  });

  it('shows what everyone else sees: the heartbeat, never a number', async () => {
    open();
    expect(await health().findByText('WHAT OTHERS SEE')).toBeTruthy();
  });

  it('uses the HEALTH folder\'s own panel for a custom model, with what others see of it', async () => {
    open(TRACKS);
    const tracks = await health().findByRole('group', { name: /track/i });
    await userEvent.click(within(tracks).getByRole('button', { name: 'STUN' }));
    fireEvent.change(health().getByLabelText('Amount'), { target: { value: '3' } });
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    await waitFor(() => expect(health().getByTestId('second-track').textContent).toContain('STUN'));
    expect(health().getByTestId('health-log').textContent).toContain('DAMAGE 3');
  });

  it('sets the token\'s own maximum outside the model\'s rules, and a second track\'s through them', async () => {
    open(TRACKS);
    fireEvent.change(await health().findByLabelText('MAX PHYSICAL'), { target: { value: '12' } });
    await userEvent.click(health().getByRole('button', { name: 'SET' }));
    await waitFor(() => expect(health().getByText(/^10 \/ 12/)).toBeTruthy());
    expect(health().queryByRole('alert')).toBeNull();

    await userEvent.click(within(health().getByRole('group', { name: /track/i })).getByRole('button', { name: 'STUN' }));
    fireEvent.change(health().getByLabelText('MAX STUN'), { target: { value: '6' } });
    await userEvent.click(health().getByRole('button', { name: 'SET' }));
    fireEvent.change(health().getByLabelText('Amount'), { target: { value: '3' } });
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    await waitFor(() => expect(health().getByTestId('second-track').textContent).toContain('STUN — FULL'));
  });

  it('says a system with token health off tracks harm as conditions', async () => {
    open({ ...H, parts: { token_health: { on: false } } });
    expect(await health().findByText('THIS SYSTEM TRACKS HARM AS CONDITIONS, NOT HEALTH.')).toBeTruthy();
    expect(health().queryByText('WHAT OTHERS SEE')).toBeNull();
  });
});

describe('an NPC to fight', () => {
  it('rolls one from a tier at a level, as GENERATE_SHEET would', async () => {
    const { api } = open(WITH_TIERS);
    fireEvent.change(await npcBox().findByLabelText('NPC level'), { target: { value: '6' } });
    await userEvent.click(npcBox().getByRole('button', { name: 'MAKE AN NPC' }));
    const npc = await npcBox().findByTestId('npc');
    expect(api!.tryTier).toHaveBeenLastCalledWith(expect.anything(), 'boss', 6);
    expect(npc.textContent).toMatch(/HP\d+ 6d10 \[/);
    expect(npc.textContent).toContain('DEFENSE17');
    expect(npc.textContent).toMatch(/STRENGTH\d+ 4d6/);
    expect(npcBox().getByRole('button', { name: 'ROLL AGAIN' })).toBeTruthy();
  });

  it('rolls the tier picked', async () => {
    const { api } = open(WITH_TIERS);
    await userEvent.selectOptions(await npcBox().findByLabelText('Tier'), 'mook');
    await userEvent.click(npcBox().getByRole('button', { name: 'MAKE AN NPC' }));
    expect((await npcBox().findByTestId('npc')).textContent).toContain('HP5');
    expect(api!.tryTier).toHaveBeenLastCalledWith(expect.anything(), 'mook', 3);
  });

  it('says where tiers are made when there are none', async () => {
    open();
    expect(await npcBox().findByText('No tiers yet: make one in NPCS.')).toBeTruthy();
  });
});

describe('without the server', () => {
  it('says so instead of drawing anything', () => {
    open(WITH_TIERS, null);
    expect(screen.getByText('No sheet without the server.')).toBeTruthy();
    expect(screen.getByText('No health without the server.')).toBeTruthy();
    expect((npcBox().getByRole('button', { name: 'MAKE AN NPC' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
