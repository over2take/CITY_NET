import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useChoicesRefused, REFUSED_MS } from '../useChoicesRefused';

/** Why the server said no to a pick (7a3b2), for a sheet window: shown, then gone; nothing without a socket. */

const makeSocket = () => ({ on: vi.fn(), off: vi.fn() });

describe('the server\'s refusal to spend recovery dice (R2b)', () => {
  it('is shown the same way', () => {
    const socket = makeSocket();
    const { result, unmount } = renderHook(() => useChoicesRefused(socket));
    const onRefused = socket.on.mock.calls.find((c) => c[0] === 'recoveryRefused')![1];
    act(() => onRefused({ error: 'The GM hasn\'t opened spending recovery dice' }));
    expect(result.current).toBe('The GM hasn\'t opened spending recovery dice');
    // And taking a rest (R3b).
    const onRest = socket.on.mock.calls.find((c) => c[0] === 'restRefused')![1];
    act(() => onRest({ error: 'In this game, rests are taken when the GM calls them' }));
    expect(result.current).toBe('In this game, rests are taken when the GM calls them');
    unmount();
    expect(socket.off).toHaveBeenCalledWith('recoveryRefused', onRefused);
    expect(socket.off).toHaveBeenCalledWith('restRefused', onRest);
  });
});

describe('the server\'s refusal of a pick', () => {
  it('is shown, and goes after a few seconds; a new one starts the clock again', () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    const { result, unmount } = renderHook(() => useChoicesRefused(socket));
    const onRefused = socket.on.mock.calls.find((c) => c[0] === 'choicesRefused')![1];
    act(() => onRefused({ error: 'Only the GM takes a pick away' }));
    expect(result.current).toBe('Only the GM takes a pick away');
    act(() => { vi.advanceTimersByTime(REFUSED_MS - 1000); });
    act(() => onRefused({ error: 'No more Classes can be picked' }));
    act(() => { vi.advanceTimersByTime(REFUSED_MS - 1000); });
    expect(result.current).toBe('No more Classes can be picked');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBeNull();
    unmount();
    expect(socket.off).toHaveBeenCalledWith('choicesRefused', onRefused);
    vi.useRealTimers();
  });

  it('listens to nothing without a socket', () => {
    const { result } = renderHook(() => useChoicesRefused(null));
    expect(result.current).toBeNull();
  });
});
