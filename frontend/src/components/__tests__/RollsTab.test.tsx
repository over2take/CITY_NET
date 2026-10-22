import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { StatsRulesPage } from '../StatsRulesPage';
import type { Definition } from '../../sheets/systemsApi';
import { withDicePreset } from '../../sheets/dice';
import { PRESETS } from '../../sheets/rolls';
import { HINTS } from '../../sheets/builderHelp';

/**
 * STATS & RULES' ROLLS tab (6b1a; approved mockup docs/mockups/builder-rolls.html, 2026-10-19): the
 * rolls listed, a new one from a preset, another preset's steps only after asking, the five steps
 * shown in words, ROLLED BY picked, a roll removed, and TEST ROLL drawing what the server's engine
 * rolled for the sample: the dice kept and not, the working and what it came to.
 */

afterEach(() => cleanup());

const req = createRequire(import.meta.url);
const tableRolls = req('../../../../backend/systemBuilder/tableRolls.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const serverConditions = req('../../../../backend/systemBuilder/conditions.js');

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight', tie: 'str' }, { id: 'lore', label: 'Lore', tie: 'str' }] },
  ],
  samples: { str: 16, fight: 2, lore: 3 },
  derived: [{ id: 'save', label: 'Save', formula: '16' }],
  rolls: [{ id: 'skill', label: 'Skill check', ...PRESETS.pbta.roll, by: ['skills'] }],
};

/** The server's engine on dice that show 4 then 5, as the route would roll for the sample, under the conditions asked. */
const testRoll = vi.fn(async (definition: Definition, rollId: string, fieldId?: string | null, changes: string[] = [], conditions: string[] = []) => {
  const roll = (definition.rolls as { id: string }[]).find((r) => r.id === rollId);
  const faces = [4, 5, 2];
  let i = 0;
  const made = tableRolls.rollField({ definition, data: definition.samples, fieldId: fieldId ?? null, roll, chosen: changes, rng: () => (faces[i++ % 3] - 0.5) / 6, who: 'The sample', tryCosts: true,
    conditions: serverConditions.conditionsOf(definition).filter((c: { id: string }) => conditions.includes(c.id)) });
  return { ok: true as const, value: { field: fieldId ?? null, fields: [], result: made.result, historyText: made.historyText, total: made.total } };
});
const api = { previewValues: vi.fn(async () => ({ ok: true as const, value: { values: {}, problems: [] } })), testRoll } as never;

const open = (start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <StatsRulesPage definition={def} api={api} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { last: () => edits[edits.length - 1] };
};
const toRolls = () => userEvent.click(screen.getByRole('tab', { name: 'ROLLS' }));
const rollsOf = (def: Definition) => def.rolls as Record<string, unknown>[];

describe('the ROLLS tab', () => {
  it('picking another roll shows that roll alone, with its own TEST ROLL (a key the two once shared)', async () => {
    open({ ...HEARTH, rolls: [...(HEARTH.rolls as object[]), { id: 'save', label: 'Save', dice: [{ count: '1', sides: 20 }], by: ['save'] }] });
    await toRolls();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Rolls' })).getByRole('button', { name: /^SAVE/ }));
    expect(screen.getAllByLabelText('Roll name').map((i) => (i as HTMLInputElement).value)).toEqual(['Save']);
    expect(screen.getAllByTestId('test-roll')).toHaveLength(1);
  });

  it('lists the rolls and shows the one picked: its name, its five steps in words, what it is rolled by', async () => {
    open();
    await toRolls();
    expect(within(screen.getByRole('navigation', { name: 'Rolls' })).getByRole('button', { name: /SKILL CHECK/ }).getAttribute('aria-current')).toBe('true');
    const roll = screen.getByTestId('roll-skill');
    expect((within(roll).getByLabelText('Roll name') as HTMLInputElement).value).toBe('Skill check');
    const dice = within(roll).getByRole('region', { name: 'DICE' });
    expect([(within(dice).getByLabelText('Dice 1: how many') as HTMLInputElement).value, (within(dice).getByLabelText('Dice 1: size') as HTMLSelectElement).value]).toEqual(['2', '6']);
    expect(within(within(roll).getByRole('region', { name: 'READ THE DICE' })).getByRole('button', { name: 'SUM' }).getAttribute('aria-pressed')).toBe('true');
    const compare = within(roll).getByRole('region', { name: 'ADD AND COMPARE' });
    expect((within(compare).getByLabelText('Add') as HTMLInputElement).value).toBe('@this');
    expect([(within(compare).getByLabelText('Band 2: up to') as HTMLInputElement).value, (within(compare).getByLabelText('Band 2: words') as HTMLInputElement).value]).toEqual(['9', 'Success at a cost']);
    const changes = within(roll).getByRole('region', { name: 'CHANGE A ROLL' });
    expect([(within(changes).getByLabelText('Change 1: words') as HTMLInputElement).value, (within(changes).getByLabelText('Change 1: adds') as HTMLInputElement).value]).toEqual(['Forward +1', '1']);
    const by = within(roll).getByRole('region', { name: 'Rolled by' });
    expect(within(by).getByRole('button', { name: 'SKILLS' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(by).getByRole('button', { name: 'STRENGTH' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('makes a new roll from a preset, named after it, and opens it', async () => {
    const { last } = open();
    await toRolls();
    await userEvent.click(screen.getByRole('button', { name: '+ ROLL' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'New roll from a preset' })).getByRole('button', { name: 'D&D CHECK' }));
    expect(rollsOf(last()).map((r) => r.id)).toEqual(['skill', 'd_d_check']);
    expect((within(screen.getByTestId('roll-d_d_check')).getByLabelText('Roll name') as HTMLInputElement).value).toBe('D&D check');
  });

  it('offers only presets when there are no rolls yet', async () => {
    open({ ...HEARTH, rolls: undefined });
    await toRolls();
    expect(screen.getByRole('group', { name: 'New roll from a preset' })).toBeTruthy();
    expect(screen.getByText(/No rolls yet/)).toBeTruthy();
    expect(screen.queryByTestId('test-roll')).toBeNull();
  });

  it('replaces the five steps with another preset only after asking, keeping the name and ROLLED BY', async () => {
    const { last } = open();
    await toRolls();
    const roll = screen.getByTestId('roll-skill');
    await userEvent.click(within(within(roll).getByRole('group', { name: 'Presets' })).getByRole('button', { name: 'BLADES ACTION' }));
    const ask = screen.getByRole('alertdialog', { name: 'Replace the five steps?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'KEEP' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(within(within(roll).getByRole('group', { name: 'Presets' })).getByRole('button', { name: 'BLADES ACTION' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'REPLACE' }));
    expect(rollsOf(last())[0]).toEqual({ id: 'skill', label: 'Skill check', ...PRESETS.blades.roll, by: ['skills'] });
  });

  it('renames a roll, picks what it is rolled by, and removes it', async () => {
    const { last } = open();
    await toRolls();
    const roll = screen.getByTestId('roll-skill');
    const name = within(roll).getByLabelText('Roll name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Move');
    expect(rollsOf(last())[0].label).toBe('Move');
    await userEvent.click(within(within(roll).getByRole('region', { name: 'Rolled by' })).getByRole('button', { name: 'SAVE' }));
    expect(rollsOf(last())[0].by).toEqual(['skills', 'save']);
    await userEvent.click(within(roll).getByRole('button', { name: 'REMOVE ROLL' }));
    expect('rolls' in last()).toBe(false);
    expect(screen.getByRole('group', { name: 'New roll from a preset' })).toBeTruthy();
  });
});

describe('TEST ROLL', () => {
  it('rolls for the field picked with the changes picked, and draws the dice, the working and what it came to', async () => {
    open();
    await toRolls();
    const test = screen.getByTestId('test-roll');
    const pickField = within(test).getByLabelText('Roll it for') as HTMLSelectElement;
    expect([...pickField.options].map((o) => o.textContent)).toEqual(['FIGHT', 'LORE']);
    await userEvent.selectOptions(pickField, 'LORE');
    await userEvent.click(within(test).getByRole('switch', { name: 'FORWARD +1' }));
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    await waitFor(() => expect(within(test).getByTestId('test-outcome').textContent).toBe('FULL SUCCESS'));
    expect(testRoll).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Hearth' }), 'skill', 'lore', ['forward'], []);
    expect(within(test).getByTestId('test-dice').textContent).toBe('45');
    // 4 + 5 = 9, LORE 3 and FORWARD 1.
    expect(within(test).getByTestId('test-working').textContent).toBe('[4 5 = 9 + 4 = 13] — FULL SUCCESS');
  });

  it('shows what a change would cost at the table, and the server\'s refusal when there is one', async () => {
    open({ ...HEARTH, rolls: [{ id: 'act', label: 'Action', ...PRESETS.blades.roll, by: ['fight'] }] });
    await toRolls();
    const test = screen.getByTestId('test-roll');
    await userEvent.click(within(test).getByRole('switch', { name: 'PUSH YOURSELF' }));
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    // Blades' push adds to Stress (6b3a); a cost that takes says so.
    await waitFor(() => expect(within(test).getByText('At the table this adds 2 STRESS.')).toBeTruthy());
    testRoll.mockResolvedValueOnce({ ok: false, error: 'roll act, read: Sum, highest, lowest, count, or the symbols' } as never);
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    expect((await within(test).findByRole('alert')).textContent).toBe('roll act, read: Sum, highest, lowest, count, or the symbols');
  });

  it('says a cost that takes as costing', async () => {
    open({ ...HEARTH, rolls: [{ id: 'f', label: 'Fate', ...PRESETS.fate.roll, by: ['fight'] }] });
    await toRolls();
    const test = screen.getByTestId('test-roll');
    await userEvent.click(within(test).getByRole('switch', { name: 'INVOKE AN ASPECT' }));
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    await waitFor(() => expect(within(test).getByText('At the table this costs 1 FATE_POINTS.')).toBeTruthy());
  });

  it('tries the roll under a condition that changes every roll, as the table would (6b3b)', async () => {
    const hurt: Definition = { ...HEARTH, conditions: {
      hurt: { name: 'Hurt', short: 'HURT', modifiers: [{ target: 'all_rolls', amount: -1 }] },
      blessed: { name: 'Blessed', modifiers: [{ target: 'all_rolls', amount: 1 }, { target: 'all_rolls', amount: 1 }] },
      poisoned: { modifiers: [{ target: 'str', amount: -2 }] },
    } };
    open(hurt);
    await toRolls();
    const test = screen.getByTestId('test-roll');
    // Only those on all rolls, each with what it comes to; Poisoned changes one stat, not the roll.
    const under = within(test).getByRole('group', { name: 'Conditions on the sample' });
    expect(within(under).getAllByRole('switch').map((s) => s.textContent)).toEqual(['HURT · ALL ROLLS −1', 'BLESSED · ALL ROLLS +2']);
    await userEvent.click(within(under).getByRole('switch', { name: 'HURT · ALL ROLLS −1' }));
    expect(within(under).getByRole('switch', { name: 'HURT · ALL ROLLS −1' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    expect(testRoll).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Hearth' }), 'skill', 'fight', [], ['hurt']);
    // 4 + 5 = 9, FIGHT 2, HURT -1: 10, a full success all the same.
    await waitFor(() => expect(within(test).getByTestId('test-working').textContent).toBe('[4 5 = 9 + 2 - 1 (HURT) = 10] — FULL SUCCESS'));
    // Off again, nothing is sent.
    await userEvent.click(within(under).getByRole('switch', { name: 'HURT · ALL ROLLS −1' }));
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    expect(testRoll).toHaveBeenLastCalledWith(expect.anything(), 'skill', 'fight', [], []);
  });

  it('offers no condition switches when none changes every roll', async () => {
    open();
    await toRolls();
    expect(within(screen.getByTestId('test-roll')).queryByRole('group', { name: 'Conditions on the sample' })).toBeNull();
  });
});

describe('editing steps 1 to 3 (6b1b1)', () => {
  it('the dice: how many, the size, a name, another kind and one taken away', async () => {
    const { last } = open();
    await toRolls();
    const dice = within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'DICE' });
    const count = within(dice).getByLabelText('Dice 1: how many');
    await userEvent.clear(count);
    await userEvent.type(count, '@this');
    await userEvent.selectOptions(within(dice).getByLabelText('Dice 1: size'), 'd10');
    await userEvent.type(within(dice).getByLabelText('Dice 1: name'), 'Hunger');
    expect(rollsOf(last())[0].dice).toEqual([{ count: '@this', sides: 10, name: 'Hunger' }]);
    expect((within(dice).getByRole('button', { name: 'Remove dice 1' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(dice).getByRole('button', { name: '+ ADD DICE' }));
    expect(rollsOf(last())[0].dice).toEqual([{ count: '@this', sides: 10, name: 'Hunger' }, { count: '1', sides: 6 }]);
    await userEvent.click(within(dice).getByRole('button', { name: 'Remove dice 1' }));
    expect(rollsOf(last())[0].dice).toEqual([{ count: '1', sides: 6 }]);
  });

  it('how the dice are read: keeping as many as typed, or counting successes at a face', async () => {
    const { last } = open();
    await toRolls();
    const read = within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'READ THE DICE' });
    await userEvent.click(within(read).getByRole('button', { name: 'KEEP HIGHEST' }));
    expect(within(read).getByRole('button', { name: 'KEEP HIGHEST' }).getAttribute('aria-pressed')).toBe('true');
    const keep = within(read).getByLabelText('How many dice are kept');
    await userEvent.clear(keep);
    await userEvent.type(keep, '2');
    expect([rollsOf(last())[0].read, rollsOf(last())[0].keep]).toEqual(['highest', '2']);
    await userEvent.click(within(read).getByRole('button', { name: 'COUNT SUCCESSES' }));
    const at = within(read).getByLabelText('A success starts at');
    await userEvent.clear(at);
    await userEvent.type(at, '6');
    expect([rollsOf(last())[0].read, rollsOf(last())[0].at, 'keep' in rollsOf(last())[0]]).toEqual(['count', 6, false]);
  });

  it('what is added, a target with rolling under, and the bands', async () => {
    const { last } = open();
    await toRolls();
    const compare = within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'ADD AND COMPARE' });
    const add = within(compare).getByLabelText('Add');
    await userEvent.clear(add);
    await userEvent.type(add, '@this + 1');
    expect(rollsOf(last())[0].add).toBe('@this + 1');
    const under = within(compare).getByRole('switch', { name: /ROLL UNDER/ }) as HTMLButtonElement;
    expect(under.disabled).toBe(true);
    await userEvent.type(within(compare).getByLabelText('Against'), '@this');
    await userEvent.click(under);
    expect([rollsOf(last())[0].against, rollsOf(last())[0].under]).toEqual(['@this', true]);
    const bands = within(compare).getByTestId('bands');
    const top = within(bands).getByLabelText('Band 1: up to');
    await userEvent.clear(top);
    await userEvent.type(top, '5');
    await userEvent.clear(within(bands).getByLabelText('Band 3: words'));
    await userEvent.type(within(bands).getByLabelText('Band 3: words'), 'Strong hit');
    expect(rollsOf(last())[0].bands).toEqual([{ upTo: 5, label: 'Miss' }, { upTo: 9, label: 'Success at a cost' }, { label: 'Strong hit' }]);
    expect(bands.textContent).toContain('ABOVE9');
    await userEvent.click(within(bands).getByRole('button', { name: 'Remove band 2' }));
    expect(rollsOf(last())[0].bands).toEqual([{ upTo: 5, label: 'Miss' }, { label: 'Strong hit' }]);
    await userEvent.click(within(bands).getByRole('button', { name: 'NO BANDS' }));
    expect('bands' in rollsOf(last())[0]).toBe(false);
    await userEvent.click(within(compare).getByRole('button', { name: '+ BANDS' }));
    expect(rollsOf(last())[0].bands).toEqual([{ upTo: 6, label: 'Miss' }, { label: 'Hit' }]);
  });
});

describe('editing step 4, special results (6b1b2)', () => {
  const special = () => within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'SPECIAL RESULTS' });
  const part = (name: RegExp) => within(special()).getByRole('group', { name });

  it('exploding switched on, on a face, once; off again', async () => {
    const { last } = open();
    await toRolls();
    await userEvent.click(within(part(/EXPLODING/)).getByRole('switch', { name: /ROLLS ANOTHER/ }));
    expect(rollsOf(last())[0].explode).toEqual({});
    await userEvent.type(within(part(/EXPLODING/)).getByLabelText('Explodes on'), '5');
    await userEvent.click(within(part(/EXPLODING/)).getByRole('switch', { name: 'ONLY ONCE' }));
    expect(rollsOf(last())[0].explode).toEqual({ on: 5, once: true });
    await userEvent.clear(within(part(/EXPLODING/)).getByLabelText('Explodes on'));
    expect(rollsOf(last())[0].explode).toEqual({ once: true });
    await userEvent.click(within(part(/EXPLODING/)).getByRole('switch', { name: /ROLLS ANOTHER/ }));
    expect('explode' in rollsOf(last())[0]).toBe(false);
  });

  it('a natural and a match added and changed; a match on any face', async () => {
    const { last } = open();
    await toRolls();
    await userEvent.click(within(part(/NATURALS/)).getByRole('button', { name: '+ NATURAL' }));
    expect(rollsOf(last())[0].natural).toEqual([{ face: 6, label: 'Critical', critical: 'success' }]);
    await userEvent.selectOptions(within(part(/NATURALS/)).getByLabelText('Natural 1: critical'), 'NOT A CRITICAL');
    await userEvent.clear(within(part(/NATURALS/)).getByLabelText('Natural 1: words'));
    await userEvent.type(within(part(/NATURALS/)).getByLabelText('Natural 1: words'), 'Boxcars');
    const face = within(part(/NATURALS/)).getByLabelText('Natural 1: face');
    await userEvent.clear(face);
    await userEvent.type(face, '12');
    expect(rollsOf(last())[0].natural).toEqual([{ face: 12, label: 'Boxcars' }]);
    await userEvent.click(within(part(/MATCHES/)).getByRole('button', { name: '+ MATCH' }));
    await userEvent.clear(within(part(/MATCHES/)).getByLabelText('Match 1: face'));
    await userEvent.type(within(part(/MATCHES/)).getByLabelText('Match 1: adds'), '1');
    expect(rollsOf(last())[0].matches).toEqual([{ count: 2, label: 'Critical', critical: 'success', adds: 1 }]);
    await userEvent.click(within(part(/MATCHES/)).getByRole('button', { name: 'Remove match 1' }));
    expect('matches' in rollsOf(last())[0]).toBe(false);
  });

  it('cancelling only while counting; a glitch; the zero-dice rule', async () => {
    const { last } = open({ ...HEARTH, rolls: [{ id: 'skill', label: 'Pool', ...PRESETS.sr6.roll, by: ['skills'] }] });
    await toRolls();
    await userEvent.click(within(part(/CANCELLING/)).getByRole('switch', { name: 'EACH DIE SHOWING' }));
    expect(rollsOf(last())[0].cancel).toEqual({ face: 1 });
    const share = within(part(/GLITCH/)).getByLabelText('Glitch share, percent');
    await userEvent.clear(share);
    await userEvent.type(share, '25');
    expect((rollsOf(last())[0].glitch as { share: number }).share).toBe(0.25);
    await userEvent.click(within(part(/NO DICE/)).getByRole('switch', { name: /ROLL SOME ANYWAY/ }));
    await userEvent.selectOptions(within(part(/NO DICE/)).getByLabelText('Kept with none'), 'HIGHEST');
    expect(rollsOf(last())[0].zero).toEqual({ count: 2, read: 'highest' });
    // Reading as a sum takes cancelling away, and its switch with it.
    await userEvent.click(within(within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'READ THE DICE' })).getByRole('button', { name: 'SUM' }));
    expect('cancel' in rollsOf(last())[0]).toBe(false);
    expect(within(special()).queryByRole('group', { name: /CANCELLING/ })).toBeNull();
  });

  it('a named kind\'s effect, only once a kind of dice is named', async () => {
    const { last } = open();
    await toRolls();
    expect(part(/NAMED DICE/).textContent).toContain('NAME A KIND OF DICE IN STEP 1');
    await userEvent.type(within(within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'DICE' })).getByLabelText('Dice 1: name'), 'Hope');
    await userEvent.click(within(part(/NAMED DICE/)).getByRole('button', { name: '+ EFFECT' }));
    await userEvent.selectOptions(within(part(/NAMED DICE/)).getByLabelText('Effect 1: when'), 'ON ANY ROLL');
    expect(rollsOf(last())[0].effects).toEqual([{ name: 'Hope', face: 6, when: 'any', label: 'Effect' }]);
  });
});

describe('editing step 5, changes (6b1b3)', () => {
  const step = () => within(screen.getByTestId('roll-skill')).getByRole('region', { name: 'CHANGE A ROLL' });

  it('a change\'s words, extra dice kept highest, what it adds, and what it costs', async () => {
    const { last } = open();
    await toRolls();
    const first = within(step()).getByRole('group', { name: 'Change 1' });
    await userEvent.clear(within(first).getByLabelText('Change 1: words'));
    await userEvent.type(within(first).getByLabelText('Change 1: words'), 'Push');
    await userEvent.click(within(first).getByRole('switch', { name: '+ DICE' }));
    await userEvent.selectOptions(within(first).getByLabelText('Change 1: kept'), 'KEEPING THE HIGHEST (ADVANTAGE)');
    await userEvent.click(within(first).getByRole('switch', { name: '+ TO THE TOTAL' }));
    await userEvent.click(within(first).getByRole('switch', { name: 'COSTS' }));
    await userEvent.selectOptions(within(first).getByLabelText('Change 1: costs what'), 'LORE');
    const amount = within(first).getByLabelText('Change 1: costs how many');
    await userEvent.clear(amount);
    await userEvent.type(amount, '2');
    expect(rollsOf(last())[0].changes).toEqual([{ id: 'forward', label: 'Push', extra: { dice: 1, keep: 'highest' }, cost: { from: 'lore', amount: 2 } }]);
    // TAKES or ADDS (6b3a): Blades' push adds to Stress.
    expect(within(first).getByText(/TAKEN FROM IT WHEN ROLLED/)).toBeTruthy();
    await userEvent.selectOptions(within(first).getByLabelText('Change 1: which way'), 'ADDS');
    expect(rollsOf(last())[0].changes).toEqual([{ id: 'forward', label: 'Push', extra: { dice: 1, keep: 'highest' }, cost: { from: 'lore', amount: 2, adds: true } }]);
    expect(within(first).getByText(/ADDED TO IT WHEN ROLLED/)).toBeTruthy();
    await userEvent.selectOptions(within(first).getByLabelText('Change 1: which way'), 'TAKES');
    expect(rollsOf(last())[0].changes[0].cost).toEqual({ from: 'lore', amount: 2 });
  });

  it('a new change added, and taken away; with none, it rolls on the first click', async () => {
    const { last } = open();
    await toRolls();
    await userEvent.click(within(step()).getByRole('button', { name: '+ CHANGE' }));
    expect((rollsOf(last())[0].changes as unknown[]).length).toBe(2);
    await userEvent.click(within(step()).getByRole('button', { name: 'Remove change 2' }));
    await userEvent.click(within(step()).getByRole('button', { name: 'Remove change 1' }));
    expect('changes' in rollsOf(last())[0]).toBe(false);
    expect(step().textContent).toContain('NONE · ROLLS ON THE FIRST CLICK');
    // TEST ROLL offers no switches with no changes.
    expect(within(screen.getByTestId('test-roll')).queryByRole('switch')).toBeNull();
  });

  it('a cost needs a stat to take it from', async () => {
    open({ ...HEARTH, stats: [], rolls: [{ id: 'skill', label: 'Skill check', ...PRESETS.pbta.roll }] });
    await toRolls();
    const first = within(step()).getByRole('group', { name: 'Change 1' });
    expect((within(first).getByRole('switch', { name: 'COSTS' }) as HTMLButtonElement).disabled).toBe(true);
    expect(first.textContent).toContain('A COST IS TAKEN FROM A STAT');
  });
});

describe('the system\'s own dice in a roll (6c3)', () => {
  const OWN = withDicePreset(HEARTH, 'narrative')!.definition;

  it('step 1 offers them after the sizes; one picked takes its own faces and name', async () => {
    const { last } = open(OWN);
    await toRolls();
    const size = screen.getByLabelText('Dice 1: size') as HTMLSelectElement;
    expect([...size.querySelectorAll('optgroup option')].map((o) => o.textContent)).toEqual(['GOOD', 'GREAT', 'BAD']);
    await userEvent.selectOptions(size, 'GOOD');
    expect(rollsOf(last())[0].dice).toEqual([{ count: '2', die: 'good' }]);
    expect(screen.queryByLabelText('Dice 1: name')).toBeNull();
    expect(screen.getByText('ITS OWN FACES AND NAME')).toBeTruthy();
    await userEvent.selectOptions(size, 'd8');
    expect(rollsOf(last())[0].dice).toEqual([{ count: '2', sides: 8 }]);
  });

  it('step 2 offers COUNT THE SYMBOLS once the roll has one of them, and what is left of which symbol', async () => {
    const { last } = open(OWN);
    await toRolls();
    const reads = () => within(screen.getByRole('group', { name: 'Read the dice as' })).getAllByRole('button').map((b) => b.textContent);
    expect(reads()).not.toContain('COUNT THE SYMBOLS');
    await userEvent.selectOptions(screen.getByLabelText('Dice 1: size'), 'GOOD');
    await userEvent.click(within(screen.getByRole('group', { name: 'Read the dice as' })).getByRole('button', { name: 'COUNT THE SYMBOLS' }));
    await userEvent.selectOptions(screen.getByLabelText('Read what is left of'), 'HIT');
    expect([rollsOf(last())[0].read, rollsOf(last())[0].on]).toEqual(['symbols', 'hit']);
    expect(problems(last())).toEqual([]);
  });

  it('TEST ROLL shows each of them as the face it landed on', async () => {
    const own = { ...OWN, rolls: [{ id: 'clash', label: 'Clash', dice: [{ count: '2', die: 'good' }], read: 'symbols', on: 'hit', against: '1', by: ['skills'] }] };
    open(own as Definition);
    await toRolls();
    const test = screen.getByTestId('test-roll');
    await userEvent.click(within(test).getByRole('button', { name: 'TEST ROLL ▸' }));
    // The mock's dice land on GOOD's 4th face (HIT EDGE) then its 5th (EDGE EDGE).
    await waitFor(() => expect(within(test).getByTestId('test-dice').textContent).toBe('✶◆◆◆'));
    expect(within(test).getByTestId('test-working').textContent).toBe('[✶◆ ◆◆ = 1 HIT, 3 EDGE] — vs 1: SUCCESS');
  });
});

describe('the "?"', () => {
  it('explains every step, part and setting of a roll and TEST ROLL, each still named by its own words', async () => {
    const seen = new Set<string | null>();
    const look = () => screen.queryAllByRole('note').forEach((n) => seen.add(n.getAttribute('aria-label')));
    open();
    await toRolls();
    look();
    // CANCELLING shows only while counting successes, and a cost only on a change.
    await userEvent.click(within(screen.getByRole('group', { name: 'Read the dice as' })).getByRole('button', { name: 'COUNT SUCCESSES' }));
    await userEvent.click(screen.getByRole('button', { name: '+ CHANGE' }));
    look();
    const keys = Object.keys(HINTS).filter((k) => k.startsWith('rolls.')) as (keyof typeof HINTS)[];
    expect(keys).toHaveLength(20);
    for (const k of keys) expect(seen.has(HINTS[k]), k).toBe(true);
    // The "?" stays out of what the steps, parts and boxes are called.
    for (const name of ['DICE', 'READ THE DICE', 'ADD AND COMPARE', 'SPECIAL RESULTS', 'CHANGE A ROLL', 'Rolled by']) expect(screen.getByRole('region', { name }), name).toBeTruthy();
    for (const name of ['EXPLODING', 'CANCELLING', 'GLITCH']) expect(screen.getByRole('group', { name }), name).toBeTruthy();
    for (const name of ['Add', 'Against']) expect(screen.getByRole('textbox', { name }), name).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Roll it for' })).toBeTruthy();
  });
});
