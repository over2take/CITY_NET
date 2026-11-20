import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTurnAsks, type AskSocket } from '../hooks/useTurnAsks';

// The EACH TURN rolls waiting (8a9c; backend sockets/turnAsks.js): asked for, asked again when they change, rolled.

const makeSocket = () => {
  const handlers: Record<string, ((data: unknown) => void)[]> = {};
  return {
    on: vi.fn((event: string, cb: (data: unknown) => void) => { (handlers[event] ??= []).push(cb); }),
    off: vi.fn((event: string, cb: (data: unknown) => void) => { handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb); }),
    emit: vi.fn(),
    trigger: (event: string, data?: unknown) => { (handlers[event] ?? []).forEach((h) => h(data)); },
    count: (event: string) => (handlers[event] ?? []).length,
  };
};
/** One ref for the life of the hook, as App's socketRef is. */
const refs = new WeakMap<object, { current: AskSocket | null }>();
const refOf = (socket: ReturnType<typeof makeSocket>) => {
  if (!refs.has(socket)) refs.set(socket, { current: socket });
  return refs.get(socket)!;
};
const asked = (socket: ReturnType<typeof makeSocket>) => socket.emit.mock.calls.filter((c) => c[0] === 'requestTurnAsks').length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useTurnAsks', () => {
  it('asks at once, keeps what comes back, asks again when told they changed and on reconnecting', () => {
    const socket = makeSocket();
    const { result } = renderHook(() => useTurnAsks(refOf(socket)));
    expect(asked(socket)).toBe(1);
    act(() => socket.trigger('turnAsks', [{ id: 3 }]));
    expect(result.current.asks).toEqual([{ id: 3 }]);
    act(() => socket.trigger('turnAsksChanged'));
    act(() => socket.trigger('connect'));
    expect(asked(socket)).toBe(3);
    // Anything but a list: none.
    act(() => socket.trigger('turnAsks', null));
    expect(result.current.asks).toEqual([]);
  });

  it('waits for a socket that isn\'t there yet', () => {
    const ref: { current: AskSocket | null } = { current: null };
    renderHook(() => useTurnAsks(ref));
    const socket = makeSocket();
    act(() => { ref.current = socket; });
    act(() => { vi.advanceTimersByTime(400); });
    expect(asked(socket)).toBe(1);
  });

  it('switched off after asks came: holds none', () => {
    const socket = makeSocket();
    const { result, rerender } = renderHook(({ on }) => useTurnAsks(refOf(socket), on), { initialProps: { on: true } });
    act(() => socket.trigger('turnAsks', [{ id: 3 }]));
    expect(result.current.asks).toHaveLength(1);
    rerender({ on: false });
    expect(result.current.asks).toEqual([]);
  });

  it('off: asks nothing, holds none; unmounted, stops listening', () => {
    const socket = makeSocket();
    renderHook(() => useTurnAsks(refOf(socket), false));
    expect(asked(socket)).toBe(0);
    expect(socket.count('turnAsks')).toBe(0);
    const on = renderHook(() => useTurnAsks(refOf(socket)));
    expect(socket.count('turnAsks')).toBe(1);
    on.unmount();
    expect(socket.count('turnAsks')).toBe(0);
    expect(socket.count('turnAsksChanged')).toBe(0);
    expect(socket.count('connect')).toBe(0);
  });

  it('a roll: sent by id, rolling till the answer; refused, said in words; made, the words gone', () => {
    const socket = makeSocket();
    const { result } = renderHook(() => useTurnAsks(refOf(socket)));
    act(() => result.current.roll(11));
    const [event, payload, ack] = socket.emit.mock.calls.find((c) => c[0] === 'turnRoll')!;
    expect([event, payload]).toEqual(['turnRoll', { id: 11 }]);
    expect(result.current.rolling).toEqual([11]);
    act(() => result.current.roll(11));
    expect(result.current.rolling).toEqual([11]);
    act(() => ack({ ok: false, error: 'POISONED is no longer on KES' }));
    expect(result.current.rolling).toEqual([]);
    expect(result.current.error).toBe('POISONED is no longer on KES');
    act(() => result.current.roll(12));
    act(() => socket.emit.mock.calls.filter((c) => c[0] === 'turnRoll').at(-1)![2]({ ok: true, line: 'rolled' }));
    expect(result.current.error).toBeNull();
    act(() => result.current.roll(13));
    act(() => socket.emit.mock.calls.filter((c) => c[0] === 'turnRoll').at(-1)![2](undefined));
    expect(result.current.error).toBe('That roll could not be made');
  });
});
