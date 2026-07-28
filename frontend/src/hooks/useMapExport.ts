import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import {
  computeCityBounds,
  boundsWidth,
  boundsDepth,
  resolveExportSize,
  DEFAULT_PNG_EXPORT_WIDTH,
  type CityBounds,
  type BoundsLocation,
  type BoundsRoad,
  type BoundsWaterBody,
  type BoundsOverpass,
} from '../utils/mapExportBounds';
import {
  compositeWatermark,
  startRenderedCompositeLoop,
  triggerDownload,
} from '../utils/mapExportWatermark';

/** Longest a recording may run before it auto-stops. */
export const MAX_RECORD_SECONDS = 10;

/**
 * Ceiling on recorded video width.
 *
 * Recording renders the scene a second time every frame, on top of what the live
 * canvas is already drawing. 4K is four times the pixels of 1080p, which on a large
 * city drops frames and yields choppier playback than a lower-resolution capture
 * would. The PNG has no such ceiling — it renders exactly once.
 */
export const VIDEO_MAX_WIDTH = 2048;

/** Frames per second the capture targets. */
export const RECORDING_FPS = 30;

/**
 * Overhead orthographic camera framed exactly to the city bounds.
 *
 * Shared by both exports so the video reads identically to the PNG: no perspective
 * convergence, no walls, no lean at the edges — just a flat top-down map.
 */
export function makeExportCamera(
  bounds: CityBounds,
  worldWidth: number,
  worldDepth: number,
): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(
    -worldWidth / 2, worldWidth / 2,
    worldDepth / 2, -worldDepth / 2,
    0.1, bounds.maxY + 1000,
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  // Centred on the city centroid, not the origin — an off-centre city would
  // otherwise be cropped.
  cam.position.set(cx, bounds.maxY + 500, cz);
  cam.up.set(0, 0, -1); // north = negative Z = up in the image
  cam.lookAt(cx, 0, cz);
  return cam;
}

/**
 * Widen the ground grid's fade radius for the duration of an export.
 *
 * `<Grid fadeDistance={750}>` is tuned for the interactive camera. Both export paths
 * frame the whole city from far above it, so the grid would fade to nothing exactly
 * when INCLUDE_GRID says to show it.
 */
export function boostGridFade(scene: THREE.Scene, distance: number): () => void {
  const grid = scene.getObjectByName(GRID_NAME) as THREE.Mesh | undefined;
  const uniforms = (grid?.material as THREE.ShaderMaterial | undefined)?.uniforms;
  const fade = uniforms?.fadeDistance;
  if (!fade) return () => {};

  const previous = fade.value;
  fade.value = distance;
  return () => { fade.value = previous; };
}

/**
 * Largest render this GPU will accept, in pixels on either axis.
 *
 * Falls back to 4096 — the floor the WebGL2 spec guarantees — if the parameter cannot
 * be read, so a missing value produces a smaller image rather than a failed one.
 */
export function maxRenderSize(renderer: THREE.WebGLRenderer): number {
  try {
    const gl = renderer.getContext();
    const limits = [
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
    ].filter((n) => Number.isFinite(n) && n > 0) as number[];
    return limits.length ? Math.min(...limits) : 4096;
  } catch {
    return 4096;
  }
}

/** Scene object names the export toggles. Set via `name` props in App.tsx. */
export const GRID_NAME = 'city-grid';
export const REF_LINES_NAME = 'city-ref-lines';
export const TOKENS_NAME = 'city-tokens';

/**
 * Preferred first, then progressively less specific. VP9 gives the best quality per
 * byte but is not universally available; plain `video/webm` lets the browser pick.
 */
const RECORDER_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** First codec this browser can actually encode, or null if none work. */
export function createRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;

  for (const mimeType of RECORDER_MIME_TYPES) {
    // isTypeSupported is the documented check, but it is not present everywhere and
    // has been known to disagree with the constructor, so guard both.
    if (MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {
      // Try the next candidate.
    }
  }

  try {
    return new MediaRecorder(stream);
  } catch {
    return null;
  }
}

export interface MapExportOptions {
  includeHidden?: boolean;
  includeTokens?: boolean;
  /** Keep the ground grid in the shot. On by default — it reads as map paper. */
  includeGrid?: boolean;
  /** Target width in pixels. Video is capped at VIDEO_MAX_WIDTH; the PNG is not. */
  width?: number;
}

interface UseMapExportArgs {
  locations: BoundsLocation[];
  roads: BoundsRoad[];
  waterBodies: BoundsWaterBody[];
  overpasses: BoundsOverpass[];
}

/**
 * Hide the objects that should never appear in an export, returning a closure that
 * puts every previous `visible` value back.
 *
 * Note this only covers objects that exist as their own scene nodes. Hidden
 * (`is_hidden`) buildings cannot be handled here — they are baked into shared
 * InstancedMesh draw calls, so there is no per-building node to switch off. App.tsx
 * filters them out of `renderLists` and re-renders before the export runs instead.
 */
export function hideNonExportObjects(
  scene: THREE.Scene,
  { includeTokens = false, includeGrid = true }: MapExportOptions = {},
): () => void {
  // The admin reference lines are always dropped: they are 2000 units long and would
  // streak across the whole image.
  const targets: string[] = [REF_LINES_NAME];
  if (!includeGrid) targets.push(GRID_NAME);
  if (!includeTokens) targets.push(TOKENS_NAME);

  const previous: Array<[THREE.Object3D, boolean]> = [];
  for (const name of targets) {
    const obj = scene.getObjectByName(name);
    if (!obj) continue;
    previous.push([obj, obj.visible]);
    obj.visible = false;
  }

  return () => {
    for (const [obj, wasVisible] of previous) obj.visible = wasVisible;
  };
}

export function useMapExport({
  locations,
  roads,
  waterBodies,
  overpasses,
}: UseMapExportArgs) {
  const scene = useThree((s) => s.scene);

  const [isRecording, setIsRecording] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offscreenRef = useRef<THREE.WebGLRenderer | null>(null);

  /**
   * One off-screen renderer for the whole session, resized per export.
   *
   * Building a fresh WebGLRenderer per export exhausts the browser's context budget
   * (Chrome allows roughly 16), at which point it evicts the oldest context — the
   * live city canvas — and the whole scene goes black. Keeping a single spare context
   * also skips the shader recompile that made the first export stall.
   */
  const offscreenRenderer = useCallback((width: number, height: number) => {
    if (!offscreenRef.current) {
      // No shadowMap: the scene has no shadow-casting lights (ambient plus token
      // point-lights only), so enabling it would allocate a map nothing writes to.
      offscreenRef.current = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    }
    offscreenRef.current.setSize(width, height, false);
    return offscreenRef.current;
  }, []);

  useEffect(() => () => {
    offscreenRef.current?.dispose();
    offscreenRef.current = null;
  }, []);

  const bounds = useCallback(
    (opts: MapExportOptions) => {
      const visible = opts.includeHidden
        ? locations
        : locations.filter((l) => !l.is_hidden);
      return computeCityBounds(visible, roads, waterBodies, overpasses);
    },
    [locations, roads, waterBodies, overpasses],
  );

  const exportPng = useCallback(
    (opts: MapExportOptions = {}) => {
      setIsExporting(true);
      let restore: (() => void) | null = null;

      try {
        const b = bounds(opts);
        const worldW = boundsWidth(b);
        const worldH = boundsDepth(b);

        const renderer = offscreenRenderer(1, 1);
        // Ask the GPU what it can actually render before sizing. Exceeding
        // MAX_RENDERBUFFER_SIZE fails outright or yields a blank image, and the height
        // implied by a tall city can breach the limit even when the chosen width does
        // not.
        const gpuMax = maxRenderSize(renderer);
        const { width: exportW, height: exportH, clamped } = resolveExportSize(
          worldW, worldH, opts.width ?? DEFAULT_PNG_EXPORT_WIDTH, gpuMax,
        );
        if (clamped) {
          console.warn(
            `[map export] ${opts.width ?? DEFAULT_PNG_EXPORT_WIDTH}px exceeds this GPU's ${gpuMax}px limit; exporting at ${exportW}x${exportH}`,
          );
        }
        renderer.setSize(exportW, exportH, false);

        const cam = makeExportCamera(b, worldW, worldH);

        const restoreScene = hideNonExportObjects(scene, opts);
        // The ortho camera sits well past the grid's usual fade radius too, so the
        // grid would wash out toward the edges of a large city.
        const restoreGrid = boostGridFade(scene, Math.hypot(worldW, worldH) * 1.5);
        restore = () => { restoreGrid(); restoreScene(); };
        renderer.render(scene, cam);

        const dataUrl = compositeWatermark(renderer.domElement);
        triggerDownload(dataUrl, `city-map-${Date.now()}.png`);
      } finally {
        // The renderer is deliberately kept alive for the session — see
        // offscreenRenderer. Disposing or force-losing it here is what cost the live
        // canvas its context.
        restore?.();
        setIsExporting(false);
      }
    },
    [scene, bounds, offscreenRenderer],
  );

  const stopRecording = useCallback(() => {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    recorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(
    async (opts: MapExportOptions = {}) => {
      // A recorder that already finished (or died) must not block every later attempt.
      // Without this, one failed capture leaves the button stuck on STOP_RECORDING for
      // the rest of the session and every click silently no-ops.
      if (recorderRef.current) {
        if (recorderRef.current.state === 'recording') return;
        recorderRef.current = null;
        restoreRef.current?.();
        restoreRef.current = null;
        setIsRecording(false);
      }

      const b = bounds(opts);
      const worldW = boundsWidth(b);
      const worldD = boundsDepth(b);

      const renderer = offscreenRenderer(1, 1);
      const gpuMax = maxRenderSize(renderer);
      // Capped below the PNG tiers: this renders the scene a second time every frame,
      // and 4K would drop frames on a large city.
      const requested = Math.min(opts.width ?? DEFAULT_PNG_EXPORT_WIDTH, VIDEO_MAX_WIDTH);
      const { width: videoW, height: videoH } = resolveExportSize(
        worldW, worldD, requested, gpuMax,
      );
      renderer.setSize(videoW, videoH, false);

      // Same orthographic camera as the PNG, so the video is square-on rather than a
      // perspective view of the city. Rendering through our own camera also means the
      // live view is never hijacked — the user keeps their position and their controls.
      const cam = makeExportCamera(b, worldW, worldD);

      const restoreScene = hideNonExportObjects(scene, opts);
      const restoreGrid = boostGridFade(scene, Math.hypot(worldW, worldD) * 1.5);
      const restoreAll = () => { restoreGrid(); restoreScene(); };
      restoreRef.current = restoreAll;

      // Traffic still animates: the live render loop keeps advancing the scene, and
      // each captured frame samples whatever state it is in.
      const loop = startRenderedCompositeLoop(videoW, videoH, () => {
        renderer.render(scene, cam);
        return renderer.domElement;
      }, RECORDING_FPS);

      const recorder = createRecorder(loop.canvas.captureStream(RECORDING_FPS));
      if (!recorder) {
        // Nothing this browser offers can encode the stream. Bail loudly rather than
        // leaving the scene mutated with no recording running.
        console.warn('[map export] no supported video codec; recording unavailable');
        loop.stop();
        restoreAll();
        restoreRef.current = null;
        return;
      }

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      // All teardown lives here so it runs exactly once, whether the stop was manual
      // or from the auto-stop timer.
      recorder.onstop = () => {
        loop.stop();
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, `city-map-${Date.now()}.webm`);
        // The blob stays alive until its URL is revoked; a few 10s captures would
        // otherwise pin tens of MB for the rest of the session. Deferred because
        // revoking in the same tick can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        restoreRef.current?.();
        restoreRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
      };
      // A recorder error never fires onstop, so without this the scene would stay
      // mutated with no way back.
      recorder.onerror = () => {
        console.warn('[map export] recording failed');
        loop.stop();
        restoreRef.current?.();
        restoreRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);

      autoStopRef.current = setTimeout(stopRecording, MAX_RECORD_SECONDS * 1000);
    },
    [scene, bounds, offscreenRenderer, stopRecording],
  );

  return { exportPng, startRecording, stopRecording, isRecording, isExporting };
}
