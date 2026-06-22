const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/  const handlePointerUp = async \(e: any\) => \{\s*if \(controls\)/g, `  const handlePointerUp = async (e: any) => {\n    try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}\n    if (controls)`);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched successfully");
