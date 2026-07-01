import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatWindow } from '../ChatWindow';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  ),
}));

const makeSocket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

const baseProps = {
  pos: { x: 0, y: 0 },
  setPos: vi.fn(),
  onClose: vi.fn(),
  messages: [],
  activeUsers: [],
  userName: 'GHOST',
  onSendMessage: vi.fn(),
  notificationsEnabled: true,
  onToggleNotifications: vi.fn(),
  isPrimaryAdmin: false,
  onGrantAccess: vi.fn(),
  onRevokeAccess: vi.fn(),
  token: '',
  isChatOpen: true,
};

beforeEach(() => vi.clearAllMocks());

describe('ChatWindow', () => {
  it('renders nothing when isChatOpen is false', () => {
    const socket = makeSocket();
    const { container } = render(<ChatWindow {...baseProps} socket={socket} isChatOpen={false} />);
    expect(container.firstChild).toHaveStyle('display: none');
  });

  it('renders CITY_NET // COMMS title', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} />);
    expect(screen.getByTestId('window-title').textContent).toBe('CITY_NET // COMMS');
  });

  it('shows GLOBAL tab by default', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} />);
    expect(screen.getByText(/\[ GLOBAL \]/)).toBeInTheDocument();
  });

  it('renders messages in the chat pane', () => {
    const socket = makeSocket();
    const messages = [
      { id: 1, sender: 'VIPER', text: 'Hello there', timestamp: '12:00' },
      { id: 2, sender: 'GHOST', text: 'Hi VIPER', timestamp: '12:01' },
    ];
    render(<ChatWindow {...baseProps} socket={socket} messages={messages} />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('Hi VIPER')).toBeInTheDocument();
  });

  it('calls onSendMessage with GLOBAL message on submit', async () => {
    const socket = makeSocket();
    const onSendMessage = vi.fn();
    render(<ChatWindow {...baseProps} socket={socket} onSendMessage={onSendMessage} />);
    await userEvent.type(screen.getByPlaceholderText('TYPE_GLOBAL_BROADCAST...'), 'test message');
    await userEvent.click(screen.getByText('SEND'));
    expect(onSendMessage).toHaveBeenCalledWith('test message', 'GHOST');
  });

  it('does not call onSendMessage for empty input', async () => {
    const socket = makeSocket();
    const onSendMessage = vi.fn();
    render(<ChatWindow {...baseProps} socket={socket} onSendMessage={onSendMessage} />);
    await userEvent.click(screen.getByText('SEND'));
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('registers socket listeners on mount', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} />);
    expect(socket.on).toHaveBeenCalledWith('receivePrivateMessage', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('privateHistory', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('purgePrivateMessages', expect.any(Function));
  });

  it('cleans up socket listeners on unmount', () => {
    const socket = makeSocket();
    const { unmount } = render(<ChatWindow {...baseProps} socket={socket} />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('receivePrivateMessage', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('privateHistory', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('purgePrivateMessages', expect.any(Function));
  });

  it('opens a private tab when receivePrivateMessage is received from another user', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} />);
    const pmHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'receivePrivateMessage')[1];
    act(() => {
      pmHandler({ sender: 'VIPER', recipient: 'GHOST', text: 'hey', timestamp: '12:00' });
    });
    expect(screen.getByText(/VIPER/)).toBeInTheDocument();
  });

  it('shows OPERATORS_ONLINE roster panel', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} />);
    expect(screen.getByText('OPERATORS_ONLINE')).toBeInTheDocument();
  });

  it('renders active users in roster', () => {
    const socket = makeSocket();
    const activeUsers = [
      { userName: 'GHOST', isAdmin: false, isTemporaryAdmin: false, isNPC: false },
      { userName: 'VIPER', isAdmin: false, isTemporaryAdmin: false, isNPC: false },
    ];
    render(<ChatWindow {...baseProps} socket={socket} activeUsers={activeUsers} />);
    expect(screen.getByText('GHOST')).toBeInTheDocument();
    expect(screen.getByText('VIPER')).toBeInTheDocument();
  });

  it('shows ADD NPC button when isPrimaryAdmin', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} isPrimaryAdmin={true} />);
    expect(screen.getByText('[+] ADD NPC')).toBeInTheDocument();
  });

  it('does not show ADD NPC button for regular users', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} isPrimaryAdmin={false} />);
    expect(screen.queryByText('[+] ADD NPC')).not.toBeInTheDocument();
  });

  it('shows NPC name input after clicking ADD NPC', async () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} isPrimaryAdmin={true} />);
    await userEvent.click(screen.getByText('[+] ADD NPC'));
    expect(screen.getByPlaceholderText('NPC NAME...')).toBeInTheDocument();
  });

  it('purges private messages on purgePrivateMessages event', () => {
    const socket = makeSocket();
    render(<ChatWindow {...baseProps} socket={socket} />);
    const pmHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'receivePrivateMessage')[1];
    const purgeHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'purgePrivateMessages')[1];
    act(() => {
      pmHandler({ sender: 'VIPER', recipient: 'GHOST', text: 'hey', timestamp: '12:00' });
    });
    act(() => {
      purgeHandler();
    });
    expect(screen.queryByText(/VIPER.*×/)).not.toBeInTheDocument();
  });
});
