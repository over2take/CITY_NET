const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<group key=\{p\.id\} position=\{\[offset\.x, offset\.y, offset\.z\]\} scale=\{\[p\.width, p\.height, p\.depth\]\}>\s*<group rotation=\{\[localEuler\.x, localEuler\.y, localEuler\.z\]\}>/g;
const replace = `<group key={p.id} position={[offset.x, offset.y, offset.z]} rotation={[localEuler.x, localEuler.y, localEuler.z]} scale={[p.width, p.height, p.depth]}>`;

if (code.match(regex)) {
    code = code.replace(regex, replace);

    // Now remove the extra </group> 
    // We will search for the specific structure of the mesh and remove the extra </group> after it.
    
    const endGroupRegex = /\{\/\* Decorative Frame \*\/\}\s*\{isSelected && \(\s*<mesh>\s*<boxGeometry \/>\s*<meshBasicMaterial color="white" wireframe \/>\s*<\/mesh>\s*\)\}\s*<\/group>\s*<\/group>/g;
    
    const endGroupReplace = `{/* Decorative Frame */}
                  {isSelected && (
                    <mesh>
                      <boxGeometry />
                      <meshBasicMaterial color="white" wireframe />
                    </mesh>
                  )}
              </group>`;
              
    code = code.replace(endGroupRegex, endGroupReplace);

    fs.writeFileSync('src/App.tsx', code);
    console.log("Patched Building group hierarchy");
} else {
    console.log("Regex did not match");
}
