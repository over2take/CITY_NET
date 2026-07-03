import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { DirectorState } from '../types';

// ─── Spectator side ───────────────────────────────────────────────────────────
// Drives the spectator camera from director state. The camera is always
// *animated toward* a goal via setLookAt(..., true) — never snapped.

export function SpectatorCameraRig({ socket, controlsRef, directorState }: {
  socket: any;
  controlsRef: React.MutableRefObject<any>;
  directorState: DirectorState;
}) {
  const modeRef = useRef(directorState.cameraMode);
  useEffect(() => { modeRef.current = directorState.cameraMode; }, [directorState.cameraMode]);

  // Mirror poses arrive at ~10Hz; handled outside React state, straight to the controls.
  useEffect(() => {
    if (!socket) return;
    const onPose = (msg: { pos: number[]; lookAt: number[] }) => {
      if (modeRef.current !== 'mirror') return;
      const c = controlsRef.current;
      if (!c || !msg?.pos || !msg?.lookAt) return;
      c.setLookAt(msg.pos[0], msg.pos[1], msg.pos[2], msg.lookAt[0], msg.lookAt[1], msg.lookAt[2], true);
    };
    socket.on('streamerCamera', onPose);
    return () => { socket.off('streamerCamera', onPose); };
  }, [socket, controlsRef]);

  // Director target: glide there and hold.
  useEffect(() => {
    if (directorState.cameraMode !== 'director' || !directorState.target) return;
    const c = controlsRef.current;
    if (!c) return;
    const { pos, lookAt } = directorState.target;
    c.setLookAt(pos[0], pos[1], pos[2], lookAt[0], lookAt[1], lookAt[2], true);
  }, [directorState.cameraMode, directorState.target, controlsRef]);

  return null;
}

// ─── Admin side ───────────────────────────────────────────────────────────────
// In mirror mode, broadcasts the admin camera pose at ~10Hz. The spectator
// interpolates between keyframes, so per-frame sends are never needed.

export function AdminCameraBroadcaster({ socket, controlsRef, enabled }: {
  socket: any;
  controlsRef: React.MutableRefObject<any>;
  enabled: boolean;
}) {
  const lastSent = useRef(0);
  const tmpTarget = useRef(new THREE.Vector3());

  useFrame((state) => {
    if (!enabled || !socket) return;
    const now = performance.now();
    if (now - lastSent.current < 100) return;
    lastSent.current = now;
    const controls = controlsRef.current;
    if (!controls) return;
    controls.getTarget(tmpTarget.current);
    const p = state.camera.position;
    const t = tmpTarget.current;
    socket.emit('streamerCamera', { pos: [p.x, p.y, p.z], lookAt: [t.x, t.y, t.z] });
  });

  return null;
}

// ─── Battle map camera sync ───────────────────────────────────────────────────
// Battle maps use their own OrthographicCamera + MapControls (not CameraControls),
// so pan is camera x/z and zoom is camera.zoom. The admin broadcasts both at
// ~10Hz; the spectator lerps toward the latest pose each frame.

export function AdminBattleMapBroadcaster({ socket, enabled }: { socket: any; enabled: boolean }) {
  const lastSent = useRef(0);

  useFrame((state) => {
    if (!enabled || !socket) return;
    const now = performance.now();
    if (now - lastSent.current < 100) return;
    lastSent.current = now;
    const cam = state.camera;
    socket.emit('streamerBattleCamera', { x: cam.position.x, z: cam.position.z, zoom: cam.zoom });
  });

  return null;
}

export function SpectatorBattleMapRig({ socket, cameraMode }: { socket: any; cameraMode: string }) {
  const latest = useRef<{ x: number; z: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!socket) return;
    const onPose = (msg: { x: number; z: number; zoom: number }) => { latest.current = msg; };
    socket.on('streamerBattleCamera', onPose);
    return () => { socket.off('streamerBattleCamera', onPose); };
  }, [socket]);

  useFrame((state, delta) => {
    if (cameraMode === 'locked' || !latest.current) return;
    const cam = state.camera;
    const k = Math.min(1, 4 * delta);
    cam.position.x = THREE.MathUtils.lerp(cam.position.x, latest.current.x, k);
    cam.position.z = THREE.MathUtils.lerp(cam.position.z, latest.current.z, k);
    cam.zoom = THREE.MathUtils.lerp(cam.zoom, latest.current.zoom, k);
    cam.updateProjectionMatrix();
    const controls = state.controls as any;
    if (controls?.target) {
      controls.target.set(cam.position.x, 0, cam.position.z);
      controls.update?.();
    }
  });

  return null;
}

// Computes a pleasant framing for an object: camera pulled back and up
// proportional to the object's size, looking at its center.
export function computeBroadcastFraming(loc: { x: number; y?: number; z: number; width: number; height: number; depth: number }) {
  const size = Math.max(loc.width, loc.height, loc.depth, 4);
  const dist = size * 6;
  const cy = (loc.y || 0) + loc.height / 2;
  return {
    pos: [loc.x + dist * 0.5, cy + dist * 0.75, loc.z + dist] as [number, number, number],
    lookAt: [loc.x, cy, loc.z] as [number, number, number],
  };
}
