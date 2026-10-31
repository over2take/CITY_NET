import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RestSection } from '../RestSection';
import { SheetRenderer } from '../SheetRenderer';
import { WORKED_KEY, REST_CALL_KEY, restSection, type RecoveryWorked, type RestingShown } from '../../sheets/choicesShown';
import type { SheetTemplate } from '../../sheets/types';

/**
 * A character sheet's RESTS section (R3b). Approved mockup rest-on-sheet (2026-10-30) and the user's
 * calls: a button for each rest where rests are finished on each sheet (the GM's always), each asking
 * first; a rest with dice to spend opens its panel, the dice then FINISH, which asks too; one with
 * none applies once asked; a rest the GM called opens by itself; dice spent any time show always.
 */

afterEach(cleanup);

const RESTING: RestingShown = { finish: 'sheet', rests: [{ id: 'short_rest', name: 'Short rest', spends: true }, { id: 'long_rest', name: 'Long rest', spends: false }] };
const HIT_DICE: RecoveryWorked = { name: 'Hit Dice', heals: 'its die', spentAt: ['Short rest'], spend: 'any', pools: [{ id: 'fighter', label: 'Fighter', die: 10, total: 3, spent: 1 }] };
const dataWith = (recovery: RecoveryWorked | null = HIT_DICE, extra: Record<string, unknown> = {}) => ({ [WORKED_KEY]: { recovery }, ...extra });
const show = (props: Partial<React.ComponentProps<typeof RestSection>> = {}) => {
  const onRestTake = vi.fn();
  const onRecoverySpend = vi.fn();
  render(<RestSection resting={RESTING} data={dataWith()} readOnly={false} onRestTake={onRestTake} onRecoverySpend={onRecoverySpend} onChoices={vi.fn()} {...props} />);
  return { onRestTake, onRecoverySpend };
};
const restButtons = () => within(screen.getByRole('group', { name: 'Rests' })).getAllByRole('button').map((b) => b.textContent);

describe('the rest buttons', () => {
  it('a button for each rest; the dice wait for the rest they are spent at', () => {
    show();
    expect(restButtons()).toEqual(['SHORT REST', 'LONG REST']);
    expect(screen.queryByRole('region', { name: 'Hit Dice' })).toBeNull();
  });

  it('a rest with nothing to spend asks first, then applies; CANCEL takes nothing', async () => {
    const { onRestTake } = show();
    await userEvent.click(screen.getByRole('button', { name: 'LONG REST' }));
    const asking = within(screen.getByRole('group', { name: 'Take a Long rest?' }));
    expect(asking.getByText('It applies now: what it refills, and what it gives back.')).toBeTruthy();
    await userEvent.click(asking.getByRole('button', { name: 'CANCEL' }));
    expect(onRestTake).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'LONG REST' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Take a Long rest?' })).getByRole('button', { name: 'REST' }));
    expect(onRestTake).toHaveBeenCalledWith('long_rest');
    expect(screen.queryByRole('region', { name: 'Long rest panel' })).toBeNull();
  });

  it('a rest the dice are spent at opens its panel: the dice, then FINISH, which asks too', async () => {
    const { onRestTake, onRecoverySpend } = show();
    await userEvent.click(screen.getByRole('button', { name: 'SHORT REST' }));
    expect(screen.getByText('It opens: spend Hit Dice first, then FINISH.')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('group', { name: 'Take a Short rest?' })).getByRole('button', { name: 'REST' }));
    const panel = within(screen.getByRole('region', { name: 'Short rest panel' }));
    expect(onRestTake).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Rests' })).toBeNull();
    await userEvent.click(panel.getByRole('button', { name: 'SPEND 1D10' }));
    expect(onRecoverySpend).toHaveBeenCalledWith('fighter', 1);
    await userEvent.click(panel.getByRole('button', { name: 'FINISH SHORT REST' }));
    const finishing = within(screen.getByRole('group', { name: 'Finish the Short rest?' }));
    await userEvent.click(finishing.getByRole('button', { name: 'NOT YET' }));
    expect(onRestTake).not.toHaveBeenCalled();
    await userEvent.click(panel.getByRole('button', { name: 'FINISH SHORT REST' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Finish the Short rest?' })).getByRole('button', { name: 'FINISH' }));
    expect(onRestTake).toHaveBeenCalledWith('short_rest');
    expect(screen.queryByRole('region', { name: 'Short rest panel' })).toBeNull();
    expect(restButtons()).toEqual(['SHORT REST', 'LONG REST']);
  });

  it('a panel the player opened can be put away again', async () => {
    const { onRestTake } = show();
    await userEvent.click(screen.getByRole('button', { name: 'SHORT REST' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Take a Short rest?' })).getByRole('button', { name: 'REST' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Short rest panel' })).getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('region', { name: 'Short rest panel' })).toBeNull();
    expect(onRestTake).not.toHaveBeenCalled();
  });

  it('a rest with no recovery dice at all applies once asked', async () => {
    const { onRestTake } = show({ data: dataWith(null) });
    await userEvent.click(screen.getByRole('button', { name: 'SHORT REST' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Take a Short rest?' })).getByRole('button', { name: 'REST' }));
    expect(onRestTake).toHaveBeenCalledWith('short_rest');
  });
});

describe('a rest the GM called', () => {
  const called = dataWith(HIT_DICE, { [REST_CALL_KEY]: { rest: 'short_rest', name: 'Short rest' } });

  it('opens by itself, says so, and stays until finished: no other rest meanwhile', async () => {
    const { onRestTake } = show({ data: called });
    const panel = within(screen.getByRole('region', { name: 'Short rest panel' }));
    expect(panel.getByText('CALLED BY THE GM')).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'CANCEL' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rests' })).toBeNull();
    await userEvent.click(panel.getByRole('button', { name: 'FINISH SHORT REST' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Finish the Short rest?' })).getByRole('button', { name: 'FINISH' }));
    expect(onRestTake).toHaveBeenCalledWith('short_rest');
  });

  it('still finished after the system moved to rests at the GM\'s call, with no word against it', () => {
    show({ data: called, resting: { ...RESTING, finish: 'call' } });
    expect(screen.getByRole('region', { name: 'Short rest panel' })).toBeTruthy();
    expect(screen.queryByText('Rests are taken when the GM calls them.')).toBeNull();
  });

  it('even where rests are at the GM\'s call; read only, it waits for the character', () => {
    show({ data: called, readOnly: true });
    expect(screen.getByText('Waiting for this character to finish it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /FINISH/ })).toBeNull();
  });
});

describe('who gets what', () => {
  it('at the GM\'s call: no buttons for a player, the dice always in view; the GM has the buttons', () => {
    show({ resting: { ...RESTING, finish: 'call' } });
    expect(screen.queryByRole('group', { name: 'Rests' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Hit Dice' })).toBeTruthy();
    expect(screen.getByText('Rests are taken when the GM calls them.')).toBeTruthy();
    cleanup();
    show({ resting: { ...RESTING, finish: 'call' }, gm: true });
    expect(restButtons()).toEqual(['SHORT REST', 'LONG REST']);
    expect(screen.queryByText('Rests are taken when the GM calls them.')).toBeNull();
  });

  it('no dice and no buttons: says rests are the GM\'s to call', () => {
    show({ resting: { ...RESTING, finish: 'call' }, data: dataWith(null) });
    expect(screen.getByText('Rests are taken when the GM calls them.')).toBeTruthy();
  });

  it('dice spent any time show always, and not again in a panel', async () => {
    show({ data: dataWith({ ...HIT_DICE, spentAt: 'any' }) });
    expect(screen.getAllByRole('region', { name: 'Hit Dice' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'SHORT REST' }));
    expect(screen.getByText('It applies now: what it refills, and what it gives back.')).toBeTruthy();
  });

  it('read only, or nowhere to ask: no buttons', () => {
    show({ readOnly: true });
    expect(screen.queryByRole('group', { name: 'Rests' })).toBeNull();
    cleanup();
    show({ onRestTake: undefined });
    expect(screen.queryByRole('group', { name: 'Rests' })).toBeNull();
  });

  it('shows a refusal under it', () => {
    show({ refused: 'In this game, rests are taken when the GM calls them' });
    expect(screen.getByRole('alert').textContent).toBe('In this game, rests are taken when the GM calls them');
  });
});

describe('the logic', () => {
  it('a called rest the game no longer has is no call; nothing at all reads safely', () => {
    expect(restSection(RESTING, { [REST_CALL_KEY]: { rest: 'nap' } }, false).call).toBeNull();
    expect(restSection(RESTING, { [REST_CALL_KEY]: 'short_rest' }, false).call).toBeNull();
    expect(restSection(undefined, null, false)).toEqual({ buttons: [], call: null, recovery: null, diceAlways: false });
  });
});

describe('on the sheet', () => {
  const template = (sections: SheetTemplate['sections']) => ({ id: 'sys_x', name: 'Forge', sections, resting: RESTING,
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: false, levelled: true, options: [] }] }) as unknown as SheetTemplate;
  const sheetData = { [WORKED_KEY]: { picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: [], recovery: HIT_DICE } };

  it('a RESTS section draws it, and the dice leave CHOICES for it', async () => {
    const onRestTake = vi.fn();
    render(<SheetRenderer template={template([
      { id: 'choices', label: 'CLASSES', layout: 'choices', fields: [] },
      { id: 'rests', label: 'RESTS', layout: 'rests', fields: [] },
    ])} data={sheetData} onChoices={vi.fn()} onRestTake={onRestTake} />);
    expect(screen.getByRole('group', { name: 'Rests' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Hit Dice' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'LONG REST' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Take a Long rest?' })).getByRole('button', { name: 'REST' }));
    expect(onRestTake).toHaveBeenCalledWith('long_rest');
  });

  it('a sheet made before RESTS keeps the dice in CHOICES', () => {
    render(<SheetRenderer template={template([{ id: 'choices', label: 'CLASSES', layout: 'choices', fields: [] }])} data={sheetData} onChoices={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Hit Dice' })).toBeTruthy();
  });
});
