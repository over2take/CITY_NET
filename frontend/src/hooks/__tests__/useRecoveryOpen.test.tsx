import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useRecoveryOpen } from '../useRecoveryOpen';
import { isOpen, OPEN_SETTING } from '../../sheets/restCalls';

/**
 * Whether the GM has spending recovery dice open (R2b), for a sheet window: the recovery_open setting
 * read from /api/settings, and again whenever a setting changes.
 */

const rows = (value: string | null) => (value === null ? [{ key: 'game_system', value: 'x' }] : [{ key: OPEN_SETTING, value }]);
const fetcherOf = (answers: unknown[]) => vi.fn(async () => ({ json: async () => answers.shift() }) as Response);

describe('spending open', () => {
  it('only a setting of 1 is open; anything else is closed', () => {
    expect(isOpen(rows('1'))).toBe(true);
    for (const r of [rows('0'), rows(null), [], null, { recovery_open: '1' }, [null, 'x']]) expect(isOpen(r), JSON.stringify(r)).toBe(false);
    expect(OPEN_SETTING).toBe('recovery_open');
  });

  it('is read at once, and again when the GM changes a setting', async () => {
    const socket = { on: vi.fn(), off: vi.fn() };
    const fetcher = fetcherOf([rows('0'), rows('1')]);
    const { result, unmount } = renderHook(() => useRecoveryOpen(socket, fetcher));
    expect(result.current).toBe(false);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const changed = socket.on.mock.calls.find((c) => c[0] === 'settingsUpdated')![1];
    act(() => changed());
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetcher).toHaveBeenCalledWith('/api/settings');
    unmount();
    expect(socket.off).toHaveBeenCalledWith('settingsUpdated', changed);
  });

  it('read once without a socket; a failed read leaves it closed', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const { result } = renderHook(() => useRecoveryOpen(null, fetcher as unknown as typeof fetch));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });
});
