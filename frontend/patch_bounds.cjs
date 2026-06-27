const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `hitMeshRef.current.instanceMatrix.needsUpdate = true;
        hitMeshRef.current.computeBoundingBox();
        hitMeshRef.current.computeBoundingSphere();`;

const replacementStr = `hitMeshRef.current.instanceMatrix.needsUpdate = true;
        if (hitMeshRef.current.geometry) {
            hitMeshRef.current.geometry.computeBoundingBox();
            hitMeshRef.current.geometry.computeBoundingSphere();
        }
        hitMeshRef.current.computeBoundingBox();
        hitMeshRef.current.computeBoundingSphere();`;

code = code.replace(targetStr, replacementStr);
fs.writeFileSync('src/App.tsx', code);
console.log("Patch applied.");
