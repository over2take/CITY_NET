import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BankWindow } from '../BankWindows';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';
import type { Currency } from '../../sheets/currencies';

/**
 * BANK.EXE in a custom system's own currencies (3c2b3), as the approved mockup has it
 * (docs/mockups/currency-windows.html): every account listed, the main one first, today's boxes
 * below for the one picked, amounts read as written, the server's refusals said in that currency,
 * and the celebrations only as the system chose. Every built-in system keeps today's window
 * (BankWindows.test.tsx, and the built-in cases here).
 */

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => <div><div data-testid="window-title">{title}</div>{children}</div>,
}));
vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const GOLD: Currency = {
  id: 'gold', name: 'Gold', decimals: 0, decimalMark: '.', debt: false, negative: false,
  denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'sp', name: 'Silver', short: 'sp', value: 10 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }],
};
const FAVOR: Currency = { id: 'favor', name: 'Favor', decimals: 0, decimalMark: '.', debt: true, negative: false, denominations: [] };
const hearth = (over: Partial<CustomRender> = {}): CustomRender => ({
  id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] },
  currencies: [GOLD, FAVOR], bank: { celebrations: false, whale: null }, ...over,
});

type Handler = (data: unknown) => void;
const makeSocket = () => {
  const handlers: Record<string, Handler> = {};
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event: string, fn: Handler) => { handlers[event] = fn; }),
    off: vi.fn(),
  };
};
const BANK = { balance: 2047, debt: 0, currencies: [{ id: 'gold', balance: 2047, debt: 0 }, { id: 'favor', balance: 5, debt: 2 }] };
const props = (socket: ReturnType<typeof makeSocket>, over: Record<string, unknown> = {}) => ({
  pos: { x: 0, y: 0 }, setPos: vi.fn(), onClose: vi.fn(), socket, userName: 'GHOST', isBankOpen: true,
  system: HEARTH, bankData: BANK, ...over,
});

beforeEach(() => { clearCustomTemplates(); registerCustomTemplate(hearth()); });
afterEach(() => { clearCustomTemplates(); vi.useRealTimers(); });

describe('the accounts', () => {
  it('lists every currency, the main one first, with what is owed beside it', () => {
    render(<BankWindow {...props(makeSocket())} />);
    const list = screen.getByRole('group', { name: 'Accounts' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['GOLDMAIN20\u00a0gp 4\u00a0sp 7\u00a0cp', 'FAVOR5\u00a0FavorOWES 2\u00a0Favor']);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the picked one in today\'s boxes, with no DEBT box for a currency that can\'t be owed', async () => {
    render(<BankWindow {...props(makeSocket())} />);
    expect(screen.getByText('BALANCE · GOLD')).toBeInTheDocument();
    expect(screen.getByTestId('bank-balance').textContent).toBe('20\u00a0gp 4\u00a0sp 7\u00a0cp');
    expect(screen.queryByTestId('bank-debt')).toBeNull();
    expect(screen.getByText(/GOLD CAN'T BE BORROWED IN THIS GAME · NEVER BELOW ZERO/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('bank-account-favor'));
    expect(screen.getByTestId('bank-account-favor')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('BALANCE · FAVOR')).toBeInTheDocument();
    expect(screen.getByTestId('bank-balance').textContent).toBe('5\u00a0Favor');
    expect(screen.getByTestId('bank-debt').textContent).toBe('2\u00a0Favor');
    expect(screen.getByText('BORROW')).toBeEnabled();
    expect(screen.queryByText(/CAN'T BE BORROWED/)).toBeNull();
  });

  it('shows what is owed in a currency that can\'t be borrowed, to be paid off but not added to', () => {
    // Owed from before the GM turned debt off: the switch hides nothing that is already there.
    render(<BankWindow {...props(makeSocket(), { bankData: { ...BANK, debt: 300, currencies: [{ id: 'gold', balance: 2047, debt: 300 }, BANK.currencies[1]] } })} />);
    expect(screen.getByTestId('bank-debt').textContent).toBe('3\u00a0gp');
    expect(screen.getByText('BORROW')).toBeDisabled();
    expect(screen.getByText('PAY')).toBeEnabled();
  });

  it('says only what a currency forbids', () => {
    registerCustomTemplate(hearth({ currencies: [{ ...GOLD, negative: true }, FAVOR] }));
    render(<BankWindow {...props(makeSocket())} />);
    expect(screen.getByText('GOLD CAN\'T BE BORROWED IN THIS GAME')).toBeInTheDocument();
    expect(screen.queryByText(/NEVER BELOW ZERO/)).toBeNull();
  });

  it('knows the main account from the balance every update carries, before it lists the rest', () => {
    render(<BankWindow {...props(makeSocket(), { bankData: { balance: 310, debt: 0 } })} />);
    expect(screen.getByTestId('bank-balance').textContent).toBe('3\u00a0gp 1\u00a0sp');
    expect(within(screen.getByRole('group', { name: 'Accounts' })).getAllByRole('button')[1].textContent).toBe('FAVOR0\u00a0Favor');
  });

  it('has no list for a system with one currency of its own, but writes its money its own way', () => {
    registerCustomTemplate(hearth({ currencies: [GOLD] }));
    render(<BankWindow {...props(makeSocket())} />);
    expect(screen.queryByRole('group', { name: 'Accounts' })).toBeNull();
    expect(screen.getByTestId('bank-balance').textContent).toBe('20\u00a0gp 4\u00a0sp 7\u00a0cp');
  });
});

describe('an amount', () => {
  it('is read as written, said back, and sent in whole units for the picked currency', async () => {
    const socket = makeSocket();
    render(<BankWindow {...props(socket)} />);
    await userEvent.click(screen.getByText('WITHDRAW'));
    expect(screen.getByText('IN GOLD')).toBeInTheDocument();
    expect(screen.getByTestId('bank-amount-read').textContent).toBe('Write it like 2 gp 5 sp');
    expect(screen.getByText('CONFIRM')).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '2 gp 5 sp');
    expect(screen.getByTestId('bank-amount-read').textContent).toBe('READS AS 2 gp 5 sp');
    await userEvent.click(screen.getByText('CONFIRM'));
    expect(socket.emit).toHaveBeenCalledWith('withdrawFunds', { username: 'GHOST', amount: 250, currency: 'gold' });
    expect(screen.queryByText(/AMOUNT TO/)).toBeNull();
  });

  it('goes to the account picked, for each of the three actions', async () => {
    const socket = makeSocket();
    render(<BankWindow {...props(socket)} />);
    await userEvent.click(screen.getByTestId('bank-account-favor'));
    for (const [button, event] of [['BORROW', 'borrowFunds'], ['PAY', 'payDebt']] as const) {
      await userEvent.click(screen.getByText(button));
      await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '3{Enter}');
      expect(socket.emit).toHaveBeenCalledWith(event, { username: 'GHOST', amount: 3, currency: 'favor' });
    }
  });

  it('is refused before it is sent when it can\'t be read, or is nothing', async () => {
    const socket = makeSocket();
    render(<BankWindow {...props(socket)} />);
    await userEvent.click(screen.getByText('WITHDRAW'));
    const box = screen.getByRole('textbox', { name: 'Amount' });
    await userEvent.type(box, '15');
    expect(screen.getByTestId('bank-amount-read').textContent).toBe('Which coin? Write it like "15 gp" (gp, sp, cp).');
    expect(screen.getByText('CONFIRM')).toBeDisabled();
    await userEvent.type(box, '{Enter}');
    await userEvent.clear(box);
    await userEvent.type(box, '0 gp{Enter}');
    expect(screen.getByTestId('bank-amount-read').textContent).toBe('Write an amount above zero.');
    expect(socket.emit).not.toHaveBeenCalledWith('withdrawFunds', expect.anything());
  });
});

describe('a refusal from the server', () => {
  it('is said in the currency it was refused in, until the next try', async () => {
    const socket = makeSocket();
    render(<BankWindow {...props(socket)} />);
    act(() => socket.handlers.bankRefused({ action: 'withdraw', reason: 'funds', currency: 'gold' }));
    expect(screen.getByRole('status').textContent).toBe('Not enough Gold. You have 20 gp 4 sp 7 cp.');
    await userEvent.click(screen.getByText('WITHDRAW'));
    expect(screen.queryByRole('status')).toBeNull();
    await userEvent.click(screen.getByText('CANCEL'));
    act(() => socket.handlers.bankRefused({ action: 'borrow', reason: 'no_debt', currency: 'gold' }));
    expect(screen.getByRole('status').textContent).toBe('Gold can\'t be borrowed in this game.');
    await userEvent.click(screen.getByTestId('bank-account-favor'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is left alone when it names a currency this system lacks', () => {
    const socket = makeSocket();
    render(<BankWindow {...props(socket)} />);
    act(() => socket.handlers.bankRefused({ action: 'withdraw', reason: 'funds', currency: 'scrip' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is not listened for under a built-in system, whose window stays as it is', () => {
    const socket = makeSocket();
    render(<BankWindow {...props(socket, { system: 'cities_without_number', bankData: { balance: 250.5, debt: 50 } })} />);
    expect(socket.on).not.toHaveBeenCalledWith('bankRefused', expect.anything());
    expect(screen.queryByRole('group', { name: 'Accounts' })).toBeNull();
    expect(screen.getByText('BALANCE')).toBeInTheDocument();
    expect(screen.getByText('250.50')).toBeInTheDocument();
  });
});

describe('the celebrations', () => {
  /** The window, then a bank update moving the main balance from `from` to `to`. */
  const move = (system: string, from: number, to: number, debt: [number, number] = [0, 0]) => {
    const socket = makeSocket();
    const p = props(socket, { system, bankData: { balance: from, debt: debt[0] } });
    const { rerender } = render(<BankWindow {...p} />);
    rerender(<BankWindow {...p} bankData={{ balance: to, debt: debt[1] }} />);
    return socket;
  };

  it('run as today in a built-in system', () => {
    const socket = move('cities_without_number', 0, 500);
    expect(screen.getByText('FIRST PAYDAY')).toBeInTheDocument();
    expect(socket.emit).toHaveBeenCalledWith('markFirstPayDone', { username: 'GHOST' });
  });

  it('make a whale at 10,000 in a built-in system, as today', () => {
    move('generic', 9999, 10000);
    expect(screen.getByText('WHALE STATUS ACHIEVED')).toBeInTheDocument();
    expect(screen.getByText('BALANCE EXCEEDED ₡10,000')).toBeInTheDocument();
  });

  it('don\'t run in a custom system that hasn\'t turned them on', () => {
    const socket = move(HEARTH, 0, 2000000, [5, 0]);
    expect(screen.queryByText('FIRST PAYDAY')).toBeNull();
    expect(screen.queryByText('WHALE STATUS ACHIEVED')).toBeNull();
    expect(screen.queryByText(/CONGRATS/)).toBeNull();
    expect(socket.emit).not.toHaveBeenCalledWith('markFirstPayDone', expect.anything());
    expect(socket.emit).not.toHaveBeenCalledWith('markHighRollerDone', expect.anything());
  });

  it('run in a custom system that turned them on, whale status at its own threshold in its main currency', () => {
    registerCustomTemplate(hearth({ bank: { celebrations: true, whale: 50000 } }));
    move(HEARTH, 0, 49999);
    expect(screen.getByText('FIRST PAYDAY')).toBeInTheDocument();
    expect(screen.queryByText('WHALE STATUS ACHIEVED')).toBeNull();
  });

  it('make a whale of the GM\'s threshold, written in the main currency', () => {
    registerCustomTemplate(hearth({ bank: { celebrations: true, whale: 50000 } }));
    move(HEARTH, 100, 50000);
    expect(screen.getByText('WHALE STATUS ACHIEVED')).toBeInTheDocument();
    expect(screen.getByText('BALANCE EXCEEDED 500 gp')).toBeInTheDocument();
  });

  it('never make a whale without the GM\'s threshold', () => {
    registerCustomTemplate(hearth({ bank: { celebrations: true, whale: null } }));
    move(HEARTH, 100, 99999999);
    expect(screen.queryByText('WHALE STATUS ACHIEVED')).toBeNull();
  });

  it('cheer debt cleared and mourn an overdraft only where they are on', () => {
    registerCustomTemplate(hearth({ currencies: [{ ...GOLD, debt: true, negative: true }, FAVOR], bank: { celebrations: true, whale: null } }));
    move(HEARTH, 100, 100, [50, 0]);
    expect(screen.getByText(/CONGRATS/)).toBeInTheDocument();
    clearCustomTemplates();
    registerCustomTemplate(hearth({ currencies: [{ ...GOLD, debt: true, negative: true }, FAVOR] }));
    move(HEARTH, 100, -5);
    expect(screen.queryByText('BALANCE NEGATIVE')).toBeNull();
  });
});
