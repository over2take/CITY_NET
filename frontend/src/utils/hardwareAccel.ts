// Whether the browser draws the 3D map on the graphics card (the user, 2026-10-31: "on firefox I see
// that without hardware acceleration enabled things get... slow"). Without hardware acceleration the
// browser draws on the processor and the map crawls, for the GM and players alike, with nothing to
// say why. Checked once: a WebGL context asked not to run slowly (failIfMajorPerformanceCaveat) is
// refused when only a slow one is on offer; and where the browser names its renderer, a software
// one (SwiftShader, llvmpipe, Microsoft Basic Render) says the same. Then AccelerationNotice.tsx
// tells them how to turn it on in their browser.

export type Acceleration = 'on' | 'off' | 'unknown';

/** Renderer names that draw on the processor, not the graphics card. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|lavapipe|softpipe|software|basic render|mesa offscreen/i;

type GL = WebGLRenderingContext;
type MakeCanvas = () => { getContext: (kind: string, options?: WebGLContextAttributes) => unknown };

/** The renderer a context names, where the browser tells (some hide it for privacy). */
const rendererOf = (gl: GL): string | null => {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return typeof name === 'string' ? name : null;
  } catch { return null; }
};

/** A context let go at once, so the check holds none of the browser's few. */
const release = (gl: GL | null) => {
  try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* gone already */ }
};

/**
 * Whether drawing is accelerated: 'off' when only a slow context is on offer or the renderer is a
 * software one, 'on' when a fast one is, 'unknown' with no WebGL at all (the map says so itself).
 */
export const accelerationOf = (makeCanvas: MakeCanvas = () => document.createElement('canvas')): { state: Acceleration; renderer: string | null } => {
  let fast: GL | null = null;
  let any: GL | null = null;
  try {
    fast = (makeCanvas().getContext('webgl', { failIfMajorPerformanceCaveat: true }) as GL | null) ?? null;
    any = fast ?? ((makeCanvas().getContext('webgl') ?? makeCanvas().getContext('experimental-webgl')) as GL | null) ?? null;
    if (!any) return { state: 'unknown', renderer: null };
    const renderer = rendererOf(any);
    return { state: !fast || (renderer !== null && SOFTWARE_RENDERER.test(renderer)) ? 'off' : 'on', renderer };
  } catch {
    return { state: 'unknown', renderer: null };
  } finally {
    release(fast);
    if (any !== fast) release(any);
  }
};

export type Browser = 'firefox' | 'edge' | 'chrome' | 'safari' | 'other';

/** The browser, from its user agent: Edge and Opera say Chrome too, so they are looked for first. */
export const browserOf = (agent: string): Browser => {
  if (/firefox|fxios/i.test(agent)) return 'firefox';
  if (/edg\//i.test(agent)) return 'edge';
  if (/chrome|crios|chromium/i.test(agent)) return 'chrome';
  if (/safari/i.test(agent)) return 'safari';
  return 'other';
};

/** How to turn hardware acceleration on, in that browser's own words. */
export const stepsFor = (browser: Browser): string[] => {
  switch (browser) {
    case 'firefox': return [
      'Open Settings, then General, and scroll to Performance.',
      'Untick "Use recommended performance settings".',
      'Tick "Use hardware acceleration when available".',
      'Restart Firefox.',
    ];
    case 'edge': return [
      'Open Settings, then System and performance.',
      'Turn on "Use graphics acceleration when available".',
      'Press Restart.',
    ];
    case 'chrome': return [
      'Open Settings, then System.',
      'Turn on "Use graphics acceleration when available".',
      'Press Relaunch.',
    ];
    default: return [
      'Turn on hardware (graphics) acceleration in your browser\'s settings.',
      'Restart the browser.',
    ];
  }
};

/** Where a dismissed notice is remembered, in this browser. */
export const DISMISSED_KEY = 'citynet:accelNoticeDismissed';
/**
 * Automated browsers (navigator.webdriver) draw in software and are never told, so the browser
 * tests' clicks aren't covered; this key in localStorage asks for the check all the same, for the
 * one test proving the notice.
 */
export const CHECK_ANYWAY_KEY = 'citynet:accelCheckAnyway';
