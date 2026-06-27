const fs = require('fs');

function applyPatch() {
    let code = fs.readFileSync('src/App.tsx', 'utf8');

    // 1. InstancedShape fix
    code = code.replace(/tempObj\.rotation\.set\(0, el\.rotation \|\| 0, 0\);/g, 
        "tempObj.rotation.set(el.rotation_x || 0, el.rotation || 0, el.rotation_z || 0, 'YXZ');");

    // 2. Editor Gen Parts (New Structures) Fix
    const newStructRotRegex = /pos\.applyAxisAngle\(new THREE\.Vector3\(0,1,0\), targetObject\.rotation\.y\);\s*pos\.add\(targetObject\.position\);\s*return \{\s*\.\.\.editData,\s*name: isRoot \? editData\.name : `\$\{editData\.name\}_PART`,\s*description: isRoot \? editData\.description : '',\s*npcs: isRoot \? editData\.npcs : '',\s*x: pos\.x,\s*y: pos\.y,\s*z: pos\.z,\s*width: part\.shape === 'sphere' \? Math\.min\(part\.width \* targetObject\.scale\.x, part\.depth \* targetObject\.scale\.z\) : part\.width \* targetObject\.scale\.x,\s*height: part\.shape === 'sphere' \? Math\.min\(part\.width \* targetObject\.scale\.x, part\.depth \* targetObject\.scale\.z\) : part\.height \* targetObject\.scale\.y,\s*depth: part\.shape === 'sphere' \? Math\.min\(part\.width \* targetObject\.scale\.x, part\.depth \* targetObject\.scale\.z\) : part\.depth \* targetObject\.scale\.z,\s*rotation: targetObject\.rotation\.y \+ \(part\.rotation \|\| 0\),/g;
    
    const newStructRotReplace = `pos.applyEuler(new THREE.Euler(targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z, 'YXZ'));
                  pos.add(targetObject.position);
                  
                  const targetQuat = targetObject.quaternion;
                  const partQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation_x || 0, part.rotation || 0, part.rotation_z || 0, 'YXZ'));
                  const finalQuat = targetQuat.clone().multiply(partQuat);
                  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'YXZ');

                  return {
                      ...editData,
                      name: isRoot ? editData.name : \`\${editData.name}_PART\`,
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
                      rotation_z: finalEuler.z,`;

    if (code.includes('applyAxisAngle(new THREE.Vector3(0,1,0), targetObject.rotation.y)')) {
        code = code.replace(newStructRotRegex, newStructRotReplace);
    }

    // 3. Fallback for new structures
    const fallbackRegex = /rotation: targetObject\.rotation\.y \}\);/g;
    code = code.replace(fallbackRegex, "rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z });");

    const finalDataRegex = /rotation: targetObject\.rotation\.y \};/g;
    code = code.replace(finalDataRegex, "rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z };");

    // 4. updates.push for edited structures
    const updateRegex = /rotation: meshEuler\.y \}\);/g;
    code = code.replace(updateRegex, "rotation: meshEuler.y, rotation_x: meshEuler.x, rotation_z: meshEuler.z });");

    // 5. Building rendering
    const buildingRegex = /const pX = p\.x - groupPos\[0\];\s*const pZ = p\.z - groupPos\[2\];\s*return \(\s*<group key=\{p\.id\} position=\{\[pX, \(p\.y - groupPos\[1\]\) \+ \(p\.height \/ 2\), pZ\]\} scale=\{\[p\.width, p\.height, p\.depth\]\}>\s*<group rotation=\{\[0, \(p\.rotation \|\| 0\) - \(location\.rotation \|\| 0\), 0\]\}>/g;
    
    const buildingReplace = `const rootQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0, 'YXZ'));
          const rootQuatInv = rootQuat.clone().invert();
          
          const absPos = new THREE.Vector3(p.x, p.y + p.height / 2, p.z);
          const offset = absPos.sub(new THREE.Vector3(...groupPos));
          offset.applyQuaternion(rootQuatInv);
          
          const partQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation_x || 0, p.rotation || 0, p.rotation_z || 0, 'YXZ'));
          const localQuat = rootQuatInv.clone().multiply(partQuat);
          const localEuler = new THREE.Euler().setFromQuaternion(localQuat, 'YXZ');
          
          return (
            <group key={p.id} position={[offset.x, offset.y, offset.z]} scale={[p.width, p.height, p.depth]}>
              <group rotation={[localEuler.x, localEuler.y, localEuler.z]}>`;

    if (code.includes('const pX = p.x - groupPos[0]')) {
        code = code.replace(buildingRegex, buildingReplace);
    }

    const rootGroupRotRegex = /rotation=\{\[0, location\.rotation \|\| 0, 0\]\}/g;
    code = code.replace(rootGroupRotRegex, "rotation={[location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0]}");

    const rootMeshGenRotRegex = /rotation=\{\[0, b\.rotation \|\| 0, 0\]\}/g;
    code = code.replace(rootMeshGenRotRegex, "rotation={[b.rotation_x || 0, b.rotation || 0, b.rotation_z || 0]}");

    fs.writeFileSync('src/App.tsx', code);
    console.log("App.tsx patched for XYZ rotation");
}

applyPatch();
