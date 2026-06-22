const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const bad1 = `    const dragDist = useRef(0);

    return (
        <group>
            {/* Visual Wireframe - No raycasting */}
            <instancedMesh ref={wireframeMeshRef} frustumCulled={false} args={[null as any, null as any, elements.length]} raycast={() => null}>
                {renderBaseGeometry(shape, polyCount)}
                <meshBasicMaterial wireframe={true} />
            </instancedMesh>
            
            {/* Holographic Face Fill - No raycasting */}
            <instancedMesh ref={fillMeshRef} frustumCulled={false} args={[null as any, null as any, elements.length]} raycast={() => null}>
                {renderBaseGeometry(shape, polyCount)}
                <meshBasicMaterial color="#020202" />
            </instancedMesh>

            {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
            <Bvh firstHitOnly>
              <instancedMesh 
                  ref={hitMeshRef} 
                  frustumCulled={false}
                  raycast={isDragging ? () => null : undefined}
                  args={[null as any, null as any, elements.length]}
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
                  {renderBaseGeometry(shape, polyCount)}
                  <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
              </instancedMesh>
            </Bvh>
        </group>
    );`;

const good1 = `    const dragDist = useRef(0);

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
    );`;

code = code.replace(bad1, good1);

// Add global pointer up failsafe
code = code.replace(
  /const \[transformMode, setTransformMode\] = useState\<'translate' \| 'scale'\>\('translate'\);\s*const \[isDragging, setIsDragging\] = useState\(false\);/,
  `const [transformMode, setTransformMode] = useState<'translate' | 'scale'>('translate');\n  const [isDragging, setIsDragging] = useState(false);\n  useEffect(() => {\n    const handleGlobalPointerUp = () => setIsDragging(false);\n    window.addEventListener('pointerup', handleGlobalPointerUp);\n    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);\n  }, []);`
);

// Add releasePointerCapture
code = code.replace(/  const handlePointerUp = async \(e: any\) => \{\s*if \(controls\)/g, `  const handlePointerUp = async (e: any) => {\n    try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}\n    if (controls)`);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched successfully");
