const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/const handleGlobalPointerUp = \(\) => setIsDragging\(false\);/, "const handleGlobalPointerUp = () => { console.log('Global pointerup! Forcing isDragging=false'); setIsDragging(false); };");

code = code.replace(/const handlePointerDown = \(e: any\) => \{\s*e\.stopPropagation\(\);/g, "const handlePointerDown = (e: any) => {\n      console.log('Rhombus pointerDown!');\n      e.stopPropagation();");

code = code.replace(/const handlePointerUp = async \(e: any\) => \{\s*try/g, "const handlePointerUp = async (e: any) => {\n      console.log('Rhombus pointerUp!');\n      try");

fs.writeFileSync('src/App.tsx', code);
console.log("Added logs");
