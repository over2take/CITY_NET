const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Fix EnemyRhombus localPos and visualPos
const enemyRhombusMatch = code.indexOf('const EnemyRhombus =');
const appMatch = code.indexOf('function App() {');

if (enemyRhombusMatch !== -1 && appMatch !== -1) {
    let enemyRhombusCode = code.substring(enemyRhombusMatch, appMatch);
    
    // Replace broken localPos in EnemyRhombus
    enemyRhombusCode = enemyRhombusCode.replace(
        /const localPos = useRef\(\{ x: isBattleMap && battleMapPos \? battleMapPos\.x : location\.x, z: isBattleMap && battleMapPos \? battleMapPos\.z : location\.z \}\);/,
        `const localPos = useRef({ x: location.x, z: location.z });`
    );

    // Replace broken useEffect in EnemyRhombus
    enemyRhombusCode = enemyRhombusCode.replace(
        `useEffect(() => {
    if (isBattleMap && battleMapPos) {
      localPos.current = { x: battleMapPos.x, z: battleMapPos.z };
    } else if (!isBattleMap) {
      localPos.current = { x: location.x, z: location.z };
    }
  }, [location.x, location.z, isBattleMap, battleMapPos]);`,
        `useEffect(() => {
    localPos.current = { x: location.x, z: location.z };
  }, [location.x, location.z]);`
    );

    // Replace broken socket emit in EnemyRhombus
    enemyRhombusCode = enemyRhombusCode.replace(
        `} else if (isAdmin) {
          if (isBattleMap) {
            socket.emit('battle_map_move', { userName: location.owner, x: localPos.current.x, z: localPos.current.z });
          } else {
            socket.emit('moveRhombus', { id: location.id, x: localPos.current.x, z: localPos.current.z });
          }
      }`,
        `} else if (isAdmin) {
          socket.emit('moveRhombus', { id: location.id, x: localPos.current.x, z: localPos.current.z });
      }`
    );

    code = code.substring(0, enemyRhombusMatch) + enemyRhombusCode + code.substring(appMatch);
}

// 2. Fix remaining isTemporaryAdmin
code = code.replace(/!isTemporaryAdmin/g, 'isPrimaryAdmin');
code = code.replace(/isTemporaryAdmin/g, '!isPrimaryAdmin'); // fallback just in case

// 3. Fix Html missing
if (code.indexOf("import { Html,") === -1 && code.indexOf(", Html") === -1) {
  code = code.replace(
    "import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh } from '@react-three/drei';",
    "import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh, Html, OrthographicCamera } from '@react-three/drei';"
  );
}

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx errors fixed.');
