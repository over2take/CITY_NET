/**
 * The ambient hum: one sound for the session. Its first start eases in; after that the volume
 * slider and mute only adjust it in place. Moving the slider used to rebuild it, restarting it
 * and running the slow start-up again.
 *
 * And a start the browser holds back must not be taken for a start. Chrome leaves a blocked
 * play() waiting rather than refusing it, and Firefox holds back every load until the page is
 * touched - so only a real 'playing' counts, and until then every key or press asks again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAmbientHum } from '../useAmbientHum';

class FakeAudio {
  static made: FakeAudio[] = [];
  /** 'allow' plays; 'hang' leaves play() waiting forever (Chrome); 'refuse' rejects (Firefox). */
  static mode: 'allow' | 'hang' | 'refuse' = 'allow';
  src: string;
  loop = false;
  volume = 1;
  paused = true;
  plays = 0;
  private on: Record<string, (() => void)[]> = {};
  constructor(src: string) { this.src = src; FakeAudio.made.push(this); }
  addEventListener(ev: string, fn: () => void) { (this.on[ev] ||= []).push(fn); }
  removeEventListener(ev: string, fn: () => void) { this.on[ev] = (this.on[ev] || []).filter((f) => f !== fn); }
  private fire(ev: string) { (this.on[ev] || []).forEach((f) => f()); }
  play(): Promise<void> {
    this.plays += 1;
    if (FakeAudio.mode === 'hang') return new Promise(() => {});
    if (FakeAudio.mode === 'refuse') return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.fire('playing');
    return Promise.resolve();
  }
  pause() { if (!this.paused) { this.paused = true; this.fire('pause'); } }
}

const base = { src: '/hum.mp3', level: 0.01, enabled: true, masterVolume: 0.5, delayMs: 3000, fadeMs: 8000 };
const FULL = 0.005;

beforeEach(() => {
  FakeAudio.made = [];
  FakeAudio.mode = 'allow';
  vi.stubGlobal('Audio', FakeAudio);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const key = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' })); });
const press = () => act(() => { window.dispatchEvent(new Event('pointerdown')); });

/** Start it and let the whole start-up run out. */
const startAndSettle = async (startHum: () => void) => {
  act(() => { startHum(); });
  await tick(3000);
  await tick(9000);
};

describe('the ambient hum', () => {
  it('waits, then eases in from silence to its level', async () => {
    const { result } = renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum(); });
    expect(hum.paused).toBe(true);
    await tick(3000);
    expect(hum.paused).toBe(false);
    await tick(2000);
    expect(hum.volume).toBeGreaterThan(0);
    expect(hum.volume).toBeLessThan(FULL * 0.1); // a quarter of the way: barely there, on the curve
    await tick(7000);
    expect(hum.volume).toBeCloseTo(FULL, 6);
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
    expect(hum.volume).toBeCloseTo(FULL, 6);
    expect(FakeAudio.made).toHaveLength(1);
  });

  it('eases in only once, however often it is asked to start', async () => {
    const { result } = renderHook(() => useAmbientHum(base));
    await startAndSettle(result.current.startHum);
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum(); });
    await key();
    await tick(5000);
    expect(hum.plays).toBe(1);
    expect(hum.volume).toBeCloseTo(FULL, 6);
  });

  it('starts at once and fades in quickly when a start asks for that - a refresh', async () => {
    const { result } = renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum({ delayMs: 0, fadeMs: 1000 }); });
    await tick(0);
    expect(hum.paused).toBe(false);
    await tick(1100);
    expect(hum.volume).toBeCloseTo(FULL, 6);
  });
});

describe('a start the browser holds back', () => {
  it('is not taken for a start when Chrome leaves it waiting - the next key plays it', async () => {
    FakeAudio.mode = 'hang';
    const { result } = renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum({ delayMs: 0, fadeMs: 1000 }); });
    await tick(0);
    expect(hum.paused).toBe(true);
    FakeAudio.mode = 'allow';
    await key();
    expect(hum.paused).toBe(false);
    // Still eased in, quickly, rather than arriving at full.
    expect(hum.volume).toBeLessThan(FULL);
    await tick(1100);
    expect(hum.volume).toBeCloseTo(FULL, 6);
  });

  it('is asked again on every press until it really plays (Firefox refusing)', async () => {
    FakeAudio.mode = 'refuse';
    const { result } = renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum({ delayMs: 0, fadeMs: 1000 }); });
    await tick(0);
    await press();
    await press();
    expect(hum.paused).toBe(true);
    FakeAudio.mode = 'allow';
    await press();
    expect(hum.paused).toBe(false);
  });

  it('starts on the first key press when nothing has asked yet, for someone who never clicks', async () => {
    renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    await key();
    await tick(3000);
    expect(hum.paused).toBe(false);
  });

  it('starts on the first mouse press too', async () => {
    renderHook(() => useAmbientHum(base));
    const hum = FakeAudio.made[0];
    await press();
    await tick(3000);
    expect(hum.paused).toBe(false);
  });

  it('stays quiet while muted, whatever is pressed', async () => {
    FakeAudio.mode = 'hang';
    const { result, rerender } = renderHook((p) => useAmbientHum(p), { initialProps: base });
    const hum = FakeAudio.made[0];
    act(() => { result.current.startHum({ delayMs: 0, fadeMs: 1000 }); });
    await tick(0);
    rerender({ ...base, enabled: false });
    FakeAudio.mode = 'allow';
    await key();
    expect(hum.paused).toBe(true);
  });
});
