const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

const searchStr = `              if (typeof (controls as any).setLookAt === 'function') {
                  (controls as any).setLookAt(camera.position.x, camera.position.y, camera.position.z, tx, ty, tz, false);
              } else {
                  camera.lookAt(centerTarget);
              }
  
              // 3. Temporarily jump to the ideal framed position`;

const replacementStr = `              if (typeof (controls as any).setLookAt === 'function') {
                  (controls as any).setLookAt(camera.position.x, camera.position.y, camera.position.z, tx, ty, tz, false);
                  (controls as any).update(0); // MUST FORCE SYNC SO FITTOBOX KNOWS THE NEW ANGLE!
              } else {
                  camera.lookAt(centerTarget);
              }
  
              // 3. Temporarily jump to the ideal framed position`;

if (code.includes(searchStr)) {
    code = code.replace(searchStr, replacementStr);
    console.log("Patched CameraController with update(0)");
} else {
    console.log("Could not find the exact target string");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
