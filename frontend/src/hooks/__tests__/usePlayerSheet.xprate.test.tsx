import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlayerSheet } from '../usePlayerSheet';

/**
 * Which XP column the sheet draws against.
 *
 * The whole table advances on one column, so it is the cwn_slow_advancement house rule
 * rather than a field on anyone's sheet. That means it travels: settings, into this hook,
 * out as a prop, into the bar.
 *
 * Worth its own test because the failure is quiet. If the setting stopped arriving, every
 * bar would draw against the fast column while the server levelled people on the slow
 * one - all the numbers plausible, just measured against the wrong table, and nobody
 * would spot it for months.
 */

function fakeSocket() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  return {
    emit() {},
    on(event: string, fn: (payload: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) || []), fn]);
    },
    off() {},
  };
}

const withSettings = (rows: { key: string; value: string }[]) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => rows }));
};

beforeEach(() => vi.unstubAllGlobals());

describe('the advancement rate reaches the sheet', () => {
  it('is fast when the house rule is off', async () => {
    withSettings([{ key: 'cwn_slow_advancement', value: '0' }]);
    const { result } = renderHook(() => usePlayerSheet(fakeSocket() as never, 'nyx'));
    await waitFor(() => expect(result.current.xpRate).toBe('fast'));
  });

  it('is slow when the house rule is on', async () => {
    withSettings([{ key: 'cwn_slow_advancement', value: '1' }]);
    const { result } = renderHook(() => usePlayerSheet(fakeSocket() as never, 'nyx'));
    await waitFor(() => expect(result.current.xpRate).toBe('slow'));
  });

  it('is fast when the rule has never been set', async () => {
    // A table that has not chosen still gets a bar, drawn against the column the server
    // will also use - the same default on both sides.
    withSettings([{ key: 'cwn_trauma', value: '1' }]);
    const { result } = renderHook(() => usePlayerSheet(fakeSocket() as never, 'nyx'));
    await waitFor(() => expect(result.current.xpRate).toBe('fast'));
  });

  it('is fast when the settings call fails outright', async () => {
    // Offline or a 500. A bar drawn against the wrong column would be worse than one
    // drawn against the default the server also falls back to.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => usePlayerSheet(fakeSocket() as never, 'nyx'));
    await waitFor(() => expect(result.current.xpRate).toBe('fast'));
  });
});
