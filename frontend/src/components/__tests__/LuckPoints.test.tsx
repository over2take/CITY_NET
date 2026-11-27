import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { RefillLuck } from '../RefillLuck';
import { LuckPoints } from '../LuckPoints';
import { templateFromRender, registerCustomTemplate, type CustomRender } from '../../sheets/customTemplates';
import { luckNowOf, armAt, armedWords, spendsOn, type LuckShown } from '../../sheets/luckPoints';

/**
 * A game's luck at the table (8c6; approved mockup docs/mockups/rule-library.html, section 4): its points on the sheet, clicked
 * to set some aside, the next roll from the sheet spending them (a roll luck isn't on keeps them aside); and the GM's REFILL
 * LUCK on the GAME tab.
 */

afterEach(cleanup);

const RENDER = (luck: LuckShown | null, id = 'sys_000000000000luck'): CustomRender => ({
  id, name: 'Luckfall', words: {}, parts: {}, derived: [],
  sheet: { sections: [{ id: 'stats', label: 'STATS', layout: 'grid', fields: [{ id: 'aim', label: 'Aim', type: 'number' }, { id: 'wit', label: 'Wit', type: 'number' }] }] },
  rolls: [{ id: 'shoot', label: 'Shoot', changes: [], fields: ['aim'] }, { id: 'think', label: 'Think', changes: [], fields: ['wit'] }],
  luck,
});
const LUCK: LuckShown = { name: 'LUCK', each: 'plus', on: 'all' };
const draw = (luck: LuckShown | null, worked: unknown = { luck: { current: 3, most: 4 } }) => {
  const onRoll = vi.fn();
  render(<SheetRenderer template={templateFromRender(RENDER(luck))} data={{ aim: 2, wit: 1, _worked: worked } as never} onFieldChange={vi.fn()} onRoll={onRoll} />);
  return onRoll;
};
const points = () => within(screen.getByRole('group', { name: 'LUCK' }));

describe('as logic', () => {
  it('what is left, of the most, as the server worked it out; nothing where it hasn\'t', () => {
    expect(luckNowOf({ luck: { current: 2, most: 4 } })).toEqual({ current: 2, most: 4 });
    expect(luckNowOf({ luck: { current: 9, most: 4 } })).toEqual({ current: 4, most: 4 });
    for (const bad of [null, {}, { luck: 3 }, { luck: { current: -1, most: 4 } }, { luck: { current: 1 } }, 'x']) expect(luckNowOf(bad)).toBeNull();
  });

  it('setting aside: up to the point clicked, none again when it was the last; never more than is left', () => {
    expect(armAt(0, 2, 3)).toBe(2);
    expect(armAt(2, 2, 3)).toBe(0);
    expect(armAt(2, 1, 3)).toBe(1);
    expect(armAt(0, 5, 3)).toBe(3);
  });

  it('in words, +1 or dice a point; spent on every roll or those named', () => {
    expect(armedWords(LUCK, 2)).toBe('2 SET ASIDE · NEXT ROLL +2');
    expect(armedWords({ ...LUCK, name: 'EDGE', each: 'die' }, 1)).toBe('1 SET ASIDE · NEXT ROLL +1 DIE');
    expect(armedWords({ ...LUCK, each: 'die' }, 3)).toBe('3 SET ASIDE · NEXT ROLL +3 DICE');
    expect(armedWords(LUCK, 0)).toBe('');
    expect(spendsOn(LUCK, 'think')).toBe(true);
    expect(spendsOn({ ...LUCK, on: ['shoot'] }, 'shoot')).toBe(true);
    expect(spendsOn({ ...LUCK, on: ['shoot'] }, 'think')).toBe(false);
    expect(spendsOn({ ...LUCK, on: ['shoot'] }, undefined)).toBe(false);
    expect(spendsOn(null, 'shoot')).toBe(false);
  });
});

describe('on the sheet', () => {
  it('a point each, those left filled; two set aside, said; the next roll spends them', async () => {
    const onRoll = draw(LUCK);
    expect(points().getByText('3/4')).toBeTruthy();
    expect((points().getByRole('button', { name: 'LUCK 4 of 4, spent' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(points().getByRole('button', { name: 'LUCK 2 of 4' }));
    expect(points().getByRole('status').textContent).toBe('2 SET ASIDE · NEXT ROLL +2');
    expect(points().getByRole('button', { name: 'LUCK 1 of 4, set aside' }).getAttribute('aria-pressed')).toBe('true');
    // The last one set aside, clicked again: none.
    await userEvent.click(points().getByRole('button', { name: 'LUCK 2 of 4, set aside' }));
    expect(points().queryByRole('status')).toBeNull();
    await userEvent.click(points().getByRole('button', { name: 'LUCK 2 of 4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Roll Shoot' }));
    expect(onRoll).toHaveBeenCalledWith('aim', 2, undefined);
    expect(points().queryByRole('status')).toBeNull();
  });

  it('ONLY THESE ROLLS: a roll luck isn\'t on is made plain and keeps them aside', async () => {
    const onRoll = draw({ ...LUCK, on: ['shoot'] });
    await userEvent.click(points().getByRole('button', { name: 'LUCK 1 of 4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Roll Think' }));
    expect(onRoll).toHaveBeenLastCalledWith('wit', undefined, undefined);
    expect(points().getByRole('status').textContent).toBe('1 SET ASIDE · NEXT ROLL +1');
    await userEvent.click(screen.getByRole('button', { name: 'Roll Shoot' }));
    expect(onRoll).toHaveBeenLastCalledWith('aim', 1, undefined);
  });

  it('none: a game without luck, a sheet not worked out yet, or a most of none', () => {
    draw(null);
    expect(screen.queryByRole('group', { name: 'LUCK' })).toBeNull();
    cleanup();
    draw(LUCK, {});
    expect(screen.queryByRole('group', { name: 'LUCK' })).toBeNull();
    cleanup();
    draw(LUCK, { luck: { current: 0, most: 0 } });
    expect(screen.queryByRole('group', { name: 'LUCK' })).toBeNull();
  });

  it('more set aside than is left (spent meanwhile): only what is left counts', () => {
    render(<LuckPoints rule={LUCK} now={{ current: 1, most: 4 }} armed={3} onArm={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('1 SET ASIDE · NEXT ROLL +1');
  });

  it('read only: shown, nothing to set aside', () => {
    render(<SheetRenderer template={templateFromRender(RENDER(LUCK))} data={{ _worked: { luck: { current: 2, most: 2 } } } as never} onFieldChange={vi.fn()} />);
    expect((points().getByRole('button', { name: 'LUCK 1 of 2' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('REFILL LUCK on the GAME tab', () => {
  it('the GM\'s: sent, its answer said; only in a game with luck', async () => {
    registerCustomTemplate(RENDER({ ...LUCK, name: 'EDGE' }, 'sys_00000000000luck2'));
    const emit = vi.fn((_e: string, ack: (a: unknown) => void) => ack({ ok: true, refilled: 2 }));
    const { unmount } = render(<RefillLuck system="sys_00000000000luck2" socketOf={() => ({ emit })} />);
    await userEvent.click(screen.getByRole('button', { name: 'REFILL EDGE' }));
    expect(emit).toHaveBeenCalledWith('refillLuck', expect.any(Function));
    expect(screen.getByRole('status').textContent).toBe('2 CHARACTERS BACK TO THEIR MOST');
    unmount();
    const one = render(<RefillLuck system="sys_00000000000luck2" socketOf={() => ({ emit: (_e: string, ack: (a: unknown) => void) => ack({ ok: true, refilled: 1 }) })} />);
    await userEvent.click(screen.getByRole('button', { name: 'REFILL EDGE' }));
    expect(screen.getByRole('status').textContent).toBe('1 CHARACTER BACK TO THEIR MOST');
    one.unmount();
    const none = render(<RefillLuck system="sys_00000000000luck2" socketOf={() => ({ emit: (_e: string, ack: (a: unknown) => void) => ack({ ok: true, refilled: 0 }) })} />);
    await userEvent.click(screen.getByRole('button', { name: 'REFILL EDGE' }));
    expect(screen.getByRole('status').textContent).toBe('EVERYONE HAS ALL OF IT');
    none.unmount();
    const refused = render(<RefillLuck system="sys_00000000000luck2" socketOf={() => ({ emit: (_e: string, ack: (a: unknown) => void) => ack({ ok: false, error: 'The GM\'s to do' }) })} />);
    await userEvent.click(screen.getByRole('button', { name: 'REFILL EDGE' }));
    expect(screen.getByRole('alert').textContent).toBe('THE GM\'S TO DO');
    refused.unmount();
    const off = render(<RefillLuck system="sys_00000000000luck2" socketOf={() => null} />);
    await userEvent.click(screen.getByRole('button', { name: 'REFILL EDGE' }));
    expect(screen.getByRole('alert').textContent).toBe('NOT CONNECTED');
    off.unmount();
    registerCustomTemplate(RENDER(null, 'sys_00000000000luck3'));
    const { container } = render(<RefillLuck system="sys_00000000000luck3" socketOf={() => ({ emit })} />);
    expect(container.textContent).toBe('');
  });
});
