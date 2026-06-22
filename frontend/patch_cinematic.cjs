const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

// 1. Rewrite CameraController
const startIndex = code.indexOf('function CameraController');
const endString = 'return null;\n}';
let endIndex = code.indexOf(endString, startIndex);
if (endIndex === -1) {
    const altEndString = 'return null;\n  }';
    endIndex = code.indexOf(altEndString, startIndex);
    if (endIndex !== -1) endIndex += altEndString.length;
} else {
    endIndex += endString.length;
}

const cameraControllerNew = `function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { camera, controls } = useThree();
    const startTime = useRef<number | null>(null);
    const initialPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const initialTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const destPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

    useFrame((state) => {
        if (!target || !controls) return;
        
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

            // 2. Compute the exact framing box
            const [tx, ty, tz] = target.pos;
            const boundsDist = Math.max(30, target.size * 2);
            const box = new THREE.Box3().setFromCenterAndSize(
                new THREE.Vector3(tx, ty, tz),
                new THREE.Vector3(boundsDist, boundsDist, boundsDist)
            );

            // 3. Temporarily jump to the ideal framed position
            if (typeof (controls as any).fitToBox === 'function') {
                (controls as any).fitToBox(box, false);
                (controls as any).update(0); // Force sync
            }
            
            // 4. Capture the mathematically perfect destination!
            destPos.current.copy(camera.position);
            if (typeof (controls as any).getTarget === 'function') {
                (controls as any).getTarget(destTarget.current);
            } else if ((controls as any).target) {
                destTarget.current.copy((controls as any).target);
            }

            distanceRef.current = initialPos.current.distanceTo(destPos.current);

            // 5. Instantly revert camera back to start position
            if (typeof (controls as any).setLookAt === 'function') {
                (controls as any).setLookAt(
                    initialPos.current.x, initialPos.current.y, initialPos.current.z,
                    initialTarget.current.x, initialTarget.current.y, initialTarget.current.z,
                    false
                );
            } else {
                camera.position.copy(initialPos.current);
                if ((controls as any).target) (controls as any).target.copy(initialTarget.current);
            }
            (controls as any).update(0);
        }

        if (startTime.current === null) return;

        const duration = 2.0; 
        const elapsed = state.clock.elapsedTime - startTime.current;
        const progress = Math.min(1, elapsed / duration);
        
        // Smooth easing
        const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // 1. Linear interpolation for basic path
        const currentPos = new THREE.Vector3().lerpVectors(initialPos.current, destPos.current, t);
        
        // 2. Add an "Arc" (Swoop up in the middle)
        const arcHeight = distanceRef.current * 0.25;
        const swoop = Math.sin(t * Math.PI) * arcHeight;
        currentPos.y += swoop;

        // 3. Add a "Pan" (Horizontal curve)
        const moveDir = new THREE.Vector3().subVectors(destPos.current, initialPos.current).normalize();
        if (moveDir.lengthSq() > 0.001) {
            const panAxis = new THREE.Vector3(0, 1, 0).cross(moveDir).normalize();
            const panAmount = Math.sin(t * Math.PI) * (distanceRef.current * 0.4);
            currentPos.add(panAxis.multiplyScalar(panAmount));
        }

        // Apply to camera and controls
        const currentTarget = new THREE.Vector3().lerpVectors(initialTarget.current, destTarget.current, t);
        
        if (typeof (controls as any).setLookAt === 'function') {
            (controls as any).setLookAt(
                currentPos.x, currentPos.y, currentPos.z, 
                currentTarget.x, currentTarget.y, currentTarget.z, 
                false
            );
        } else {
            camera.position.copy(currentPos);
            if ((controls as any).target) (controls as any).target.copy(currentTarget);
        }
        
        // update(0) avoids internal tweening from overriding our manual frame updates
        (controls as any).update(0);

        if (progress >= 1) {
            isSetup.current = false;
            startTime.current = null;
            onComplete();
        }
    });

    return null;
  }`;

code = code.substring(0, startIndex) + cameraControllerNew + code.substring(endIndex);


// 2. Update Zoom buttons
// We'll use regex to update the styling of the [Z] buttons
code = code.replace(
    /padding: '0 4px', fontSize: '0.6rem'/g,
    "padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer'"
);
code = code.replace(/>\[Z\]<\/button>/g, ">ZOOM</button>");

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
console.log('Restored Cinematic CameraController and updated zoom buttons.');
