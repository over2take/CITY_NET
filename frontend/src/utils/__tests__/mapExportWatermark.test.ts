import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drawWatermark,
  watermarkFontSize,
  WATERMARK_TEXT,
  WATERMARK_MARGIN,
  WATERMARK_OPACITY,
  WATERMARK_MIN_FONT,
  triggerDownload,
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
  it('anchors to the bottom-right corner', () => {
    const { ctx, calls } = fakeCtx();
    drawWatermark(ctx, 2048, 1024);

    const [text, x, y] = calls.fillText[0];
    expect(text).toBe(WATERMARK_TEXT);
    expect(x).toBe(2048 - WATERMARK_MARGIN);
    expect(y).toBe(1024 - WATERMARK_MARGIN);
    expect(ctx.textAlign).toBe('right');
    expect(ctx.textBaseline).toBe('bottom');
  });

  it('strokes before filling so the mark stays legible on light and dark maps', () => {
    const { ctx, calls } = fakeCtx();
    drawWatermark(ctx, 800, 600);
    expect(calls.strokeText).toHaveLength(1);
    expect(calls.fillText).toHaveLength(1);
    expect(calls.strokeText[0][0]).toBe(WATERMARK_TEXT);
  });

  it('draws translucent', () => {
    const { ctx } = fakeCtx();
    drawWatermark(ctx, 800, 600);
    expect(ctx.globalAlpha).toBe(WATERMARK_OPACITY);
  });

  it('saves and restores so it cannot leak state into later draws', () => {
    const { ctx, calls } = fakeCtx();
    drawWatermark(ctx, 800, 600);
    expect(calls.save).toHaveLength(1);
    expect(calls.restore).toHaveLength(1);
  });

  it('tracks the corner when the canvas is a different shape', () => {
    const { ctx, calls } = fakeCtx();
    drawWatermark(ctx, 400, 2000);
    const [, x, y] = calls.fillText[0];
    expect(x).toBe(400 - WATERMARK_MARGIN);
    expect(y).toBe(2000 - WATERMARK_MARGIN);
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
