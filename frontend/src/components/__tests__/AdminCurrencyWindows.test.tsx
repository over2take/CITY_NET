import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));
vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));
vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => <div><div data-testid="window-title">{title}</div>{children}</div>,
}));

import { AdminPanel } from '../AdminPanel';
import { AdminBankWindow, AdminPayWindow } from '../BankWindows';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';
import type { Currency } from '../../sheets/currencies';

/**
 * The GM's money windows in a custom system's own currencies (3c2b5), as the approved mockup has
 * them (docs/mockups/currency-windows.html): BANK_ADMIN.EXE edits every account, PAYROLL.EXE pays in
 * the currency picked, and where BUY WITH MONEY YOU DO NOT HAVE is hidden a note says what each
 * currency does instead. Every built-in system keeps today's windows (BankWindows.test.tsx,
 * partsMoneyWindows.test.tsx).
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const GOLD: Currency = {
  id: 'gold', name: 'Gold', decimals: 0, decimalMark: '.', debt: false, negative: false,
  denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'sp', name: 'Silver', short: 'sp', value: 10 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }],
};
const FAVOR: Currency = { id: 'favor', name: 'Favor', decimals: 0, decimalMark: '.', debt: true, negative: false, denominations: [] };
const DOLLARS: Currency = { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2, decimalMark: '.', debt: true, negative: true, denominations: [] };
const hearth = (currencies: Currency[] = [GOLD, FAVOR]): CustomRender => ({
  id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] }, currencies,
});

type Handler = (data: any) => void;
const makeSocket = () => {
  const handlers: Record<string, Handler> = {};
  return { handlers, emit: vi.fn(), on: vi.fn((e: string, fn: Handler) => { handlers[e] = fn; }), off: vi.fn() };
};
const UPDATE = { username: 'GHOST', balance: 2047, debt: 0, currencies: [{ id: 'gold', balance: 2047, debt: 0 }, { id: 'favor', balance: 5, debt: 2 }] };

beforeEach(() => { clearCustomTemplates(); registerCustomTemplate(hearth()); });
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('BANK_ADMIN.EXE', () => {
  const open = (update: Record<string, unknown> = UPDATE) => {
    const socket = makeSocket();
    const onClose = vi.fn();
    render(<AdminBankWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={onClose} targetUser="GHOST" socket={socket} token="tok" system={HEARTH} />);
    act(() => socket.handlers.bankUpdate(update));
    return { socket, onClose };
  };
  const box = (name: string) => screen.getByRole('textbox', { name });
  const updates = (socket: ReturnType<typeof makeSocket>) => socket.emit.mock.calls.filter((c) => c[0] === 'adminUpdateBank').map((c) => c[1]);

  it('shows every account, the currency\'s way, with a debt box only where it can be owed', () => {
    const { socket } = open();
    expect(socket.emit).toHaveBeenCalledWith('requestBankBalance', { username: 'GHOST' });
    expect(box('Gold balance')).toHaveValue('20 gp 4 sp 7 cp');
    expect(screen.queryByRole('textbox', { name: 'Gold debt' })).toBeNull();
    expect(within(screen.getByTestId('admin-account-gold')).getByText('NO DEBT')).toBeInTheDocument();
    expect(box('Favor balance')).toHaveValue('5 Favor');
    expect(box('Favor debt')).toHaveValue('2 Favor');
    expect(screen.getByTestId('admin-read-favor').textContent).toBe('= 5 Favor · OWES 2 Favor');
  });

  it('sends only the accounts that changed, each in whole units with its currency', async () => {
    const { socket, onClose } = open();
    await userEvent.clear(box('Gold balance'));
    await userEvent.type(box('Gold balance'), '30 gp 5 sp');
    expect(screen.getByTestId('admin-read-gold').textContent).toBe('= 30 gp 5 sp');
    await userEvent.click(screen.getByText('SAVE CHANGES'));
    expect(updates(socket)).toEqual([{ token: 'tok', username: 'GHOST', balance: 3050, debt: 0, currency: 'gold' }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses what a currency won\'t allow before anything is sent, and says which', async () => {
    const { socket, onClose } = open();
    await userEvent.clear(box('Gold balance'));
    await userEvent.type(box('Gold balance'), '-5 gp');
    expect(screen.getByTestId('admin-read-gold').textContent).toBe('Gold can\'t go below zero in this game.');
    await userEvent.clear(box('Favor debt'));
    await userEvent.type(box('Favor debt'), '-1');
    expect(screen.getByTestId('admin-read-favor').textContent).toBe('Debt is never below zero.');
    await userEvent.click(screen.getByText('SAVE CHANGES'));
    expect(screen.getByRole('status').textContent).toBe('Gold: Gold can\'t go below zero in this game.');
    expect(updates(socket)).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.clear(box('Gold balance'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('admin-read-gold').textContent).toBe('Write an amount of Gold.');
  });

  it('lets what is owed in a currency that can\'t be owed be cleared, but not added to', async () => {
    const { socket } = open({ ...UPDATE, debt: 300, currencies: [{ id: 'gold', balance: 2047, debt: 300 }, UPDATE.currencies[1]] });
    expect(box('Gold debt')).toHaveValue('3 gp');
    expect(screen.getByTestId('admin-read-gold').textContent).toBe('Nobody can owe Gold in this game.');
    await userEvent.clear(box('Gold debt'));
    await userEvent.type(box('Gold debt'), '0 gp');
    await userEvent.click(screen.getByText('SAVE CHANGES'));
    expect(updates(socket)).toEqual([{ token: 'tok', username: 'GHOST', balance: 2047, debt: 0, currency: 'gold' }]);
  });

  it('knows the main account from the balance every update carries, and ignores other players\'', () => {
    const { socket } = open({ username: 'GHOST', balance: 310, debt: 0 });
    expect(box('Gold balance')).toHaveValue('3 gp 1 sp');
    expect(box('Favor balance')).toHaveValue('0 Favor');
    expect(box('Favor debt')).toHaveValue('0 Favor');
    act(() => socket.handlers.bankUpdate({ ...UPDATE, username: 'VIPER' }));
    expect(box('Gold balance')).toHaveValue('3 gp 1 sp');
  });

  it('is today\'s window under a built-in system', () => {
    const socket = makeSocket();
    render(<AdminBankWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} targetUser="GHOST" socket={socket} token="tok" system="cities_without_number" />);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('PAYROLL.EXE', () => {
  const users = ['GHOST', 'VIPER', 'ROOK'].map((userName) => ({ userName, isNPC: false, isAdmin: false, isTemporaryAdmin: false }));
  const open = () => {
    const socket = makeSocket();
    const onClose = vi.fn();
    render(<AdminPayWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={onClose} socket={socket} token="tok" activeUsers={users} system={HEARTH} />);
    return { socket, onClose };
  };
  const amount = () => screen.getByRole('textbox', { name: 'Total amount' });
  const share = () => screen.getByTestId('payroll-share').textContent;

  it('pays in the main currency unless another is picked, read as written', async () => {
    const { socket, onClose } = open();
    expect(screen.getByRole('combobox')).toHaveValue('gold');
    expect(share()).toBe('Write it like 2 gp 5 sp');
    await userEvent.type(amount(), '20 gp');
    expect(share()).toBe('20 gp for 3 players: 6 gp 6 sp 7 cp each, rounded up so nobody is short.');
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(share()).toBe('20 gp for 2 players: 10 gp each.');
    await userEvent.click(screen.getByText('PAY_SELECTED'));
    expect(socket.emit).toHaveBeenCalledWith('adminPayPlayers', { token: 'tok', usernames: ['GHOST', 'VIPER'], totalAmount: 2000, currency: 'gold' });
    expect(onClose).toHaveBeenCalled();
  });

  it('pays in the currency picked, starting its amount afresh', async () => {
    const { socket } = open();
    await userEvent.type(amount(), '20 gp');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'favor');
    expect(amount()).toHaveValue('');
    await userEvent.type(amount(), '6');
    await userEvent.click(screen.getByText('SPLIT_AMONG_ALL'));
    expect(socket.emit).toHaveBeenCalledWith('adminPayPlayers', { token: 'tok', usernames: ['GHOST', 'VIPER', 'ROOK'], totalAmount: 6, currency: 'favor' });
  });

  it('pays nothing it can\'t read, or nothing at all', async () => {
    const { socket, onClose } = open();
    await userEvent.type(amount(), '15');
    expect(share()).toBe('Which coin? Write it like "15 gp" (gp, sp, cp).');
    await userEvent.click(screen.getByText('SPLIT_AMONG_ALL'));
    await userEvent.clear(amount());
    await userEvent.type(amount(), '0 gp');
    expect(share()).toBe('Write an amount above zero.');
    await userEvent.click(screen.getByText('SPLIT_AMONG_ALL'));
    expect(socket.emit).not.toHaveBeenCalledWith('adminPayPlayers', expect.anything());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has no picker for a system with one currency of its own', async () => {
    registerCustomTemplate(hearth([DOLLARS]));
    const { socket } = open();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.type(amount(), '$10.00');
    await userEvent.click(screen.getByText('SPLIT_AMONG_ALL'));
    expect(socket.emit).toHaveBeenCalledWith('adminPayPlayers', expect.objectContaining({ totalAmount: 1000, currency: 'dollars' }));
  });
});

describe('the house rules', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: shownSystem, systems: [] }) };
      return { ok: true, json: async () => [] };
    }));
  });
  let shownSystem = HEARTH;
  const props = (system: string): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], setIsAdminPayOpen: vi.fn(), handleSaveDefault: vi.fn(), handleLoadDefault: vi.fn(),
    globalSettings: { game_system: system }, gameSystem: system,
  });
  const houseRules = async (system: string) => {
    shownSystem = system;
    render(<AdminPanel {...props(system)} />);
    await userEvent.click(screen.getByText('GAME'));
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
    await userEvent.click(screen.getByText('HOUSE RULES'));
    await screen.findByText(/ FOLLOWS BUILDING /);
  };

  it('say what each currency does when a player is short, in place of the overdraft rule', async () => {
    registerCustomTemplate(hearth([GOLD, FAVOR, DOLLARS, { ...FAVOR, id: 'scrip', name: 'Scrip', debt: false, negative: true }]));
    await houseRules(HEARTH);
    expect(await screen.findByTestId('shortfall-note')).toBeInTheDocument();
    expect(screen.queryByText('BUY WITH MONEY YOU DO NOT HAVE')).toBeNull();
    const lines = within(screen.getByTestId('shortfall-note')).getAllByText(/^(GOLD|FAVOR|DOLLARS|SCRIP)$/).map((n) => `${n.textContent} ${n.nextSibling?.textContent}`);
    expect(lines).toEqual(['GOLD refused', 'FAVOR can be owed', 'DOLLARS can be owed or go below zero', 'SCRIP can go below zero']);
  });

  it('keep the overdraft rule and have no note where the system has today\'s money', async () => {
    for (const system of ['cities_without_number', 'generic']) {
      await houseRules(system);
      expect(screen.getByText('BUY WITH MONEY YOU DO NOT HAVE'), system).toBeInTheDocument();
      expect(screen.queryByTestId('shortfall-note'), system).toBeNull();
      cleanup();
    }
    registerCustomTemplate(hearth([]));
    await houseRules(HEARTH);
    expect(screen.getByText('BUY WITH MONEY YOU DO NOT HAVE')).toBeInTheDocument();
    expect(screen.queryByTestId('shortfall-note')).toBeNull();
  });

  it('have neither where the system has the bank off', async () => {
    registerCustomTemplate({ ...hearth(), parts: { bank: { on: false } } });
    await houseRules(HEARTH);
    expect(screen.queryByText('BUY WITH MONEY YOU DO NOT HAVE')).toBeNull();
    expect(screen.queryByTestId('shortfall-note')).toBeNull();
  });
});
