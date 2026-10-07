import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));

import { BankSettings } from '../BankSettings';
import { systemsApi, type Definition } from '../../sheets/systemsApi';

/**
 * The bank's settings on FEATURES (4b1c2). Approved mockup builder-words-features (2026-10-06):
 * currencies counted in whole numbers, decimals or coins, each with its switches and icon (the five,
 * or uploaded); the main one is the bank balance; celebrations with a whale threshold in it.
 */

const UPLOADED = `/uploads/currency_icons/${'e'.repeat(64)}.png`;
afterEach(() => cleanup());

const open = (start: Definition = { format: 1, name: 'Hearth' }, fetcher?: typeof fetch) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <BankSettings definition={def} api={fetcher ? systemsApi('gm', fetcher) : undefined}
      edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const gold: Definition = { format: 1, name: 'Hearth', currencies: [{ id: 'gold', name: 'Gold' }] };
const currency = (id: string) => screen.getByTestId(`currency-${id}`);
const readsAs = (id: string) => screen.getByTestId(`reads-as-${id}`).textContent;

describe('currencies', () => {
  it('starts with the app\'s money, and the first one added is the main one', async () => {
    const { last } = open();
    expect(screen.getByText(/None yet: the bank keeps the app's own money/)).toBeTruthy();
    await userEvent.click(screen.getByText('+ CURRENCY'));
    expect(last().currencies).toEqual([{ id: 'new_currency', name: 'NEW CURRENCY' }]);
    expect(within(currency('new_currency')).getByText('MAIN · THE BANK BALANCE')).toBeTruthy();
    expect(within(currency('new_currency')).queryByText('REMOVE')).toBeNull();
    expect(within(currency('new_currency')).queryByText('MAKE MAIN')).toBeNull();
  });

  it('renames one, and reads an amount in whole numbers, decimals or coins', async () => {
    const { last } = open(gold);
    expect(readsAs('gold')).toBe('123,456 Gold');
    await userEvent.click(within(currency('gold')).getByText('DECIMALS'));
    await userEvent.type(within(currency('gold')).getByPlaceholderText('none'), '$');
    expect(readsAs('gold')).toBe('$1,234.56');
    await userEvent.click(within(currency('gold')).getByText('AFTER'));
    await userEvent.click(within(currency('gold')).getByText('COMMA'));
    expect(readsAs('gold')).toBe('1.234,56 $');
    fireEvent.change(within(currency('gold')).getByRole('spinbutton'), { target: { value: '9' } });
    expect(last().currencies).toEqual([{ id: 'gold', name: 'Gold', symbol: '$', symbolAfter: true, decimals: 4, decimalMark: ',' }]);
    await userEvent.click(within(currency('gold')).getByText('COINS'));
    await userEvent.click(within(currency('gold')).getByText('+ COIN'));
    await userEvent.type(within(currency('gold')).getByLabelText('Coin 1 short'), 'gp');
    await userEvent.type(within(currency('gold')).getByLabelText('Coin 2 short'), 'cp');
    expect(readsAs('gold')).toBe('12345 gp 6 cp');
    fireEvent.change(within(currency('gold')).getByLabelText('Coin 1 worth'), { target: { value: '100' } });
    expect(readsAs('gold')).toBe('1234 gp 56 cp');
    expect((within(currency('gold')).getByLabelText('Remove coin Gold') as HTMLButtonElement).disabled).toBe(true);
    const name = within(currency('gold')).getByLabelText('Currency name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Crowns');
    expect(last().currencies![0].name).toBe('Crowns');
  });

  it('turns debt and a balance below zero on and off', async () => {
    const { last } = open(gold);
    await userEvent.click(within(currency('gold')).getByLabelText(/Players can borrow it/));
    await userEvent.click(within(currency('gold')).getByLabelText(/A balance can go below zero/));
    expect(last().currencies).toEqual([{ id: 'gold', name: 'Gold', debt: true, negative: true }]);
    await userEvent.click(within(currency('gold')).getByLabelText(/Players can borrow it/));
    expect(last().currencies).toEqual([{ id: 'gold', name: 'Gold', negative: true }]);
  });

  it('makes an extra currency the main one, and removes one only after asking', async () => {
    const { last } = open({ ...gold, currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }] });
    await userEvent.click(within(currency('favor')).getByText('MAKE MAIN'));
    expect(last().currencies!.map((c) => c.id)).toEqual(['favor', 'gold']);
    await userEvent.click(within(currency('gold')).getByText('REMOVE'));
    const ask = screen.getByRole('alertdialog', { name: 'Remove Gold' });
    expect(ask.textContent).toContain('Players\' balances in it are kept but hidden');
    await userEvent.click(within(ask).getByText('KEEP IT'));
    expect(last().currencies!.map((c) => c.id)).toEqual(['favor', 'gold']);
    await userEvent.click(within(currency('gold')).getByText('REMOVE'));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByText('REMOVE'));
    expect(last().currencies!.map((c) => c.id)).toEqual(['favor']);
  });

  it('stops at eight', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
    open({ ...gold, currencies: eight });
    expect((screen.getByText('+ CURRENCY') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('8 of 8.')).toBeTruthy();
  });
});

describe('icons', () => {
  it('picks one of the five, or none', async () => {
    const { last } = open(gold);
    await userEvent.click(within(currency('gold')).getByLabelText('🪙 for Gold'));
    expect(last().currencies).toEqual([{ id: 'gold', name: 'Gold', icon: '🪙' }]);
    expect(within(currency('gold')).getByLabelText('🪙 for Gold').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(currency('gold')).getByText('NONE'));
    expect(last().currencies).toEqual([{ id: 'gold', name: 'Gold' }]);
  });

  it('uploads one and uses it, or says why not', async () => {
    let answer: { status: number; body: unknown } = { status: 200, body: { icon: UPLOADED } };
    const fetcher = vi.fn(async () => ({ ok: answer.status < 300, status: answer.status, json: async () => answer.body }) as unknown as Response);
    const { last } = open(gold, fetcher as typeof fetch);
    await userEvent.upload(within(currency('gold')).getByLabelText('Upload an icon for Gold'), new File(['<svg/>'], 'coin.svg', { type: 'image/svg+xml' }));
    await waitFor(() => expect(last().currencies).toEqual([{ id: 'gold', name: 'Gold', icon: UPLOADED }]));
    expect(fetcher.mock.calls[0][0]).toBe('/api/systems/currency-icons');
    expect(within(currency('gold')).getByLabelText('Uploaded icon').querySelector('img')!.getAttribute('src')).toBe(UPLOADED);
    answer = { status: 413, body: { error: '"huge.png" is over the 0.25MB limit.' } };
    await userEvent.upload(within(currency('gold')).getByLabelText('Upload an icon for Gold'), new File(['x'], 'huge.png', { type: 'image/png' }));
    expect((await screen.findByRole('alert')).textContent).toBe('"huge.png" is over the 0.25MB limit.');
  });

  it('has no UPLOAD where it can\'t send one', () => {
    open(gold);
    expect(within(currency('gold')).queryByText('UPLOAD')).toBeNull();
  });
});

describe('celebrations', () => {
  it('turns them on and sets whale status in the main currency, written as money', async () => {
    const { last } = open({ ...gold, currencies: [{ id: 'gold', name: 'Gold', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] }] });
    expect(screen.queryByText('WHALE STATUS AT')).toBeNull();
    await userEvent.click(screen.getByLabelText(/The bank's easter eggs/));
    expect(last().bank).toEqual({ celebrations: true });
    expect(screen.getByText('Empty: whale status never fires.')).toBeTruthy();
    const whale = screen.getByLabelText(/WHALE STATUS AT/);
    await userEvent.type(whale, '500 gp');
    expect(last().bank).toEqual({ celebrations: true, whale: 50000 });
    expect(screen.getByText('= 500 gp in Gold')).toBeTruthy();
    await userEvent.clear(whale);
    expect(last().bank).toEqual({ celebrations: true });
    await userEvent.type(whale, 'lots');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(last().bank).toEqual({ celebrations: true });
    await userEvent.click(screen.getByLabelText(/The bank's easter eggs/));
    expect('bank' in last()).toBe(false);
  });

  it('needs a currency of the system\'s own for whale status', async () => {
    open();
    await userEvent.click(screen.getByLabelText(/The bank's easter eggs/));
    expect(screen.getByText('Whale status needs a currency of the system\'s own: add one above.')).toBeTruthy();
  });
});
