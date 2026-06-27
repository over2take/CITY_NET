const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regexInstancedShape = /const InstancedShape = React\.memo\(\(\s*\{\s*shape,\s*polyCount,\s*elements,\s*onSelect,\s*isDragging\s*\}.*?return \(\s*<group>.*?<\/group>\s*\);\s*\}\);/s;

const goodInstancedShape = `const InstancedShape = React.memo(({ shape, polyCount, elements, onSelect, isDragging }: { shape: string, polyCount: number, elements: any[], onSelect: (rootLoc: any) => void, isDragging?: boolean }) => {
    const wireframeMeshRef = useRef<THREE.InstancedMesh>(null);
    const fillMeshRef = useRef<THREE.InstancedMesh>(null);
    const hitMeshRef = useRef<THREE.InstancedMesh>(null);
    const tempObj = new THREE.Object3D();

    useEffect(() => {
        if (!wireframeMeshRef.current || !hitMeshRef.current || !fillMeshRef.current) return;
        elements.forEach((el, i) => {
            tempObj.position.set(el.x, el.y + el.height / 2, el.z);
            tempObj.rotation.set(0, el.rotation || 0, 0);
            tempObj.scale.set(el.width, el.height, el.depth);
            tempObj.updateMatrix();
            
            wireframeMeshRef.current.setMatrixAt(i, tempObj.matrix);
            fillMeshRef.current.setMatrixAt(i, tempObj.matrix);
            hitMeshRef.current.setMatrixAt(i, tempObj.matrix);
            
            const parentLoc = el.rootLoc || el;
            const hasData = isUserDefinedName(parentLoc.name) || 
                            (parentLoc.description && parentLoc.description.trim() !== "") || 
                            (parentLoc.npcs && parentLoc.npcs.trim() !== "");
            
            let color = "#00ff00";
            if (parentLoc.district_color) color = parentLoc.district_color;
            if (el.color && el.color !== "#00ff00") color = el.color;
            if (hasData) color = "#8800ff";
            if (parentLoc.isFavorite) color = "#ff7b00";
            if (parentLoc.isDanger) color = "#ff0000";
            
            const threeColor = new THREE.Color(color);
            wireframeMeshRef.current.setColorAt(i, threeColor);
            fillMeshRef.current.setColorAt(i, threeColor);
        });
        wireframeMeshRef.current.instanceMatrix.needsUpdate = true;
        if (wireframeMeshRef.current.instanceColor) wireframeMeshRef.current.instanceColor.needsUpdate = true;
        
        fillMeshRef.current.instanceMatrix.needsUpdate = true;
        if (fillMeshRef.current.instanceColor) fillMeshRef.current.instanceColor.needsUpdate = true;

        hitMeshRef.current.instanceMatrix.needsUpdate = true;
        hitMeshRef.current.computeBoundingBox();
        hitMeshRef.current.computeBoundingSphere();
    }, [elements]);

    const dragDist = useRef(0);

    const hitGeometry = useMemo(() => {
        const segs = Math.max(3, polyCount);
        switch (shape) {
            case 'none': return new THREE.BoxGeometry(0.001, 0.001, 0.001);
            case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, segs);
            case 'sphere': return new THREE.SphereGeometry(0.5, segs, segs);
            case 'rhombus': return new THREE.OctahedronGeometry(0.5);
            case 'pyramid': return new THREE.ConeGeometry(0.5, 1, segs);
            default: return new THREE.BoxGeometry(1, 1, 1);
        }
    }, [shape, polyCount]);

    const hitMeshArgs = useMemo(() => [hitGeometry, null, elements.length], [hitGeometry, elements.length]);
    const visMeshArgs = useMemo(() => [null as any, null as any, elements.length], [elements.length]);

    return (
        <group>
            {/* Visual Wireframe - No raycasting */}
            <instancedMesh ref={wireframeMeshRef} frustumCulled={false} args={visMeshArgs as any} raycast={() => null}>
                {renderBaseGeometry(shape, polyCount)}
                <meshBasicMaterial wireframe={true} />
            </instancedMesh>
            
            {/* Holographic Face Fill - No raycasting */}
            <instancedMesh ref={fillMeshRef} frustumCulled={false} args={visMeshArgs as any} raycast={() => null}>
                {renderBaseGeometry(shape, polyCount)}
                <meshBasicMaterial color="#020202" />
            </instancedMesh>

            {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
            <Bvh>
                <instancedMesh 
                    ref={hitMeshRef} 
                    frustumCulled={false}
                    raycast={isDragging ? () => null : undefined}
                    args={hitMeshArgs as any}
                    onPointerDown={() => { dragDist.current = 0; }}
                    onPointerMove={(e) => { dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY); }}
                    onPointerUp={(e) => {
                        if (dragDist.current < 10) {
                            e.stopPropagation();
                            if (e.instanceId !== undefined && elements[e.instanceId]) {
                                onSelect(elements[e.instanceId].rootLoc);
                            }
                        }
                    }}
                >
                    <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
                </instancedMesh>
            </Bvh>
        </group>
    );
});`;

code = code.replace(regexInstancedShape, goodInstancedShape);

// Add global pointer up failsafe ONLY inside App component
const appHookRegex = /const \[transformMode, setTransformMode\] = useState\<'translate' \| 'scale'\>\('translate'\);\s*const \[isDragging, setIsDragging\] = useState\(false\);/;
code = code.replace(appHookRegex, `const [transformMode, setTransformMode] = useState<'translate' | 'scale'>('translate');\n  const [isDragging, setIsDragging] = useState(false);\n  useEffect(() => {\n    const handleGlobalPointerUp = () => setIsDragging(false);\n    window.addEventListener('pointerup', handleGlobalPointerUp);\n    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);\n  }, []);`);

// Add releasePointerCapture
code = code.replace(/  const handlePointerUp = async \(e: any\) => \{\s*if \(controls\)/g, `  const handlePointerUp = async (e: any) => {\n    try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}\n    if (controls)`);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched safely");
