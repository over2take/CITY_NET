const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/console\.log\('Rhombus pointerDown!'\);\s*/g, '');
code = code.replace(/console\.log\('Rhombus pointerUp!'\);\s*/g, '');
code = code.replace(/console\.log\('Global pointerup! Forcing isDragging=false'\);\s*/g, '');

fs.writeFileSync('src/App.tsx', code);
console.log("Removed logs");
