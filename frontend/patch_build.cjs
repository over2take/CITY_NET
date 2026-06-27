const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const searchStr = `if (res.ok) { setIsDragging(false); setAdminAlert("LOCATION_UPLOADED");`;
const replaceStr = `if (res.ok) { setAdminAlert("LOCATION_UPLOADED");`;
code = code.split(searchStr).join(replaceStr);

const searchStr2 = `if (res.ok) { setIsDragging(false); setAdminAlert("LOCATION_UPDATED");`;
const replaceStr2 = `if (res.ok) { setAdminAlert("LOCATION_UPDATED");`;
code = code.split(searchStr2).join(replaceStr2);

fs.writeFileSync('src/App.tsx', code);
console.log('Fixed setIsDragging error');
