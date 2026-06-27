const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const badRaycast = /raycast=\{isDragging \? \(\) => null : undefined\}/g;
code = code.replace(badRaycast, '');

fs.writeFileSync('src/App.tsx', code);
console.log("Removed broken raycast prop mutation");
