const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const badChunk = `            <instancedMesh 
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

const goodChunk = `            <Bvh>
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
        </group>`;

code = code.replace(badChunk, goodChunk);

// Also remove the custom bounds calculation that might be crashing things silently
const badBounds = `hitMeshRef.current.instanceMatrix.needsUpdate = true;
        if (hitMeshRef.current.geometry) {
            hitMeshRef.current.geometry.computeBoundingBox();
            hitMeshRef.current.geometry.computeBoundingSphere();
        }
        hitMeshRef.current.computeBoundingBox();
        hitMeshRef.current.computeBoundingSphere();`;

const goodBounds = `hitMeshRef.current.instanceMatrix.needsUpdate = true;
        hitMeshRef.current.computeBoundingBox();
        hitMeshRef.current.computeBoundingSphere();`;

code = code.replace(badBounds, goodBounds);

fs.writeFileSync('src/App.tsx', code);
console.log("Restored Bvh without firstHitOnly");
