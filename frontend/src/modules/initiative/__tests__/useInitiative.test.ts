import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInitiative } from '../hooks/useInitiative';

const makeSocket = () => {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      (handlers[event] ??= []).push(cb);
    }),
    off: vi.fn((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb);
    }),
    emit: vi.fn(),
    trigger: (event: string, data?: any) => {
      (handlers[event] ?? []).forEach((h) => h(data));
    },
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useInitiative — socket timing', () => {
  it('emits initiative:join immediately when socket is ready on mount', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    renderHook(() => useInitiative(socketRef, 'city:0'));
    expect(socket.emit).toHaveBeenCalledWith('initiative:join', { sceneKey: 'city:0' });
  });

  it('registers listeners and joins once socket becomes available after mount', async () => {
    const socketRef = { current: null as any };
    renderHook(() => useInitiative(socketRef, 'city:0'));

    const socket = makeSocket();
    // Assign socket then advance timer so the poll fires and calls forceReady()
    act(() => { socketRef.current = socket; });
    act(() => { vi.advanceTimersByTime(400); }); // poll tick → forceReady dispatch
    // forceReady causes re-render → effect re-runs with socket present
    act(() => {});

    expect(socket.emit).toHaveBeenCalledWith('initiative:join', { sceneKey: 'city:0' });
    expect(socket.on).toHaveBeenCalledWith('initiative:state', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('initiative:started', expect.any(Function));
  });

  it('re-emits initiative:join on socket reconnect', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    renderHook(() => useInitiative(socketRef, 'city:0'));

    socket.emit.mockClear();
    socket.trigger('connect');

    expect(socket.emit).toHaveBeenCalledWith('initiative:join', { sceneKey: 'city:0' });
  });

  it('re-emits initiative:join when sceneKey changes', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    let sceneKey = 'city:0';
    const { rerender } = renderHook(() => useInitiative(socketRef, sceneKey));

    socket.emit.mockClear();
    sceneKey = '42:1';
    rerender();

    expect(socket.emit).toHaveBeenCalledWith('initiative:join', { sceneKey: '42:1' });
  });
});

describe('useInitiative — state updates', () => {
  it('sets state when initiative:state arrives for current scene', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => {
      socket.trigger('initiative:state', {
        sceneKey: 'city:0', combatId: 1, combatants: [], turnIndex: 0, turnCounter: 1, passCounter: 1,
      });
    });

    expect(result.current.state).not.toBeNull();
    expect(result.current.state?.combatId).toBe(1);
  });

  it('ignores initiative:state for a different scene', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => {
      socket.trigger('initiative:state', {
        sceneKey: '99:0', combatId: 5, combatants: [], turnIndex: 0, turnCounter: 1, passCounter: 1,
      });
    });

    expect(result.current.state).toBeNull();
  });

  it('does not seed state on initiative:started — waits for initiative:state broadcast', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => {
      socket.trigger('initiative:started', { sceneKey: 'city:0', combatId: 3 });
    });

    // State is only set by the subsequent initiative:state broadcast, not by started alone
    expect(result.current.state).toBeNull();

    act(() => {
      socket.trigger('initiative:state', { sceneKey: 'city:0', combatId: 3, combatants: [], turnIndex: 0, turnCounter: 1, passCounter: 1, system: 'shadowrun_6e' });
    });

    expect(result.current.state?.combatId).toBe(3);
    expect(result.current.state?.system).toBe('shadowrun_6e');
  });

  it('clears state when initiative:ended arrives for current scene', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => {
      socket.trigger('initiative:state', {
        sceneKey: 'city:0', combatId: 1, combatants: [], turnIndex: 0, turnCounter: 1, passCounter: 1,
      });
    });
    act(() => {
      socket.trigger('initiative:ended', { sceneKey: 'city:0' });
    });

    expect(result.current.state).toBeNull();
  });

  it('updates activeCombats on initiative:combats', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => {
      socket.trigger('initiative:combats', [{ id: 1, turn_counter: 2, scene_keys: ['city:0'] }]);
    });

    expect(result.current.activeCombats).toHaveLength(1);
    expect(result.current.activeCombats[0].id).toBe(1);
  });
});

describe('useInitiative — actions', () => {
  it('startInitiative emits initiative:start with sceneKey', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => { result.current.startInitiative(); });

    expect(socket.emit).toHaveBeenCalledWith('initiative:start', { sceneKey: 'city:0', combatId: null, system: 'generic' });
  });

  it('startInitiative passes combatId when joining existing', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => { result.current.startInitiative(7); });

    expect(socket.emit).toHaveBeenCalledWith('initiative:start', { sceneKey: 'city:0', combatId: 7, system: 'generic' });
  });

  it('nextTurn emits initiative:next', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => { result.current.nextTurn(); });

    expect(socket.emit).toHaveBeenCalledWith('initiative:next', { sceneKey: 'city:0' });
  });

  it('endInitiative emits initiative:end', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => { result.current.endInitiative(); });

    expect(socket.emit).toHaveBeenCalledWith('initiative:end', { sceneKey: 'city:0' });
  });

  it('cleans up listeners on unmount', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { unmount } = renderHook(() => useInitiative(socketRef, 'city:0'));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('initiative:state', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('initiative:started', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('initiative:ended', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('initiative:combats', expect.any(Function));
  });
});

describe('useInitiative — ending a combat from the nav list', () => {
  it('ends the combat by id, not by the scene you happen to be standing in', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => result.current.endCombat(182));

    expect(socket.emit).toHaveBeenCalledWith('initiative:end_combat', { combatId: 182 });
  });

  it('works with no scene of its own, which is the usual case from the nav list', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, null));

    act(() => result.current.endCombat(7));

    expect(socket.emit).toHaveBeenCalledWith('initiative:end_combat', { combatId: 7 });
  });

  it('ignores a missing combat id rather than emitting a useless event', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));
    socket.emit.mockClear();

    act(() => result.current.endCombat(0 as any));

    expect(socket.emit).not.toHaveBeenCalledWith('initiative:end_combat', expect.anything());
  });

  it('refreshes the combat list when the server says a scene ended', () => {
    // The server does not push a new list, it announces the end and each client asks.
    // That is what repopulates the nav panel after the END button is pressed.
    const socket = makeSocket();
    const socketRef = { current: socket };
    renderHook(() => useInitiative(socketRef, 'city:0'));
    socket.emit.mockClear();

    act(() => socket.trigger('initiative:ended', { sceneKey: '42:0' }));

    expect(socket.emit).toHaveBeenCalledWith('initiative:list_combats');
  });

  it('clears the open tracker when the ended scene is the one being watched', () => {
    const socket = makeSocket();
    const socketRef = { current: socket };
    const { result } = renderHook(() => useInitiative(socketRef, 'city:0'));

    act(() => socket.trigger('initiative:state', {
      sceneKey: 'city:0', combatants: [], sides: [], turnIndex: 0, turnCounter: 1,
    }));
    expect(result.current.state).not.toBeNull();

    act(() => socket.trigger('initiative:ended', { sceneKey: 'city:0' }));
    expect(result.current.state).toBeNull();
  });
});
