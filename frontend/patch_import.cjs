const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
    `import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh } from '@react-three/drei';`,
    `import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh, Html } from '@react-three/drei';`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Fixed Html import');
