const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    /function CameraController\(\{ target, onComplete \}: \{ target: \{ pos: \[number, number, number\], size: number \} \| null, onComplete: \(\) => void \}\) \{[\s\S]*?    return null;\s*\}/,
    `function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
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
    }, [target, controls, onComplete]);

    return null;
}`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Regex patch complete');
