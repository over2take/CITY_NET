import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { bandOf, BAND_COLOR, RHYTHM, beatPoints } from '../healthBands';
import { HeartMonitor, HealthReviewPanel, HitPointsPanel } from '../HitPoints';
import { StreamerOverlay } from '../StreamerOverlay';

/**
 * The heart monitor says how hurt someone is without a number: its color and its rhythm come
 * from one band, on the same thresholds, so the beat quickens and falters as the color turns.
 */

afterEach(cleanup);

describe('the band', () => {
  it('is steady over half, fast at half or less, critical at a quarter or less, and down at 0', () => {
    expect(bandOf(20, 20)).toBe('steady');
    expect(bandOf(11, 20)).toBe('steady');
    expect(bandOf(10, 20)).toBe('fast');
    expect(bandOf(6, 20)).toBe('fast');
    expect(bandOf(5, 20)).toBe('critical');
    expect(bandOf(1, 20)).toBe('critical');
    expect(bandOf(0, 20)).toBe('down');
    expect(bandOf(-3, 20)).toBe('down');
  });

  it('reads no maximum as badly hurt, as the color always has, and more than the maximum as whole', () => {
    expect(bandOf(5, 0)).toBe('critical');
    expect(bandOf(30, 20)).toBe('steady');
  });

  it('keeps the colors the monitor has always used', () => {
    expect(BAND_COLOR).toEqual({ steady: 'var(--green)', fast: 'var(--warning)', critical: 'var(--danger)', down: 'var(--danger)' });
  });
});

describe('the rhythm', () => {
  it('over half is the one even beat the monitor has always drawn', () => {
    expect(beatPoints(0, RHYTHM.steady.beats)).toBe('0,25 27,25 34,20 42,25 49,25 56,5 60,45 64,5 68,25 80,30 87,25 280,25');
    expect(RHYTHM.steady.seconds).toBe(2.4);
  });

  it('beats more often as the band worsens, and weakens when critical', () => {
    expect(RHYTHM.fast.beats.length).toBe(2 * RHYTHM.steady.beats.length);
    expect(RHYTHM.critical.beats.length).toBeGreaterThan(RHYTHM.fast.beats.length);
    expect(RHYTHM.critical.seconds).toBeLessThan(RHYTHM.fast.seconds);
    // Uneven: not every gap the same, and some beats barely there.
    const gaps = RHYTHM.critical.beats.slice(1).map(([x], i) => x - RHYTHM.critical.beats[i][0]);
    expect(new Set(gaps).size).toBeGreaterThan(1);
    expect(Math.min(...RHYTHM.critical.beats.map(([, s]) => s))).toBeLessThan(0.5);
  });

  it('draws a weak beat smaller, around the same baseline', () => {
    expect(beatPoints(0, [[0, 0.5]])).toBe('0,25 0,25 7,22.5 15,25 22,25 29,15 33,35 37,15 41,25 53,27.5 60,25 280,25');
  });

  it('keeps every beat inside its stretch, so the trace repeats without a seam', () => {
    for (const { beats } of Object.values(RHYTHM)) {
      const xs = beatPoints(280, beats).split(' ').map((p) => Number(p.split(',')[0]));
      expect(xs[0]).toBe(280);
      expect(xs[xs.length - 1]).toBe(560);
      xs.forEach((x, i) => { if (i) expect(x).toBeGreaterThanOrEqual(xs[i - 1]); });
      const ys = beatPoints(0, beats).split(' ').map((p) => Number(p.split(',')[1]));
      ys.forEach((y) => { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(50); });
    }
  });
});

describe('the monitor', () => {
  it('draws each band in its color and at its speed, and a flatline when down', () => {
    for (const band of ['steady', 'fast', 'critical'] as const) {
      const { container } = render(<HeartMonitor band={band} />);
      const svg = container.querySelector('svg.ekg-live') as SVGElement;
      expect(svg.style.animationDuration).toBe(`${RHYTHM[band].seconds}s`);
      expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe(BAND_COLOR[band]);
      expect(container.querySelector('polyline')!.getAttribute('points')).toBe(beatPoints(0, RHYTHM[band].beats));
      cleanup();
    }
    const { container } = render(<HeartMonitor band="down" />);
    expect(container.querySelector('svg.ekg-live')).toBeNull();
    expect(container.querySelector('line')!.getAttribute('stroke')).toBe('var(--danger)');
  });

  it('holds still with reduced motion', () => {
    const { container } = render(<HeartMonitor band="fast" />);
    expect(container.querySelector('style')!.textContent).toMatch(/prefers-reduced-motion: reduce\) \{ \.ekg-live \{ animation: none; \}/);
  });

  it('tells a screen reader how it looks, never a number', () => {
    render(<HeartMonitor band="critical" />);
    expect(screen.getByRole('img', { name: 'Heart monitor: weak, uneven heartbeat' })).toBeTruthy();
  });

  it("follows another player's health as others see it", () => {
    const token = { id: 1, name: 'Razor', x: 0, y: 0, z: 0, shape: 'rhombus', owner: 'RAZOR', hp_max: 20 } as never;
    const shown = (hp: number) => {
      const { container } = render(<HealthReviewPanel location={{ ...(token as object), hp_current: hp } as never} />);
      const band = container.querySelector('[data-band]')!.getAttribute('data-band');
      cleanup();
      return band;
    };
    expect([shown(18), shown(9), shown(3), shown(0)]).toEqual(['steady', 'fast', 'critical', 'down']);
  });

  it('beats the same way in the editing panel and on the stream', () => {
    const token = (hp: number) => ({ id: 1, name: 'Razor', x: 0, y: 0, z: 0, shape: 'rhombus', owner: 'RAZOR', hp_current: hp, hp_max: 20 } as never);
    const inPanel = (hp: number) => {
      const { container } = render(<HitPointsPanel target={token(hp)} token="" refreshLocations={() => {}} />);
      const band = container.querySelector('[data-band]')!.getAttribute('data-band');
      cleanup();
      return band;
    };
    const onStream = (hp: number) => {
      const { container } = render(<StreamerOverlay socket={null} directorState={{ letterbox: false } as never} selectedLocation={token(hp)} />);
      const band = container.querySelector('[data-band]')!.getAttribute('data-band');
      cleanup();
      return band;
    };
    expect([inPanel(18), inPanel(9), inPanel(3), inPanel(0)]).toEqual(['steady', 'fast', 'critical', 'down']);
    expect([onStream(18), onStream(9), onStream(3), onStream(0)]).toEqual(['steady', 'fast', 'critical', 'down']);
  });
});
