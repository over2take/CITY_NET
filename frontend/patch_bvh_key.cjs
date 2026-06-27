const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const badBvh = `<Bvh>`;
const goodBvh = `<Bvh key={elements.length}>`;

// We only want to replace the <Bvh> inside InstancedShape.
// Let's locate it by finding the specific block.
const blockToFind = `            <Bvh>
              <instancedMesh 
                  ref={hitMeshRef} `;

const blockToReplace = `            <Bvh key={elements.length}>
              <instancedMesh 
                  ref={hitMeshRef} `;

if (code.includes(blockToFind)) {
    code = code.replace(blockToFind, blockToReplace);
    fs.writeFileSync('src/App.tsx', code);
    console.log("Patched Bvh with key=elements.length");
} else {
    console.log("Could not find block");
}
