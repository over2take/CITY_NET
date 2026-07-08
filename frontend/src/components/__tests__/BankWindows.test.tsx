import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminBankWindow, AdminPayWindow, BankWindow, formatBankValue } from '../BankWindows';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  ),
}));

vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));

const basePos = { x: 0, y: 0 };
const setPos = vi.fn();
const onClose = vi.fn();
const makeSocket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

beforeEach(() => vi.clearAllMocks());

// ─── formatBankValue ────────────────────────────────────────────────────────

describe('formatBankValue', () => {
  it('formats positive value to 2 decimal places', () => {
    expect(formatBankValue(42.5)).toBe('42.50');
  });

  it('formats zero as 0.00', () => {
    expect(formatBankValue(0)).toBe('0.00');
  });

  it('rounds to 2 decimal places', () => {
    expect(formatBankValue(1.234)).toBe('1.23');
  });
});

// ─── AdminBankWindow ─────────────────────────────────────────────────────────

describe('AdminBankWindow', () => {
  it('renders with correct title', () => {
    const socket = makeSocket();
    render(<AdminBankWindow pos={basePos} setPos={setPos} onClose={onClose} targetUser="GHOST" socket={socket} token="tok" />);
    expect(screen.getByTestId('window-title').textContent).toBe('ADMIN BANK: GHOST');
  });

  it('requests bank balance on mount', () => {
    const socket = makeSocket();
    render(<AdminBankWindow pos={basePos} setPos={setPos} onClose={onClose} targetUser="GHOST" socket={socket} token="tok" />);
    expect(socket.emit).toHaveBeenCalledWith('requestBankBalance', { username: 'GHOST' });
  });

  it('registers and cleans up bankUpdate listener', () => {
    const socket = makeSocket();
    const { unmount } = render(<AdminBankWindow pos={basePos} setPos={setPos} onClose={onClose} targetUser="GHOST" socket={socket} token="tok" />);
    expect(socket.on).toHaveBeenCalledWith('bankUpdate', expect.any(Function));
    unmount();
    expect(socket.off).toHaveBeenCalledWith('bankUpdate', expect.any(Function));
  });

  it('emits adminUpdateBank on SAVE CHANGES', async () => {
    const socket = makeSocket();
    render(<AdminBankWindow pos={basePos} setPos={setPos} onClose={onClose} targetUser="GHOST" socket={socket} token="tok" />);
    const inputs = screen.getAllByRole('spinbutton');
    await userEvent.clear(inputs[0]);
    await userEvent.type(inputs[0], '500');
    await userEvent.clear(inputs[1]);
    await userEvent.type(inputs[1], '100');
    await userEvent.click(screen.getByText('SAVE CHANGES'));
    expect(socket.emit).toHaveBeenCalledWith('adminUpdateBank', expect.objectContaining({ username: 'GHOST', balance: 500, debt: 100 }));
    expect(onClose).toHaveBeenCalled();
  });
});

// ─── AdminPayWindow ──────────────────────────────────────────────────────────

describe('AdminPayWindow', () => {
  const activeUsers = [
    { userName: 'GHOST', isNPC: false, isAdmin: false, isTemporaryAdmin: false },
    { userName: 'VIPER', isNPC: false, isAdmin: false, isTemporaryAdmin: false },
    { userName: 'ADMIN', isNPC: false, isAdmin: true, isTemporaryAdmin: false },
    { userName: 'NPC_BOT', isNPC: true, isAdmin: false, isTemporaryAdmin: false },
  ];

  it('renders the window title', () => {
    const socket = makeSocket();
    render(<AdminPayWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} token="tok" activeUsers={activeUsers} />);
    expect(screen.getByTestId('window-title').textContent).toBe('ADMIN // PAY_PLAYERS');
  });

  it('excludes NPCs and primary admins from user list', () => {
    const socket = makeSocket();
    render(<AdminPayWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} token="tok" activeUsers={activeUsers} />);
    expect(screen.getByText('GHOST')).toBeInTheDocument();
    expect(screen.getByText('VIPER')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument();
    expect(screen.queryByText('NPC_BOT')).not.toBeInTheDocument();
  });

  it('shows No users online when list is empty', () => {
    const socket = makeSocket();
    render(<AdminPayWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} token="tok" activeUsers={[]} />);
    expect(screen.getByText('No users online.')).toBeInTheDocument();
  });

  it('emits adminPayPlayers with selected users on PAY_SELECTED', async () => {
    const socket = makeSocket();
    render(<AdminPayWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} token="tok" activeUsers={activeUsers} />);
    await userEvent.type(screen.getByRole('spinbutton'), '200');
    await userEvent.click(screen.getAllByRole('checkbox')[0]); // select GHOST
    await userEvent.click(screen.getByText('PAY_SELECTED'));
    expect(socket.emit).toHaveBeenCalledWith('adminPayPlayers', expect.objectContaining({ usernames: ['GHOST'], totalAmount: 200 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('emits adminPayPlayers with all users on SPLIT_AMONG_ALL', async () => {
    const socket = makeSocket();
    render(<AdminPayWindow pos={basePos} setPos={setPos} onClose={onClose} socket={socket} token="tok" activeUsers={activeUsers} />);
    await userEvent.type(screen.getByRole('spinbutton'), '400');
    await userEvent.click(screen.getByText('SPLIT_AMONG_ALL'));
    expect(socket.emit).toHaveBeenCalledWith('adminPayPlayers', expect.objectContaining({ usernames: ['GHOST', 'VIPER'], totalAmount: 400 }));
  });
});

// ─── BankWindow ──────────────────────────────────────────────────────────────

describe('BankWindow', () => {
  const bankData = { balance: 250.5, debt: 50 };

  it('renders nothing when isBankOpen is false', () => {
    const { container } = render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={makeSocket()} userName="GHOST" isBankOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders balance and debt when open', () => {
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={makeSocket()} userName="GHOST" isBankOpen={true} />);
    expect(screen.getByText('250.50')).toBeInTheDocument();
    expect(screen.getByText('50.00')).toBeInTheDocument();
  });

  it('shows amount prompt overlay on withdraw click', async () => {
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={makeSocket()} userName="GHOST" isBankOpen={true} />);
    await userEvent.click(screen.getByText('WITHDRAW'));
    expect(screen.getByText(/Amount to withdraw/i)).toBeInTheDocument();
  });

  it('emits withdrawFunds on confirm', async () => {
    const socket = makeSocket();
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={socket} userName="GHOST" isBankOpen={true} />);
    await userEvent.click(screen.getByText('WITHDRAW'));
    await userEvent.type(screen.getByRole('spinbutton'), '100');
    await userEvent.click(screen.getByText('CONFIRM'));
    expect(socket.emit).toHaveBeenCalledWith('withdrawFunds', { username: 'GHOST', amount: 100 });
  });

  it('emits borrowFunds on borrow confirm', async () => {
    const socket = makeSocket();
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={socket} userName="GHOST" isBankOpen={true} />);
    await userEvent.click(screen.getByText('BORROW'));
    await userEvent.type(screen.getByRole('spinbutton'), '50');
    await userEvent.click(screen.getByText('CONFIRM'));
    expect(socket.emit).toHaveBeenCalledWith('borrowFunds', { username: 'GHOST', amount: 50 });
  });

  it('emits payDebt on pay confirm', async () => {
    const socket = makeSocket();
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={socket} userName="GHOST" isBankOpen={true} />);
    await userEvent.click(screen.getByText('PAY'));
    await userEvent.type(screen.getByRole('spinbutton'), '25');
    await userEvent.click(screen.getByText('CONFIRM'));
    expect(socket.emit).toHaveBeenCalledWith('payDebt', { username: 'GHOST', amount: 25 });
  });

  it('dismisses prompt on CANCEL', async () => {
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={makeSocket()} userName="GHOST" isBankOpen={true} />);
    await userEvent.click(screen.getByText('WITHDRAW'));
    await userEvent.click(screen.getByText('CANCEL'));
    expect(screen.queryByText(/Amount to/i)).not.toBeInTheDocument();
  });

  it('does not emit when amount is invalid', async () => {
    const socket = makeSocket();
    render(<BankWindow pos={basePos} setPos={setPos} onClose={onClose} bankData={bankData} socket={socket} userName="GHOST" isBankOpen={true} />);
    await userEvent.click(screen.getByText('WITHDRAW'));
    await userEvent.click(screen.getByText('CONFIRM')); // empty input
    expect(socket.emit).not.toHaveBeenCalledWith('withdrawFunds', expect.anything());
  });
});
