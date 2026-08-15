import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVehicleRoster } from '../useVehicleRoster';

/**
 * The roster the window and the buttons that open it both read.
 *
 * The case worth pinning is the socket arriving late. A ref's `.current` is not reactive,
 * so a hook that reads it once binds to nothing and never binds again — which showed up
 * as an empty window on a sheet with a vehicle plainly on it.
 */

type Handler = (payload: unknown) => void;

const makeSocket = () => {
  const handlers: Record<string, Handler[]> = {};
  const emitted: string[] = [];
  return {
    emitted,
    on: (event: string, fn: Handler) => { (handlers[event] ||= []).push(fn); },
    off: (event: string, fn: Handler) => { handlers[event] = (handlers[event] || []).filter(h => h !== fn); },
    emit: (event: string) => { emitted.push(event); },
    deliver: (event: string, payload: unknown) => act(() => { (handlers[event] || []).forEach(h => h(payload)); }),
  };
};

const CAR = { owner: 'cody', index: 1, name: 'Kestrel' };

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('the vehicle roster', () => {
  it('asks for it once the system is CWN', () => {
    const socket = makeSocket();
    const ref = { current: socket } as never;
    renderHook(() => useVehicleRoster(ref, 'cities_without_number'));
    expect(socket.emitted).toContain('requestVehicleRoster');
  });

  it('stays quiet under other systems', () => {
    const socket = makeSocket();
    const ref = { current: socket } as never;
    renderHook(() => useVehicleRoster(ref, 'cyberpunk_red'));
    expect(socket.emitted).not.toContain('requestVehicleRoster');
  });

  it('binds once the socket turns up, not only if it was there first', async () => {
    // The socket is created asynchronously, so the first render often has none. Reading
    // ref.current at that moment and never looking again is the bug this guards.
    const ref = { current: null } as { current: unknown };
    const { result } = renderHook(() => useVehicleRoster(ref as never, 'cities_without_number'));
    expect(result.current.hasVehicles).toBe(false);

    const socket = makeSocket();
    ref.current = socket;
    await act(async () => { vi.advanceTimersByTime(400); });

    await waitFor(() => expect(socket.emitted).toContain('requestVehicleRoster'));
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody'] });
    expect(result.current.hasVehicles).toBe(true);
  });

  it('holds what the server sends', () => {
    const socket = makeSocket();
    const ref = { current: socket } as never;
    const { result } = renderHook(() => useVehicleRoster(ref, 'cities_without_number'));
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody', 'mouse'] });
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.players).toEqual(['cody', 'mouse']);
    expect(result.current.hasVehicles).toBe(true);
  });

  it('re-asks when a sheet is saved or someone moves seat', () => {
    const socket = makeSocket();
    const ref = { current: socket } as never;
    renderHook(() => useVehicleRoster(ref, 'cities_without_number'));
    const before = socket.emitted.filter(e => e === 'requestVehicleRoster').length;
    // A vehicle exists the moment it is filled in, not only when someone sits in it.
    socket.deliver('sheetUpdated', { username: 'cody' });
    socket.deliver('vehicleSeatingChanged', {});
    expect(socket.emitted.filter(e => e === 'requestVehicleRoster').length).toBe(before + 2);
  });

  it('empties on a switch away from CWN, so the buttons go with it', () => {
    const socket = makeSocket();
    const ref = { current: socket } as never;
    const { result, rerender } = renderHook(
      ({ system }: { system: string }) => useVehicleRoster(ref, system),
      { initialProps: { system: 'cities_without_number' } },
    );
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody'] });
    expect(result.current.hasVehicles).toBe(true);

    rerender({ system: 'cyberpunk_red' });
    expect(result.current.hasVehicles).toBe(false);
  });
});
