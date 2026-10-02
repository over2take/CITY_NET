/**
 * The shop in a custom system's own currencies (3c2b4), as the approved mockup has it
 * (docs/mockups/currency-windows.html): each catalogue priced in its own currency on the shelf
 * and in the cart, one total per currency, every short currency asked about at once and only in
 * the ways it allows, a currency that allows nothing refusing the cart by name, and a receipt per
 * currency. Every built-in system keeps today's shop (ShopWindow.test.tsx).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopWindow } from '../ShopWindow';
import { loadUploaded, clearUploaded } from '../../sheets/uploadedCatalogues';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';
import type { Currency } from '../../sheets/currencies';

const sheetData: { data: Record<string, unknown> } = { data: {} };
vi.mock('../../hooks/usePlayerSheet', () => ({
  usePlayerSheet: () => ({
    sheet: { system: 'sys_aaaaaaaaaaaaaaaa', data: sheetData.data },
    handleFieldChange: vi.fn(), handleFieldsChange: vi.fn(), encumbranceEnforced: false, overdraftAllowed: true,
  }),
}));

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const GOLD: Currency = {
  id: 'gold', name: 'Gold', decimals: 0, decimalMark: '.', debt: false, negative: false,
  denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'sp', name: 'Silver', short: 'sp', value: 10 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }],
};
const FAVOR: Currency = { id: 'favor', name: 'Favor', decimals: 0, decimalMark: '.', debt: true, negative: false, denominations: [] };
const hearth = (over: Partial<CustomRender> = {}): CustomRender => ({
  id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] },
  currencies: [GOLD, FAVOR], buildings: { catalogues: { weapon_mods: { currency: 'favor' } } }, ...over,
});

let emitted: { event: string; data: any }[] = [];
let listeners: Record<string, ((data: any) => void)[]> = {};
const socket = {
  on: (event: string, fn: (data: any) => void) => { (listeners[event] ||= []).push(fn); },
  off: (event: string, fn: (data: any) => void) => { listeners[event] = (listeners[event] || []).filter((f) => f !== fn); },
  emit: (event: string, data?: any) => { emitted.push({ event, data }); },
};
const push = (event: string, data: any) => act(() => (listeners[event] || []).forEach((f) => f(data)));
const checkouts = () => emitted.filter((e) => e.event === 'checkoutShop').map((e) => e.data);

const BANK = { username: 'JADE', balance: 2047, debt: 0, currencies: [{ id: 'gold', balance: 2047, debt: 0 }, { id: 'favor', balance: 5, debt: 2 }] };
const show = (bank: Record<string, unknown> = BANK) => {
  render(<ShopWindow name="Forge" locationId={7} buildingType="gun_shop" system={HEARTH} buybackPct={45} socket={socket} userName="JADE" onClose={vi.fn()} />);
  push('bankUpdate', bank);
};
const shelfTab = (n: number) => within(screen.getByRole('tablist', { name: 'Catalogue' })).getAllByRole('tab')[n];
const add = async (label: string, shelf = 0) => {
  await userEvent.click(screen.getByRole('tab', { name: 'BUY' }));
  await userEvent.click(shelfTab(shelf));
  await userEvent.click(screen.getByRole('button', { name: `Add ${label} to the cart` }));
};
const openCart = () => userEvent.click(screen.getByRole('tab', { name: 'CART' }));
const checkOut = () => userEvent.click(screen.getAllByRole('button', { name: 'CHECK OUT' }).at(-1)!);

beforeEach(() => {
  emitted = []; listeners = {};
  sheetData.data = {};
  clearCustomTemplates(); clearUploaded();
  registerCustomTemplate(hearth());
  loadUploaded({
    weapons: [{ id: 'sword', name: 'Sword', price: 1500, fields: {} }],
    weapon_mods: [{ id: 'rune', name: 'Rune', price: 3, fields: {} }],
  });
});
afterEach(() => { clearCustomTemplates(); clearUploaded(); });

describe('the shelves and the header', () => {
  it('price each catalogue in its own currency', async () => {
    show();
    expect(screen.getByText('15 gp')).toBeInTheDocument();
    await userEvent.click(shelfTab(1));
    expect(screen.getByText('3 Favor')).toBeInTheDocument();
  });

  it('show every account, each its own way, with what is owed', () => {
    show();
    expect(screen.getByTestId('shop-account-gold').textContent).toBe('20 gp 4 sp 7 cp');
    expect(screen.getByTestId('shop-account-favor').textContent).toBe('5 Favor');
    expect(screen.getByText('(2 Favor OWED)')).toBeInTheDocument();
  });

  it('know the main account from the balance every update carries, before it lists the rest', () => {
    show({ username: 'JADE', balance: 310, debt: 0 });
    expect(screen.getByTestId('shop-account-gold').textContent).toBe('3 gp 1 sp');
    expect(screen.getByTestId('shop-account-favor').textContent).toBe('0 Favor');
  });

  it('keep today\'s credits in a custom system with no currencies of its own', () => {
    registerCustomTemplate(hearth({ currencies: [] }));
    show({ username: 'JADE', balance: 2047, debt: 0 });
    expect(screen.getByText('1,500cr')).toBeInTheDocument();
    expect(screen.queryByTestId('shop-account-gold')).toBeNull();
  });
});

describe('the cart', () => {
  it('tags each line with its currency and totals each currency apart', async () => {
    show();
    await add('Sword');
    await add('Rune', 1);
    await openCart();
    expect(screen.getAllByTestId('cart-currency').map((t) => t.textContent)).toEqual(['GOLD', 'FAVOR']);
    const lines = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(lines[0]).toContain('15 gp');
    expect(lines[1]).toContain('3 Favor');
    expect(screen.getByTestId('cart-total-gold').textContent).toBe('TOTAL · GOLD15 gpYOU PAY 15 gp · BALANCE AFTER 5 gp 4 sp 7 cp');
    expect(screen.getByTestId('cart-total-favor').textContent).toBe('TOTAL · FAVOR3 FavorYOU PAY 3 Favor · BALANCE AFTER 2 Favor');
  });

  it('sends every currency\'s total as the player saw it, with nothing to cover', async () => {
    show();
    await add('Sword');
    await add('Rune', 1);
    await openCart();
    await checkOut();
    expect(checkouts()).toEqual([{
      locationId: 7, buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 1 }, { catalogue: 'weapon_mods', itemId: 'rune', qty: 1 }],
      sells: [], settle: {}, expectedNet: { gold: 1500, favor: 3 },
    }]);
  });

  it('asks how to cover a short currency, only in the ways it allows, before anything is sent', async () => {
    show();
    await add('Rune', 1);
    await openCart();
    await userEvent.click(screen.getByRole('button', { name: 'One more Rune' }));
    expect(screen.getByTestId('cart-total-favor').textContent).toContain('1 Favor SHORT');
    await checkOut();
    const ask = screen.getByRole('alertdialog');
    expect(within(ask).getByTestId('cart-short-favor').textContent)
      .toContain('The Favor total comes to 6 Favor and you have 5 Favor. How do you want to cover the 1 Favor short?');
    expect(within(ask).queryByRole('button', { name: 'GO NEGATIVE' })).toBeNull();
    expect(within(ask).getByRole('button', { name: 'CHECK OUT' })).toBeDisabled();
    expect(checkouts()).toEqual([]);
    await userEvent.click(within(ask).getByRole('button', { name: 'TAKE DEBT' }));
    await userEvent.click(within(ask).getByRole('button', { name: 'CHECK OUT' }));
    expect(checkouts()).toEqual([expect.objectContaining({ settle: { favor: 'debt' }, expectedNet: { favor: 6 } })]);
  });

  it('forgets how a shortfall was to be covered when it is cancelled or the cart changes', async () => {
    show();
    await add('Rune', 1);
    await openCart();
    await userEvent.click(screen.getByRole('button', { name: 'One more Rune' }));
    await checkOut();
    await userEvent.click(screen.getByRole('button', { name: 'TAKE DEBT' }));
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await checkOut();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(checkouts()).toEqual([]);
    // Chosen, then the cart changes: the choice was for a cart that is gone, so it is asked again.
    await userEvent.click(screen.getByRole('button', { name: 'TAKE DEBT' }));
    await userEvent.click(screen.getByRole('button', { name: 'One more Rune' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await checkOut();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(checkouts()).toEqual([]);
  });

  it('refuses a cart short in a currency that allows no way to cover it, naming it', async () => {
    show({ ...BANK, balance: 1000, currencies: [{ id: 'gold', balance: 1000, debt: 0 }, BANK.currencies[1]] });
    await add('Sword');
    await openCart();
    await checkOut();
    expect(screen.getByRole('alert').textContent).toBe('Not enough Gold: it comes to 15 gp and you have 10 gp. Gold can\'t be owed or go below zero in this game. Nothing was charged.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(checkouts()).toEqual([]);
  });

  it('has no tags or named totals in a system with one currency of its own', async () => {
    registerCustomTemplate(hearth({ currencies: [GOLD], buildings: {} }));
    show({ username: 'JADE', balance: 2047, debt: 0, currencies: [{ id: 'gold', balance: 2047, debt: 0 }] });
    await add('Sword');
    await openCart();
    expect(screen.queryByTestId('cart-currency')).toBeNull();
    expect(screen.getByTestId('cart-total-gold').textContent).toMatch(/^TOTAL15 gp/);
  });
});

describe('selling', () => {
  it('offers and pays in the currency of the catalogue a thing came from, whole units rounded down', async () => {
    sheetData.data = { inventory: JSON.stringify([{ name: 'Sword', qty: 1 }, { name: 'Rune', qty: 1 }]) };
    show();
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
    // 45% of 15 gp is 6 gp 7 sp 5 cp; of 3 Favor, 1.35, which pays 1.
    const rows = screen.getAllByRole('row').map((r) => r.textContent);
    expect(rows.find((r) => r?.includes('Sword'))).toContain('6 gp 7 sp 5 cp');
    expect(rows.find((r) => r?.includes('Rune'))).toContain('1 Favor');
    await userEvent.click(screen.getByRole('button', { name: 'Add Sword to the cart' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Rune to the cart' }));
    await openCart();
    expect(screen.getByTestId('cart-total-gold').textContent).toBe('TOTAL · GOLD-6 gp 7 sp 5 cpTHE SHOP PAYS YOU 6 gp 7 sp 5 cp · BALANCE AFTER 27 gp 2 sp 2 cp');
    expect(screen.getByTestId('cart-total-favor').textContent).toBe('TOTAL · FAVOR-1 FavorTHE SHOP PAYS YOU 1 Favor · BALANCE AFTER 6 Favor');
  });
});

describe('the server\'s answer', () => {
  const twoLines = async () => {
    show();
    await add('Sword');
    await add('Rune', 1);
    await openCart();
    await checkOut();
  };

  it('is a receipt with every line in its currency and a total for each', async () => {
    await twoLines();
    push('shopCheckout', {
      ok: true, buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 1, price: 1500, currency: 'gold' }, { catalogue: 'weapon_mods', itemId: 'rune', qty: 1, price: 3, currency: 'favor' }],
      currencies: {
        gold: { buyTotal: 1500, payout: 0, net: 1500, balance: 547, debt: 0, settled: 'balance' },
        favor: { buyTotal: 3, payout: 0, net: 3, balance: 2, debt: 2, settled: 'balance' },
      },
      sold: [], fromBody: 0,
    });
    const receipt = screen.getByTestId('cart-receipt');
    expect(receipt.textContent).toContain('Sword15 gp');
    expect(receipt.textContent).toContain('Rune3 Favor');
    expect(within(receipt).getByTestId('receipt-total-gold').textContent).toBe('TOTAL · GOLD15 gpPAID FROM YOUR ACCOUNTBALANCE 5 gp 4 sp 7 cp');
    expect(within(receipt).getByTestId('receipt-total-favor').textContent).toBe('TOTAL · FAVOR3 FavorPAID FROM YOUR ACCOUNTBALANCE 2 Favor · DEBT 2 Favor');
  });

  it('says a price changed in the currency it changed in, and agrees to the new total on the next try', async () => {
    await twoLines();
    push('shopCheckout', { ok: false, reason: 'total_changed', currency: 'favor', buyTotal: 9, payout: 0, net: 9 });
    expect(screen.getByRole('alert').textContent).toBe('Prices changed while this sat in the cart: the Favor total is now 9 Favor. Check it, then CHECK OUT again.');
    expect(screen.getByTestId('cart-total-favor').textContent).toContain('PRICES CHANGED — THIS IS THE NEW TOTAL');
    expect(screen.getByTestId('cart-total-favor').textContent).toContain('4 Favor SHORT');
    await checkOut();
    await userEvent.click(screen.getByRole('button', { name: 'TAKE DEBT' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CHECK OUT' }));
    expect(checkouts().at(-1)).toMatchObject({ settle: { favor: 'debt' }, expectedNet: { gold: 1500, favor: 9 } });
  });

  it('names the currency a refusal for funds was about, and says the rest as it always has', async () => {
    await twoLines();
    push('shopCheckout', { ok: false, reason: 'funds', currency: 'gold', buyTotal: 1500, payout: 0, net: 1500 });
    expect(screen.getByRole('alert').textContent).toContain('Not enough Gold: it comes to 15 gp');
    await checkOut();
    push('shopCheckout', { ok: false, reason: 'qty' });
    expect(screen.getByRole('alert').textContent).toBe('A quantity in the cart is more than the shop will sell at once. Nothing was charged.');
  });
});
