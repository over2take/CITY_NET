const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    /\/\/ 2\.5 Force camera to an "up and to the right" viewing angle before framing[\s\S]*?\/\/ 3\. Temporarily jump to the ideal framed position/,
    `// 2.5 Force camera to an "up and to the right" viewing angle before framing
                if (typeof (controls as any).rotateTo === 'function') {
                    (controls as any).setTarget(tx, ty, tz, false);
                    (controls as any).rotateTo(Math.PI / 4, Math.PI / 3, false);
                    (controls as any).update(0);
                } else {
                    const centerTarget = new THREE.Vector3(tx, ty, tz);
                    const offset = new THREE.Vector3(1, 1.2, 1.5).normalize().multiplyScalar(boundsDist * 2);
                    camera.position.copy(centerTarget).add(offset);
                    camera.lookAt(centerTarget);
                }
  
                // 3. Temporarily jump to the ideal framed position`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Regex patch complete');
