const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = \pos.applyAxisAngle(new THREE.Vector3(0,1,0), targetObject.rotation.y);
                  pos.add(targetObject.position);

                  return {
                      ...editData,
                      name: isRoot ? editData.name : \\\\\\_PART\\\,
                      description: isRoot ? editData.description : '',
                      npcs: isRoot ? editData.npcs : '',
                      x: pos.x,
                      y: pos.y,
                      z: pos.z,
                      width: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.width * targetObject.scale.x,
                      height: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.height * targetObject.scale.y,
                      depth: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.depth * targetObject.scale.z,
                      rotation: targetObject.rotation.y + (part.rotation || 0),\;

const replacement = \pos.applyEuler(targetObject.rotation);
                  pos.add(targetObject.position);

                  const childQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation_x || 0, part.rotation || 0, part.rotation_z || 0));
                  const finalQuat = targetObject.quaternion.clone().multiply(childQuat);
                  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat);

                  return {
                      ...editData,
                      name: isRoot ? editData.name : \\\\\\_PART\\\,
                      description: isRoot ? editData.description : '',
                      npcs: isRoot ? editData.npcs : '',
                      x: pos.x,
                      y: pos.y,
                      z: pos.z,
                      width: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.width * targetObject.scale.x,
                      height: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.height * targetObject.scale.y,
                      depth: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.depth * targetObject.scale.z,
                      rotation: finalEuler.y,
                      rotation_x: finalEuler.x,
                      rotation_z: finalEuler.z,\;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/App.tsx', code);
    console.log('patched4 success');
} else {
    console.log('target not found!');
}

