const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /rotation: p\.rotation,\s*district_color: p\.district_color/g;
const replace = `rotation: p.rotation,
              rotation_x: p.rotation_x,
              rotation_z: p.rotation_z,
              district_color: p.district_color`;

if (code.match(regex)) {
    code = code.replace(regex, replace);
    fs.writeFileSync('src/App.tsx', code);
    console.log("Patched pushSimple for rotation_x/z");
} else {
    console.log("Regex did not match");
}
