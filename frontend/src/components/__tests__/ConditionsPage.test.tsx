import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { ConditionsPage } from '../ConditionsPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';

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
    expect((detail('Stunned condition').getByRole('option', { name: 'AT A REFRESH EVENT (COMING)' }) as HTMLOptionElement).disabled).toBe(true);
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
