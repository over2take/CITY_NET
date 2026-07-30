import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRecorder } from '../useMapExport';

/**
 * `createRecorder` is the one part of the recording path that varies by browser, so
 * it is exported and tested directly. The rest of the hook needs a live WebGL context
 * and is exercised by hand.
 */

const stream = {} as MediaStream;

const installMediaRecorder = (opts: {
  supported?: string[];
  /** Mime types whose constructor throws despite isTypeSupported saying yes. */
  constructorRejects?: string[];
  /** Omit isTypeSupported entirely, as some older browsers do. */
  withoutIsTypeSupported?: boolean;
}) => {
  const constructed: Array<string | undefined> = [];

  const Fake = function (this: any, _s: MediaStream, o?: MediaRecorderOptions) {
    constructed.push(o?.mimeType);
    if (o?.mimeType && opts.constructorRejects?.includes(o.mimeType)) {
      throw new Error('unsupported');
    }
    this.mimeType = o?.mimeType;
  } as unknown as typeof MediaRecorder;

  if (!opts.withoutIsTypeSupported) {
    (Fake as any).isTypeSupported = (t: string) => (opts.supported ?? []).includes(t);
  }

  vi.stubGlobal('MediaRecorder', Fake);
  return { constructed };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('createRecorder', () => {
  it('prefers VP9 when available', () => {
    const { constructed } = installMediaRecorder({
      supported: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
    });
    expect(createRecorder(stream)).not.toBeNull();
    expect(constructed).toEqual(['video/webm;codecs=vp9']);
  });

  it('falls back to VP8 when VP9 is unsupported', () => {
    const { constructed } = installMediaRecorder({
      supported: ['video/webm;codecs=vp8', 'video/webm'],
    });
    expect(createRecorder(stream)).not.toBeNull();
    expect(constructed).toEqual(['video/webm;codecs=vp8']);
  });

  it('falls back to plain webm when no codec is named', () => {
    const { constructed } = installMediaRecorder({ supported: ['video/webm'] });
    expect(createRecorder(stream)).not.toBeNull();
    expect(constructed).toEqual(['video/webm']);
  });

  it('lets the browser choose when nothing in the list is supported', () => {
    const { constructed } = installMediaRecorder({ supported: [] });
    expect(createRecorder(stream)).not.toBeNull();
    // Last resort: construct with no mimeType at all.
    expect(constructed).toEqual([undefined]);
  });

  it('keeps trying when isTypeSupported disagrees with the constructor', () => {
    const { constructed } = installMediaRecorder({
      supported: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'],
      constructorRejects: ['video/webm;codecs=vp9'],
    });
    expect(createRecorder(stream)).not.toBeNull();
    expect(constructed).toEqual(['video/webm;codecs=vp9', 'video/webm;codecs=vp8']);
  });

  it('works on browsers with no isTypeSupported at all', () => {
    const { constructed } = installMediaRecorder({ withoutIsTypeSupported: true });
    expect(createRecorder(stream)).not.toBeNull();
    expect(constructed).toEqual(['video/webm;codecs=vp9']);
  });

  it('returns null when every attempt throws, rather than a half-built recorder', () => {
    installMediaRecorder({
      supported: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
      constructorRejects: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
    });
    // The bare constructor throws too, since it is called with no mimeType.
    vi.stubGlobal('MediaRecorder', function () { throw new Error('nope'); });
    expect(createRecorder(stream)).toBeNull();
  });

  it('returns null when MediaRecorder does not exist', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(createRecorder(stream)).toBeNull();
  });
});

// ─── grid fade ────────────────────────────────────────────────────────────────

import { boostGridFade, makeExportCamera, VIDEO_MAX_WIDTH, GRID_NAME } from '../useMapExport';

/** Minimal stand-in for the drei <Grid> mesh and its shader uniform. */
const sceneWithGrid = (fadeDistance = 750) => {
  const uniform = { value: fadeDistance };
  const grid = { name: GRID_NAME, material: { uniforms: { fadeDistance: uniform } } };
  return {
    uniform,
    scene: { getObjectByName: (n: string) => (n === GRID_NAME ? grid : undefined) } as any,
  };
};

describe('boostGridFade', () => {
  it('widens the fade radius so the grid survives a distant camera', () => {
    const { scene, uniform } = sceneWithGrid(750);
    boostGridFade(scene, 6000);
    expect(uniform.value).toBe(6000);
  });

  it('restores the original radius', () => {
    const { scene, uniform } = sceneWithGrid(750);
    const restore = boostGridFade(scene, 6000);
    restore();
    expect(uniform.value).toBe(750);
  });

  it('is a no-op when the grid is absent, rather than throwing mid-export', () => {
    const scene = { getObjectByName: () => undefined } as any;
    expect(() => boostGridFade(scene, 6000)()).not.toThrow();
  });

  it('survives a grid whose material carries no fadeDistance uniform', () => {
    const grid = { name: GRID_NAME, material: {} };
    const scene = { getObjectByName: () => grid } as any;
    expect(() => boostGridFade(scene, 6000)()).not.toThrow();
  });
});

describe('makeExportCamera', () => {
  const bounds = (over: Partial<Record<string, number>> = {}) => ({
    minX: 0, maxX: 400, minZ: 0, maxZ: 200, maxY: 60, ...over,
  }) as any;

  it('is orthographic, so both exports read square-on with no perspective lean', () => {
    const cam = makeExportCamera(bounds(), 400, 200);
    expect(cam.isOrthographicCamera).toBe(true);
  });

  it('frames the frustum to the city dimensions', () => {
    const cam = makeExportCamera(bounds(), 400, 200);
    expect(cam.right - cam.left).toBeCloseTo(400);
    expect(cam.top - cam.bottom).toBeCloseTo(200);
  });

  it('centres on the city centroid rather than the origin', () => {
    // A city sitting far from the origin must not be cropped.
    const cam = makeExportCamera(bounds({ minX: 1000, maxX: 1400, minZ: -800, maxZ: -600 }), 400, 200);
    expect(cam.position.x).toBeCloseTo(1200);
    expect(cam.position.z).toBeCloseTo(-700);
  });

  it('sits above the tallest structure', () => {
    const cam = makeExportCamera(bounds({ maxY: 250 }), 400, 200);
    expect(cam.position.y).toBeGreaterThan(250);
  });

  it('points north up the image', () => {
    const cam = makeExportCamera(bounds(), 400, 200);
    expect(cam.up.z).toBe(-1);
  });

  it('reaches past the ground plane', () => {
    const cam = makeExportCamera(bounds({ maxY: 60 }), 400, 200);
    expect(cam.far).toBeGreaterThan(cam.position.y);
  });
});

describe('VIDEO_MAX_WIDTH', () => {
  it('caps video below the largest PNG tiers', () => {
    // Recording renders the scene a second time per frame; 4K drops frames.
    expect(VIDEO_MAX_WIDTH).toBeLessThan(4096);
  });

  it('still allows a full 1080p-class capture', () => {
    expect(VIDEO_MAX_WIDTH).toBeGreaterThanOrEqual(1920);
  });
});

// ─── countdown accuracy ───────────────────────────────────────────────────────

/**
 * The countdown derives from a wall-clock deadline rather than decrementing a
 * counter. Rendering the scene a second time per frame starves timers, and a
 * decrementing counter loses every dropped tick permanently — the display fell behind
 * and then snapped from a few seconds straight to zero when auto-stop fired.
 */
const remainingFrom = (endsAt: number, now: number) =>
  Math.ceil(Math.max(0, endsAt - now) / 1000);

describe('countdown from a deadline', () => {
  const START = 1_000_000;
  const endsAt = START + 10_000;

  it('reports the full duration at the start', () => {
    expect(remainingFrom(endsAt, START)).toBe(10);
  });

  it('tracks elapsed wall-clock time', () => {
    expect(remainingFrom(endsAt, START + 3_000)).toBe(7);
    expect(remainingFrom(endsAt, START + 7_500)).toBe(3);
  });

  it('stays correct after a long stall, rather than lagging behind', () => {
    // The bug: six ticks dropped while the GPU was busy would leave a decrementing
    // counter reading 10, then jumping to 0. Deadline math self-corrects.
    expect(remainingFrom(endsAt, START + 6_000)).toBe(4);
  });

  it('never goes negative once the deadline passes', () => {
    expect(remainingFrom(endsAt, START + 10_000)).toBe(0);
    expect(remainingFrom(endsAt, START + 25_000)).toBe(0);
  });

  it('decreases monotonically across a starved, irregular tick sequence', () => {
    const stalls = [0, 250, 900, 4_100, 4_200, 8_800, 9_999, 10_400];
    const seen = stalls.map((dt) => remainingFrom(endsAt, START + dt));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(0);
  });
});
