const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    /\/\/ 2\. Compute the exact framing box[\s\S]*?\/\/ 3\. Temporarily jump to the ideal framed position/,
    `// 2. Compute the exact framing box
              const [tx, ty, tz] = target.pos;
              const boundsDist = Math.max(30, target.size * 2);
              const box = new THREE.Box3().setFromCenterAndSize(
                  new THREE.Vector3(tx, ty, tz),
                  new THREE.Vector3(boundsDist, boundsDist, boundsDist)
              );

              // 2.5 Force camera to an "up and to the right" viewing angle before framing
              const centerTarget = new THREE.Vector3(tx, ty, tz);
              // Offset vector: right (+X), up (+Y), backward (+Z)
              const offset = new THREE.Vector3(1, 1.2, 1.5).normalize().multiplyScalar(boundsDist * 2);
              camera.position.copy(centerTarget).add(offset);
              if (typeof (controls as any).setLookAt === 'function') {
                  (controls as any).setLookAt(camera.position.x, camera.position.y, camera.position.z, tx, ty, tz, false);
              } else {
                  camera.lookAt(centerTarget);
              }

              // 3. Temporarily jump to the ideal framed position`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Regex patch complete');
