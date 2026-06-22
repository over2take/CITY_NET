const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const badChunk = `            {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
            <Bvh firstHitOnly>
              <instancedMesh 
                  ref={hitMeshRef} 
                  frustumCulled={false}
                  raycast={isDragging ? () => null : undefined}
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
        </group>`;

const fixedChunk = `            {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
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
        </group>`;

code = code.replace(badChunk, fixedChunk);
fs.writeFileSync('src/App.tsx', code);
console.log("Patch fixed!");
