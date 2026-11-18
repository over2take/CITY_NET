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
    emitted: [] as { event: string; payload: unknown; ack?: (answer: unknown) => void }[],
    emit(event: string, payload?: unknown, ack?: (answer: unknown) => void) { this.emitted.push({ event, payload, ...(ack ? { ack } : {}) }); },
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

  it('FIRE sends a gear edit still waiting first, in order, then never again: it can\'t land after the count (8a4b)', () => {
    const socket = fakeSocket();
    const { result } = load(socket);
    act(() => { result.current.handleFieldChange('inventory', '[{"name":"Pistol"}]'); });
    act(() => { result.current.handleFieldChange('cool', 5); });
    act(() => { void result.current.actions.onGearCount!(0, 'ammo', 'spend'); });
    expect(socket.emitted.map((e) => e.event).filter((e) => e === 'updateSheetField' || e === 'countAction')).toEqual(['updateSheetField', 'countAction']);
    expect(socket.sent('updateSheetField')[0].payload).toEqual({ fieldId: 'inventory', value: '[{"name":"Pistol"}]' });
    // Strict: FIRE names no line to take from, not even as undefined.
    expect(socket.sent('countAction')[0].payload).toStrictEqual({ kind: 'spend', line: 0, column: 'ammo' });
    // The other field still waits its turn; the gear isn't sent a second time.
    act(() => { vi.advanceTimersByTime(400); });
    expect(socket.sent('updateSheetField').map((e) => (e.payload as { fieldId: string }).fieldId)).toEqual(['inventory', 'cool']);
  });

  it('RELOAD names the line picked; the server\'s answer, or none after 5 s', async () => {
    const socket = fakeSocket();
    const { result } = load(socket);
    let answer: Promise<unknown> = Promise.resolve();
    act(() => { answer = result.current.actions.onGearCount!(0, 'ammo', 'reload', 2); });
    const sent = socket.emitted.find((e) => e.event === 'countAction')!;
    expect(sent.payload).toEqual({ kind: 'reload', line: 0, column: 'ammo', from: 2 });
    expect(socket.sent('updateSheetField')).toHaveLength(0);
    sent.ack!({ ok: true, now: 6, most: 6 });
    expect(await answer).toEqual({ ok: true, now: 6, most: 6 });
    act(() => { answer = result.current.actions.onGearCount!(0, 'ammo', 'spend'); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(await answer).toBeNull();
  });
});
