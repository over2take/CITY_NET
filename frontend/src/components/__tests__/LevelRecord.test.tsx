import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LevelRecord } from '../LevelRecord';
import type { SheetTemplate } from '../../sheets/types';

/**
 * WHAT EACH LEVEL GAINED (7d7b2; approved mockup docs/mockups/level-record.html, 2026-11-09): folded shut to start;
 * the player rolls a level the GM cleared and spends an increase left open; the GM's tools each on a line of its own.
 */

const STATS = [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }];
const ASI = { id: 'asi', label: 'Ability Score Improvement', at: 4, increase: { points: 2, most: 1, stats: STATS, cap: 20 } };
const TEMPLATE = {
  levels: { top: 10, health: { gain: 'roll', dieOn: 'class', dice: { soldier: 10 } } },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: false, levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [ASI] }] }],
} as unknown as SheetTemplate;

const LEVELS = [
  { level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10, rolled: true }, { level: 3, took: 5, die: 10, cleared: true }, { level: 4, took: 6, die: 10, set: true },
];
const data = (more: object = {}) => ({
  might: 19, wits: 12,
  _health: { adds: 2, max: 33, levels: LEVELS },
  _worked: { picks: [{ list: 'classes', option: 'soldier', level: 4 }], levels: { level: 4 }, increasesOpen: ['asi'] },
  ...more,
});

const draw = (gm: boolean, more: object = {}, onLevel: ((a: Record<string, unknown>) => void) | undefined = vi.fn()) => {
  render(<LevelRecord template={TEMPLATE} data={data(more)} gm={gm} onLevel={onLevel} />);
  return onLevel as ReturnType<typeof vi.fn>;
};
const unfold = () => userEvent.click(screen.getByRole('button', { name: /LEVELS · 4 · MAX HEALTH 33 · WHAT EACH GAINED/ }));
const level = (n: number) => within(screen.getByRole('group', { name: `Level ${n}` }));

afterEach(cleanup);

describe('WHAT EACH LEVEL GAINED', () => {
  it('folded shut to start, its head saying the level and the maximum', async () => {
    draw(false);
    const head = screen.getByRole('button', { name: /WHAT EACH GAINED/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Level 1' })).toBeNull();
    await unfold();
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(level(1).getByText('HEALTH +12')).toBeTruthy();
    expect(level(1).getByText('THE FULL D10, +2 EACH LEVEL')).toBeTruthy();
    expect(screen.getByLabelText('Max health').textContent).toBe('33');
  });

  it('the player: ROLL D10 where the GM cleared one, and no GM tools', async () => {
    const onLevel = draw(false);
    await unfold();
    expect(level(2).getByText('ROLLED 5, +2 EACH LEVEL')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clear level/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set level/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear Ability/ })).toBeNull();
    expect(level(3).getByText(/YOUR GM CLEARED IT FOR ANOTHER GO/)).toBeTruthy();
    await userEvent.click(level(3).getByRole('button', { name: 'ROLL D10' }));
    expect(onLevel).toHaveBeenCalledWith({ kind: 'rollLevel', level: 3 });
  });

  it('the GM: CLEAR THE ROLL on a past roll, SET TO on each, CLEAR on one set; a cleared one waits for the player', async () => {
    const onLevel = draw(true);
    await unfold();
    expect(level(1).queryByRole('button', { name: /Clear level/ })).toBeNull();
    await userEvent.click(level(2).getByRole('button', { name: "Clear level 2's roll" }));
    expect(onLevel).toHaveBeenLastCalledWith({ kind: 'clearLevel', level: 2 });
    expect(level(3).getByText('TO ROLL AGAIN: THE PLAYER ROLLS IT ON THEIR SHEET')).toBeTruthy();
    expect(level(3).queryByRole('button', { name: 'ROLL D10' })).toBeNull();
    // CLEAR, back, only on one set.
    expect(level(2).queryByRole('button', { name: 'Level 2 back to the average' })).toBeNull();
    await userEvent.click(level(4).getByRole('button', { name: 'Level 4 back to the average' }));
    expect(onLevel).toHaveBeenLastCalledWith({ kind: 'setLevel', level: 4, took: null });
    expect(level(1).getByText("THE DIE'S PART, 1 TO 10")).toBeTruthy();
  });

  it('SET TO: OK once there is a number, sent whole, by click or Enter; level 1 set goes back to the full die', async () => {
    const onLevel = draw(true, { _health: { adds: 2, max: 33, levels: [{ level: 1, took: 4, die: 10, set: true }, ...LEVELS.slice(1)] } });
    await unfold();
    const ok = level(2).getByRole('button', { name: 'Set level 2' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    // Enter with nothing typed asks nothing.
    await userEvent.type(level(2).getByLabelText("Level 2: set the die's part to"), '{Enter}');
    expect(onLevel).not.toHaveBeenCalled();
    await userEvent.type(level(2).getByLabelText("Level 2: set the die's part to"), '7');
    await userEvent.click(ok);
    expect(onLevel).toHaveBeenLastCalledWith({ kind: 'setLevel', level: 2, took: 7 });
    expect((level(2).getByLabelText("Level 2: set the die's part to") as HTMLInputElement).value).toBe('');
    await userEvent.type(level(3).getByLabelText("Level 3: set the die's part to"), '3{Enter}');
    expect(onLevel).toHaveBeenLastCalledWith({ kind: 'setLevel', level: 3, took: 3 });
    expect(level(1).getByText('SET TO 4 BY THE GM, +2 EACH LEVEL')).toBeTruthy();
    await userEvent.click(level(1).getByRole('button', { name: 'Level 1 back to the full die' }));
    expect(onLevel).toHaveBeenLastCalledWith({ kind: 'setLevel', level: 1, took: null });
  });

  it('an increase open: − and + as LEVEL_UP.EXE, SPEND once every point is', async () => {
    const onLevel = draw(false);
    await unfold();
    const inc = within(screen.getByRole('group', { name: 'Ability Score Improvement' }));
    const spend = inc.getByRole('button', { name: 'SPEND' }) as HTMLButtonElement;
    expect(spend.disabled).toBe(true);
    expect(inc.getByText('2 POINTS LEFT · AT MOST 1 ON ONE · STOPS AT 20')).toBeTruthy();
    expect((inc.getByRole('button', { name: 'Less Might' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(inc.getByRole('button', { name: 'More Might' }));
    expect(inc.getByLabelText('Might with the points').textContent).toBe('20');
    // At most 1 on one, and Might stops at 20.
    expect((inc.getByRole('button', { name: 'More Might' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(inc.getByRole('button', { name: 'More Wits' }));
    expect(spend.disabled).toBe(false);
    await userEvent.click(spend);
    expect(onLevel).toHaveBeenCalledWith({ kind: 'spendIncrease', feature: 'asi', spread: { might: 1, wits: 1 } });
    await userEvent.click(inc.getByRole('button', { name: 'Less Wits' }));
    expect(spend.disabled).toBe(true);
  });

  it('an increase spent: what it went on; the GM clears it for the player to spend again', async () => {
    const spent = { _increases: { asi: { might: 1, wits: 1 } }, _worked: { picks: [{ list: 'classes', option: 'soldier', level: 4 }], levels: { level: 4 } } };
    draw(false, spent);
    await unfold();
    expect(screen.getByText('INCREASE +1 MIGHT, +1 WITS')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear Ability Score Improvement' })).toBeNull();
    cleanup();
    const onLevel = draw(true, spent);
    await unfold();
    await userEvent.click(screen.getByRole('button', { name: 'Clear Ability Score Improvement' }));
    expect(onLevel).toHaveBeenCalledWith({ kind: 'clearIncrease', feature: 'asi' });
  });

  it('only read with nothing to ask: no buttons but the fold', async () => {
    render(<LevelRecord template={TEMPLATE} data={data()} gm />);
    await unfold();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(level(3).getByText('HEALTH +7')).toBeTruthy();
    cleanup();
    // The player's, only read: a cleared level says so, with nothing to press.
    render(<LevelRecord template={TEMPLATE} data={data()} />);
    await unfold();
    expect(level(3).queryByRole('button', { name: 'ROLL D10' })).toBeNull();
    expect(level(3).getByText('TO ROLL AGAIN')).toBeTruthy();
  });

  it('increases only, where health isn\'t per level: no maximum', async () => {
    render(<LevelRecord template={{ ...TEMPLATE, levels: { top: 10 } } as unknown as SheetTemplate} data={data()} gm onLevel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^LEVELS · 4 · WHAT EACH GAINED$/ }));
    expect(screen.getByRole('group', { name: 'Ability Score Improvement' })).toBeTruthy();
    expect(screen.queryByLabelText('Max health')).toBeNull();
  });

  it('an uploaded maximum: one line for its levels; the GM clears it', async () => {
    const based = { _health: { adds: 2, max: 39, base: { max: 31, level: 3 }, levels: [
      { level: 1, took: 10, die: 10, base: true }, { level: 2, took: 5, die: 10, base: true }, { level: 3, took: 5, die: 10, base: true }, { level: 4, took: 6, die: 10, rolled: true },
    ] } };
    draw(false, based);
    await userEvent.click(screen.getByRole('button', { name: /WHAT EACH GAINED/ }));
    const line = within(screen.getByRole('group', { name: 'Uploaded maximum' }));
    expect(line.getByText('L1–3 · HEALTH 31')).toBeTruthy();
    expect(line.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Level 2' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Level 4' })).toBeTruthy();
    cleanup();
    const onLevel = draw(true, based);
    await userEvent.click(screen.getByRole('button', { name: /WHAT EACH GAINED/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear the uploaded maximum' }));
    expect(onLevel).toHaveBeenCalledWith({ kind: 'clearBase' });
    cleanup();
    render(<LevelRecord template={TEMPLATE} data={data(based)} gm />);
    await userEvent.click(screen.getByRole('button', { name: /WHAT EACH GAINED/ }));
    expect(within(screen.getByRole('group', { name: 'Uploaded maximum' })).queryByRole('button')).toBeNull();
  });

  it('nothing at all where there is no record', () => {
    const { container } = render(<LevelRecord template={{ choices: [] } as unknown as SheetTemplate} data={{}} />);
    expect(container.innerHTML).toBe('');
  });
});
