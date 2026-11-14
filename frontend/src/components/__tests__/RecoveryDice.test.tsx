import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecoveryDice } from '../RecoveryDice';
import { ChoicesSection } from '../ChoicesSection';
import { WORKED_KEY, type RecoveryWorked, type ChoiceListShown } from '../../sheets/choicesShown';

/**
 * A character's recovery dice on their sheet (R2b). Approved mockup rest-on-sheet (2026-10-30): the
 * system's name for them, what one heals and where they're spent, each pool as pips lit while left;
 * a pip ticks one off (real dice) or back, SPEND rolls some; where the system leaves it to the GM, a
 * player's controls wait until the GM opens spending, and the GM's never do.
 */

afterEach(cleanup);

const HIT_DICE: RecoveryWorked = {
  name: 'Hit Dice', heals: 'its die + CON MODIFIER', spentAt: ['Short rest'], spend: 'any',
  pools: [{ id: 'fighter', label: 'Fighter', die: 10, total: 3, spent: 1 }, { id: 'wizard', label: 'Wizard', die: 6, total: 2, spent: 2 }],
};
const show = (props: Partial<React.ComponentProps<typeof RecoveryDice>> = {}) => {
  const ask = vi.fn();
  const onSpend = vi.fn();
  render(<RecoveryDice recovery={HIT_DICE} can gm={false} open={false} ask={ask} onSpend={onSpend} {...props} />);
  return { ask, onSpend };
};
const pool = (name: string) => within(screen.getByRole('group', { name }));
const pips = (name: string) => within(screen.getByRole('group', { name: `${name} left` })).getAllByRole('button');

describe('the block', () => {
  it('names them, says what one heals and where, and shows each pool lit while left', () => {
    show();
    const block = within(screen.getByRole('region', { name: 'Hit Dice' }));
    expect(block.getByText('HIT DICE')).toBeTruthy();
    expect(block.getByText('ONE HEALS ITS DIE + CON MODIFIER · SPENT AT A SHORT REST')).toBeTruthy();
    expect(pips('Fighter d10').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(pool('Fighter d10').getByText('2 OF 3 LEFT')).toBeTruthy();
    expect(pool('Wizard d6').getByText('0 OF 2 LEFT')).toBeTruthy();
  });

  it('a pip ticks one off or takes it back, as a feature\'s uses do', async () => {
    const { ask } = show();
    await userEvent.click(pips('Fighter d10')[2]);
    expect(ask).toHaveBeenLastCalledWith({ kind: 'recovery', pool: 'fighter', spent: 3 });
    await userEvent.click(pips('Fighter d10')[0]);
    expect(ask).toHaveBeenLastCalledWith({ kind: 'recovery', pool: 'fighter', spent: 0 });
  });

  it('SPEND rolls as many as − and + say, kept to what is left; none left, no SPEND', async () => {
    const { onSpend } = show();
    const fighter = pool('Fighter d10');
    expect(fighter.getByRole('button', { name: 'Spend fewer Fighter d10' })).toHaveProperty('disabled', true);
    await userEvent.click(fighter.getByRole('button', { name: 'Spend more Fighter d10' }));
    expect(fighter.getByLabelText('How many Fighter d10 to spend').textContent).toBe('2');
    expect(fighter.getByRole('button', { name: 'Spend more Fighter d10' })).toHaveProperty('disabled', true);
    await userEvent.click(fighter.getByRole('button', { name: 'SPEND 2D10' }));
    expect(onSpend).toHaveBeenCalledWith('fighter', 2);
    await userEvent.click(fighter.getByRole('button', { name: 'Spend fewer Fighter d10' }));
    await userEvent.click(fighter.getByRole('button', { name: 'SPEND 1D10' }));
    expect(onSpend).toHaveBeenLastCalledWith('fighter', 1);
    expect(pool('Wizard d6').queryByRole('button', { name: /^SPEND/ })).toBeNull();
  });

  it('spent any time, and a formula\'s one pool, as the sheet says them', () => {
    show({ recovery: { ...HIT_DICE, name: 'Recoveries', heals: 'its die for each level', spentAt: 'any', pools: [{ id: '_all', label: 'Recoveries', die: 8, total: 8, spent: 0 }] } });
    expect(screen.getByText('ONE HEALS ITS DIE FOR EACH LEVEL · SPENT ANY TIME')).toBeTruthy();
    expect(pool('Recoveries d8').getByText('8 OF 8 LEFT')).toBeTruthy();
  });

  it('read only, or with nowhere to ask: shown, nothing to press', () => {
    show({ can: false });
    expect(pips('Fighter d10').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /^SPEND/ })).toBeNull();
    expect(screen.queryByText(/THE GM OPENS SPENDING/)).toBeNull();
  });
});

describe('when the GM has the say', () => {
  const gmSays = { ...HIT_DICE, spend: 'gm' as const };

  it('a player\'s wait while spending is closed, and work once it is open', () => {
    show({ recovery: gmSays });
    expect(pips('Fighter d10').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /^SPEND/ })).toBeNull();
    expect(screen.getByText('THE GM OPENS SPENDING: UNTIL THEN THESE WAIT')).toBeTruthy();
    cleanup();
    show({ recovery: gmSays, open: true });
    expect(pips('Fighter d10').some((b) => (b as HTMLButtonElement).disabled)).toBe(false);
    expect(screen.getByRole('button', { name: 'SPEND 1D10' })).toBeTruthy();
    expect(screen.queryByText(/THE GM OPENS SPENDING/)).toBeNull();
  });

  it('the GM\'s work closed or open, and say which, and where to change it', () => {
    show({ recovery: gmSays, gm: true });
    expect(screen.getByRole('button', { name: 'SPEND 1D10' })).toBeTruthy();
    expect(screen.getByText('SPENDING IS CLOSED FOR PLAYERS · OPEN OR CLOSE IT IN THE GAME TAB\'S RESTS')).toBeTruthy();
    cleanup();
    show({ recovery: gmSays, gm: true, open: true });
    expect(screen.getByText(/^SPENDING IS OPEN FOR PLAYERS/)).toBeTruthy();
    cleanup();
    show({ gm: true });
    expect(screen.queryByText(/SPENDING IS/)).toBeNull();
  });
});

describe('at the head of the CHOICES block', () => {
  const LISTS: ChoiceListShown[] = [{ id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: false, levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [] }] }];
  const data = (recovery: unknown) => ({ [WORKED_KEY]: { picks: [{ list: 'classes', option: 'fighter', level: 3 }], opens: [], levels: {}, from: {}, uses: {}, unmet: [], recovery } });

  it('shown from what the save wrote, asking through the block\'s own ways', async () => {
    const onChoices = vi.fn();
    const onRecoverySpend = vi.fn();
    render(<ChoicesSection lists={LISTS} data={data(HIT_DICE)} readOnly={false} onChoices={onChoices} onRecoverySpend={onRecoverySpend} />);
    expect(screen.getByRole('region', { name: 'Hit Dice' })).toBeTruthy();
    await userEvent.click(pips('Fighter d10')[2]);
    expect(onChoices).toHaveBeenCalledWith({ kind: 'recovery', pool: 'fighter', spent: 3 });
    await userEvent.click(screen.getByRole('button', { name: 'SPEND 1D10' }));
    expect(onRecoverySpend).toHaveBeenCalledWith('fighter', 1);
  });

  it('closed until the window says spending is open; none without recovery dice', () => {
    render(<ChoicesSection lists={LISTS} data={data({ ...HIT_DICE, spend: 'gm' })} readOnly={false} onChoices={vi.fn()} onRecoverySpend={vi.fn()} recoveryOpen />);
    expect(screen.getByRole('button', { name: 'SPEND 1D10' })).toBeTruthy();
    cleanup();
    render(<ChoicesSection lists={LISTS} data={data(undefined)} readOnly={false} onChoices={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Hit Dice' })).toBeNull();
  });
});
