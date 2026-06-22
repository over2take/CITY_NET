const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regexPlane = /\{isLocalDragging && \(\s*<mesh\s*rotation=\{\[-Math\.PI \/ 2, 0, 0\]\}\s*position=\{\[0, -visualPos\.current\.y, 0\]\}\s*scale=\{\[10000, 10000, 1\]\}\s*onPointerMove=\{handlePointerMove\}\s*onPointerUp=\{handlePointerUp\}\s*>\s*<planeGeometry \/>\s*<meshBasicMaterial visible=\{false\} \/>\s*<\/mesh>\s*\)\}/g;

code = code.replace(regexPlane, '');

fs.writeFileSync('src/App.tsx', code);
console.log("Deleted infinite planes");
