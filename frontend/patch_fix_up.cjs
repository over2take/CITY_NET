const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(`    const handlePointerUp = async (e: any) => {
        try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
        mouseScreenPos.current = null;`, `    const handleMouseUp = () => {
        mouseScreenPos.current = null;`);

const badUp = `  const handlePointerUp = async (e: any) => {
  
      if (controls) (controls as any).enabled = true;`;

const goodUp = `  const handlePointerUp = async (e: any) => {
    try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
      if (controls) (controls as any).enabled = true;`;

code = code.split(badUp).join(goodUp);

fs.writeFileSync('src/App.tsx', code);
console.log("Fixed releasePointerCapture");
