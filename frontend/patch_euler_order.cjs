const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Building root group
const regex1 = /rotation=\{\[location\.rotation_x \|\| 0, location\.rotation \|\| 0, location\.rotation_z \|\| 0\]\}/g;
const replace1 = `rotation={new THREE.Euler(location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0, 'YXZ')}`;
code = code.replace(regex1, replace1);

// 2. Building child group
const regex2 = /rotation=\{\[localEuler\.x, localEuler\.y, localEuler\.z\]\}/g;
const replace2 = `rotation={localEuler}`;
code = code.replace(regex2, replace2);

// 3. editorGenParts mesh
const regex3 = /rotation=\{\[b\.rotation_x \|\| 0, b\.rotation \|\| 0, b\.rotation_z \|\| 0\]\}/g;
const replace3 = `rotation={new THREE.Euler(b.rotation_x || 0, b.rotation || 0, b.rotation_z || 0, 'YXZ')}`;
code = code.replace(regex3, replace3);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched Euler orders");
