const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

const searchStr = `              // 2. Compute the exact framing box
              const [tx, ty, tz] = target.pos;
              const boundsDist = Math.max(30, target.size * 2);
              const box = new THREE.Box3().setFromCenterAndSize(
                  new THREE.Vector3(tx, ty, tz),
                  new THREE.Vector3(boundsDist, boundsDist, boundsDist)
              );
  
              // 3. Temporarily jump to the ideal framed position`;

const replacementStr = `              // 2. Compute the exact framing box
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
  
              // 3. Temporarily jump to the ideal framed position`;

if (code.includes(searchStr)) {
    code = code.replace(searchStr, replacementStr);
    console.log("Patched CameraController with forced angle");
} else {
    console.log("Could not find the exact target string");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
