const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const debugOverlayCode = `
const DebugOverlay = ({ isDragging, targetObject, view, editId }: any) => {
    const { camera } = useThree();
    const [debugText, setDebugText] = React.useState("");
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

code = code.replace(
    `const OverlapChecker = React.memo(({ locations, setOverlapIds }: any) => {`,
    debugOverlayCode + `\nconst OverlapChecker = React.memo(({ locations, setOverlapIds }: any) => {`
);

fs.writeFileSync('src/App.tsx', code);
console.log('Fixed DebugOverlay injection');
