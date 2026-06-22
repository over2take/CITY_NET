const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(/\r\n/g, '\n');

const startIndex = code.indexOf('function CameraController');
const endString = 'return null;\n}';
let endIndex = code.indexOf(endString, startIndex);
if (endIndex === -1) {
    // try different indentation
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
  }`;

code = code.substring(0, startIndex) + cameraControllerNew + code.substring(endIndex);

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
console.log('Sliced patch complete');
