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

import { boostGridFade, RECORDING_FOV, GRID_NAME } from '../useMapExport';

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

describe('RECORDING_FOV', () => {
  it('is much narrower than the live camera, to approximate an orthographic view', () => {
    // The live world camera runs at Three's default 50 degrees.
    expect(RECORDING_FOV).toBeLessThan(50);
  });

  it('stays wide enough to avoid an absurd camera distance', () => {
    // Height scales as 1/tan(fov/2), so a very small FOV pushes the camera so far out
    // that depth precision suffers even with a tight frustum.
    expect(RECORDING_FOV).toBeGreaterThanOrEqual(8);
  });

  it('cuts perspective lean to a small fraction of the default', () => {
    // Lean at the frame edge scales with tan(fov/2).
    const lean = (fov: number) => Math.tan((fov * Math.PI) / 180 / 2);
    expect(lean(RECORDING_FOV) / lean(50)).toBeLessThan(0.25);
  });
});
