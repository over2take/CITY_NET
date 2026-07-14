import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QuickSheetCard } from '../QuickSheetCard';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  ),
}));

const basePos = { x: 0, y: 0 };
const setPos = vi.fn();
const onClose = vi.fn();

const makeSocket = () => {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = (handlers[event] || []).filter(h => h !== handler);
    }),
    trigger: (event: string, data: any) => {
      (handlers[event] || []).forEach(h => h(data));
    },
  };
};

beforeEach(() => vi.clearAllMocks());

describe('QuickSheetCard', () => {
  it('emits requestQuickSheet on mount', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(socket.emit).toHaveBeenCalledWith('requestQuickSheet', { username: 'GHOST' });
  });

  it('shows loading state before data arrives', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText(/FETCHING_IDENT/)).toBeTruthy();
  });

  it('shows NO_IDENT_ON_FILE when exists is false', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    act(() => socket.trigger('quickSheetData', { username: 'GHOST', exists: false, fields: {}, portrait_url: null }));
    expect(screen.getByText(/NO_IDENT_ON_FILE/)).toBeTruthy();
  });

  it('ignores quickSheetData for a different username', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    act(() => socket.trigger('quickSheetData', { username: 'VIPER', exists: true, fields: { handle: 'VIPER' }, portrait_url: null }));
    expect(screen.getByText(/FETCHING_IDENT/)).toBeTruthy();
  });

  it('renders handle and role from public fields', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    act(() => socket.trigger('quickSheetData', {
      username: 'GHOST',
      exists: true,
      system: 'cyberpunk_red',
      portrait_url: null,
      fields: { handle: 'Ghost', role: 'Solo', description: 'Runs the shadows.' },
    }));
    expect(screen.getByText('GHOST')).toBeTruthy();
    expect(screen.getByText('SOLO')).toBeTruthy();
    expect(screen.getByText('Runs the shadows.')).toBeTruthy();
  });

  it('falls back to name field for generic system', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="VIPER" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    act(() => socket.trigger('quickSheetData', {
      username: 'VIPER',
      exists: true,
      system: 'generic',
      portrait_url: null,
      fields: { name: 'Viper' },
    }));
    expect(screen.getByText('VIPER')).toBeTruthy();
  });

  it('renders portrait img when portrait_url is provided', () => {
    const socket = makeSocket();
    render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    act(() => socket.trigger('quickSheetData', {
      username: 'GHOST',
      exists: true,
      system: 'cyberpunk_red',
      portrait_url: '/uploads/ghost.jpg',
      fields: { handle: 'Ghost' },
    }));
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('ghost.jpg');
  });

  it('unregisters quickSheetData listener on unmount', () => {
    const socket = makeSocket();
    const { unmount } = render(<QuickSheetCard username="GHOST" socket={socket} pos={basePos} setPos={setPos} onClose={onClose} />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('quickSheetData', expect.any(Function));
  });
});
