const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\r\n/g, '\n');

// 1. Add DebugOverlay to App.tsx
const debugOverlayCode = `
const DebugOverlay = ({ isDragging, targetObject, view, editId }: any) => {
    const { camera } = useThree();
    const [debugText, setDebugText] = useState("");
    useFrame(() => {
        setDebugText(
            \`isDragging: \${isDragging}\\n\` +
            \`targetObject: \${!!targetObject}\\n\` +
            \`view: \${view}\\n\` +
            \`editId: \${editId}\\n\` +
            \`cameraPos: \${camera.position.x.toFixed(2)}, \${camera.position.y.toFixed(2)}, \${camera.position.z.toFixed(2)}\\n\` +
            \`cameraNaN: \${isNaN(camera.position.x) || isNaN(camera.position.y) || isNaN(camera.position.z)}\\n\`
        );
    });
    return (
        <Html position={[-100, 100, 0]} style={{ pointerEvents: 'none', background: 'rgba(0,0,0,0.8)', color: '#0f0', padding: '10px', whiteSpace: 'pre', fontFamily: 'monospace', zIndex: 9999 }}>
            {debugText}
        </Html>
    );
};
`;

if (!code.includes('DebugOverlay')) {
    code = code.replace(
        `import { useThree, useFrame, Canvas, extend } from '@react-three/fiber';`,
        `import { useThree, useFrame, Canvas, extend } from '@react-three/fiber';\nimport { Html } from '@react-three/drei';`
    );
    
    code = code.replace(
        `const OverlapChecker = ({ locations, setOverlapIds }: any) => {`,
        debugOverlayCode + `\nconst OverlapChecker = ({ locations, setOverlapIds }: any) => {`
    );
    
    // 2. Add it to Canvas
    const canvasSearch = `<OverlapChecker locations={locations} setOverlapIds={setOverlapIds} />`;
    const canvasReplace = `<OverlapChecker locations={locations} setOverlapIds={setOverlapIds} />\n              <DebugOverlay isDragging={isDragging} targetObject={targetObject} view={view} editId={editId} />`;
    code = code.split(canvasSearch).join(canvasReplace);
    console.log("Added DebugOverlay");
}

code = code.replace(/\n/g, '\r\n');
fs.writeFileSync('src/App.tsx', code);
