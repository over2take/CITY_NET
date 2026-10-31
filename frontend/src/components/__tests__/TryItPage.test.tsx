import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { TryItPage, TRY_IT_DELAY_MS } from '../TryItPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { tierList } from '../../sheets/npcs';
import { HINTS } from '../../sheets/builderHelp';

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
const { tryRest } = req('../../../../backend/systemBuilder/tryRest.js');

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
  // Every die shows its highest face, so a rolled rest is known.
  tryRest: vi.fn(async (def: Definition, state: object) => {
    const r = tryRest(def, state, () => 0.999999);
    return r.ok ? { ok: true as const, value: r } : { ok: false as const, error: r.error, status: 400 };
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

/** HEARTH with rests (4f6c): a breather rolls, the end of a session sets a stat. */
const RESTED: Definition = { ...H, rests: {
  short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d6 + @level' }] },
  end_of_session: { refills: [{ what: 'str', how: 'to', amount: '@level' }] },
  end_of_scene: { on: false },
} };
const restBox = () => within(screen.getByRole('region', { name: 'A rest' }));

describe('CALL A REST', () => {
  it('rolls one of the draft\'s rests on the pretend token, logging the line the game would', async () => {
    const { api } = open(RESTED);
    await health().findByRole('button', { name: 'DAMAGE' });
    fireEvent.change(health().getByLabelText('Amount'), { target: { value: '8' } });
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    await waitFor(() => expect(health().getByText(/^2 \/ 10/)).toBeTruthy());
    expect(health().getByRole('img', { name: /Heart monitor/ }).getAttribute('data-band')).not.toBe('steady');
    expect(within(restBox().getByLabelText('Rest')).getAllByRole('option').map((o) => o.textContent)).toEqual(['SHORT REST', 'LONG REST', 'END OF SESSION']);
    await userEvent.click(restBox().getByRole('button', { name: 'CALL A REST' }));
    // 2 + a 6 + level 3, held to the maximum of 10.
    await waitFor(() => expect(health().getByText(/^10 \/ 10/)).toBeTruthy());
    expect(screen.getByTestId('health-log').textContent).toContain('SHORT REST · Sample: HP 2 → 10; rolled 1d6 + @level = 9 (1d6: 6)');
    expect(api!.tryRest.mock.calls[0][1]).toMatchObject({ rest: 'short_rest', roll: true, token: { current: 2, max: 10 } });
    // What others see is asked for again, for the token as the rest left it: a steady heartbeat.
    await waitFor(() => expect(api!.tryHealth).toHaveBeenLastCalledWith(expect.anything(), { token: { current: 10, max: 10, temp: 0 }, sheet: {} }));
    await waitFor(() => expect(health().getByRole('img', { name: /Heart monitor/ }).getAttribute('data-band')).toBe('steady'));
  });

  it('puts what a rest refilled back into the character, its formulas worked out again', async () => {
    open(RESTED);
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    fireEvent.change(restBox().getByLabelText('Rest'), { target: { value: 'end_of_session' } });
    await userEvent.click(restBox().getByRole('button', { name: 'CALL A REST' }));
    await waitFor(() => expect(valueOf('Strength')).toBe('3'));
    await waitFor(() => expect(valueOf('Save')).toBe('10'));
    expect(screen.getByTestId('health-log').textContent).toContain('END OF SESSION · Sample: Strength 2 → 3');
  });

  it('says when no rest is on, and what the server refused', async () => {
    open({ ...H, rests: { short_rest: { on: false }, long_rest: { on: false }, end_of_scene: { on: false }, end_of_session: { on: false } } });
    expect(await restBox().findByText('No rest is on: turn one on in RESTS.')).toBeTruthy();
    cleanup();
    const api = serverApi();
    api.tryRest.mockResolvedValueOnce({ ok: false as const, error: 'Not one of this system\'s rests', status: 400 } as never);
    open(RESTED, api);
    await userEvent.click(await restBox().findByRole('button', { name: 'CALL A REST' }));
    expect(await restBox().findByRole('alert')).toHaveTextContent('Not one of this system\'s rests');
  });

  it('redraws a custom model\'s panel from what the rest left: the second track cleared', async () => {
    open({ ...TRACKS, rests: { long_rest: { refills: [{ what: 'health', how: 'full' }] } } });
    await userEvent.click(within(await health().findByRole('group', { name: /track/i })).getByRole('button', { name: 'STUN' }));
    fireEvent.change(health().getByLabelText('MAX STUN'), { target: { value: '6' } });
    await userEvent.click(health().getByRole('button', { name: 'SET' }));
    fireEvent.change(health().getByLabelText('Amount'), { target: { value: '6' } });
    await userEvent.click(health().getByRole('button', { name: 'DAMAGE' }));
    // What others see: the stun track full.
    await waitFor(() => expect(health().getByTestId('second-track').textContent).toContain('STUN — FULL'));
    fireEvent.change(restBox().getByLabelText('Rest'), { target: { value: 'long_rest' } });
    await userEvent.click(restBox().getByRole('button', { name: 'CALL A REST' }));
    await waitFor(() => expect(health().getByTestId('second-track').textContent).toBe('STUN'));
  });

  it('can\'t be called without the server', () => {
    open(RESTED, null);
    expect((restBox().getByRole('button', { name: 'CALL A REST' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the made-up character', () => {
  it('starts as the sample on the draft\'s own sheet, its formulas worked out by the server', async () => {
    open();
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    expect(valueOf('Strength')).toBe('2');
    // Who they are, on the CHARACTER tab beside STATS (2026-10-31).
    await userEvent.click(character().getByText('CHARACTER', { selector: 'button' }));
    expect(await character().findByDisplayValue('Sample character')).toBeTruthy();
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
    await userEvent.click(character().getByText('CHARACTER', { selector: 'button' }));
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

describe('the "?"', () => {
  it('explains the health, what others see, the level an NPC is made at, and the rules to try', async () => {
  const allShown = (page: string, count: number) => {
    const keys = Object.keys(HINTS).filter((k) => k.startsWith(`${page}.`)) as (keyof typeof HINTS)[];
    expect(keys).toHaveLength(count);
    for (const k of keys) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  };
    open({ ...WITH_TIERS, house_rules: [{ id: 'magic', name: 'MAGIC' }] } as Definition);
    await screen.findByText('WHAT OTHERS SEE');
    allShown('try', 4);
    expect(screen.getByRole('spinbutton', { name: 'NPC level' })).toBeTruthy();
  });
});

describe('RULES (4j5b)', () => {
  // Approved mockup optional-rules (2026-10-14): the draft tried with each house rule on or off,
  // starting as each STARTS says; the game keeps the GM's choice.
  const RULED = {
    ...H,
    house_rules: [{ id: 'magic', name: 'Magic' }, { id: 'gritty', name: 'Gritty wounds' }, { id: 'markets', name: 'Markets', starts: true }],
    derived: [{ id: 'save', label: 'Save', formula: '16 - (@level + @str)', alternative: { rule: 'gritty', formula: '10 - @str' } }],
    sheet: (() => {
      const sheet = starterSheet(H);
      sheet.sections.push({ id: 'spells', label: 'SPELLS', layout: 'list', tab: 'STATS', only_with: 'magic', fields: [{ id: 'spell', label: 'Spell', type: 'text' }] });
      return sheet;
    })(),
  } as unknown as Definition;
  const rules = () => within(screen.getByRole('group', { name: 'House rules to try' }));
  const flip = (name: string) => userEvent.click(rules().getByRole('switch', { name: `${name} on` }));

  it('switches each rule, starting as it STARTS, and never touches the draft', async () => {
    const { edits } = open(RULED);
    expect(rules().getAllByRole('switch').map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')]))
      .toEqual([['MAGIC on', 'false'], ['GRITTY WOUNDS on', 'false'], ['MARKETS on', 'true']]);
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    expect(character().queryByText(/─── SPELLS ───/)).toBeNull();
    await flip('GRITTY WOUNDS');
    await waitFor(() => expect(valueOf('Save')).toBe('8'));
    await flip('MAGIC');
    expect(await character().findByText(/─── SPELLS ───/)).toBeTruthy();
    await flip('GRITTY WOUNDS');
    await waitFor(() => expect(valueOf('Save')).toBe('11'));
    expect(edits).toEqual([]);
  });

  it('SAVE AS THE SAMPLE CHARACTER still writes the draft itself, rules and all', async () => {
    const { last } = open(RULED);
    await flip('GRITTY WOUNDS');
    await waitFor(() => expect(valueOf('Save')).toBe('8'));
    fireEvent.change(character().getByLabelText('Strength'), { target: { value: '5' } });
    await userEvent.click(screen.getByRole('button', { name: 'SAVE AS THE SAMPLE CHARACTER' }));
    expect(last().samples).toEqual({ level: 3, str: 5 });
    expect(last().derived).toEqual(RULED.derived);
    expect(last().sheet).toEqual(RULED.sheet);
  });

  it('isn\'t there in a system with no house rules', () => {
    open();
    expect(screen.queryByRole('group', { name: 'House rules to try' })).toBeNull();
  });
});