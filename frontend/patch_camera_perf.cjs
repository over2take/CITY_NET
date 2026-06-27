const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(/\r\n/g, '\n');

const searchStr = `    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

    useFrame((state) => {`;

const replacementStr = `    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const moveDir = useRef<THREE.Vector3>(new THREE.Vector3());
    const panAxis = useRef<THREE.Vector3>(new THREE.Vector3());
    const upVec = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

    useFrame((state) => {`;

code = code.replace(searchStr, replacementStr);

const logicSearchStr = `        // 1. Linear interpolation for basic path
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
        }`;

const logicReplacementStr = `        // 1. Linear interpolation for basic path
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
        }`;

code = code.replace(logicSearchStr, logicReplacementStr);

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
console.log('Optimized CameraController performance');
