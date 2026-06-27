const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add snapRotation state
code = code.replace(
  /const \[snapToGrid, setSnapToGrid\] = useState\(false\);/g,
  'const [snapToGrid, setSnapToGrid] = useState(false);\n    const [snapRotation, setSnapRotation] = useState(false);'
);

// 2. Pass snapRotation to DistrictInteractions
code = code.replace(
  /snapToGrid, setSnapToGrid,/g,
  'snapToGrid, setSnapToGrid, snapRotation, setSnapRotation,'
);

// 3. AdminPanel props and button
code = code.replace(
  /snapToGrid=\{snapToGrid\} setSnapToGrid=\{setSnapToGrid\}/g,
  'snapToGrid={snapToGrid} setSnapToGrid={setSnapToGrid} snapRotation={snapRotation} setSnapRotation={setSnapRotation}'
);
code = code.replace(
  /const \[snapToGrid, setSnapToGrid\] = useState\(true\);/g,
  'const [snapToGrid, setSnapToGrid] = useState(true);\n  const [snapRotation, setSnapRotation] = useState(false);'
);
// Careful with button replacement
code = code.replace(
  /<button type=\x22button\x22 className=\{\utility-btn \$\{snapToGrid \? 'active' : ''\}\\} onClick=\{\(\) => setSnapToGrid\(!snapToGrid\)\} style=\{\{flex: 1, fontSize: '0.7rem'\}\}>\{snapToGrid \? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'\}<\/button>/g,
  '<button type=\x22button\x22 className={utility-btn } onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: \x220.7rem\x22}}>{snapToGrid ? \x22GRID_SNAP: ON\x22 : \x22GRID_SNAP: OFF\x22}</button>\n                <button type=\x22button\x22 className={utility-btn } onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1, fontSize: \x220.7rem\x22}}>{snapRotation ? \x22ROT_SNAP: ON\x22 : \x22ROT_SNAP: OFF\x22}</button>'
);
code = code.replace(
  /<button className=\{\utility-btn \$\{snapToGrid \? 'active' : ''\}\\} onClick=\{\(\) => setSnapToGrid\(!snapToGrid\)\} style=\{\{flex: 1\}\}>\{snapToGrid \? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'\}<\/button>/g,
  '<button className={utility-btn } onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1}}>{snapToGrid ? \x22GRID_SNAP: ON\x22 : \x22GRID_SNAP: OFF\x22}</button>\n                <button className={utility-btn } onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1}}>{snapRotation ? \x22ROT_SNAP: ON\x22 : \x22ROT_SNAP: OFF\x22}</button>'
);

// 4. TransformControls rotationSnap
code = code.replace(
  /translationSnap=\{snapToGrid \? 1 : null\}/g,
  'translationSnap={snapToGrid ? 1 : null} rotationSnap={snapRotation ? Math.PI / 18 : null}'
);

// 5. editorGenParts map math
code = code.replace(
  /pos\.applyAxisAngle\(new THREE\.Vector3\(0,1,0\), targetObject\.rotation\.y\);\n\s*pos\.add\(targetObject\.position\);\n\n\s*return \{\n\s*\.\.\.editData,\n\s*name: isRoot \? editData\.name : \\$\{editData\.name\}_PART\,\n\s*description: isRoot \? editData\.description : '',\n\s*npcs: isRoot \? editData\.npcs : '',\n\s*x: pos\.x,\n\s*y: pos\.y,\n\s*z: pos\.z,\n\s*width: .*?,\n\s*height: .*?,\n\s*depth: .*?,\n\s*rotation: targetObject\.rotation\.y \+ \(part\.rotation \|\| 0\),/g,
  'pos.applyEuler(targetObject.rotation);\n                  pos.add(targetObject.position);\n\n                  const childQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation_x || 0, part.rotation || 0, part.rotation_z || 0));\n                  const finalQuat = targetObject.quaternion.clone().multiply(childQuat);\n                  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat);\n\n                  return {\n                      ...editData,\n                      name: isRoot ? editData.name : ${editData.name}_PART,\n                      description: isRoot ? editData.description : \\x27\\x27,\n                      npcs: isRoot ? editData.npcs : \\x27\\x27,\n                      x: pos.x,\n                      y: pos.y,\n                      z: pos.z,\n                      width: part.shape === \\x27sphere\\x27 ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.width * targetObject.scale.x,\n                      height: part.shape === \\x27sphere\\x27 ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.height * targetObject.scale.y,\n                      depth: part.shape === \\x27sphere\\x27 ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.depth * targetObject.scale.z,\n                      rotation: finalEuler.y,\n                      rotation_x: finalEuler.x,\n                      rotation_z: finalEuler.z,'
);

fs.writeFileSync('src/App.tsx', code);
console.log('patched3 done');

