import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

const PAN_SPEED = 0.4;
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0,  1], ArrowDown: [0,  1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1,  0], ArrowRight: [1,  0],
};

export function KeyboardPan({ active }: { active: boolean }) {
  const { controls } = useThree();
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active) { keys.current.clear(); return; }
    const down = (e: KeyboardEvent) => { if (PAN_KEYS[e.code]) { e.preventDefault(); keys.current.add(e.code); } };
    const up   = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); keys.current.clear(); };
  }, [active]);

  useFrame(() => {
    if (!active || !controls || keys.current.size === 0) return;
    let dx = 0, dy = 0;
    keys.current.forEach(code => { const d = PAN_KEYS[code]; if (d) { dx += d[0]; dy += d[1]; } });
    if (dx !== 0 || dy !== 0) (controls as any).truck(dx * PAN_SPEED, dy * PAN_SPEED, true);
  });

  return null;
}

export const GlobalCameraCapture = () => {
  const { camera } = useThree();
  useEffect(() => {
    (window as any).globalCamera = camera;
  }, [camera]);
  return null;
};

export function CursorPivotControls() {
  const { camera, controls, raycaster, pointer, scene } = useThree();

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      // Rotate on left or right click
      if ((e.button === 0 || e.button === 2) && controls && (controls as any).setOrbitPoint) {
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = -(e.clientY / window.innerHeight) * 2 + 1;
        const mouse = new THREE.Vector2(x, y);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        if (intersects.length > 0) {
          const point = intersects[0].point;
          (controls as any).setOrbitPoint(point.x, point.y, point.z);
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [camera, pointer, raycaster, scene, controls]);

  return null;
}

export function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { camera, controls, size } = useThree();
    const startTime = useRef<number | null>(null);
    const initialPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const initialTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const destPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const moveDir = useRef<THREE.Vector3>(new THREE.Vector3());
    const panAxis = useRef<THREE.Vector3>(new THREE.Vector3());
    const upVec = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

    useEffect(() => {
        isSetup.current = false;
        startTime.current = null;
    }, [target]);

    useFrame((state) => {
        if (!target || !controls || !(camera as any).fov) return;
        
        if (!isSetup.current) {
            isSetup.current = true;
            startTime.current = state.clock.elapsedTime;
            
            // 1. Store initial state
            initialPos.current.copy(camera.position);
            if (typeof (controls as any).getTarget === 'function') {
                (controls as any).getTarget(initialTarget.current);
            } else if ((controls as any).target) {
                initialTarget.current.copy((controls as any).target);
            }

            // 2. Compute exact mathematical framing distance
            const [tx, ty, tz] = target.pos;
            destTarget.current.set(tx, ty, tz);
            
            // Radius of the object's bounding sphere
            const radius = Math.max(15, target.size * 1.5);
            
            // Calculate distance needed to fit radius in FOV
            const fov = (camera as any).fov * (Math.PI / 180);
            const aspect = size.width / size.height;
            let fitDistance = radius / Math.sin(fov / 2);
            
            // If window is tall and narrow, increase distance to prevent cropping sides
            if (aspect < 1) {
                fitDistance = fitDistance / aspect;
            }

            // 3. Force 45-degree up and 45-degree right angle (Isometric)
            // x: right, y: up, z: toward viewer
            const isoDir = new THREE.Vector3(0.5, 0.7071, 0.5).normalize();
            
            // Dest position is exactly the target center + offset direction * fitDistance
            destPos.current.copy(destTarget.current).add(isoDir.multiplyScalar(fitDistance));

            distanceRef.current = initialPos.current.distanceTo(destPos.current);
        }

        if (startTime.current === null) return;

        const duration = 2.0; 
        const elapsed = state.clock.elapsedTime - startTime.current;
        const progress = Math.min(1, elapsed / duration);
        
        // Smooth easing
        const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // 1. Linear interpolation for basic path
        currentPos.current.lerpVectors(initialPos.current, destPos.current, t);
        
        // 2. Add an "Arc" (Swoop up in the middle)
        const arcHeight = distanceRef.current * 0.25;
        const swoop = Math.sin(t * Math.PI) * arcHeight;
        currentPos.current.y += swoop;

        // 3. Add a "Pan" (Horizontal curve)
        moveDir.current.subVectors(destPos.current, initialPos.current).normalize();
        if (moveDir.current.lengthSq() > 0.001) {
            panAxis.current.copy(upVec.current).cross(moveDir.current).normalize();
            const panAmount = Math.sin(t * Math.PI) * (distanceRef.current * 0.4);
            currentPos.current.add(panAxis.current.multiplyScalar(panAmount));
        }

        // Apply to camera and controls
        currentTarget.current.lerpVectors(initialTarget.current, destTarget.current, t);
        
        if (typeof (controls as any).setLookAt === 'function') {
            (controls as any).setLookAt(
                currentPos.current.x, currentPos.current.y, currentPos.current.z, 
                currentTarget.current.x, currentTarget.current.y, currentTarget.current.z, 
                false
            );
        } else {
            camera.position.copy(currentPos.current);
            camera.lookAt(currentTarget.current);
            if ((controls as any).target) (controls as any).target.copy(currentTarget.current);
        }
        
        // Force sync controls to prevent internal tweening conflicts
        (controls as any).update(0);

        if (progress >= 1) {
            isSetup.current = false;
            startTime.current = null;
            onComplete();
        }
    });

    return null;
  }
