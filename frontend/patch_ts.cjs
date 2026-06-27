const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/wireframeMeshRef\.current\.setMatrixAt/g, "wireframeMeshRef.current!.setMatrixAt");
code = code.replace(/fillMeshRef\.current\.setMatrixAt/g, "fillMeshRef.current!.setMatrixAt");
code = code.replace(/hitMeshRef\.current\.setMatrixAt/g, "hitMeshRef.current!.setMatrixAt");

code = code.replace(/wireframeMeshRef\.current\.setColorAt/g, "wireframeMeshRef.current!.setColorAt");
code = code.replace(/fillMeshRef\.current\.setColorAt/g, "fillMeshRef.current!.setColorAt");

code = code.replace(/wireframeMeshRef\.current\.instanceMatrix/g, "wireframeMeshRef.current!.instanceMatrix");
code = code.replace(/wireframeMeshRef\.current\.instanceColor/g, "wireframeMeshRef.current!.instanceColor");

code = code.replace(/fillMeshRef\.current\.instanceMatrix/g, "fillMeshRef.current!.instanceMatrix");
code = code.replace(/fillMeshRef\.current\.instanceColor/g, "fillMeshRef.current!.instanceColor");

code = code.replace(/hitMeshRef\.current\.instanceMatrix/g, "hitMeshRef.current!.instanceMatrix");
code = code.replace(/hitMeshRef\.current\.computeBoundingBox/g, "hitMeshRef.current!.computeBoundingBox");
code = code.replace(/hitMeshRef\.current\.computeBoundingSphere/g, "hitMeshRef.current!.computeBoundingSphere");

fs.writeFileSync('src/App.tsx', code);
console.log("Fixed typescript non-null assertions");
