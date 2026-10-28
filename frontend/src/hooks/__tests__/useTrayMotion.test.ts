import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTrayMotion } from '../useTrayMotion';

/**
 * The dice tray's ROLL or LANDED (6c4b3b): on the signed-in person's account, so it follows them,
 * and in the browser for whoever isn't signed in. Starts on ROLL.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

beforeEach(() => { mockFetch.mockReset(); localStorage.clear(); });

describe('the tray\'s motion', () => {
  it('starts on ROLL, asking nobody when nobody is signed in', () => {
    const { result } = renderHook(() => useTrayMotion(null));
    expect(result.current[0]).toBe('roll');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('takes the account\'s choice when signed in, and keeps it in the browser too', async () => {
    mockFetch.mockImplementation(() => ok({ trayMotion: 'landed' }));
    const { result } = renderHook(() => useTrayMotion('tok'));
    await waitFor(() => expect(result.current[0]).toBe('landed'));
    expect(mockFetch).toHaveBeenCalledWith('/api/me/settings', { headers: { Authorization: 'Bearer tok' } });
    expect(localStorage.getItem('citynet_tray_motion')).toBe('landed');
  });

  it('saves a change to the account and the browser', async () => {
    mockFetch.mockImplementation(() => ok({ trayMotion: 'roll' }));
    const { result } = renderHook(() => useTrayMotion('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    act(() => result.current[1]('landed'));
    expect(result.current[0]).toBe('landed');
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put![0]).toBe('/api/me/settings');
    expect(put![1].headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(put![1].body)).toEqual({ trayMotion: 'landed' });
    expect(localStorage.getItem('citynet_tray_motion')).toBe('landed');
  });

  it('keeps a choice made before the account answered, rather than the late answer', async () => {
    let answer: (v: Response) => void = () => {};
    mockFetch.mockImplementation(() => ok({}));
    mockFetch.mockImplementationOnce(() => new Promise<Response>((r) => { answer = r; }));
    const { result } = renderHook(() => useTrayMotion('tok'));
    act(() => result.current[1]('landed'));
    await act(async () => { answer({ ok: true, json: () => Promise.resolve({ trayMotion: 'roll' }) } as Response); });
    expect(result.current[0]).toBe('landed');
  });

  it('keeps it in the browser alone for someone not signed in, and remembers it there', () => {
    const { result, unmount } = renderHook(() => useTrayMotion(null));
    act(() => result.current[1]('landed'));
    expect(mockFetch).not.toHaveBeenCalled();
    unmount();
    expect(renderHook(() => useTrayMotion(null)).result.current[0]).toBe('landed');
  });

  it('keeps the browser\'s choice when the account can\'t be reached or answers nonsense', async () => {
    localStorage.setItem('citynet_tray_motion', 'landed');
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));
    const first = renderHook(() => useTrayMotion('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(first.result.current[0]).toBe('landed');
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => ok({ trayMotion: 'wobble' }));
    const second = renderHook(() => useTrayMotion('tok'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(second.result.current[0]).toBe('landed');
    localStorage.setItem('citynet_tray_motion', 'sideways');
    expect(renderHook(() => useTrayMotion(null)).result.current[0]).toBe('roll');
  });
});
