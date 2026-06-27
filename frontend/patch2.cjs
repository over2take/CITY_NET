const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Patch updates.push for fallback root
content = content.replace(
  /depth: finalD, rotation: targetObject\.rotation\.y \}\);/g,
  'depth: finalD, rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z });'
);

// Patch updates.push inside targetObject.traverse
content = content.replace(
  /rotation: eu\.y/g,
  'rotation: eu.y,\n              rotation_x: eu.x,\n              rotation_z: eu.z'
);

fs.writeFileSync('src/App.tsx', content);
console.log('patched2');

