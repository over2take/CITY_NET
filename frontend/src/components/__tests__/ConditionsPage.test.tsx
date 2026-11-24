import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { ConditionsPage } from '../ConditionsPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';

/**
 * The builder's CONDITIONS page (4e1b). Approved mockup builder-conditions (2026-10-09): the standard
 * set with switches, a system's own added and deleted, each one's name, chip label, icon (drawn or
 * uploaded), description, how it ends and its modifiers. Every change is held to the server's checks.
 */

const { checkDefinition } = createRequire(import.meta.url)('../../../../backend/systemBuilder/definition.js');
afterEach(cleanup);

const H: Definition = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'save', label: 'Physical save', formula: '16 - @str' }],
};
type Api = ReturnType<typeof systemsApi>;
const UPLOADED = `/uploads/condition_icons/${'c'.repeat(64)}.png`;

const open = (start: Definition = H, api?: Partial<Api>) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <ConditionsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={api as Api | undefined} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const list = () => within(screen.getByRole('list', { name: 'Conditions' }));
const detail = (name: RegExp | string) => within(screen.getByRole('region', { name }));
const stored = (def: Definition) => def.conditions as Record<string, Record<string, unknown>> | undefined;

describe('the list', () => {
  it('shows the ten standard conditions with switches, all on, and the count against sixty', () => {
    open();
    expect(list().getAllByRole('switch')).toHaveLength(10);
    expect(list().getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(screen.getByText('10 ON · 10 OF 60')).toBeTruthy();
    expect(detail('Blinded condition').getByText('STANDARD CONDITION')).toBeTruthy();
  });

  it('turns a standard one off and on, storing only that it is off', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('switch', { name: 'Prone on' }));
    expect(stored(last())).toEqual({ prone: { on: false } });
    expect(screen.getByText('9 ON · 10 OF 60')).toBeTruthy();
    await userEvent.click(list().getByRole('switch', { name: 'Prone on' }));
    expect(last()).toEqual(H);
  });

  it('opens the one picked', async () => {
    open();
    await userEvent.click(list().getByRole('button', { name: 'STUNNED' }));
    expect(detail('Stunned condition').getByPlaceholderText('Stunned')).toBeTruthy();
  });
});

describe('a standard condition', () => {
  it('is renamed and described, the standard name as placeholder, and put back by clearing it', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'PRONE' }));
    const name = detail('Prone condition').getByLabelText('NAME') as HTMLInputElement;
    expect(name.value).toBe('');
    fireEvent.change(name, { target: { value: 'Knocked down' } });
    expect(stored(last())).toEqual({ prone: { name: 'Knocked down' } });
    expect(list().getByRole('button', { name: 'KNOCKED DOWN' })).toBeTruthy();
    fireEvent.change(detail('Knocked down condition').getByLabelText('NAME'), { target: { value: '' } });
    expect(last()).toEqual(H);
    expect(checkDefinition(last()).problems).toEqual([]);
  });

  it('takes an icon from the drawn set, and a chip label in capitals', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'PRONE' }));
    await userEvent.click(detail('Prone condition').getByRole('radio', { name: 'snow' }));
    fireEvent.change(detail('Prone condition').getByLabelText('ON THE CHIP'), { target: { value: 'flat' } });
    expect(stored(last())).toEqual({ prone: { icon: 'snow', short: 'FLAT' } });
    expect(detail('Prone condition').getByRole('radio', { name: 'snow' }).getAttribute('aria-checked')).toBe('true');
  });

  it('ends after rounds, the rounds typed', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'STUNNED' }));
    fireEvent.change(detail('Stunned condition').getByLabelText('ENDS'), { target: { value: 'rounds' } });
    expect(stored(last())).toEqual({ stunned: { ends: 'rounds', rounds: 1 } });
    const rounds = detail('Stunned condition').getByLabelText('Rounds');
    fireEvent.change(rounds, { target: { value: '' } });
    fireEvent.change(rounds, { target: { value: '4' } });
    expect(stored(last())).toEqual({ stunned: { ends: 'rounds', rounds: 4 } });
    fireEvent.change(detail('Stunned condition').getByLabelText('ENDS'), { target: { value: 'removed' } });
    expect(last()).toEqual(H);
  });

  it('ends at a rest, the rests ticked, the same setting as the RESTS page', async () => {
    // 4f4b. A rest turned off isn't offered, unless already picked, so it can be unticked.
    const start: Definition = { ...H, rests: { end_of_scene: { on: false }, downtime: { name: 'Downtime' } }, conditions: { stunned: { ends: 'rest', at: ['end_of_scene'] } } };
    const { last } = open(start);
    await userEvent.click(list().getByRole('button', { name: 'EXHAUSTED' }));
    fireEvent.change(detail('Exhausted condition').getByLabelText('ENDS'), { target: { value: 'rest' } });
    expect(stored(last())!.exhausted).toEqual({ ends: 'rest', at: [] });
    const ticks = () => within(detail('Exhausted condition').getByRole('group', { name: 'Ends at' }));
    expect(ticks().getAllByRole('checkbox').map((t) => t.textContent)).toEqual(['SHORT REST', 'LONG REST', 'END OF SESSION', 'DOWNTIME']);
    expect(detail('Exhausted condition').getByText('Pick at least one rest.')).toBeTruthy();
    expect(checkDefinition(last()).problems).toEqual([{ where: 'condition exhausted, at', message: 'Name the rests it wears off at' }]);
    await userEvent.click(ticks().getByRole('checkbox', { name: 'LONG REST' }));
    await userEvent.click(ticks().getByRole('checkbox', { name: 'DOWNTIME' }));
    expect(stored(last())!.exhausted).toEqual({ ends: 'rest', at: ['long_rest', 'downtime'] });
    expect(ticks().getByRole('checkbox', { name: 'LONG REST' }).getAttribute('aria-checked')).toBe('true');
    expect(detail('Exhausted condition').queryByText('Pick at least one rest.')).toBeNull();
    expect(detail('Exhausted condition').getByText(/Comes off at any of these/)).toBeTruthy();
    expect(checkDefinition(last()).problems).toEqual([]);
    await userEvent.click(ticks().getByRole('checkbox', { name: 'LONG REST' }));
    expect(stored(last())!.exhausted).toEqual({ ends: 'rest', at: ['downtime'] });
    // Switched to another ending, the rests go with it.
    fireEvent.change(detail('Exhausted condition').getByLabelText('ENDS'), { target: { value: 'rounds' } });
    expect(stored(last())!.exhausted).toEqual({ ends: 'rounds', rounds: 1 });
    expect(detail('Exhausted condition').queryByRole('group', { name: 'Ends at' })).toBeNull();
    // The picked rest that is off is still there to untick.
    await userEvent.click(list().getByRole('button', { name: 'STUNNED' }));
    const off = within(detail('Stunned condition').getByRole('group', { name: 'Ends at' })).getByRole('checkbox', { name: 'END OF SCENE (OFF)' });
    expect(off.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(off);
    expect(stored(last())!.stunned).toEqual({ ends: 'rest', at: [] });
    expect(within(detail('Stunned condition').getByRole('group', { name: 'Ends at' })).queryByRole('checkbox', { name: /END OF SCENE/ })).toBeNull();
  });

  it('gets modifiers on all rolls or the system\'s stats and formulas, a negative typed sign first', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'POISONED' }));
    const d = () => detail('Poisoned condition');
    await userEvent.click(d().getByRole('button', { name: '+ MODIFIER' }));
    expect(stored(last())).toEqual({ poisoned: { modifiers: [{ target: 'all_rolls', amount: -1 }] } });
    expect(d().getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['ALL ROLLS', 'Strength', 'Physical save']));
    fireEvent.change(d().getByLabelText('Modifier 1 target'), { target: { value: 'save' } });
    const amount = d().getByLabelText('Modifier 1 amount') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '-' } });
    expect(amount.value).toBe('-');
    fireEvent.change(amount, { target: { value: '-3' } });
    expect(stored(last())).toEqual({ poisoned: { modifiers: [{ target: 'save', amount: -3 }] } });
    expect(checkDefinition(last()).problems).toEqual([]);
    await userEvent.click(d().getByRole('button', { name: 'Remove modifier 1' }));
    expect(last()).toEqual(H);
  });

  it('can\'t be deleted, only turned off', async () => {
    open();
    expect(detail('Blinded condition').queryByRole('button', { name: 'DELETE' })).toBeNull();
  });
});

describe('a system\'s own condition', () => {
  it('is added named to be renamed, opened, renamed, and given a label from its name', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ CONDITION' }));
    expect(stored(last())).toEqual({ new_condition: { name: 'New condition' } });
    const d = detail('New condition condition');
    expect(d.getByText('ONE OF THIS SYSTEM\'S OWN')).toBeTruthy();
    fireEvent.change(d.getByLabelText('NAME'), { target: { value: 'Glitching' } });
    expect(stored(last())).toEqual({ new_condition: { name: 'Glitching' } });
    expect((detail('Glitching condition').getByLabelText('ON THE CHIP') as HTMLInputElement).placeholder).toBe('GLITCHIN');
    expect(screen.getByText('11 ON · 11 OF 60')).toBeTruthy();
  });

  it('shows a blank name as a problem rather than losing the condition', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ CONDITION' }));
    fireEvent.change(detail('New condition condition').getByLabelText('NAME'), { target: { value: '' } });
    expect(stored(last())).toEqual({ new_condition: { name: '' } });
    expect(list().getByRole('button', { name: 'NEEDS A NAME' })).toBeTruthy();
    expect(screen.getByLabelText('NAME').getAttribute('aria-invalid')).toBe('true');
  });

  it('is deleted only after asking', async () => {
    const { last } = open({ ...H, conditions: { hex: { name: 'Hexed' } } });
    await userEvent.click(list().getByRole('button', { name: 'HEXED' }));
    await userEvent.click(detail('Hexed condition').getByRole('button', { name: 'DELETE' }));
    expect(detail('Hexed condition').getByText('Delete Hexed?')).toBeTruthy();
    await userEvent.click(detail('Hexed condition').getByRole('button', { name: 'KEEP' }));
    await userEvent.click(detail('Hexed condition').getByRole('button', { name: 'DELETE' }));
    await userEvent.click(detail('Hexed condition').getByRole('button', { name: 'DELETE' }));
    expect(last()).toEqual(H);
    expect(list().queryByRole('button', { name: 'HEXED' })).toBeNull();
  });

  it('takes an uploaded icon, and says why one was refused', async () => {
    const uploadIcon = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: '"big.png" is over the 0.25MB limit.', status: 413 })
      .mockResolvedValueOnce({ ok: true, value: { icon: UPLOADED } });
    const { last } = open({ ...H, conditions: { hex: { name: 'Hexed' } } }, { uploadIcon });
    await userEvent.click(list().getByRole('button', { name: 'HEXED' }));
    const file = new File(['x'], 'big.png', { type: 'image/png' });
    await userEvent.upload(detail('Hexed condition').getByLabelText('Upload an icon for Hexed'), file);
    expect((await detail('Hexed condition').findByRole('alert')).textContent).toBe('"big.png" is over the 0.25MB limit.');
    await userEvent.upload(detail('Hexed condition').getByLabelText('Upload an icon for Hexed'), file);
    expect(uploadIcon).toHaveBeenLastCalledWith(file, 'condition');
    expect(stored(last())).toEqual({ hex: { name: 'Hexed', icon: UPLOADED } });
    expect(detail('Hexed condition').getByRole('radio', { name: 'Uploaded icon' })).toBeTruthy();
    expect(detail('Hexed condition').queryByRole('alert')).toBeNull();
  });

  it('offers no upload without the server', async () => {
    open({ ...H, conditions: { hex: { name: 'Hexed' } } });
    await userEvent.click(list().getByRole('button', { name: 'HEXED' }));
    expect(detail('Hexed condition').queryByRole('button', { name: 'UPLOAD' })).toBeNull();
  });
});

describe('the limit', () => {
  it('stops + CONDITION at sixty in all', () => {
    const own = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`c${i}`, { name: `C${i}` }]));
    open({ ...H, conditions: own });
    expect(screen.getByText('60 ON · 60 OF 60')).toBeTruthy();
    expect((screen.getByRole('button', { name: '+ CONDITION' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the "?"', () => {
  it('sits beside a condition\'s settings, the fields still named by their words', () => {
  const allShown = (page: string, count: number) => {
    const keys = Object.keys(HINTS).filter((k) => k.startsWith(`${page}.`)) as (keyof typeof HINTS)[];
    expect(keys).toHaveLength(count);
    for (const k of keys) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  };
    open();
    // ITS MODIFIERS and MODIFIERS joined them in 8a5e2, EACH TURN in 8a9b.
    allShown('conditions', 7);
    for (const name of ['ON THE CHIP', 'DESCRIPTION']) expect(screen.getByRole('textbox', { name }), name).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'ENDS' })).toBeTruthy();
  });
});

describe('ONLY WITH (4j4a)', () => {
  it('puts a condition under a house rule, and takes it out again', () => {
    const { last } = open({ ...H, house_rules: [{ id: 'magic', name: 'MAGIC' }] } as unknown as Definition);
    const box = list().getAllByRole('button').find((b) => b.textContent === 'PRONE')!;
    fireEvent.click(box);
    const only = detail('Prone condition').getByRole('combobox', { name: 'ONLY WITH' });
    fireEvent.change(only, { target: { value: 'magic' } });
    expect(last().conditions).toEqual({ prone: { only_with: 'magic' } });
    expect((detail('Prone condition').getByRole('combobox', { name: 'ONLY WITH' }) as HTMLSelectElement).value).toBe('magic');
    fireEvent.change(detail('Prone condition').getByRole('combobox', { name: 'ONLY WITH' }), { target: { value: '' } });
    expect(last().conditions).toBeUndefined();
    expect(detail('Prone condition').getByRole('note', { name: HINTS['only.with'] })).toBeTruthy();
  });

  it('isn\'t there in a system with no house rules', () => {
    open();
    expect(screen.queryByRole('combobox', { name: 'ONLY WITH' })).toBeNull();
  });
});

describe('ITS MODIFIERS and a modifier\'s way (8a5e2)', () => {
  it('A REMINDER to start; APPLIED stored, the words under the modifiers saying what it does; back, nothing stored', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'POISONED' }));
    const d = () => detail('Poisoned condition');
    const its = () => within(d().getByRole('group', { name: 'Its modifiers' }));
    expect(its().getByRole('button', { name: 'A REMINDER' }).getAttribute('aria-pressed')).toBe('true');
    expect(d().getByRole('note', { name: 'What its modifiers do' }).textContent).toBe('A REMINDER: shown to the GM and the token\'s owner, changing no number.');
    await userEvent.click(its().getByRole('button', { name: 'APPLIED' }));
    expect(stored(last())).toEqual({ poisoned: { applied: true } });
    expect(its().getByRole('button', { name: 'APPLIED' }).getAttribute('aria-pressed')).toBe('true');
    expect(d().getByRole('note', { name: 'What its modifiers do' }).textContent).toMatch(/^APPLIED: a character whose token has it sees these numbers change/);
    expect(checkDefinition(last()).problems).toEqual([]);
    await userEvent.click(its().getByRole('button', { name: 'A REMINDER' }));
    expect(last()).toEqual(H);
  });

  it('a stat\'s modifier: its way, a number kept a number, a formula kept as text, eˣ to help; all held to the server\'s checks', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'POISONED' }));
    const d = () => detail('Poisoned condition');
    await userEvent.click(d().getByRole('button', { name: '+ MODIFIER' }));
    fireEvent.change(d().getByLabelText('Modifier 1 target'), { target: { value: 'str' } });
    fireEvent.change(d().getByLabelText('Modifier 1 way'), { target: { value: 'times' } });
    fireEvent.change(d().getByLabelText('Modifier 1 amount'), { target: { value: '0.5' } });
    expect(stored(last())).toEqual({ poisoned: { modifiers: [{ target: 'str', way: 'times', amount: 0.5 }] } });
    expect(checkDefinition(last()).problems).toEqual([]);
    fireEvent.change(d().getByLabelText('Modifier 1 amount'), { target: { value: '@str / 2' } });
    expect(stored(last())).toEqual({ poisoned: { modifiers: [{ target: 'str', way: 'times', amount: '@str / 2' }] } });
    expect(checkDefinition(last()).problems).toEqual([]);
    expect(d().getByRole('button', { name: 'Help writing Modifier 1 amount' })).toBeTruthy();
    // ADD says no way; SET TO and AT MOST each stored.
    for (const [way, kept] of [['set', { way: 'set' }], ['most', { way: 'most' }], ['add', {}]] as const) {
      fireEvent.change(d().getByLabelText('Modifier 1 way'), { target: { value: way } });
      expect(stored(last())!.poisoned.modifiers).toEqual([{ target: 'str', amount: '@str / 2', ...kept }]);
    }
  });

  it('ALL ROLLS: an ADD of a whole number only, its way held; one changed to it loses a formula and a way', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('button', { name: 'POISONED' }));
    const d = () => detail('Poisoned condition');
    await userEvent.click(d().getByRole('button', { name: '+ MODIFIER' }));
    const way = d().getByLabelText('Modifier 1 way') as HTMLSelectElement;
    expect([way.value, way.disabled]).toEqual(['add', true]);
    expect(d().queryByRole('button', { name: 'Help writing Modifier 1 amount' })).toBeNull();
    // No formula's words under a whole number: -1 is no formula to read.
    expect(within(d().getByRole('group', { name: 'Modifier 1' })).queryByTestId('formula-words')).toBeNull();
    expect(d().getByRole('note', { name: 'What its modifiers do' }).textContent).toContain('ALL ROLLS always reaches every roll');
    fireEvent.change(d().getByLabelText('Modifier 1 target'), { target: { value: 'save' } });
    fireEvent.change(d().getByLabelText('Modifier 1 way'), { target: { value: 'most' } });
    fireEvent.change(d().getByLabelText('Modifier 1 amount'), { target: { value: '@str' } });
    fireEvent.change(d().getByLabelText('Modifier 1 target'), { target: { value: 'all_rolls' } });
    expect(stored(last())).toEqual({ poisoned: { modifiers: [{ target: 'all_rolls', amount: -1 }] } });
    expect(checkDefinition(last()).problems).toEqual([]);
  });
});

describe('a modifier\'s words, said its way (8a5e2)', () => {
  it('TIMES 0.5 reads ×0.5 for the sample, the server asked for a formula; an ADD signed', async () => {
    const asked: string[] = [];
    const api = { previewFormulas: vi.fn(async (_d: Definition, fs: { text: string; kind: string }[]) => {
      asked.push(fs[0].kind);
      return { ok: true, value: { results: [{ ok: true, value: Number(fs[0].text) || 0, reads: [] }], sampleLevel: 3 } };
    }) };
    open({ ...H, conditions: { poisoned: { modifiers: [{ target: 'str', way: 'times', amount: 0.5 }, { target: 'str', amount: -2 }] } } } as Definition, api as unknown as Partial<Api>);
    await userEvent.click(list().getByRole('button', { name: 'POISONED' }));
    const d = detail('Poisoned condition');
    expect(await within(d.getByRole('group', { name: 'Modifier 1' })).findByText(/×0\.5/)).toBeTruthy();
    expect(await within(d.getByRole('group', { name: 'Modifier 2' })).findByText(/-2/)).toBeTruthy();
    expect(asked.every((k) => k === 'formula')).toBe(true);
  });
});

describe('EACH TURN and the new ending (8a9b)', () => {
  const pick = async (name: string) => userEvent.click(list().getByRole('button', { name }));
  const row = (i: number) => within(screen.getByRole('group', { name: `Each turn ${i}` }));

  it('none to start; + EACH TURN adds 1d4 damage at the start of its turn, onto the token, rolled by the table, said in words', async () => {
    const { last } = open();
    await pick('BLEEDING');
    expect(screen.queryByRole('group', { name: 'Each turn 1' })).toBeNull();
    expect(detail('Bleeding condition').getByText('Nothing on turns: a reminder until someone takes it off.')).toBeTruthy();
    await userEvent.click(detail('Bleeding condition').getByRole('button', { name: '+ EACH TURN' }));
    expect(stored(last())).toEqual({ bleeding: { each_turn: [{ when: 'turn_start', does: 'damage', roll: '1d4' }] } });
    expect((row(1).getByRole('combobox', { name: 'Each turn 1 when' }) as HTMLSelectElement).value).toBe('turn_start');
    expect(row(1).getByRole('button', { name: 'ON ITS OWN' }).getAttribute('aria-pressed')).toBe('true');
    // Damage has no ENDS ON: only a save does.
    expect(row(1).queryByRole('textbox', { name: 'Each turn 1 ends on' })).toBeNull();
    expect(row(1).getByRole('button', { name: 'THE TABLE' }).getAttribute('aria-pressed')).toBe('true');
    expect(row(1).getByRole('note', { name: 'Each turn 1 in words' }).textContent).toBe('BLEEDING: 1d4 DAMAGE at the start of its turn, onto the token');
    expect(checkDefinition(last()).problems).toEqual([]);
  });

  it('a save: ROLL TO END with ENDS ON, rolled by the player, the end of its turn; the words follow; the server agrees', async () => {
    const { last } = open();
    await pick('POISONED');
    await userEvent.click(detail('Poisoned condition').getByRole('button', { name: '+ EACH TURN' }));
    await userEvent.selectOptions(row(1).getByRole('combobox', { name: 'Each turn 1 when' }), 'turn_end');
    await userEvent.selectOptions(row(1).getByRole('combobox', { name: 'Each turn 1 does' }), 'roll_to_end');
    // A save has no CHANGES HP, and starts at 10.
    expect(row(1).queryByRole('group', { name: 'Each turn 1 changes HP' })).toBeNull();
    const endsOn = row(1).getByRole('textbox', { name: 'Each turn 1 ends on' });
    await userEvent.clear(endsOn);
    await userEvent.type(endsOn, '13');
    const box = row(1).getByRole('textbox', { name: 'Each turn 1 roll' });
    await userEvent.clear(box);
    await userEvent.type(box, 'd20 + @str');
    await userEvent.click(row(1).getByRole('button', { name: 'THE PLAYER · THE GM FOR AN NPC' }));
    expect(stored(last())!.poisoned.each_turn).toEqual([{ when: 'turn_end', does: 'roll_to_end', roll: 'd20 + @str', ends_on: 13, rolled_by: 'player' }]);
    expect(row(1).getByRole('note', { name: 'Each turn 1 in words' }).textContent)
      .toBe('POISONED: a save, d20 + Strength, at the end of its turn, the player (the GM for an NPC) asked to roll; off on 13 or more');
    expect(checkDefinition(last()).problems).toEqual([]);
    // Back to the table: nothing stored for it.
    await userEvent.click(row(1).getByRole('button', { name: 'THE TABLE' }));
    expect(stored(last())!.poisoned.each_turn).toEqual([{ when: 'turn_end', does: 'roll_to_end', roll: 'd20 + @str', ends_on: 13 }]);
  });

  it('HEAL for the GM to apply, JUST ROLL to the log; up to three; × takes one away, the last leaves nothing', async () => {
    const { last } = open();
    await pick('PRONE');
    const add = () => userEvent.click(detail('Prone condition').getByRole('button', { name: '+ EACH TURN' }));
    await add();
    await userEvent.selectOptions(row(1).getByRole('combobox', { name: 'Each turn 1 does' }), 'heal');
    await userEvent.click(row(1).getByRole('button', { name: 'ROLL ONLY, THE GM APPLIES' }));
    expect(row(1).getByRole('note', { name: 'Each turn 1 in words' }).textContent).toBe('PRONE: 1d4 HEALED at the start of its turn, for the GM to apply');
    await add();
    await userEvent.selectOptions(row(2).getByRole('combobox', { name: 'Each turn 2 does' }), 'just_roll');
    await userEvent.selectOptions(row(2).getByRole('combobox', { name: 'Each turn 2 when' }), 'round_end');
    expect(row(2).getByRole('note', { name: 'Each turn 2 in words' }).textContent).toBe('PRONE: 1d4 rolled at the end of the round, to the log');
    await add();
    expect(detail('Prone condition').getByRole('button', { name: '+ EACH TURN' })).toBeDisabled();
    expect(stored(last())!.prone.each_turn).toEqual([
      { when: 'turn_start', does: 'heal', roll: '1d4', changes_hp: false },
      { when: 'round_end', does: 'just_roll', roll: '1d4' },
      { when: 'turn_start', does: 'damage', roll: '1d4' },
    ]);
    expect(checkDefinition(last()).problems).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove each turn 2' }));
    expect(stored(last())!.prone.each_turn.map((e: { does: string }) => e.does)).toEqual(['heal', 'damage']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove each turn 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove each turn 1' }));
    expect(last()).toEqual(H);
  });

  it('a roll the system can\'t read is the server\'s to name, and the box says it', async () => {
    const { last } = open();
    await pick('BLEEDING');
    await userEvent.click(detail('Bleeding condition').getByRole('button', { name: '+ EACH TURN' }));
    const box = row(1).getByRole('textbox', { name: 'Each turn 1 roll' });
    await userEvent.clear(box);
    await userEvent.type(box, '1d4 + @nope');
    expect(checkDefinition(last()).problems).toEqual([{ where: 'condition bleeding, each turn 1, roll', message: '@nope isn\'t one of this system\'s names' }]);
  });

  it('ENDS AT THE END OF ITS NEXT TURN: stored, said, kept through another edit, the server agrees', async () => {
    const { last } = open();
    await pick('STUNNED');
    await userEvent.selectOptions(detail('Stunned condition').getByRole('combobox', { name: 'ENDS' }), 'next_turn');
    expect(stored(last())).toEqual({ stunned: { ends: 'next_turn' } });
    expect(detail('Stunned condition').getByText('comes off on its own when NEXT ends this character\'s next turn')).toBeTruthy();
    await userEvent.type(detail('Stunned condition').getByRole('textbox', { name: 'DESCRIPTION' }), '!');
    expect(stored(last())!.stunned.ends).toBe('next_turn');
    expect(checkDefinition(last()).problems).toEqual([]);
  });
});

describe('a condition drawn on the pad (8b1b)', () => {
  it('DRAW: the pad, with how it looks on a chip and the map; kept as the server takes it; an icon picked after, the drawing gone', async () => {
    const { last } = open();
    const blinded = detail('Blinded condition');
    await userEvent.click(blinded.getByRole('button', { name: 'DRAW' }));
    expect(blinded.getByText('ON A CHIP · ON THE MAP')).toBeTruthy();
    fireEvent.click(within(blinded.getByRole('group', { name: 'Drawing of Blinded' })).getByRole('button', { name: 'Square 2, 1' }), { detail: 0 });
    expect(stored(last())!.blinded).toEqual({ drawn: ['4000', ...Array(15).fill('0000')] });
    expect(checkDefinition(last()).problems).toEqual([]);
    // No icon checked while it is drawn; the list draws the drawing.
    expect(within(blinded.getByRole('radiogroup', { name: 'Icon' })).getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(list().getByText('BLINDED').closest('li')!.querySelectorAll('rect')).toHaveLength(1);
    await userEvent.click(within(blinded.getByRole('radiogroup', { name: 'Icon' })).getByRole('radio', { name: 'skull' }));
    expect(stored(last())!.blinded).toEqual({ icon: 'skull' });
    expect(blinded.queryByRole('group', { name: 'Drawing of Blinded' })).toBeNull();
  });
});
