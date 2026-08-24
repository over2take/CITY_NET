/**
 * The video element behind an animated battle map.
 *
 * All of the risk here is browser policy rather than rendering, and every bit of it is
 * silent when wrong: an unmuted video simply never starts, a video that keeps decoding
 * on a hidden tab just drains a battery, and an element that is not released holds its
 * buffers while a GM steps through floors. None of that shows up as an error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoMapTexture } from '../useVideoMapTexture';

const URL_A = '/uploads/battle_maps/aaa.webm';
const URL_B = '/uploads/battle_maps/bbb.webm';

/** The elements the hook created, in order, with play/pause recorded. */
let made: any[];
let realCreate: typeof document.createElement;

beforeEach(() => {
  made = [];
  realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) => {
    const el: any = realCreate(tag as any, ...(rest as []));
    if (tag === 'video') {
      el.play = vi.fn(() => Promise.resolve());
      el.pause = vi.fn();
      el.load = vi.fn();
      made.push(el);
    }
    return el;
  }) as any);
});

afterEach(() => vi.restoreAllMocks());

describe('useVideoMapTexture', () => {
  it('mutes the video, because otherwise it never starts', async () => {
    // Not a preference. Every browser refuses to autoplay a video with sound, and a map
    // that will not move until someone clicks looks broken rather than deliberate.
    await act(async () => { renderHook(() => useVideoMapTexture(URL_A)); });
    expect(made[0].muted).toBe(true);
    expect(made[0].play).toHaveBeenCalled();
  });

  it('loops it, and keeps it in the page on iOS', async () => {
    await act(async () => { renderHook(() => useVideoMapTexture(URL_A)); });
    expect(made[0].loop).toBe(true);
    // Without playsInline, iOS Safari takes the video full-screen — which for a texture
    // means it is not on the map at all.
    expect(made[0].playsInline).toBe(true);
  });

  it('stops decoding while the tab is hidden', async () => {
    // A GM leaves the tab open. Decoding video for nobody is real battery on a laptop.
    await act(async () => { renderHook(() => useVideoMapTexture(URL_A)); });
    const video = made[0];
    video.play.mockClear();

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(video.pause).toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(video.play).toHaveBeenCalled();
  });

  it('releases the source when the map goes away', async () => {
    // Pausing alone leaves the decoded buffers held. Stepping through floors would
    // otherwise accumulate one loaded video per map visited.
    const { unmount } = renderHook(() => useVideoMapTexture(URL_A));
    await act(async () => { unmount(); });

    const video = made[0];
    expect(video.pause).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
  });

  it('starts a new element when the map changes, and lets the old one go', async () => {
    const { rerender } = renderHook(({ url }) => useVideoMapTexture(url), {
      initialProps: { url: URL_A },
    });
    await act(async () => { rerender({ url: URL_B }); });

    expect(made).toHaveLength(2);
    expect(made[0].pause).toHaveBeenCalled();
    expect(made[1].src).toContain('bbb.webm');
  });

  it('waits for a click when the browser refuses to start on its own', async () => {
    // A strict setting or an extension can refuse even a muted loop. A still frame with
    // no explanation is the worst outcome; the next click anywhere is enough.
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) => {
      const el: any = realCreate(tag as any, ...(rest as []));
      if (tag === 'video') {
        el.play = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
        el.pause = vi.fn();
        el.load = vi.fn();
        made.push(el);
      }
      return el;
    }) as any);

    const { result } = renderHook(() => useVideoMapTexture(URL_A));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.awaitingGesture).toBe(true);

    made[0].play.mockClear();
    await act(async () => { window.dispatchEvent(new Event('pointerdown')); });
    expect(made[0].play).toHaveBeenCalled();
  });

  it('does nothing at all without a url', () => {
    renderHook(() => useVideoMapTexture(''));
    expect(made).toHaveLength(0);
  });
});
