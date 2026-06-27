const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    /\(controls as any\)\.setLookAt\(camera\.position\.x, camera\.position\.y, camera\.position\.z, tx, ty, tz, false\);/g,
    "(controls as any).setLookAt(camera.position.x, camera.position.y, camera.position.z, tx, ty, tz, false);\n                  (controls as any).update(0);"
);

fs.writeFileSync('src/App.tsx', code);
console.log('Regex patch complete');
