import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drawWatermark,
  watermarkFontSize,
  watermarkUrlFontSize,
  WATERMARK_TEXT,
  WATERMARK_URL,
  WATERMARK_MARGIN,
  WATERMARK_OPACITY,
  WATERMARK_MIN_FONT,
  WATERMARK_URL_MIN_FONT,
  triggerDownload,
  exportFilename,
} from '../mapExportWatermark';

/** jsdom has no 2D context, so record the calls the watermark makes. */
const fakeCtx = () => {
  const calls: Record<string, unknown[][]> = { fillText: [], strokeText: [], save: [], restore: [] };
  const ctx = {
    save: (...a: unknown[]) => { calls.save.push(a); },
    restore: (...a: unknown[]) => { calls.restore.push(a); },
    fillText: (...a: unknown[]) => { calls.fillText.push(a); },
    strokeText: (...a: unknown[]) => { calls.strokeText.push(a); },
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe('watermarkFontSize', () => {
  it('scales with canvas width', () => {
    expect(watermarkFontSize(2048)).toBeGreaterThan(watermarkFontSize(900));
  });

  it('never drops below the legibility floor', () => {
    expect(watermarkFontSize(100)).toBe(WATERMARK_MIN_FONT);
    expect(watermarkFontSize(1)).toBe(WATERMARK_MIN_FONT);
  });

  it('reads the same relative size at different resolutions', () => {
    // 2048 and 1024 differ by 2x, so their fonts should too — within the slack that
    // rounding to whole pixels allows (37/18, not exactly 2).
    const ratio = watermarkFontSize(2048) / watermarkFontSize(1024);
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });
});

describe('drawWatermark', () => {
  /** Both lines, keyed by their text, with the position each was drawn at. */
  const drawn = (w: number, h: number) => {
    const { ctx, calls } = fakeCtx();
    drawWatermark(ctx, w, h);
    const byText = (t: string) => {
      const call = calls.fillText.find(([text]) => text === t);
      return call ? { x: call[1] as number, y: call[2] as number } : null;
    };
    return { ctx, calls, mark: byText(WATERMARK_TEXT), url: byText(WATERMARK_URL) };
  };

  it('draws the mark and the repo URL', () => {
    const { mark, url } = drawn(2048, 1024);
    expect(mark).not.toBeNull();
    expect(url).not.toBeNull();
  });

  it('anchors the URL to the bottom-right corner', () => {
    const { ctx, url } = drawn(2048, 1024);
    expect(url!.x).toBe(2048 - WATERMARK_MARGIN);
    expect(url!.y).toBe(1024 - WATERMARK_MARGIN);
    expect(ctx.textAlign).toBe('right');
    expect(ctx.textBaseline).toBe('bottom');
  });

  it('stacks the mark above the URL, sharing the right edge', () => {
    const { mark, url } = drawn(2048, 1024);
    expect(mark!.y).toBeLessThan(url!.y);
    expect(mark!.x).toBe(url!.x);
  });

  it('keeps the whole block inside the canvas', () => {
    // The mark moved up to make room, so it must not be pushed off the top edge
    // on a short canvas.
    const { mark } = drawn(2048, 200);
    expect(mark!.y).toBeGreaterThan(0);
  });

  it('sets the URL smaller than the mark', () => {
    expect(watermarkUrlFontSize(2048)).toBeLessThan(watermarkFontSize(2048));
  });

  it('keeps the URL legible on small canvases rather than scaling to nothing', () => {
    expect(watermarkUrlFontSize(100)).toBeGreaterThanOrEqual(WATERMARK_URL_MIN_FONT);
  });

  it('strokes and fills both lines so they stay legible on light and dark maps', () => {
    const { calls } = drawn(800, 600);
    expect(calls.strokeText).toHaveLength(2);
    expect(calls.fillText).toHaveLength(2);
    expect(calls.strokeText.map(([t]) => t)).toEqual([WATERMARK_TEXT, WATERMARK_URL]);
  });

  it('draws translucent', () => {
    const { ctx } = drawn(800, 600);
    expect(ctx.globalAlpha).toBe(WATERMARK_OPACITY);
  });

  it('saves and restores so it cannot leak state into later draws', () => {
    const { calls } = drawn(800, 600);
    expect(calls.save).toHaveLength(1);
    expect(calls.restore).toHaveLength(1);
  });

  it('tracks the corner when the canvas is a different shape', () => {
    const { mark, url } = drawn(400, 2000);
    expect(url!.x).toBe(400 - WATERMARK_MARGIN);
    expect(url!.y).toBe(2000 - WATERMARK_MARGIN);
    expect(mark!.x).toBe(400 - WATERMARK_MARGIN);
  });
});

describe('triggerDownload', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clicks a download link and cleans it up', () => {
    const click = vi.fn();
    const anchor = document.createElement('a');
    anchor.click = click;
    const spy = vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);

    triggerDownload('data:image/png;base64,AAA', 'city-map-1.png');

    expect(anchor.download).toBe('city-map-1.png');
    expect(anchor.href).toContain('data:image/png');
    expect(click).toHaveBeenCalled();
    expect(document.body.contains(anchor)).toBe(false);
    spy.mockRestore();
  });
});

// ─── filenames ────────────────────────────────────────────────────────────────

describe('exportFilename', () => {
  const DAY = new Date(2026, 6, 28); // 28 July 2026

  it('names the file after the live map', () => {
    expect(exportFilename('png', 'Night City', DAY)).toBe('night-city-2026-07-28.png');
  });

  it('falls back when no map is loaded', () => {
    // A freshly generated city that has never been saved has no name to use.
    expect(exportFilename('png', null, DAY)).toBe('city-map-2026-07-28.png');
    expect(exportFilename('png', undefined, DAY)).toBe('city-map-2026-07-28.png');
    expect(exportFilename('png', '', DAY)).toBe('city-map-2026-07-28.png');
  });

  it('uses the right extension per format', () => {
    expect(exportFilename('webm', 'Watson', DAY)).toBe('watson-2026-07-28.webm');
  });

  it('strips characters a filesystem might object to', () => {
    expect(exportFilename('png', 'A/B:C*D?"E<F>G|H', DAY)).toBe('a-b-c-d-e-f-g-h-2026-07-28.png');
  });

  it('collapses runs of separators and trims the edges', () => {
    expect(exportFilename('png', '  __Night   City!!  ', DAY)).toBe('night-city-2026-07-28.png');
  });

  it('falls back when a name slugs down to nothing', () => {
    expect(exportFilename('png', '!!!', DAY)).toBe('city-map-2026-07-28.png');
  });

  it('caps a very long name', () => {
    const out = exportFilename('png', 'x'.repeat(200), DAY);
    expect(out.length).toBeLessThan(90);
    expect(out.endsWith('-2026-07-28.png')).toBe(true);
  });

  it('zero-pads month and day so names sort chronologically', () => {
    expect(exportFilename('png', 'M', new Date(2026, 0, 5))).toBe('m-2026-01-05.png');
  });
});
