const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

const cameraControllerOld = `function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { camera, controls } = useThree();
    const startTime = useRef<number | null>(null);
    const startPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const startTarget = useRef<THREE.Vector3>(new THREE.Vector3());
  
    useFrame((state) => {
      if (!target || !controls) {
          startTime.current = null;
          return;
      }
      
      if (startTime.current === null) {
          startTime.current = state.clock.elapsedTime;
          startPos.current.copy(camera.position);
          if ((controls as any).getTarget) {
               (controls as any).getTarget(startTarget.current);
          } else if ((controls as any).target) {
               startTarget.current.copy((controls as any).target);
          }
      }
  
      const duration = 2.0; // Slightly longer for more cinematic feel
      const elapsed = state.clock.elapsedTime - startTime.current;
      const progress = Math.min(1, elapsed / duration);
      
      // Smooth easing
      const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  
      const [tx, ty, tz] = target.pos;
      const size = target.size;
      const destTarget = new THREE.Vector3(tx, ty, tz);
      
      // Calculate final position
      const distance = Math.max(45, size * 3.8);
      const destPos = new THREE.Vector3(tx + distance * 0.7, ty + distance * 0.6, tz + distance * 0.7);
  
      // --- CINEMATIC ARC & PAN ---
      // 1. Linear interpolation for basic path
      const currentPos = new THREE.Vector3().lerpVectors(startPos.current, destPos, t);
      
      // 2. Add an "Arc" (Swoop up in the middle)
      const arcHeight = startPos.current.distanceTo(destPos) * 0.25;
      const swoop = Math.sin(t * Math.PI) * arcHeight;
      currentPos.y += swoop;
  
      // 3. Add a "Pan" (Horizontal curve)
      // We calculate a vector perpendicular to the movement and the up-axis
      const moveDir = new THREE.Vector3().subVectors(destPos, startPos.current).normalize();
      const panAxis = new THREE.Vector3(0, 1, 0).cross(moveDir).normalize();
      const panAmount = Math.sin(t * Math.PI) * (distance * 0.4);
      currentPos.add(panAxis.multiplyScalar(panAmount));
  
      // Apply to camera and controls
      const currentTarget = new THREE.Vector3().lerpVectors(startTarget.current, destTarget, t);
      if ((controls as any).setLookAt) {
          (controls as any).setLookAt(currentPos.x, currentPos.y, currentPos.z, currentTarget.x, currentTarget.y, currentTarget.z, false);
      } else {
          camera.position.copy(currentPos);
          (controls as any).target.lerpVectors(startTarget.current, destTarget, t);
      }
      
      (controls as any).update();
  
      if (progress >= 1) {
          onComplete();
          startTime.current = null;
      }
    });
    return null;
  }`;

const cameraControllerNew = `function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { controls } = useThree();

    useEffect(() => {
        if (!target || !controls) return;
        
        const [tx, ty, tz] = target.pos;
        
        // We calculate a sensible distance multiplier
        const boundsDist = Math.max(30, target.size * 2);
        
        const box = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(tx, ty, tz),
            new THREE.Vector3(boundsDist, boundsDist, boundsDist)
        );

        // fitToBox automatically respects window aspect ratio and perfectly centers the object.
        if (typeof (controls as any).fitToBox === 'function') {
            (controls as any).fitToBox(box, true, {
                paddingTop: 0,
                paddingLeft: 0,
                paddingBottom: 0,
                paddingRight: 0
            }).then(() => {
                onComplete();
            });
        } else {
            onComplete();
        }
    }, [target, controls]);

    return null;
}`;

if (code.includes(cameraControllerOld)) {
    code = code.replace(cameraControllerOld, cameraControllerNew);
    console.log("Patched CameraController");
} else {
    console.log("Could not find CameraController");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
