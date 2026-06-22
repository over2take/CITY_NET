const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex1 = /const worldPos = new THREE\.Vector3\(\); mesh\.getWorldPosition\(worldPos\);\s*mesh\.getWorldScale\(worldScale\);/g;
const replace1 = `const worldPos = new THREE.Vector3(); mesh.getWorldPosition(worldPos);
          mesh.getWorldScale(worldScale);
          const meshWorldQuat = new THREE.Quaternion();
          mesh.getWorldQuaternion(meshWorldQuat);
          const meshEuler = new THREE.Euler().setFromQuaternion(meshWorldQuat, 'YXZ');`;
code = code.replace(regex1, replace1);

const regex2 = /updates\.push\(\{ \.\.\.mergedData, x: worldPos\.x, y: worldPos\.y - \(h \/ 2\), z: worldPos\.z, width: w, height: h, depth: d, rotation: euler\.y \}\);/g;
const replace2 = `updates.push({ ...mergedData, x: worldPos.x, y: worldPos.y - (h / 2), z: worldPos.z, width: w, height: h, depth: d, rotation: meshEuler.y });`;
code = code.replace(regex2, replace2);

fs.writeFileSync('src/App.tsx', code);
console.log("Fixed rotation saving bug");
