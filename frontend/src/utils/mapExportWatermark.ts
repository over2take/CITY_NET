/**
 * CITY_NET watermark for map exports.
 *
 * Composited in 2D canvas space after the WebGL render rather than added as a scene
 * object: a mesh would be lit, transformed by the camera, and would need world
 * coordinates that shift with every city size. Pixel space keeps the mark a fixed
 * size and corner position no matter how far the city sprawls.
 */

export const WATERMARK_TEXT = 'CITY_NET';
/** Shown beneath the mark. Protocol omitted — it reads cleaner and still resolves. */
export const WATERMARK_URL = 'github.com/over2take/CITY_NET';
export const WATERMARK_OPACITY = 0.35;
/** Distance from the canvas edge, in pixels. */
export const WATERMARK_MARGIN = 24;
/** Font size as a fraction of output width, so a 2048px PNG and a 900px capture match. */
export const WATERMARK_SCALE = 0.018;
export const WATERMARK_MIN_FONT = 14;
/** URL line, relative to the mark above it. */
export const WATERMARK_URL_RATIO = 0.5;
export const WATERMARK_URL_MIN_FONT = 9;
/** Vertical gap between the two lines, as a fraction of the mark's size. */
export const WATERMARK_LINE_GAP_RATIO = 0.25;

export const watermarkFontSize = (canvasWidth: number): number =>
  Math.max(WATERMARK_MIN_FONT, Math.round(canvasWidth * WATERMARK_SCALE));

export const watermarkUrlFontSize = (canvasWidth: number): number =>
  Math.max(
    WATERMARK_URL_MIN_FONT,
    Math.round(watermarkFontSize(canvasWidth) * WATERMARK_URL_RATIO),
  );

/**
 * Draw the mark into the bottom-right corner of a 2D context.
 *
 * Stroke-then-fill rather than a single translucent colour: themes range from
 * near-black to light, and one flat colour disappears at one end of that range. A dark
 * outline under white text stays legible on both.
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const fontSize = watermarkFontSize(width);
  const urlFontSize = watermarkUrlFontSize(width);
  const gap = Math.round(fontSize * WATERMARK_LINE_GAP_RATIO);

  const right = width - WATERMARK_MARGIN;
  // The URL takes the bottom anchor and the mark sits above it, so the block stays
  // pinned to the corner rather than growing past the edge.
  const urlBaseline = height - WATERMARK_MARGIN;
  const markBaseline = urlBaseline - urlFontSize - gap;

  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = WATERMARK_OPACITY;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillStyle = '#ffffff';

  ctx.font = `bold ${fontSize}px "Courier New", monospace`;
  ctx.lineWidth = Math.max(2, fontSize * 0.14);
  ctx.strokeText(WATERMARK_TEXT, right, markBaseline);
  ctx.fillText(WATERMARK_TEXT, right, markBaseline);

  ctx.font = `${urlFontSize}px "Courier New", monospace`;
  ctx.lineWidth = Math.max(1.5, urlFontSize * 0.14);
  ctx.strokeText(WATERMARK_URL, right, urlBaseline);
  ctx.fillText(WATERMARK_URL, right, urlBaseline);
  ctx.restore();
}

/** Copy a rendered canvas, stamp the watermark, and return it as a PNG data URL. */
export function compositeWatermark(source: HTMLCanvasElement): string {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;

  const ctx = out.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');

  ctx.drawImage(source, 0, 0);
  drawWatermark(ctx, out.width, out.height);
  return out.toDataURL('image/png');
}

export interface CompositeLoop {
  /** The canvas to call `captureStream()` on. */
  canvas: HTMLCanvasElement;
  stop: () => void;
}

/**
 * Mirror a WebGL canvas into a 2D canvas each frame, stamping the watermark on top.
 *
 * `captureStream()` on the WebGL canvas alone gives no opportunity to draw over the
 * frames, so recording has to capture from this intermediate canvas instead. This is
 * also the real reason `preserveDrawingBuffer` is required — the loop reads the WebGL
 * canvas outside its own draw call.
 */
export function startCompositeLoop(
  source: HTMLCanvasElement,
  overlay: (ctx: CanvasRenderingContext2D, w: number, h: number) => void = drawWatermark,
): CompositeLoop {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');

  let frame = 0;
  const tick = () => {
    if (ctx) {
      try {
        // The user can resize mid-recording; track the source so frames stay aligned.
        if (canvas.width !== source.width || canvas.height !== source.height) {
          canvas.width = source.width;
          canvas.height = source.height;
        }
        ctx.drawImage(source, 0, 0);
        overlay(ctx, canvas.width, canvas.height);
      } catch {
        // An exception thrown inside a rAF callback stops it rescheduling, which
        // would silently freeze the capture. Skip the bad frame and keep going —
        // drawImage can throw transiently if the source canvas loses its context.
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return { canvas, stop: () => cancelAnimationFrame(frame) };
}

/** Download a data or object URL under the given filename. */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
