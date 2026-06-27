const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Normalize line endings
code = code.replace(/\r\n/g, '\n');

const globalTabOld = `onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); }}`;
const globalTabNew = `onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); setUnreadTabs(prev => { const next = new Set(prev); next.delete('GLOBAL'); return next; }); }}`;

if (code.includes(globalTabOld)) {
    code = code.replace(globalTabOld, globalTabNew);
    console.log("Patched GLOBAL tab onClick");
} else {
    console.log("Could not find globalTabOld");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
