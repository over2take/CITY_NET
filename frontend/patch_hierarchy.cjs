const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Combine the two <group> tags
const regex1 = /<group key=\{p\.id\} position=\{\[offset\.x, offset\.y, offset\.z\]\} scale=\{\[p\.width, p\.height, p\.depth\]\}>\s*<group rotation=\{\[localEuler\.x, localEuler\.y, localEuler\.z\]\}>/g;
const replace1 = `<group key={p.id} position={[offset.x, offset.y, offset.z]} rotation={[localEuler.x, localEuler.y, localEuler.z]} scale={[p.width, p.height, p.depth]}>`;

// 2. Remove the extra closing </group> tag
const regex2 = /depthTest=\{!isOverlapped\}\s*\/>\s*<\/mesh>\s*<\/group>\s*<\/group>\s*\);\s*\}\)\}/g;
const replace2 = `depthTest={!isOverlapped}
                  />
                </mesh>
              </group>
          );
        })}`;

if (code.match(regex1) && code.match(regex2)) {
    code = code.replace(regex1, replace1);
    code = code.replace(regex2, replace2);
    fs.writeFileSync('src/App.tsx', code);
    console.log("Patched Building group hierarchy correctly!");
} else {
    console.log("Regex did not match!");
    console.log("regex1:", !!code.match(regex1));
    console.log("regex2:", !!code.match(regex2));
}
