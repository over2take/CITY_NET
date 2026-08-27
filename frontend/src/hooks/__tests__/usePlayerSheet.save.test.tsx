/**
 * Sheet edits reaching the server.
 *
 * Every edit is held for 400ms before being sent, so that typing into a field is one save
 * rather than one per keystroke. The delay is the risk: anything still waiting when the
 * sheet goes away has to be sent, not dropped.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlayerSheet } from '../usePlayerSheet';

const SHEET = {
  username: 'nyx',
  system: 'cyberpunk_red',
  data: { cyberware: [{ name: 'Kerenzikov', type: 'neural', side: null, hl: 7, cost: 500, data: '' }] },
};

/** A socket that records what was emitted and can replay the sheet to a listener. */
function fakeSocket() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  return {
    emitted: [] as { event: string; payload: unknown }[],
    emit(event: string, payload?: unknown) { this.emitted.push({ event, payload }); },
    on(event: string, fn: (payload: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) || []), fn]);
    },
    off() {},
    deliver(event: string, payload: unknown) {
      act(() => { (listeners.get(event) || []).forEach((fn) => fn(payload)); });
    },
    sent(event: string) { return this.emitted.filter((e) => e.event === event); },
  };
}

const load = (socket: ReturnType<typeof fakeSocket>) => {
  const hook = renderHook(() => usePlayerSheet(socket, 'nyx'));
  socket.deliver('sheetData', SHEET);
  return hook;
};

describe('saving a field', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits before sending, so typing is one save rather than one per keystroke', () => {
    const socket = fakeSocket();
    const { result } = load(socket);

    act(() => { result.current.handleFieldChange('cool', 5); });
    expect(socket.sent('updateSheetField')).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(400); });
    expect(socket.sent('updateSheetField')).toEqual([
      { event: 'updateSheetField', payload: { fieldId: 'cool', value: 5 } },
    ]);
  });

  it('sends what is still waiting when the sheet closes', () => {
    // The bug this covers: removing a piece of cyberware is a single click, and people
    // close the window straight after. The edit was on screen and in local state and
    // never reached the server, so it came back on the next load. Adding one hid the
    // fault, because typing a name always outlasts the delay.
    const socket = fakeSocket();
    const { result, unmount } = load(socket);

    act(() => { result.current.handleFieldChange('cyberware', []); });
    expect(socket.sent('updateSheetField')).toHaveLength(0);

    unmount();
    expect(socket.sent('updateSheetField')).toEqual([
      { event: 'updateSheetField', payload: { fieldId: 'cyberware', value: [] } },
    ]);
  });

  it('sends the last value of a field edited twice, not both', () => {
    const socket = fakeSocket();
    const { result, unmount } = load(socket);

    act(() => { result.current.handleFieldChange('cool', 4); });
    act(() => { result.current.handleFieldChange('cool', 6); });
    unmount();

    expect(socket.sent('updateSheetField')).toEqual([
      { event: 'updateSheetField', payload: { fieldId: 'cool', value: 6 } },
    ]);
  });

  it('does not send twice when the delay already elapsed', () => {
    const socket = fakeSocket();
    const { result, unmount } = load(socket);

    act(() => { result.current.handleFieldChange('cool', 5); });
    act(() => { vi.advanceTimersByTime(400); });
    unmount();

    expect(socket.sent('updateSheetField')).toHaveLength(1);
  });

  it('sends nothing on a close with nothing waiting', () => {
    const socket = fakeSocket();
    const { unmount } = load(socket);
    unmount();
    expect(socket.sent('updateSheetField')).toHaveLength(0);
  });
});
