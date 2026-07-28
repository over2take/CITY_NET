import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCustomDice } from '../useCustomDice';
import type { CustomDie } from '../../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const GM_DIE: CustomDie = {
  id: 1, name: 'punk', sides: 4,
  faces: [{ value: 'apple' }, { value: 'bannana' }, { value: 'oragne' }, { value: 'peach' }],
};

const SYSTEM_DIE: CustomDie = {
  id: 'builtin:fate_df', name: 'dF', sides: 6,
  faces: [{ value: '+1' }, { value: '+1' }, { value: '-1' }, { value: '-1' }, { value: '0' }, { value: '0' }],
};

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
const fail = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);

/** Route each endpoint independently so ordering between them doesn't matter. */
const routeFetch = (gm: CustomDie[] = [], system: CustomDie[] = []) => {
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith('/api/system_dice')) return ok(system);
    if (url.startsWith('/api/custom_dice')) return ok(gm);
    return fail(404);
  });
};

// Block body matters: `() => mockFetch.mockReset()` would return the mock, and
// Vitest calls a hook's return value as a teardown function — invoking fetch()
// with no arguments partway through the suite.
beforeEach(() => { mockFetch.mockReset(); });

// ─── Loading ──────────────────────────────────────────────────────────────────

describe('useCustomDice — loading', () => {
  it('fetches GM dice on mount', async () => {
    routeFetch([GM_DIE]);
    const { result } = renderHook(() => useCustomDice());
    await waitFor(() => expect(result.current.customDice).toHaveLength(1));
    expect(result.current.customDice[0].name).toBe('punk');
  });

  it('does not request system dice when no system is active', async () => {
    routeFetch([GM_DIE]);
    renderHook(() => useCustomDice());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls.some(c => String(c[0]).includes('system_dice'))).toBe(false);
  });

  it('fetches system dice for the active system', async () => {
    routeFetch([], [SYSTEM_DIE]);
    renderHook(() => useCustomDice('tok', 'fate_core'));
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(c => c[0] === '/api/system_dice/fate_core')).toBe(true)
    );
  });

  it('marks system dice as locked so the UI hides edit and delete', async () => {
    routeFetch([], [SYSTEM_DIE]);
    const { result } = renderHook(() => useCustomDice('tok', 'fate_core'));
    await waitFor(() => expect(result.current.customDice).toHaveLength(1));
    expect(result.current.customDice[0].locked).toBe(true);
  });

  it('leaves GM dice unlocked', async () => {
    routeFetch([GM_DIE]);
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(result.current.customDice).toHaveLength(1));
    expect(result.current.customDice[0].locked).toBeFalsy();
  });

  it('lists system dice before GM dice', async () => {
    routeFetch([GM_DIE], [SYSTEM_DIE]);
    const { result } = renderHook(() => useCustomDice('tok', 'fate_core'));
    await waitFor(() => expect(result.current.customDice).toHaveLength(2));
    expect(result.current.customDice.map(d => d.name)).toEqual(['dF', 'punk']);
  });

  it('survives a failed fetch without throwing', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCustomDice('tok', 'fate_core'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current.customDice).toEqual([]);
  });

  it('refetches system dice when the game system changes', async () => {
    routeFetch([], [SYSTEM_DIE]);
    const { rerender } = renderHook(({ sys }) => useCustomDice('tok', sys), {
      initialProps: { sys: 'fate_core' },
    });
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(c => c[0] === '/api/system_dice/fate_core')).toBe(true)
    );
    rerender({ sys: 'shadowrun_6e' });
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(c => c[0] === '/api/system_dice/shadowrun_6e')).toBe(true)
    );
  });
});

// ─── applyDice (socket broadcast) ─────────────────────────────────────────────

describe('useCustomDice — applyDice', () => {
  it('replaces GM dice from a broadcast', async () => {
    routeFetch([GM_DIE]);
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(result.current.customDice).toHaveLength(1));

    const next: CustomDie = { id: 2, name: 'Fate', sides: 2, faces: [{ value: '+' }, { value: '-' }] };
    act(() => result.current.applyDice([next]));
    expect(result.current.customDice.map(d => d.name)).toEqual(['Fate']);
  });

  it('keeps system dice when a GM broadcast arrives', async () => {
    routeFetch([GM_DIE], [SYSTEM_DIE]);
    const { result } = renderHook(() => useCustomDice('tok', 'fate_core'));
    await waitFor(() => expect(result.current.customDice).toHaveLength(2));

    act(() => result.current.applyDice([]));
    expect(result.current.customDice.map(d => d.name)).toEqual(['dF']);
  });
});

// ─── Mutations ────────────────────────────────────────────────────────────────

describe('useCustomDice — mutations', () => {
  const draft = { name: 'new', sides: 2, faces: [{ value: 'a' }, { value: 'b' }] };

  it('POSTs a new die with the admin token', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockImplementation(() => ok({}));
    await act(async () => { await result.current.addDie(draft); });

    const call = mockFetch.mock.calls.find(c => c[1]?.method === 'POST');
    expect(call[0]).toBe('/api/custom_dice');
    expect(call[1].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(call[1].body)).toEqual(draft);
  });

  it('PUTs an edited die to its own id', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockImplementation(() => ok({}));
    await act(async () => { await result.current.updateDie(GM_DIE); });

    const call = mockFetch.mock.calls.find(c => c[1]?.method === 'PUT');
    expect(call[0]).toBe('/api/custom_dice/1');
    // The id travels in the URL, not the body
    expect(JSON.parse(call[1].body)).not.toHaveProperty('id');
  });

  it('DELETEs by id', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockImplementation(() => ok({}));
    await act(async () => { await result.current.deleteDie(1); });

    const call = mockFetch.mock.calls.find(c => c[1]?.method === 'DELETE');
    expect(call[0]).toBe('/api/custom_dice/1');
  });

  it('returns true on success', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockImplementation(() => ok({}));
    let outcome: boolean | undefined;
    await act(async () => { outcome = await result.current.addDie(draft); });
    expect(outcome).toBe(true);
  });

  it('returns false and surfaces the server message on failure', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockImplementation(() => fail(409, { error: 'a die with that name already exists' }));
    let outcome: boolean | undefined;
    await act(async () => { outcome = await result.current.addDie(draft); });

    expect(outcome).toBe(false);
    expect(result.current.error).toBe('a die with that name already exists');
  });

  it('reports a network failure rather than throwing', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockRejectedValue(new Error('offline'));
    let outcome: boolean | undefined;
    await act(async () => { outcome = await result.current.addDie(draft); });

    expect(outcome).toBe(false);
    expect(result.current.error).toMatch(/could not reach/i);
  });

  it('clears a previous error on the next attempt', async () => {
    routeFetch();
    const { result } = renderHook(() => useCustomDice('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockImplementation(() => fail(409, { error: 'boom' }));
    await act(async () => { await result.current.addDie(draft); });
    expect(result.current.error).toBe('boom');

    mockFetch.mockImplementation(() => ok({}));
    await act(async () => { await result.current.addDie(draft); });
    expect(result.current.error).toBeNull();
  });
});
