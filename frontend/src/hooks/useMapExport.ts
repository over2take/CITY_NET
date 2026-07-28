import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import {
  computeCityBounds,
  boundsCenter,
  boundsWidth,
  boundsDepth,
  overheadFlyHeight,
  type BoundsLocation,
  type BoundsRoad,
  type BoundsWaterBody,
  type BoundsOverpass,
} from '../utils/mapExportBounds';
import {
  compositeWatermark,
  startCompositeLoop,
  triggerDownload,
} from '../utils/mapExportWatermark';

/** Longest a recording may run before it auto-stops. */
export const MAX_RECORD_SECONDS = 10;

/** Width of the exported PNG; height follows the city's aspect ratio. */
export const PNG_EXPORT_WIDTH = 2048;

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
}

/**
 * The slice of drei's CameraControls this hook drives. Typed structurally rather than
 * imported so a drei API change surfaces here as a type error instead of silently
 * no-opping the fly-to at runtime.
 */
interface ExportCameraControls {
  enabled: boolean;
  getPosition?: (out: THREE.Vector3) => THREE.Vector3;
  getTarget?: (out: THREE.Vector3) => THREE.Vector3;
  setLookAt?: (
    px: number, py: number, pz: number,
    tx: number, ty: number, tz: number,
    enableTransition?: boolean,
  ) => Promise<void>;
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
  { includeTokens = false }: MapExportOptions = {},
): () => void {
  const targets: string[] = [GRID_NAME, REF_LINES_NAME];
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
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as ExportCameraControls | null;

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
        const centre = boundsCenter(b);

        const exportW = PNG_EXPORT_WIDTH;
        const exportH = Math.max(1, Math.round(exportW * (worldH / worldW)));

        const renderer = offscreenRenderer(exportW, exportH);

        // Ortho frustum matches world bounds exactly, so nothing is distorted and the
        // whole city lands in one frame regardless of how far it sprawls.
        const cam = new THREE.OrthographicCamera(
          -worldW / 2,
          worldW / 2,
          worldH / 2,
          -worldH / 2,
          0.1,
          b.maxY + 1000,
        );
        // Centred on the city centroid, not the origin — an off-centre city would
        // otherwise be cropped.
        cam.position.set(centre.x, b.maxY + 500, centre.z);
        cam.up.set(0, 0, -1); // north = negative Z = up in the image
        cam.lookAt(centre.x, 0, centre.z);

        restore = hideNonExportObjects(scene, opts);
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
    // react-hooks/immutability flags the camera and controls mutations below. In R3F
    // those are the intended API — useThree returns live scene objects from a zustand
    // store, and moving the camera means assigning to it. There is no immutable
    // alternative; both are read back and restored when the recording stops.
    // eslint-disable-next-line react-hooks/immutability
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
      const centre = boundsCenter(b);
      const worldW = boundsWidth(b);
      const worldD = boundsDepth(b);
      const span = Math.max(worldW, worldD);
      // Width and depth are fitted to their own screen axes; collapsing them into one
      // span zooms out by the city's aspect ratio and wastes most of the frame.
      const flyHeight = overheadFlyHeight(
        worldW, worldD, camera.fov, camera.aspect, b.maxY,
      );

      // The world camera declares no `far`, so it inherits Three's default of 2000.
      // Pulling up to frame a large city puts the far corners past that plane and they
      // clip out mid-recording — raise it for the duration and restore on stop.
      const savedFar = camera.far;
      // eslint-disable-next-line react-hooks/immutability -- R3F cameras are mutated by design; restored on stop
      camera.far = flyHeight + span * 2;
      camera.updateProjectionMatrix();

      const savedPosition = new THREE.Vector3();
      const savedTarget = new THREE.Vector3();
      const savedEnabled = controls?.enabled ?? true;
      if (controls?.getPosition) controls.getPosition(savedPosition);
      if (controls?.getTarget) controls.getTarget(savedTarget);

      const restoreScene = hideNonExportObjects(scene, opts);

      if (controls?.setLookAt) {
        await controls.setLookAt(
          centre.x, flyHeight, centre.z,
          centre.x, 0, centre.z,
          false,
        );
        // eslint-disable-next-line react-hooks/immutability -- locking input during capture; restored on stop
        controls.enabled = false;
      }

      const restoreAll = () => {
        restoreScene();
        camera.far = savedFar;
        camera.updateProjectionMatrix();
        if (controls?.setLookAt) {
          controls.setLookAt(
            savedPosition.x, savedPosition.y, savedPosition.z,
            savedTarget.x, savedTarget.y, savedTarget.z,
            false,
          );
          controls.enabled = savedEnabled;
        }
      };
      restoreRef.current = restoreAll;

      // captureStream() on the WebGL canvas gives nothing to draw over, so the
      // watermark requires compositing through an intermediate 2D canvas.
      const loop = startCompositeLoop(gl.domElement);

      const recorder = createRecorder(loop.canvas.captureStream(30));
      if (!recorder) {
        // Nothing this browser offers can encode the stream. Bail loudly rather than
        // leaving the camera parked overhead with no recording running.
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
      // A recorder error never fires onstop, so without this the camera would stay
      // parked overhead with the controls locked and no way back.
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
    [scene, gl, camera, controls, bounds, stopRecording],
  );

  return { exportPng, startRecording, stopRecording, isRecording, isExporting };
}
