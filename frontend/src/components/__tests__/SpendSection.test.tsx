// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpendSection } from '../SpendSection';
import type { SpendShown } from '../../sheets/spendShown';
import type { ChoiceListShown } from '../../sheets/choicesShown';

/**
 * SPEND XP on the sheet (7f2c1): what it draws of sheets/spendShown.ts, and that BUY and the GM's APPROVE, DECLINE and
 * UNDO each ask the server. What each line says is tested in sheets/__tests__/spendShown.test.ts.
 */

const SHOWN: SpendShown = {
  buys: [{ id: 'skills_up', what: 'stat', stats: [{ id: 'lore', label: 'Lore' }, { id: 'grit', label: 'Grit' }] }, { id: 'feats', what: 'option', list: 'feats', one: 'Feat', many: 'Feats' }],
  wait: true,
};
const LISTS = [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'alert', label: 'Alert' }] }] as unknown as ChoiceListShown[];
const DATA = {
  name: 'Wren', _xp: 40, lore: 2, grit: 9,
  _worked: { spend: { unspent: 15, prices: { skills_up: { lore: { cost: 15, from: 2, to: 3 }, grit: { error: 'Grit stops at 9' } }, feats: { alert: { cost: 10 } } } } },
  _spent: [
    { n: 1, buy: 'skills_up', what: 'stat', target: 'lore', from: 1, to: 2, cost: 10, by: 'player', state: 'done' },
    { n: 2, buy: 'feats', what: 'option', list: 'feats', target: 'alert', cost: 10, by: 'player', state: 'pending' },
    { n: 3, buy: 'skills_up', what: 'stat', target: 'grit', from: 8, to: 9, cost: 5, by: 'gm', state: 'declined' },
  ],
};
const open = (more: Partial<React.ComponentProps<typeof SpendSection>> = {}) => {
  const onSpend = vi.fn();
  render(<SpendSection spend={SHOWN} lists={LISTS} data={DATA} word="XP" onSpend={onSpend} {...more} />);
  return onSpend;
};

afterEach(cleanup);

describe('SPEND XP on the sheet', () => {
  it('XP unspent, with what was awarded, spent and is waiting', () => {
    open();
    const status = screen.getByRole('status', { name: 'XP unspent' });
    expect(status.textContent).toBe('XP 15 UNSPENT40 AWARDED · 10 SPENT · 10 WAITING FOR THE GM');
  });

  it('a BUY beside each, asking the server; one that can\'t be bought says why, its BUY off', async () => {
    const onSpend = open();
    const buys = within(screen.getByRole('list', { name: 'What XP buys' }));
    expect(buys.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['LORE', 'GRIT', 'FEAT · ALERT']);
    expect(within(buys.getByRole('listitem', { name: 'LORE' })).getByText('TO 3: 15 XP')).toBeTruthy();
    expect(within(buys.getByRole('listitem', { name: 'GRIT' })).getByText('Grit stops at 9')).toBeTruthy();
    expect((buys.getByRole('button', { name: 'Buy GRIT' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(buys.getByRole('listitem', { name: 'FEAT · ALERT' })).getByText('WAITING FOR THE GM')).toBeTruthy();
    expect((buys.getByRole('button', { name: 'Buy FEAT · ALERT' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(buys.getByRole('button', { name: 'Buy LORE' }));
    expect(onSpend).toHaveBeenCalledWith({ kind: 'buy', buy: 'skills_up', target: 'lore' });
  });

  it('SPENT, newest first; a player sees no GM\'s buttons', () => {
    open();
    const spent = within(screen.getByRole('list', { name: 'Spent' }));
    expect(spent.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'GRIT 8 → 95 XP · BY THE GMDECLINED', 'FEAT · ALERT10 XP · BY WRENPENDING', 'LORE 1 → 210 XP · BY WREN',
    ]);
    expect(spent.queryByRole('button')).toBeNull();
  });

  it('the GM\'s APPROVE, DECLINE and UNDO, each asking the server', async () => {
    const onSpend = open({ gm: true });
    const spent = within(screen.getByRole('list', { name: 'Spent' }));
    await userEvent.click(within(spent.getByRole('listitem', { name: 'FEAT · ALERT' })).getByRole('button', { name: 'APPROVE' }));
    await userEvent.click(within(spent.getByRole('listitem', { name: 'FEAT · ALERT' })).getByRole('button', { name: 'DECLINE' }));
    await userEvent.click(within(spent.getByRole('listitem', { name: 'LORE 1 → 2' })).getByRole('button', { name: 'UNDO' }));
    expect(onSpend.mock.calls.map((c) => c[0])).toEqual([{ kind: 'approve', entry: 2 }, { kind: 'decline', entry: 2 }, { kind: 'undo', entry: 1 }]);
    expect(within(spent.getByRole('listitem', { name: 'GRIT 8 → 9' })).queryByRole('button')).toBeNull();
  });

  it('read only: no BUY to press, no GM\'s buttons; nothing bought yet said so; what was refused shown', () => {
    render(<SpendSection spend={SHOWN} lists={LISTS} data={DATA} word="XP" gm />);
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    cleanup();
    open({ data: { ...DATA, _spent: [] }, refused: 'That costs 15 XP, and 14 is unspent' });
    expect(screen.getByText('NOTHING BOUGHT YET')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('That costs 15 XP, and 14 is unspent');
  });

  it('nothing at all before a save has priced it, or without a price list', () => {
    open({ data: { _xp: 4 } });
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    open({ spend: null });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
