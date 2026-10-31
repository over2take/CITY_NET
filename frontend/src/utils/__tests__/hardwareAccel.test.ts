import { describe, it, expect, vi } from 'vitest';
import { accelerationOf, accelerationOnce, forgetAcceleration, browserOf, stepsFor, warnOn, setWarn, SOFTWARE_RENDERER, DISMISSED_KEY, WARN_EVENT } from '../hardwareAccel';

/**
 * Whether the browser draws the 3D map on the graphics card (2026-10-31): off when only a slow WebGL
 * context is on offer or its renderer is a software one; the browser named from its user agent, and
 * the steps to turn acceleration on in each.
 */

/** A canvas whose contexts answer as told: fast (refused when slow), any, and the renderer's name. */
const canvases = ({ fast = true, any = true, renderer = 'ANGLE (NVIDIA GeForce RTX 3060)' as string | null, throws = false } = {}) => {
  const lose = vi.fn();
  const gl = {
    getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' ? (renderer === null ? null : { UNMASKED_RENDERER_WEBGL: 37446 })
      : name === 'WEBGL_lose_context' ? { loseContext: lose } : null),
    getParameter: () => renderer,
  };
  const make = () => ({
    getContext: (kind: string, options?: WebGLContextAttributes) => {
      if (throws) throw new Error('no canvas');
      if (options?.failIfMajorPerformanceCaveat) return fast ? gl : null;
      return any && kind === 'webgl' ? gl : null;
    },
  });
  return { make, lose };
};

describe('whether drawing is accelerated', () => {
  it('on: a fast context, a graphics card named; each context let go', () => {
    const { make, lose } = canvases();
    expect(accelerationOf(make)).toEqual({ state: 'on', renderer: 'ANGLE (NVIDIA GeForce RTX 3060)' });
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it('off: only a slow context on offer, whatever it is called', () => {
    const { make, lose } = canvases({ fast: false });
    expect(accelerationOf(make).state).toBe('off');
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it('off: a software renderer, even when it gave a fast context', () => {
    for (const renderer of ['Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Mesa OffScreen', 'softpipe', 'lavapipe']) {
      expect(accelerationOf(canvases({ renderer }).make).state, renderer).toBe('off');
    }
    expect(SOFTWARE_RENDERER.test('Apple M2')).toBe(false);
  });

  it('on when the browser hides its renderer but gives a fast context', () => {
    expect(accelerationOf(canvases({ renderer: null }).make)).toEqual({ state: 'on', renderer: null });
  });

  it('unknown with no WebGL at all, or a canvas that throws', () => {
    expect(accelerationOf(canvases({ fast: false, any: false }).make)).toEqual({ state: 'unknown', renderer: null });
    expect(accelerationOf(canvases({ throws: true }).make)).toEqual({ state: 'unknown', renderer: null });
  });
});

describe('the WARN ME setting, and asking once', () => {
  it('on until switched off, kept in local storage, each change said on the window', () => {
    window.localStorage.clear();
    const heard = vi.fn();
    window.addEventListener(WARN_EVENT, heard);
    expect(warnOn()).toBe(true);
    setWarn(false);
    expect(warnOn()).toBe(false);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1');
    setWarn(true);
    expect(warnOn()).toBe(true);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(WARN_EVENT, heard);
  });

  it('on where the browser keeps nothing', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(warnOn()).toBe(true);
    expect(() => setWarn(false)).not.toThrow();
    get.mockRestore();
    vi.restoreAllMocks();
  });

  it('the check asked once per page, until forgotten', () => {
    forgetAcceleration();
    const check = vi.fn(() => ({ state: 'off' as const }));
    expect(accelerationOnce(check)).toBe('off');
    expect(accelerationOnce(() => ({ state: 'on' as const }))).toBe('off');
    expect(check).toHaveBeenCalledTimes(1);
    forgetAcceleration();
    expect(accelerationOnce(() => ({ state: 'on' as const }))).toBe('on');
    forgetAcceleration();
  });
});

describe('the browser and its steps', () => {
  it('named from the user agent, Edge before Chrome', () => {
    expect(browserOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('firefox');
    expect(browserOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('edge');
    expect(browserOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('chrome');
    expect(browserOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe('safari');
    expect(browserOf('curl/8.0')).toBe('other');
  });

  it('says where the switch is in each', () => {
    expect(stepsFor('firefox')).toContain('Tick "Use hardware acceleration when available".');
    expect(stepsFor('firefox').at(-1)).toBe('Restart Firefox.');
    expect(stepsFor('chrome')).toContain('Turn on "Use graphics acceleration when available".');
    expect(stepsFor('edge')[0]).toBe('Open Settings, then System and performance.');
    expect(stepsFor('safari')).toEqual(stepsFor('other'));
  });
});
