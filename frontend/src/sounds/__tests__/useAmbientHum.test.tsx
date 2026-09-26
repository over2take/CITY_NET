/**
 * The ambient hum: one sound for the session. Its first start eases in; after that the
 * volume slider and mute only ever adjust it in place. The bug this holds: moving the slider
 * used to rebuild the hum, which restarted it and ran the slow start-up again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAmbientHum } from '../useAmbientHum';

class FakeAudio {
  static made: FakeAudio[] = [];
  src: string;
  loop = false;
  volume = 1;
  paused = true;
  plays = 0;
  constructor(src: string) { this.src = src; FakeAudio.made.push(this); }
  play() { this.paused = false; this.plays += 1; return Promise.resolve(); }
  pause() { this.paused = true; }
}

const base = { src: '/hum.mp3', level: 0.01, enabled: true, masterVolume: 0.5, delayMs: 3000, fadeMs: 8000 };

beforeEach(() => {
  FakeAudio.made = [];
  vi.stubGlobal('Audio', FakeAudio);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Start it and let the whole start-up run out. */
const startAndSettle = async (startHum: () => void) => {
  act(() => { startHum(); });
  await act(async () => { vi.advanceTimersByTime(3000); });
  await act(async () => { vi.advanceTimersByTime(9000); });
};

describe('the ambient hum', () => {
  it('waits, then eases in from silence to its level', async () => {
    const { result } = renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum(); });
    expect(hum.paused).toBe(true);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(hum.paused).toBe(false);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(hum.volume).toBeGreaterThan(0);
    expect(hum.volume).toBeLessThan(0.005 * 0.1); // a quarter of the way: barely there, on the curve
    await act(async () => { vi.advanceTimersByTime(7000); });
    expect(hum.volume).toBeCloseTo(0.005, 6);
  });

  it('follows the volume slider in place, never restarting', async () => {
    const { result, rerender } = renderHook((p) => useAmbientHum(p), { initialProps: base });
    await startAndSettle(result.current.startHum);
    const hum = FakeAudio.made[0];
    rerender({ ...base, masterVolume: 1 });
    rerender({ ...base, masterVolume: 0.2 });
    expect(FakeAudio.made).toHaveLength(1);
    expect(hum.plays).toBe(1);
    expect(hum.paused).toBe(false);
    expect(hum.volume).toBeCloseTo(0.002, 6);
  });

  it('pauses on mute and resumes at its level on unmute, with no second start-up', async () => {
    const { result, rerender } = renderHook((p) => useAmbientHum(p), { initialProps: base });
    await startAndSettle(result.current.startHum);
    const hum = FakeAudio.made[0];
    rerender({ ...base, enabled: false });
    expect(hum.paused).toBe(true);
    rerender({ ...base, enabled: true });
    expect(hum.paused).toBe(false);
    expect(hum.volume).toBeCloseTo(0.005, 6);
    expect(FakeAudio.made).toHaveLength(1);
  });

  it('eases in only once, however often it is asked to start', async () => {
    const { result } = renderHook(() => useAmbientHum(base));
    await startAndSettle(result.current.startHum);
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum(); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(hum.plays).toBe(1);
    expect(hum.volume).toBeCloseTo(0.005, 6);
  });

  it('starts on the first click, where the browser held sound back', async () => {
    renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    act(() => { document.body.click(); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(hum.paused).toBe(false);
  });
});
