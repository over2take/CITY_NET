import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTrayNotify } from '../useTrayNotify';
import { useTrayMotion } from '../useTrayMotion';

/**
 * The dice tray's bell (6c4g): on the signed-in person's account and in the browser, like its
 * ROLL or LANDED (useAccountSetting, tested through useTrayMotion), and apart from it. Starts ON.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

beforeEach(() => { mockFetch.mockReset(); localStorage.clear(); });

describe('the tray\'s bell', () => {
  it('starts ON', () => {
    expect(renderHook(() => useTrayNotify(null)).result.current[0]).toBe('on');
  });

  it('takes the account\'s choice, and saves a change to the account as trayNotify', async () => {
    mockFetch.mockImplementation(() => ok({ trayMotion: 'landed', trayNotify: 'off' }));
    const { result } = renderHook(() => useTrayNotify('tok'));
    await waitFor(() => expect(result.current[0]).toBe('off'));
    act(() => result.current[1]('on'));
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(JSON.parse(put![1].body)).toEqual({ trayNotify: 'on' });
    expect(localStorage.getItem('citynet_tray_notify')).toBe('on');
  });

  it('is kept apart from the tray\'s motion, each under its own name', async () => {
    mockFetch.mockImplementation(() => ok({ trayMotion: 'landed', trayNotify: 'off' }));
    const bell = renderHook(() => useTrayNotify('tok'));
    const motion = renderHook(() => useTrayMotion('tok'));
    await waitFor(() => expect(bell.result.current[0]).toBe('off'));
    await waitFor(() => expect(motion.result.current[0]).toBe('landed'));
    act(() => bell.result.current[1]('on'));
    expect(motion.result.current[0]).toBe('landed');
    expect(localStorage.getItem('citynet_tray_motion')).toBe('landed');
  });

  it('ignores a choice it doesn\'t have, in the browser or from the account', async () => {
    localStorage.setItem('citynet_tray_notify', 'loud');
    expect(renderHook(() => useTrayNotify(null)).result.current[0]).toBe('on');
    localStorage.setItem('citynet_tray_notify', 'off');
    mockFetch.mockImplementation(() => ok({ trayNotify: 'roll' }));
    const { result } = renderHook(() => useTrayNotify('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current[0]).toBe('off');
  });
});
