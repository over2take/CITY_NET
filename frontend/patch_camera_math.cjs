const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(/\r\n/g, '\n');

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

if (startIndex === -1 || endIndex < startIndex) {
    console.error("Could not find CameraController bounds");
    process.exit(1);
}

const cameraControllerNew = `function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { camera, controls, size } = useThree();
    const startTime = useRef<number | null>(null);
    const initialPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const initialTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const destPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

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
            camera.lookAt(currentTarget);
            if ((controls as any).target) (controls as any).target.copy(currentTarget);
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
  }`;

code = code.substring(0, startIndex) + cameraControllerNew + code.substring(endIndex);

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
console.log('Math patch complete');
