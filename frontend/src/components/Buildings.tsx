import React, { useRef, useMemo, useEffect, useContext } from 'react';
import * as THREE from 'three';
import { Html, Bvh } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { isUserDefinedName } from '../utils/locationHelpers';
import { renderBaseGeometry } from '../utils/threeHelpers';
import { ThemeContext } from '../theme/themes';

export const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, isOverlapped, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, isDragging, socket, activeUsers }: any) => {
  const theme = useContext(ThemeContext);
  const meshRef = useRef<THREE.Mesh>(null);
  
  const parts = [location, ...(children || [])];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
  parts.forEach(p => {
    minX = Math.min(minX, p.x - p.width / 2); maxX = Math.max(maxX, p.x + p.width / 2);
    minZ = Math.min(minZ, p.z - p.depth / 2); maxZ = Math.max(maxZ, p.z + p.depth / 2);
    minY = Math.min(minY, p.y);
  });
  
  const currentX = (minX + maxX) / 2;
  const currentZ = (minZ + maxZ) / 2;
  const groupPos: [number, number, number] = [currentX, minY, currentZ];
  
  const hasData = isUserDefinedName(location.name) || 
                  (location.description && location.description.trim() !== "") ||
                  (location.npcs && location.npcs.trim() !== "");
  let baseColor = location.color || "#00aa33";
  if (location.district_color) baseColor = location.district_color;
  if (hasData) {
    baseColor = "#8800ff";
  } else {
    baseColor = "#00ff00"; // Neon green if it has no name, description, and residence
  }

  let maxY = -Infinity;
  parts.forEach(p => {
    maxY = Math.max(maxY, p.y + p.height / 2);
  });

  const isBattleActive = activeUsers && activeUsers.some((user: any) => user.currentBattleMapId && Number(user.currentBattleMapId) === Number(location.id));

  const dragDist = useRef(0);

  return (
    <group 
        position={groupPos} 
        rotation={new THREE.Euler(location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0, 'YXZ')}
        ref={(group) => { if (isSelected && group) { setTargetObject(group); if (editMeshRef) editMeshRef.current = group; } }} 
    >
      {isBattleActive && (
          <Html position={[0, maxY - minY + 2, 0]} center wrapperClass="battle-indicator" style={{ pointerEvents: 'none' }}>
            <div style={{
                fontSize: '24px', 
                filter: 'drop-shadow(0 0 10px #ff0000)',
                animation: 'pulse 1.5s infinite',
                pointerEvents: 'none'
            }}>
                ⚔️
            </div>
          </Html>
        )}
      {parts.map((p, idx) => {
        const isRoot = idx === 0;
        const rootQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(location.rotation_x || 0, location.rotation || 0, location.rotation_z || 0, 'YXZ'));
          const rootQuatInv = rootQuat.clone().invert();
          
          const absPos = new THREE.Vector3(p.x, p.y + p.height / 2, p.z);
          const offset = absPos.sub(new THREE.Vector3(...groupPos));
          offset.applyQuaternion(rootQuatInv);
          
          const partQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation_x || 0, p.rotation || 0, p.rotation_z || 0, 'YXZ'));
          const localQuat = rootQuatInv.clone().multiply(partQuat);
          const localEuler = new THREE.Euler().setFromQuaternion(localQuat, 'YXZ');
          
          return (
            <group key={p.id} position={[offset.x, offset.y, offset.z]} rotation={localEuler} scale={[p.width, p.height, p.depth]}>
              {/* Invisible Solid Hitbox (handles interactions) */}
              <mesh 
                  ref={isRoot ? meshRef as any : null}
                  userData={{ id: p.id }}
                  
                  onPointerDown={() => { dragDist.current = 0; }}
                  onPointerMove={(e) => { dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY); }}
                  onPointerUp={(e) => {
                      if (dragDist.current < 10) {
                          e.stopPropagation();
                          onClick();
                      }
                  }}
              >
                {renderBaseGeometry(p.shape, p.polyCount || 5)}
                <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
              </mesh>

              {/* Wireframe */}
              <mesh raycast={() => null}>
                {renderBaseGeometry(p.shape, p.polyCount || 5)}
                <meshBasicMaterial 
                  color={isBatchSelected ? theme.highlight : location.isDanger ? theme.danger : location.isFavorite ? theme.friendly : hasData ? "#8800ff" : ((p.color && p.color !== "#00ff00") ? p.color : location.district_color ? location.district_color : theme.primary)} 
                  wireframe={true} 
                />
              </mesh>
              
              {/* Solid Fill */}
              <mesh raycast={() => null}>
                {renderBaseGeometry(p.shape, p.polyCount || 5)}
                <meshBasicMaterial 
                  color={location.isDanger ? theme.danger : location.isFavorite ? theme.friendly : hasData ? "#8800ff" : ((p.color && p.color !== "#00ff00") ? p.color : location.district_color ? location.district_color : theme.primary)} 
                  transparent={true}
                  opacity={(isSelected || isBatchSelected) ? 0.3 : (isOverlapped ? 0.0 : 0.05)}
                  depthTest={!isOverlapped}
                  />
                </mesh>
              </group>
          );
        })}
    </group>
  );
});

export const InstancedShape = React.memo(({ shape, polyCount, elements, onSelect, isDragging }: { shape: string, polyCount: number, elements: any[], onSelect: (rootLoc: any) => void, isDragging?: boolean }) => {
    const theme = useContext(ThemeContext);
    const wireframeMeshRef = useRef<THREE.InstancedMesh>(null);
    const fillMeshRef = useRef<THREE.InstancedMesh>(null);
    const hitMeshRef = useRef<THREE.InstancedMesh>(null);
    const tempObj = new THREE.Object3D();

    useEffect(() => {
        if (!wireframeMeshRef.current || !hitMeshRef.current || !fillMeshRef.current) return;
        elements.forEach((el, i) => {
            tempObj.position.set(el.x, el.y + el.height / 2, el.z);
            tempObj.rotation.set(el.rotation_x || 0, el.rotation || 0, el.rotation_z || 0, 'YXZ');
            tempObj.scale.set(el.width, el.height, el.depth);
            tempObj.updateMatrix();
            hitMeshRef.current!.setMatrixAt(i, tempObj.matrix);

            // Wireframe lines rasterize at 1px regardless of geometry size, so a
            // 'none' shape still draws a visible dot unless scaled to zero
            if (shape === 'none') {
                tempObj.scale.set(0, 0, 0);
                tempObj.updateMatrix();
            }
            wireframeMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            fillMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            
            const parentLoc = el.rootLoc || el;
            const hasData = isUserDefinedName(parentLoc.name) || 
                            (parentLoc.description && parentLoc.description.trim() !== "") || 
                            (parentLoc.npcs && parentLoc.npcs.trim() !== "");
            
            let color = theme.primary;
            if (parentLoc.district_color) color = parentLoc.district_color;
            if (el.color && el.color !== "#00ff00") color = el.color;
            if (hasData) color = "#8800ff";
            if (parentLoc.isFavorite) color = theme.friendly;
            if (parentLoc.isDanger) color = theme.danger;
            
            const threeColor = new THREE.Color(color);
            wireframeMeshRef.current!.setColorAt(i, threeColor);
            fillMeshRef.current!.setColorAt(i, threeColor);
        });
        wireframeMeshRef.current!.instanceMatrix.needsUpdate = true;
        if (wireframeMeshRef.current!.instanceColor) wireframeMeshRef.current!.instanceColor.needsUpdate = true;
        
        fillMeshRef.current!.instanceMatrix.needsUpdate = true;
        if (fillMeshRef.current!.instanceColor) fillMeshRef.current!.instanceColor.needsUpdate = true;

        hitMeshRef.current!.instanceMatrix.needsUpdate = true;
        hitMeshRef.current!.computeBoundingBox();
        hitMeshRef.current!.computeBoundingSphere();
    }, [elements, theme]);

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
                <meshBasicMaterial color={theme.background} />
            </instancedMesh>

            {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
            <Bvh>
                <instancedMesh 
                    ref={hitMeshRef} 
                    frustumCulled={false}
                    
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
});

export const InstancedBuildings = React.memo(({ buildings, onSelect, isDragging }: { buildings: any[], onSelect: (loc: any) => void, isDragging?: boolean }) => {
    const groups = useMemo(() => {
        const result: { [key: string]: any[] } = {};
        buildings.forEach(el => {
            const sh = el.shape || 'box';
            const pc = el.polyCount || 5;
            const key = `${sh}_${pc}`;
            if (!result[key]) result[key] = [];
            result[key].push(el);
        });
        return result;
    }, [buildings]);

    return (
        <group>
            {Object.entries(groups).map(([key, items]) => {
                const [shape, pcStr] = key.split('_');
                if (items.length === 0) return null;
                return (
                    <InstancedShape 
                        key={key} 
                        shape={shape} 
                        polyCount={parseInt(pcStr)}
                        elements={items} 
                        onSelect={onSelect} 
                        isDragging={isDragging}
                    />
                );
            })}
        </group>
    );
});

export const generateThemedBuildingsForPlot = (
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  zoneTypeVal: number,
  isBlocked: (x: number, z: number, w: number, d: number, buffer?: number) => boolean,
  getGridKey: (x: number, z: number) => string,
  spatialGrid: any,
  rawBuildings: any[],
  sourceLocations: any[],
  blockId?: string,
  overrideH?: number,
  styleOverride?: number
) => {
  const startIndex = rawBuildings.length;
  const color = ''; // default neutral color

  let targetGenType = '';
  if (zoneTypeVal === 2.0) targetGenType = 'MARKETS';
  else if (zoneTypeVal >= 1.5 && zoneTypeVal < 2.0) targetGenType = 'LANDMARK';
  else if (zoneTypeVal > 0.8 && zoneTypeVal < 1.5) targetGenType = 'CORPO';
  else if (zoneTypeVal > 0.3 && zoneTypeVal < 0.8) targetGenType = 'URBAN';
  else if (zoneTypeVal <= 0.25 && zoneTypeVal >= 0) targetGenType = 'SLUMS';
  else if (zoneTypeVal < 0) targetGenType = 'INDUSTRIAL';
  else if (zoneTypeVal === 3.0) targetGenType = 'CUSTOM';

  const customPool = sourceLocations.filter(b => b.classification === targetGenType && !b.parent_id);
  const baseMaxStyle = (targetGenType === 'CORPO' ? 11 : targetGenType === 'URBAN' ? 10 : targetGenType === 'INDUSTRIAL' ? 10 : targetGenType === 'SLUMS' ? 1 : targetGenType === 'LANDMARK' ? 13 : targetGenType === 'MARKETS' ? 5 : 0);

  if (styleOverride !== undefined && styleOverride >= baseMaxStyle && customPool.length > 0) {
    const customIndex = styleOverride - baseMaxStyle;
    const customRoot = customPool[customIndex % customPool.length];
    if (customRoot) {
      const children = sourceLocations.filter(b => b.parent_id === customRoot.id);
      const allParts = [customRoot, ...children];
      
      const minX = Math.min(...allParts.map(p => p.x - (p.width||0)/2));
      const maxX = Math.max(...allParts.map(p => p.x + (p.width||0)/2));
      const minZ = Math.min(...allParts.map(p => p.z - (p.depth||0)/2));
      const maxZ = Math.max(...allParts.map(p => p.z + (p.depth||0)/2));
      const origW = maxX - minX || 1;
      const origD = maxZ - minZ || 1;
      
      const scaleX = bw / origW;
      const scaleZ = bd / origD;
      
      const origCX = minX + origW/2;
      const origCZ = minZ + origD/2;

      allParts.forEach(p => {
        const relX = p.x - origCX;
        const relZ = p.z - origCZ;
        const newW = (p.width || 1) * scaleX;
        const newD = (p.depth || 1) * scaleZ;
        
        const part: any = {
          name: p.name || '',
          x: bx + (relX * scaleX),
          y: p.y,
          z: bz + (relZ * scaleZ),
          width: newW,
          depth: newD,
          height: p.height || 1,
          color: p.color,
          shape: p.shape,
          rotation: p.rotation,
          polyCount: p.polyCount || 5,
        };
        if (p.id !== customRoot.id) {
          part.parent_name = 'ROOT';
        }
        rawBuildings.push(part);
        
        if (p.id === customRoot.id) {
           part.description = customRoot.description || '';
           const key = getGridKey(bx, bz); 
           if(!spatialGrid[key]) spatialGrid[key] = []; 
           spatialGrid[key].push(part);
        }
      });
      
      const bId = blockId || `plot_${bx.toFixed(3)}_${bz.toFixed(3)}`;
      for (let i = startIndex; i < rawBuildings.length; i++) {
        rawBuildings[i].temp_block_id = bId;
      }
      return;
    }
  }

  // 1. SLUMS
  if (zoneTypeVal <= 0.25 && zoneTypeVal >= 0) {
    let rootShack: any = null;

    if (bw >= 8 || bd >= 8) {
      const shackArea = 16.0;
      const shackCount = Math.max(2, Math.floor((bw * bd) / shackArea));
      const radiusX = bw / 2;
      const radiusZ = bd / 2;
      for (let i = 0; i < shackCount; i++) {
        const shW = 2.0 + Math.random() * 2.0; const shD = 2.0 + Math.random() * 2.0;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 0.9;
        const shX = bx + Math.cos(angle) * radiusX * r;
        const shZ = bz + Math.sin(angle) * radiusZ * r;
        const shH = 2.5 + Math.random() * 4.0; const shackColor = '#00ff00';

        if (!isBlocked(shX, shZ, shW, shD, 0.5)) {
          if (!rootShack) {
            rootShack = { name: '', description: '', x: shX, y: 0, z: shZ, width: shW, depth: shD, height: shH, color: shackColor, shape: 'box', polyCount: 5 };
            rawBuildings.push(rootShack);
            const key = getGridKey(shX, shZ); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(rootShack);
          } else {
            const shack = { name: '', x: shX, y: 0, z: shZ, width: shW, depth: shD, height: shH, color: shackColor, shape: 'box', polyCount: 5, parent_name: 'ROOT' };
            rawBuildings.push(shack);
            const key = getGridKey(shX, shZ); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(shack);
          }
          if (Math.random() < 0.3) {
            rawBuildings.push({ name: '', x: shX, y: shH, z: shZ, width: shW * 0.9, depth: shD * 0.9, height: 1.0 + Math.random() * 1.5, color: '#00ff00', shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
          }
        }
      }
    } else {
      const shH = 2.5 + Math.random() * 4.0; const shackColor = '#00ff00';
      rootShack = { name: '', description: '', x: bx, y: 0, z: bz, width: bw * 0.7, depth: bd * 0.7, height: shH, color: shackColor, shape: 'box', polyCount: 5 };
      rawBuildings.push(rootShack);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(rootShack);
      if (Math.random() < 0.3) {
        rawBuildings.push({ name: '', x: bx, y: shH, z: bz, width: bw * 0.6, depth: bd * 0.6, height: 1.0 + Math.random() * 1.5, color: '#00ff00', shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      }
    }

    // Fallback: if no shack was spawned (e.g. all blocked or small size failed), force-spawn one at the center to ensure block is populated
    if (!rootShack) {
      const shH = 2.5 + Math.random() * 4.0; const shackColor = Math.random() > 0.5 ? '#8d5b4c' : '#4d4f53';
      rootShack = { name: '', description: '', x: bx, y: 0, z: bz, width: Math.max(3.0, bw * 0.8), depth: Math.max(3.0, bd * 0.8), height: shH, color: shackColor, shape: 'box', polyCount: 5 };
      rawBuildings.push(rootShack);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(rootShack);
      if (Math.random() < 0.3) {
        rawBuildings.push({ name: '', x: bx, y: shH, z: bz, width: rootShack.width * 0.8, depth: rootShack.depth * 0.8, height: 1.0 + Math.random() * 1.5, color: '#3f2b24', shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    return;
  }

  // Clamping aspect ratio for non-slums buildings to eliminate long flat buildings (City Gen only)
  if (overrideH === undefined) {
      const maxRatio = 1.3;
      if (bw > bd * maxRatio) {
        bw = bd * maxRatio;
      } else if (bd > bw * maxRatio) {
        bd = bw * maxRatio;
      }
  }

  // 2. INDUSTRIAL
  if (zoneTypeVal < 0) {
    const industrialStyle = styleOverride !== undefined ? styleOverride % 10 : Math.floor(Math.random() * 10);
    
    // Create the base concrete pad platform
    const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 1.2, color, shape: 'box', polyCount: 5, rotation: 0 };
    rawBuildings.push(root);
    const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

    if (industrialStyle === 0) {
      // Style 0: Refinery Terminal (Medium building, 2 liquid tanks, shipping containers)
      const wareW = bw * 0.42; const wareD = bd * 0.55; const wareH = 6.0 + Math.random() * 3;
      rawBuildings.push({ name: '', x: bx - bw * 0.2, y: 1.2, z: bz, width: wareW, depth: wareD, height: wareH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      const tankR = Math.min(bw, bd) * 0.16; const tankH = 5.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 1.2, z: bz - bd * 0.2, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 1.2, z: bz + bd * 0.2, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      const containerW = bw * 0.22; const containerD = bd * 0.35; const containerH = 2.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.2, y: 1.2 + wareH, z: bz, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    } 
    else if (industrialStyle === 1) {
      // Style 1: Manufacturing Station (Medium building, tall smokestack, liquid tank, containers)
      const genW = bw * 0.45; const genD = bd * 0.5; const genH = 5.0 + Math.random() * 3;
      rawBuildings.push({ name: '', x: bx - bw * 0.1, y: 1.2, z: bz - bd * 0.1, width: genW, depth: genD, height: genH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      const stackW = 1.0; const stackH = 15.0 + Math.random() * 5;
      rawBuildings.push({ name: '', x: bx + bw * 0.3, y: 1.2, z: bz - bd * 0.22, width: stackW, depth: stackW, height: stackH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      const tankR = Math.min(bw, bd) * 0.18; const tankH = 6.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx + bw * 0.3, y: 1.2, z: bz + bd * 0.22, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      const containerW = bw * 0.2; const containerD = bd * 0.3; const containerH = 2.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.32, y: 1.2, z: bz + bd * 0.25, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - bw * 0.32, y: 1.2 + containerH, z: bz + bd * 0.25, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (industrialStyle === 2) {
      // Style 2: Fuel Storage Depot (Medium building, 3 grouped cylinders, containers)
      const officeW = bw * 0.35; const officeD = bd * 0.38; const officeH = 4.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx - bw * 0.24, y: 1.2, z: bz - bd * 0.2, width: officeW, depth: officeD, height: officeH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      const tankR = Math.min(bw, bd) * 0.15; const tankH = 6.0 + Math.random() * 3;
      rawBuildings.push({ name: '', x: bx + bw * 0.22, y: 1.2, z: bz - bd * 0.22, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw * 0.22, y: 1.2, z: bz + bd * 0.22, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw * 0.38, y: 1.2, z: bz, width: tankR * 2.2, depth: tankR * 2.2, height: tankH * 1.2, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      const containerW = bw * 0.22; const containerD = bd * 0.32; const containerH = 2.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.24, y: 1.2, z: bz + bd * 0.25, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - bw * 0.24, y: 1.2 + containerH, z: bz + bd * 0.25, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (industrialStyle === 3) {
      // Style 3: Power & Distribution Plant (Medium building, cooling tower, containers)
      const wareW = bw * 0.48; const wareD = bd * 0.55; const wareH = 6.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx - bw * 0.15, y: 1.2, z: bz, width: wareW, depth: wareD, height: wareH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      const tankR = Math.min(bw, bd) * 0.18; const tankH = 9.0 + Math.random() * 3;
      rawBuildings.push({ name: '', x: bx + bw * 0.28, y: 1.2, z: bz + bd * 0.18, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      const containerW = bw * 0.24; const containerD = bd * 0.28; const containerH = 2.0;
      rawBuildings.push({ name: '', x: bx + bw * 0.28, y: 1.2, z: bz - bd * 0.22, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw * 0.28, y: 1.2 + containerH, z: bz - bd * 0.22, width: containerW, depth: containerD, height: containerH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (industrialStyle === 4) {
      // Style 4: Industrial Standard A
      // Instructions: lowpoly cylinder for liquids, small retangles for storage crates, and a medum sized buiding for opterations.
      const opW = bw * 0.4; const opD = bd * 0.4; const opH = 5.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx - bw * 0.2, y: 1.2, z: bz - bd * 0.2, width: opW, depth: opD, height: opH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      const tankR = Math.min(bw, bd) * 0.15; const tankH = 6.0;
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 1.2, z: bz - bd * 0.2, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      for(let i=0; i<3; i++) {
        rawBuildings.push({ name: '', x: bx - bw*0.1 + i*1.5, y: 1.2, z: bz + bd*0.3, width: 1.2, depth: 1.2, height: 1.2, color: ['#aa3333','#3355aa'][i%2], shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (industrialStyle === 5) {
      // Style 5: Industrial Standard B
      // Instructions: lowpoly cylinder for liquids, small retangles for storage crates, and a medum sized buiding for opterations.
      const opW = bw * 0.5; const opD = bd * 0.3; const opH = 4.0;
      rawBuildings.push({ name: '', x: bx, y: 1.2, z: bz + bd * 0.25, width: opW, depth: opD, height: opH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      const tankR = Math.min(bw, bd) * 0.2; const tankH = 5.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.25, y: 1.2, z: bz - bd * 0.2, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      for(let i=0; i<4; i++) {
        rawBuildings.push({ name: '', x: bx + bw*0.15 + (i%2)*1.2, y: 1.2 + Math.floor(i/2)*1.2, z: bz - bd*0.2, width: 1.0, depth: 1.0, height: 1.0, color: '#33aa33', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (industrialStyle === 6) {
      // Style 6: Industrial Standard C
      // Instructions: lowpoly cylinder for liquids, small retangles for storage crates, and a medum sized buiding for opterations.
      const opW = bw * 0.35; const opD = bd * 0.6; const opH = 7.0;
      rawBuildings.push({ name: '', x: bx + bw * 0.2, y: 1.2, z: bz, width: opW, depth: opD, height: opH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      const tankR = Math.min(bw, bd) * 0.12; const tankH = 8.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.2, y: 1.2, z: bz - bd * 0.25, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - bw * 0.2, y: 1.2, z: bz, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      for(let i=0; i<2; i++) {
        rawBuildings.push({ name: '', x: bx - bw*0.2, y: 1.2, z: bz + bd*0.3, width: 1.5, depth: 1.5, height: 1.5, color: '#ddaa22', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (industrialStyle === 7) {
      // Style 7: Industrial Standard D
      // Instructions: lowpoly cylinder for liquids, small retangles for storage crates, and a medum sized buiding for opterations.
      const opW = bw * 0.45; const opD = bd * 0.45; const opH = 4.5;
      rawBuildings.push({ name: '', x: bx, y: 1.2, z: bz, width: opW, depth: opD, height: opH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      const tankR = Math.min(bw, bd) * 0.16; const tankH = 4.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.3, y: 1.2, z: bz - bd * 0.3, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw * 0.3, y: 1.2, z: bz + bd * 0.3, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      for(let i=0; i<3; i++) {
        rawBuildings.push({ name: '', x: bx + bw*0.3, y: 1.2 + i*1.0, z: bz - bd*0.3, width: 1.0, depth: 1.0, height: 1.0, color: '#aa3333', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (industrialStyle === 8) {
      // Style 8: Industrial Standard E
      // Instructions: lowpoly cylinder for liquids, small retangles for storage crates, and a medum sized buiding for opterations.
      const opW = bw * 0.6; const opD = bd * 0.25; const opH = 5.5;
      rawBuildings.push({ name: '', x: bx, y: 1.2, z: bz - bd * 0.3, width: opW, depth: opD, height: opH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      const tankR = Math.min(bw, bd) * 0.18; const tankH = 6.5;
      rawBuildings.push({ name: '', x: bx, y: 1.2, z: bz + bd * 0.2, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      for(let i=0; i<2; i++) {
        rawBuildings.push({ name: '', x: bx - bw*0.3, y: 1.2, z: bz + bd*0.2, width: 1.2, depth: 1.8, height: 1.2, color: '#3355aa', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (industrialStyle === 9) {
      // Style 9: Industrial Standard F
      // Instructions: lowpoly cylinder for liquids, small retangles for storage crates, and a medum sized buiding for opterations.
      const opW = bw * 0.4; const opD = bd * 0.5; const opH = 8.0;
      rawBuildings.push({ name: '', x: bx - bw * 0.25, y: 1.2, z: bz + bd * 0.1, width: opW, depth: opD, height: opH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      const tankR = Math.min(bw, bd) * 0.15; const tankH = 4.5;
      rawBuildings.push({ name: '', x: bx + bw * 0.2, y: 1.2, z: bz - bd * 0.25, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      for(let i=0; i<4; i++) {
        rawBuildings.push({ name: '', x: bx + bw*0.25, y: 1.2 + Math.floor(i/2)*1.0, z: bz + bd*0.2 + (i%2)*1.0, width: 0.9, depth: 0.9, height: 0.9, color: '#ddaa22', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    return;
  }

  // 3. LANDMARK (STATUES, MONUMENTS, TOWERS)
  if (zoneTypeVal >= 1.5 && zoneTypeVal < 2.0) {
    const h = overrideH !== undefined ? overrideH : (20 + Math.random() * 60);
    const baseW = bw * 0.9;
    const baseD = bd * 0.9;
    const landmarkStyle = styleOverride !== undefined ? styleOverride % 13 : Math.floor(Math.random() * 13);

    if (landmarkStyle === 0) {
      // Style 1: Grand Obelisk
      const pedW = Math.min(baseW, baseD) * 0.55;
      const pedH = h * 0.12;
      const shaftW = pedW * 0.45;
      const shaftH = h * 0.75;
      const tipH = h * 0.13;
      // Wide stepped pedestal base
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: pedW, depth: pedW, height: pedH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Mid pedestal step
      rawBuildings.push({ name: '', x: bx, y: pedH, z: bz, width: pedW * 0.75, depth: pedW * 0.75, height: pedH * 0.6, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Tall narrow shaft
      rawBuildings.push({ name: '', x: bx, y: pedH * 1.6, z: bz, width: shaftW, depth: shaftW, height: shaftH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Pyramid tip
      rawBuildings.push({ name: '', x: bx, y: pedH * 1.6 + shaftH, z: bz, width: shaftW * 1.1, depth: shaftW * 1.1, height: tipH, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      // Glowing apex sphere
      rawBuildings.push({ name: '', x: bx, y: pedH * 1.6 + shaftH + tipH, z: bz, width: shaftW * 0.25, depth: shaftW * 0.25, height: shaftW * 0.25, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 1) {
      // Style 2: Colossus Statue (humanoid silhouette on pedestal)
      const pedW = Math.min(baseW, baseD) * 0.5;
      const pedH = h * 0.18;
      const bodyW = pedW * 0.55;
      const legH = h * 0.22;
      const torsoH = h * 0.28;
      const headR = bodyW * 0.5;
      // Stepped pedestal
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: pedW, depth: pedW * 0.8, height: pedH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Left leg
      rawBuildings.push({ name: '', x: bx - bodyW * 0.2, y: pedH, z: bz, width: bodyW * 0.3, depth: bodyW * 0.35, height: legH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Right leg
      rawBuildings.push({ name: '', x: bx + bodyW * 0.2, y: pedH, z: bz, width: bodyW * 0.3, depth: bodyW * 0.35, height: legH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Torso
      rawBuildings.push({ name: '', x: bx, y: pedH + legH, z: bz, width: bodyW * 0.85, depth: bodyW * 0.5, height: torsoH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Left arm raised
      rawBuildings.push({ name: '', x: bx - bodyW * 0.65, y: pedH + legH + torsoH * 0.5, z: bz, width: bodyW * 0.25, depth: bodyW * 0.25, height: torsoH * 0.85, color, shape: 'cylinder', polyCount: 5, rotation: 0.4, parent_name: 'ROOT' });
      // Right arm
      rawBuildings.push({ name: '', x: bx + bodyW * 0.65, y: pedH + legH + torsoH * 0.2, z: bz, width: bodyW * 0.22, depth: bodyW * 0.22, height: torsoH * 0.65, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      // Head
      rawBuildings.push({ name: '', x: bx, y: pedH + legH + torsoH, z: bz, width: headR, depth: headR, height: headR * 1.1, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 2) {
      // Style 3: Triumphal Arch / Memorial Gate
      const archW = baseW * 0.9;
      const archD = baseD * 0.35;
      const pillarW = archW * 0.18;
      const pillarH = h * 0.75;
      const spanH = h * 0.25;
      // Left pillar
      const root = { name: '', description: '', x: bx - archW * 0.36, y: 0, z: bz, width: pillarW, depth: archD, height: pillarH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx - archW * 0.36, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Right pillar
      rawBuildings.push({ name: '', x: bx + archW * 0.36, y: 0, z: bz, width: pillarW, depth: archD, height: pillarH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Spanning lintel / arch top
      rawBuildings.push({ name: '', x: bx, y: pillarH, z: bz, width: archW, depth: archD, height: spanH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Decorative relief panels on sides
      rawBuildings.push({ name: '', x: bx, y: pillarH * 0.4, z: bz - archD * 0.55, width: archW * 0.5, depth: 0.5, height: pillarH * 0.3, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: pillarH * 0.4, z: bz + archD * 0.55, width: archW * 0.5, depth: 0.5, height: pillarH * 0.3, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Victory spike / finial on top center
      rawBuildings.push({ name: '', x: bx, y: pillarH + spanH, z: bz, width: pillarW * 0.3, depth: pillarW * 0.3, height: spanH * 0.6, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 3) {
      // Style 4: Comm / Signal Tower (tall lattice spire)
      const baseR = Math.min(baseW, baseD) * 0.25;
      const towerH = h;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseR * 2.2, depth: baseR * 2.2, height: towerH * 0.06, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Four corner support legs
      const legOffset = baseR * 0.8;
      rawBuildings.push({ name: '', x: bx - legOffset, y: 0, z: bz - legOffset, width: baseR * 0.25, depth: baseR * 0.25, height: towerH * 0.45, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + legOffset, y: 0, z: bz - legOffset, width: baseR * 0.25, depth: baseR * 0.25, height: towerH * 0.45, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - legOffset, y: 0, z: bz + legOffset, width: baseR * 0.25, depth: baseR * 0.25, height: towerH * 0.45, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + legOffset, y: 0, z: bz + legOffset, width: baseR * 0.25, depth: baseR * 0.25, height: towerH * 0.45, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      // Central mast
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.06, z: bz, width: baseR * 0.28, depth: baseR * 0.28, height: towerH * 0.85, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      // Signal dish
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.72, z: bz, width: baseR * 1.1, depth: baseR * 0.3, height: baseR * 0.8, color, shape: 'cylinder', polyCount: 5, rotation: 0.35, parent_name: 'ROOT' });
      // Blinking beacon sphere
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.91, z: bz, width: baseR * 0.18, depth: baseR * 0.18, height: baseR * 0.18, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 4) {
      // Style 5: Plaza Fountain Monument (wide stepped plaza with central column)
      const plazaW = baseW * 0.9;
      const plazaD = baseD * 0.9;
      const plazaH = h * 0.04;
      const ring1W = plazaW * 0.65;
      const ring1H = h * 0.06;
      const ring2W = plazaW * 0.4;
      const ring2H = h * 0.08;
      const colW = plazaW * 0.12;
      const colH = h * 0.65;
      // Wide flat plaza base
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: plazaW, depth: plazaD, height: plazaH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Raised inner ring
      rawBuildings.push({ name: '', x: bx, y: plazaH, z: bz, width: ring1W, depth: ring1W, height: ring1H, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      // Pool ring / inner platform
      rawBuildings.push({ name: '', x: bx, y: plazaH + ring1H, z: bz, width: ring2W, depth: ring2W, height: ring2H, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      // Central decorative column
      rawBuildings.push({ name: '', x: bx, y: plazaH + ring1H + ring2H, z: bz, width: colW, depth: colW, height: colH, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      // Capital / crown sphere
      const crownR = colW * 1.2;
      rawBuildings.push({ name: '', x: bx, y: plazaH + ring1H + ring2H + colH, z: bz, width: crownR, depth: crownR, height: crownR, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
      // Four ornamental pillars around the plaza
      const pillarOff = ring1W * 0.4;
      const pR = colW * 0.45;
      const pHh = colH * 0.35;
      rawBuildings.push({ name: '', x: bx - pillarOff, y: plazaH + ring1H + ring2H, z: bz - pillarOff, width: pR, depth: pR, height: pHh, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + pillarOff, y: plazaH + ring1H + ring2H, z: bz - pillarOff, width: pR, depth: pR, height: pHh, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - pillarOff, y: plazaH + ring1H + ring2H, z: bz + pillarOff, width: pR, depth: pR, height: pHh, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + pillarOff, y: plazaH + ring1H + ring2H, z: bz + pillarOff, width: pR, depth: pR, height: pHh, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 5) {
      // Style 6: Corporate Arcology (3 stacked pyramids + glowing orb)
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: h * 0.4, color, shape: 'pyramid', polyCount: 5 };
      rawBuildings.push(root);
      const key2 = getGridKey(bx, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(root);
      rawBuildings.push({ name: '', x: bx, y: h * 0.4, z: bz, width: baseW * 0.6, depth: baseD * 0.6, height: h * 0.4, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: h * 0.8, z: bz, width: baseW * 0.3, depth: baseD * 0.3, height: h * 0.2, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      const peakSphereR = Math.min(baseW, baseD) * 0.15;
      rawBuildings.push({ name: '', x: bx, y: h * 1.05, z: bz, width: peakSphereR, depth: peakSphereR, height: peakSphereR, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 6) {
      // Style 7: Cyber-Citadel (Stepped buttresses + tall central spire)
      const centralSpireH = h;
      const centralSpireW = baseW * 0.45;
      const centralSpireD = baseD * 0.45;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: centralSpireW, depth: centralSpireD, height: centralSpireH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Tiered corner buttresses
      const buttW = baseW * 0.15;
      const buttD = baseD * 0.15;
      const offsets = [
        { dx: -baseW * 0.35, dz: -baseD * 0.35 },
        { dx: baseW * 0.35, dz: -baseD * 0.35 },
        { dx: -baseW * 0.35, dz: baseD * 0.35 },
        { dx: baseW * 0.35, dz: baseD * 0.35 }
      ];
      offsets.forEach(offset => {
        const ox = bx + offset.dx;
        const oz = bz + offset.dz;
        rawBuildings.push({ name: '', x: ox, y: 0, z: oz, width: buttW, depth: buttD, height: centralSpireH * 0.4, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: ox - Math.sign(offset.dx)*buttW*0.2, y: centralSpireH * 0.4, z: oz - Math.sign(offset.dz)*buttD*0.2, width: buttW * 0.7, depth: buttD * 0.7, height: centralSpireH * 0.35, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      });
      // Large top ring
      rawBuildings.push({ name: '', x: bx, y: centralSpireH * 0.8, z: bz, width: centralSpireW * 1.3, depth: centralSpireD * 1.3, height: h * 0.03, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Top antenna
      rawBuildings.push({ name: '', x: bx, y: centralSpireH, z: bz, width: 0.3, depth: 0.3, height: centralSpireH * 0.18, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 7) {
      // Style 8: Hyper-Pyramid Complex (Grand tiered pyramid with satellite obelisks)
      const base1W = baseW * 0.75;
      const base1D = baseD * 0.75;
      const base1H = h * 0.05;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: base1W, depth: base1D, height: base1H, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Stepped Tier 2 Base
      const base2W = base1W * 0.75;
      const base2D = base1D * 0.75;
      const base2H = h * 0.08;
      rawBuildings.push({ name: '', x: bx, y: base1H, z: bz, width: base2W, depth: base2D, height: base2H, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Crown Pyramid
      const pyramidW = base2W * 0.75;
      const pyramidD = base2D * 0.75;
      const pyramidH = h * 0.87;
      rawBuildings.push({ name: '', x: bx, y: base1H + base2H, z: bz, width: pyramidW, depth: pyramidD, height: pyramidH, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      // Satellite Obelisks at corners
      const satOffsets = [
        { dx: -baseW * 0.42, dz: -baseD * 0.42 },
        { dx: baseW * 0.42, dz: -baseD * 0.42 },
        { dx: -baseW * 0.42, dz: baseD * 0.42 },
        { dx: baseW * 0.42, dz: baseD * 0.42 }
      ];
      satOffsets.forEach(offset => {
        const ox = bx + offset.dx;
        const oz = bz + offset.dz;
        rawBuildings.push({ name: '', x: ox, y: 0, z: oz, width: baseW * 0.08, depth: baseD * 0.08, height: h * 0.03, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: ox, y: h * 0.03, z: oz, width: baseW * 0.08, depth: baseD * 0.08, height: h * 0.17, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      });
    }
    else if (landmarkStyle === 8) {
      // Style 9: Megastructure Arch / Arcology (Twin pillars + joining arch + suspended atrium)
      const pillarW = baseW * 0.22;
      const pillarD = baseD * 0.65;
      const pillarH = h;
      const offsetDist = baseW * 0.33;
      const root = { name: '', description: '', x: bx - offsetDist, y: 0, z: bz, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx - offsetDist, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Right Pillar
      rawBuildings.push({ name: '', x: bx + offsetDist, y: 0, z: bz, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Top Connecting Arch
      const archH2 = h * 0.08;
      const archW2 = offsetDist * 2 + pillarW;
      rawBuildings.push({ name: '', x: bx, y: pillarH - archH2, z: bz, width: archW2, depth: pillarD * 0.9, height: archH2, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Center Suspended Atrium
      const atriumW = offsetDist * 1.3;
      const atriumD = pillarD * 0.7;
      const atriumH = pillarH * 0.45;
      rawBuildings.push({ name: '', x: bx, y: pillarH * 0.35, z: bz, width: atriumW, depth: atriumD, height: atriumH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Twin spires on top
      rawBuildings.push({ name: '', x: bx - offsetDist, y: pillarH, z: bz, width: 0.5, depth: 0.5, height: h * 0.1, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + offsetDist, y: pillarH, z: bz, width: 0.5, depth: 0.5, height: h * 0.1, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 9) {
      // Style 10: Communications Array (Stepped tower + horizontal array discs + needles)
      const towerH = h;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.4, depth: baseD * 0.4, height: towerH * 0.3, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      // Mid and Upper Sections
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.3, z: bz, width: baseW * 0.3, depth: baseD * 0.3, height: towerH * 0.4, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.7, z: bz, width: baseW * 0.2, depth: baseD * 0.2, height: towerH * 0.3, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Horizontal Array Discs
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.45, z: bz, width: baseW * 0.65, depth: baseD * 0.65, height: h * 0.015, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.75, z: bz, width: baseW * 0.5, depth: baseD * 0.5, height: h * 0.01, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: towerH * 0.92, z: bz, width: baseW * 0.32, depth: baseD * 0.32, height: h * 0.008, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Top needle / antenna
      rawBuildings.push({ name: '', x: bx, y: towerH, z: bz, width: 0.3, depth: 0.3, height: towerH * 0.12, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Beacon sphere
      rawBuildings.push({ name: '', x: bx, y: towerH * 1.12, z: bz, width: baseW * 0.06, depth: baseD * 0.06, height: baseW * 0.06, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 10) {
      // Style 11: Ferris Wheel (horizontal cylinder-like wheel with triangle supports)
      const wheelRadius = Math.min(baseW, baseD) * 0.4;
      const wheelCenterY = wheelRadius * 1.1 + h * 0.02;
      const supportSpread = baseD * 0.35;

      // Ground platform
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.7, depth: baseD * 0.7, height: h * 0.015, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Front A-frame support (pyramid/triangle)
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz - supportSpread, width: baseW * 0.12, depth: baseD * 0.12, height: wheelCenterY * 1.05, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      // Back A-frame support (pyramid/triangle)
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + supportSpread, width: baseW * 0.12, depth: baseD * 0.12, height: wheelCenterY * 1.05, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });

      // The wheel (sphere flattened on Z axis - in wireframe looks like a circular frame)
      rawBuildings.push({ name: '', x: bx, y: wheelCenterY - wheelRadius, z: bz, width: wheelRadius * 2, depth: supportSpread * 0.3, height: wheelRadius * 2, color, shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });

      // Center axle hub
      rawBuildings.push({ name: '', x: bx, y: wheelCenterY - wheelRadius * 0.08, z: bz, width: wheelRadius * 0.15, depth: supportSpread * 1.8, height: wheelRadius * 0.15, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Gondola cabins around the wheel rim
      const numGondolas = 8;
      for (let i = 0; i < numGondolas; i++) {
        const angle = (i / numGondolas) * Math.PI * 2;
        const gx = bx + Math.cos(angle) * wheelRadius * 0.88;
        const gy = wheelCenterY + Math.sin(angle) * wheelRadius * 0.88;
        const gondolaSize = wheelRadius * 0.09;
        rawBuildings.push({ name: '', x: gx, y: gy - gondolaSize / 2, z: bz, width: gondolaSize, depth: gondolaSize, height: gondolaSize * 1.2, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }

      // Cross-brace spokes (thin boxes through center)
      const spokeW = wheelRadius * 0.03;
      // Vertical spoke
      rawBuildings.push({ name: '', x: bx, y: wheelCenterY - wheelRadius * 0.85, z: bz, width: spokeW, depth: spokeW, height: wheelRadius * 1.7, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // Horizontal spoke
      rawBuildings.push({ name: '', x: bx, y: wheelCenterY - spokeW / 2, z: bz, width: wheelRadius * 1.7, depth: spokeW, height: spokeW, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (landmarkStyle === 11) {
      // Style 12: Cyber-Swing Ride (Star Flyer / High-Altitude Carousel)
      const towerRadius = Math.max(2, Math.min(baseW, baseD) * 0.1);
      const rideHeight = h;
      const canopyRadius = Math.min(baseW, baseD) * 0.45;
      
      // Base platform
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: canopyRadius * 2.2, depth: canopyRadius * 2.2, height: h * 0.05, color, shape: 'cylinder', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Central tower
      rawBuildings.push({ name: '', x: bx, y: h * 0.05, z: bz, width: towerRadius * 2, depth: towerRadius * 2, height: rideHeight * 0.85, color, shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      // Top mechanical hub (glowing)
      const hubY = h * 0.9;
      rawBuildings.push({ name: '', x: bx, y: hubY, z: bz, width: towerRadius * 4, depth: towerRadius * 4, height: rideHeight * 0.05, color: '#ff00aa', shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });

      // Canopy roof (pyramid for low-poly tent look)
      rawBuildings.push({ name: '', x: bx, y: hubY + rideHeight * 0.05, z: bz, width: canopyRadius * 2, depth: canopyRadius * 2, height: rideHeight * 0.1, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });

      // Swings flinging outwards
      const numSwings = 8;
      const swingDrop = rideHeight * 0.35; // How far down the chains hang
      const swingOutward = canopyRadius * 0.7; // The outward centrifugal force
      
      for (let i = 0; i < numSwings; i++) {
         const angle = (i / numSwings) * Math.PI * 2;
         // Attachment point at the edge of the canopy
         const attachX = bx + Math.cos(angle) * (canopyRadius * 0.8);
         const attachZ = bz + Math.sin(angle) * (canopyRadius * 0.8);
         const attachY = hubY;

         // Seat point (swung outwards and downwards)
         const seatX = bx + Math.cos(angle) * (canopyRadius * 0.8 + swingOutward);
         const seatZ = bz + Math.sin(angle) * (canopyRadius * 0.8 + swingOutward);
         const seatY = attachY - swingDrop;

         // Chain links
         const chainLinks = 6;
         for (let j = 1; j <= chainLinks; j++) {
            const t = j / chainLinks;
            const lx = attachX + (seatX - attachX) * t;
            const ly = attachY + (seatY - attachY) * t;
            const lz = attachZ + (seatZ - attachZ) * t;
            rawBuildings.push({ name: '', x: lx, y: ly, z: lz, width: 0.3, depth: 0.3, height: 0.3, color: '#555555', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
         }

         // Rider Seat
         rawBuildings.push({ name: '', x: seatX, y: seatY, z: seatZ, width: 2.0, depth: 2.0, height: 1.5, color: '#00ffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (landmarkStyle === 12) {
      // Style 13: Crystal Tower (geometric crystal spire)
      const baseW = Math.min(baseW, baseD) * 0.35;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 1.2, depth: baseW * 1.2, height: h * 0.1, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      const facets = 8;
      for (let i = 0; i < facets; i++) {
        const angle = (i / facets) * Math.PI * 2;
        const facetX = bx + Math.cos(angle) * baseW * 0.4;
        const facetZ = bz + Math.sin(angle) * baseW * 0.4;
        const facetH = h * (0.3 + (i % 3) * 0.25);
        rawBuildings.push({ name: '', x: facetX, y: h * 0.1, z: facetZ, width: baseW * 0.5, depth: baseW * 0.5, height: facetH, color, shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
      }

      // Central spire
      rawBuildings.push({ name: '', x: bx, y: h * 0.4, z: bz, width: baseW * 0.4, depth: baseW * 0.4, height: h * 0.55, color: '#00ffff', shape: 'pyramid', polyCount: 5, parent_name: 'ROOT' });
    }
    return;
  }

  // 4. CORPO (HIGH-RISE)
  if (zoneTypeVal > 0.8 && zoneTypeVal < 1.5) {
    const h = overrideH !== undefined ? overrideH : (100 + Math.random() * 90) * (0.85 + Math.random() * 0.3); // Proportional height randomization
    let baseW = bw * 0.95;
    let baseD = bd * 0.95;

    let allowed = false;
    const scales = [1.0, 0.75, 0.5, 0.3];
    for (const scale of scales) {
      if (!isBlocked(bx, bz, baseW * scale, baseD * scale, 1.0)) {
        baseW = baseW * scale;
        baseD = baseD * scale;
        allowed = true;
        break;
      }
    }
    // Fallback: if still blocked, force a small footprint and spawn anyway to ensure the block is populated
    if (!allowed) {
      baseW = Math.max(4.0, bw * 0.3);
      baseD = Math.max(4.0, bd * 0.3);
    }

    const corpoStyle = styleOverride !== undefined ? styleOverride % 11 : Math.floor(Math.random() * 11); // 11 styles

    if (corpoStyle === 0) {
      // Style 0: Asymmetrical Nexus (main tower + data-centre annex + skybridges)
      const root = { name: '', description: '', x: bx - baseW * 0.2, y: 0, z: bz - baseD * 0.2, width: baseW * 0.6, depth: baseD * 0.6, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx - baseW * 0.2, bz - baseD * 0.2); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      const annex = { name: '', x: bx + baseW * 0.25, y: 0, z: bz + baseD * 0.25, width: baseW * 0.5, depth: baseD * 0.5, height: h * 0.4, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' };
      rawBuildings.push(annex);
      rawBuildings.push({ name: '', x: bx, y: h * 0.2, z: bz, width: baseW * 0.5, depth: baseD * 0.1, height: 4.0, color, shape: 'box', polyCount: 5, rotation: -0.785, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: h * 0.35, z: bz, width: baseW * 0.5, depth: baseD * 0.1, height: 4.0, color, shape: 'box', polyCount: 5, rotation: -0.785, parent_name: 'ROOT' });
    }
    else if (corpoStyle === 1) {
      // Style 1: Twin Spire with Skybridge Link
      const towerW = baseW * 0.4; const towerD = baseD * 0.8;
      const t1x = bx - baseW * 0.3; const t2x = bx + baseW * 0.3;

      if (allowed && (isBlocked(t1x, bz, towerW, towerD, 1.0) || isBlocked(t2x, bz, towerW, towerD, 1.0))) {
        // Fallback to Style 0 if sub-towers are blocked but parent plot was not blocked
        const baseH = h * 0.45; const midH = h * 0.35; const topH = h * 0.2;
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: baseH, color, shape: 'box', polyCount: 5 };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        rawBuildings.push({ name: '', x: bx, y: baseH, z: bz, width: baseW * 0.7, depth: baseD * 0.7, height: midH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx, y: baseH + midH, z: bz, width: baseW * 0.45, depth: baseD * 0.45, height: topH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx, y: baseH + midH + topH, z: bz, width: 0.2, depth: 0.2, height: h * 0.15, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      } else {
        const root = { name: '', description: '', x: t1x, y: 0, z: bz, width: towerW, depth: towerD, height: h, color, shape: 'box', polyCount: 5 };
        rawBuildings.push(root);
        const key = getGridKey(t1x, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        const beta = { name: '', x: t2x, y: 0, z: bz, width: towerW, depth: towerD, height: h, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' };
        rawBuildings.push(beta);
        const key2 = getGridKey(t2x, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(beta);
        
        const bridgeH = 4.0; const bridgeW = (t2x - t1x) - towerW;
        rawBuildings.push({ name: '', x: bx, y: h * 0.7, z: bz, width: bridgeW, depth: towerD * 0.4, height: bridgeH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      }
    } 
    else if (corpoStyle === 2) {
      // Style 2: Corporate Citadel with Symmetrical Wings (3 towers)
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.5, depth: baseD * 0.5, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      const wingW = baseW * 0.25; const wingD = baseD * 0.35; const wingH = h * 0.65;
      rawBuildings.push({ name: '', x: bx - baseW * 0.35, y: 0, z: bz, width: wingW, depth: wingD, height: wingH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      rawBuildings.push({ name: '', x: bx + baseW * 0.35, y: 0, z: bz, width: wingW, depth: wingD, height: wingH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
    } 
    else if (corpoStyle === 3) {
      // Style 3: Split Atrium Spire with Helipad/Comms Disc
      const towerW = baseW * 0.35; const towerD = baseD * 0.8;
      const t1x = bx - baseW * 0.25; const t2x = bx + baseW * 0.25;

      if (allowed && (isBlocked(t1x, bz, towerW, towerD, 1.0) || isBlocked(t2x, bz, towerW, towerD, 1.0))) {
        // Fallback to Style 0 if sub-towers are blocked but parent plot was not blocked
        const baseH = h * 0.45; const midH = h * 0.35; const topH = h * 0.2;
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: baseH, color, shape: 'box', polyCount: 5 };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        rawBuildings.push({ name: '', x: bx, y: baseH, z: bz, width: baseW * 0.7, depth: baseD * 0.7, height: midH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx, y: baseH + midH, z: bz, width: baseW * 0.45, depth: baseD * 0.45, height: topH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx, y: baseH + midH + topH, z: bz, width: 0.2, depth: 0.2, height: h * 0.15, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      } else {
        const root = { name: '', description: '', x: t1x, y: 0, z: bz, width: towerW, depth: towerD, height: h * 0.95, color, shape: 'box', polyCount: 5 };
        rawBuildings.push(root);
        const key = getGridKey(t1x, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        const beta = { name: '', x: t2x, y: 0, z: bz, width: towerW, depth: towerD, height: h * 0.95, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' };
        rawBuildings.push(beta);
        const key2 = getGridKey(t2x, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(beta);

        const helipadW = baseW * 1.1; const helipadD = baseD * 0.9;
        rawBuildings.push({ name: '', x: bx, y: h * 0.95, z: bz, width: helipadW, depth: helipadD, height: 2.0, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: bx, y: h * 0.95 + 2.0, z: bz, width: 0.15, depth: 0.15, height: h * 0.18, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      }
    }
    else if (corpoStyle === 4) {
      // Style 4: Cylindrical Tower with Outer Ribs
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.65, depth: baseD * 0.65, height: h, color, shape: 'cylinder', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // 4 outer structural ribs (boxes)
      const ribW = baseW * 0.08; const ribH = h * 0.82;
      const ribDistX = baseW * 0.35; const ribDistZ = baseD * 0.35;
      rawBuildings.push({ name: '', x: bx - ribDistX, y: 0, z: bz, width: ribW, depth: ribW * 2, height: ribH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      rawBuildings.push({ name: '', x: bx + ribDistX, y: 0, z: bz, width: ribW, depth: ribW * 2, height: ribH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz - ribDistZ, width: ribW * 2, depth: ribW, height: ribH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + ribDistZ, width: ribW * 2, depth: ribW, height: ribH, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });

      // Glowing top sphere
      const sphereR = Math.min(baseW, baseD) * 0.28;
      rawBuildings.push({ name: '', x: bx, y: h, z: bz, width: sphereR, depth: sphereR, height: sphereR, color, shape: 'sphere', polyCount: 5, parent_name: 'CORP_ROOT' });
    }
    else if (corpoStyle === 5) {
      // Style 5: Stepped Ziggurat / Arch Spire
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.38, depth: baseD * 0.72, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Stepped side towers
      const sideW = baseW * 0.26; const sideD = baseD * 0.55;
      rawBuildings.push({ name: '', x: bx - baseW * 0.32, y: 0, z: bz, width: sideW, depth: sideD, height: h * 0.65, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
      rawBuildings.push({ name: '', x: bx + baseW * 0.32, y: 0, z: bz, width: sideW, depth: sideD, height: h * 0.65, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });

      // Sky arch link
      rawBuildings.push({ name: '', x: bx, y: h * 0.58, z: bz, width: baseW * 0.8, depth: sideD * 0.5, height: 3.5, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
    }
    else if (corpoStyle === 6) {
      // Style 6: Tri-Tower Hub (Three cylinders grouped)
      const tW = baseW * 0.38; const tD = baseD * 0.38;
      const c1x = bx; const c1z = bz - baseD * 0.2;
      const c2x = bx - baseW * 0.2; const c2z = bz + baseD * 0.18;
      const c3x = bx + baseW * 0.2; const c3z = bz + baseD * 0.18;

      const root = { name: '', description: '', x: c1x, y: 0, z: c1z, width: tW, depth: tD, height: h * 0.9, color, shape: 'cylinder', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(c1x, c1z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      rawBuildings.push({ name: '', x: c2x, y: 0, z: c2z, width: tW, depth: tD, height: h * 0.75, color, shape: 'cylinder', polyCount: 5, parent_name: 'CORP_ROOT' });
      rawBuildings.push({ name: '', x: c3x, y: 0, z: c3z, width: tW, depth: tD, height: h * 0.98, color, shape: 'cylinder', polyCount: 5, parent_name: 'CORP_ROOT' });

      // Central box atrium core linking them
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: baseW * 0.3, depth: baseD * 0.3, height: h * 0.7, color, shape: 'box', polyCount: 5, parent_name: 'CORP_ROOT' });
    }
    else if (corpoStyle === 7) {
      // Style 7: Cantilevered / Stacked Rotated Spire
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: h * 0.35, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Rotated tier 2
      rawBuildings.push({ name: '', x: bx + baseW * 0.08, y: h * 0.35, z: bz - baseD * 0.05, width: baseW * 0.72, depth: baseD * 0.72, height: h * 0.3, color, shape: 'box', polyCount: 5, rotation: 0.15, parent_name: 'ROOT' });
      // Rotated tier 3
      rawBuildings.push({ name: '', x: bx - baseW * 0.05, y: h * 0.65, z: bz + baseD * 0.08, width: baseW * 0.5, depth: baseD * 0.5, height: h * 0.25, color, shape: 'box', polyCount: 5, rotation: -0.15, parent_name: 'ROOT' });
      // Antenna
      rawBuildings.push({ name: '', x: bx, y: h * 0.9, z: bz, width: 0.2, depth: 0.2, height: h * 0.16, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (corpoStyle === 8) {
      // Style 8: The Monolith Slab
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD * 0.6, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Vertical data core
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + baseD * 0.3, width: baseW * 0.2, depth: baseD * 0.1, height: h * 1.05, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (corpoStyle === 9) {
      // Style 9: Stepped Corporate Spire (3 stacked tiers)
      const baseH = h * 0.45; const midH = h * 0.35; const topH = h * 0.2;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: baseH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      rawBuildings.push({ name: '', x: bx, y: baseH, z: bz, width: baseW * 0.7, depth: baseD * 0.7, height: midH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: baseH + midH, z: bz, width: baseW * 0.45, depth: baseD * 0.45, height: topH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: baseH + midH + topH, z: bz, width: 0.2, depth: 0.2, height: h * 0.15, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    else if (corpoStyle === 10) {
      // Style 11: Player Custom Structure (L-Shaped Cantilever Tower)
      const rootW = baseW * 0.25;
      const rootD = baseD;
      const rootH = h * 0.91;
      const rootX = bx - baseW * 0.375;

      const root = { name: '', description: '', x: rootX, y: 0, z: bz, width: rootW, depth: rootD, height: rootH, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(rootX, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      const midY = h * 0.32;
      const midH = h * 0.41;
      rawBuildings.push({ name: '', x: bx, y: midY, z: bz, width: baseW * 0.5, depth: baseD * 0.7, height: midH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      const topY = h * 0.84;
      const topH = h * 0.07;
      rawBuildings.push({ name: '', x: bx, y: topY, z: bz, width: baseW, depth: baseD * 0.9, height: topH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      const spireY = h * 0.91;
      const spireH = h * 0.09;
      rawBuildings.push({ name: '', x: rootX, y: spireY, z: bz, width: baseW * 0.02, depth: baseD * 0.02, height: spireH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
    }
    return;
  }

  // 4. URBAN (APARTMENT COMPLEXES)
  if (zoneTypeVal > 0.3 && zoneTypeVal < 0.8) {
    const h = overrideH !== undefined ? overrideH : (10 + Math.random() * 20) * (0.8 + Math.random() * 0.4);
    const urbanStyle = styleOverride !== undefined ? styleOverride % 10 : Math.floor(Math.random() * 10);

    if (urbanStyle === 0) {
      // Style 0: Courtyard Apartment (Hollow O-block)
      const wingD = bd * 0.22;
      const wingW = bw * 0.22;
      
      const root = { name: '', description: '', x: bx, y: 0, z: bz - bd * 0.39, width: bw, depth: wingD, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz - bd * 0.39); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // South wing
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + bd * 0.39, width: bw, depth: wingD, height: h * 0.9, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // West wing
      rawBuildings.push({ name: '', x: bx - bw * 0.39, y: 0, z: bz, width: wingW, depth: bd * 0.56, height: h * 0.95, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // East wing
      rawBuildings.push({ name: '', x: bx + bw * 0.39, y: 0, z: bz, width: wingW, depth: bd * 0.56, height: h * 0.85, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Courtyard grass lawn
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bw * 0.54, depth: bd * 0.54, height: 0.1, color: '#1a5925', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      
      // Holographic tree in center
      const trunkH = 1.8;
      rawBuildings.push({ name: 'HOLOTREE_TRUNK', x: bx, y: 0.1, z: bz, width: 0.2, depth: 0.2, height: trunkH, color: '#00ff66', shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: 'HOLOTREE_CANOPY', x: bx, y: 0.1 + trunkH, z: bz, width: 1.5, depth: 1.5, height: 1.5, color: '#00ff66', shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });

      // Stacked balconies on exterior sides
      const balW = 0.4; const balD = 1.8; const balH = 0.15;
      for (let yLevel = 3.0; yLevel < h - 2; yLevel += 4.0) {
        // Balconies on West facade of West wing
        rawBuildings.push({ name: '', x: bx - bw * 0.39 - wingW/2 - balW/2, y: yLevel, z: bz - bd * 0.15, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx - bw * 0.39 - wingW/2 - balW/2, y: yLevel, z: bz + bd * 0.15, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

        // Balconies on East facade of East wing
        rawBuildings.push({ name: '', x: bx + bw * 0.39 + wingW/2 + balW/2, y: yLevel, z: bz - bd * 0.15, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + bw * 0.39 + wingW/2 + balW/2, y: yLevel, z: bz + bd * 0.15, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 1) {
      // Style 1: U-Shape Complex with Parking Lot
      const wingD = bd * 0.25;
      const wingW = bw * 0.25;

      const root = { name: '', description: '', x: bx, y: 0, z: bz - bd * 0.375, width: bw, depth: wingD, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz - bd * 0.375); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // East wing
      rawBuildings.push({ name: '', x: bx + bw * 0.375, y: 0, z: bz + bd * 0.125, width: wingW, depth: bd * 0.75, height: h * 0.9, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      // West wing
      rawBuildings.push({ name: '', x: bx - bw * 0.375, y: 0, z: bz + bd * 0.125, width: wingW, depth: bd * 0.75, height: h * 0.9, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Dark asphalt parking lot pad
      const lotW = bw * 0.5; const lotD = bd * 0.7;
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + bd * 0.125, width: lotW, depth: lotD, height: 0.08, color: '#242528', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Small box cars parked in the lot
      const carW = 1.0; const carD = 1.8; const carH = 0.65;
      const carColors = ['#cc3333', '#3355cc', '#4f5259', '#d1d5db'];
      rawBuildings.push({ name: 'PARKED_VEHICLE', x: bx - lotW * 0.22, y: 0.08, z: bz + bd * 0.05, width: carW, depth: carD, height: carH, color: carColors[0], shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: 'PARKED_VEHICLE', x: bx - lotW * 0.22, y: 0.08, z: bz + bd * 0.25, width: carW, depth: carD, height: carH, color: carColors[1], shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: 'PARKED_VEHICLE', x: bx + lotW * 0.22, y: 0.08, z: bz + bd * 0.05, width: carW, depth: carD, height: carH, color: carColors[2], shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: 'PARKED_VEHICLE', x: bx + lotW * 0.22, y: 0.08, z: bz + bd * 0.25, width: carW, depth: carD, height: carH, color: carColors[3], shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Balconies facing the parking lot
      const balW = 0.4; const balD = 1.5; const balH = 0.15;
      for (let yLevel = 3.0; yLevel < h - 2; yLevel += 4.0) {
        rawBuildings.push({ name: '', x: bx - bw * 0.375 + wingW/2 + balW/2, y: yLevel, z: bz + bd * 0.1, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + bw * 0.375 - wingW/2 - balW/2, y: yLevel, z: bz + bd * 0.1, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 2) {
      // Style 2: L-Shape Terrace with Recreation Plaza
      const wingD = bd * 0.28;
      const wingW = bw * 0.28;

      const root = { name: '', description: '', x: bx, y: 0, z: bz - bd * 0.36, width: bw, depth: wingD, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz - bd * 0.36); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // West wing (terraced shorter)
      const westH = h * 0.75;
      rawBuildings.push({ name: '', x: bx - bw * 0.36, y: 0, z: bz + bd * 0.14, width: wingW, depth: bd * 0.72, height: westH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Plaza pad
      const plazaW = bw * 0.68; const plazaD = bd * 0.68;
      rawBuildings.push({ name: '', x: bx + bw * 0.14, y: 0, z: bz + bd * 0.14, width: plazaW, depth: plazaD, height: 0.08, color: '#524337', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Gazebo
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 0.08, z: bz + bd * 0.25, width: 0.1, depth: 0.1, height: 2.5, color: '#a3a3a3', shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 2.58, z: bz + bd * 0.25, width: 2.0, depth: 2.0, height: 0.15, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Plaza Tree
      rawBuildings.push({ name: 'HOLOTREE_TRUNK', x: bx + bw * 0.05, y: 0.08, z: bz + bd * 0.05, width: 0.15, depth: 0.15, height: 1.5, color: '#00ff66', shape: 'cylinder', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: 'HOLOTREE_CANOPY', x: bx + bw * 0.05, y: 1.58, z: bz + bd * 0.05, width: 1.2, depth: 1.2, height: 1.2, color: '#00ff66', shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });

      // Balconies facing the plaza
      const balW = 0.4; const balD = 1.6; const balH = 0.15;
      for (let yLevel = 3.0; yLevel < h - 2; yLevel += 4.0) {
        rawBuildings.push({ name: '', x: bx + bw * 0.15, y: yLevel, z: bz - bd * 0.36 + wingD/2 + balW/2, width: balD, depth: balW, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
      for (let yLevel = 3.0; yLevel < westH - 2; yLevel += 4.0) {
        rawBuildings.push({ name: '', x: bx - bw * 0.36 + wingW/2 + balW/2, y: yLevel, z: bz + bd * 0.05, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 3) {
      // Style 3: Parallel Slab Towers with Sky Bridge
      const wingW = bw * 0.24;
      const root = { name: '', description: '', x: bx - bw * 0.38, y: 0, z: bz, width: wingW, depth: bd, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx - bw * 0.38, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // East wing slab
      rawBuildings.push({ name: '', x: bx + bw * 0.38, y: 0, z: bz, width: wingW, depth: bd, height: h, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Central landscape pathway
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bw * 0.52, depth: bd * 0.9, height: 0.08, color: '#3d3e42', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Sky bridge linking them at h * 0.7 height
      const bridgeH = 3.0; const bridgeY = h * 0.65;
      rawBuildings.push({ name: '', x: bx, y: bridgeY, z: bz, width: bw * 0.52, depth: bd * 0.22, height: bridgeH, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Stacked balconies on front and back end faces
      const balW = wingW * 0.8; const balD = 0.4; const balH = 0.15;
      for (let yLevel = 3.0; yLevel < h - 2; yLevel += 4.0) {
        rawBuildings.push({ name: '', x: bx - bw * 0.38, y: yLevel, z: bz - bd/2 - balD/2, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx - bw * 0.38, y: yLevel, z: bz + bd/2 + balD/2, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + bw * 0.38, y: yLevel, z: bz - bd/2 - balD/2, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + bw * 0.38, y: yLevel, z: bz + bd/2 + balD/2, width: balW, depth: balD, height: balH, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 4) {
      // Style 4: Urban Standard A
      // Instructions: A towering mixed living building, that should have balconies, or windows. they can also have courtyards, or parking lots.
      const mainW = bw * 0.8; const mainD = bd * 0.5;
      const root = { name: '', description: '', x: bx, y: 0, z: bz - bd * 0.2, width: mainW, depth: mainD, height: h, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz - bd * 0.2); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      // Parking Lot
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + bd * 0.25, width: bw * 0.8, depth: bd * 0.4, height: 0.1, color: '#242528', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - bw*0.2, y: 0.1, z: bz + bd*0.25, width: 1.0, depth: 2.0, height: 0.8, color: '#cc3333', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      
      // Balconies
      for (let yLevel = 4.0; yLevel < h - 3; yLevel += 4.0) {
        rawBuildings.push({ name: '', x: bx, y: yLevel, z: bz - bd * 0.2 + mainD/2 + 0.5, width: mainW * 0.6, depth: 1.0, height: 0.2, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 5) {
      // Style 5: Urban Standard B
      // Instructions: A towering mixed living building, that should have balconies, or windows. they can also have courtyards, or parking lots.
      const mainW = bw * 0.6; const mainD = bd * 0.6;
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: mainW, depth: mainD, height: h * 1.2, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      // Courtyard (wrap around base)
      rawBuildings.push({ name: '', x: bx + bw*0.3, y: 0, z: bz, width: bw * 0.3, depth: bd * 0.8, height: 0.1, color: '#1a5925', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw*0.3, y: 0.1, z: bz, width: 1.5, depth: 1.5, height: 3.0, color: '#00ff66', shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
      
      // Windows
      for (let yLevel = 5.0; yLevel < h * 1.2 - 5; yLevel += 5.0) {
        rawBuildings.push({ name: '', x: bx + mainW/2 + 0.1, y: yLevel, z: bz, width: 0.2, depth: mainD * 0.5, height: 2.0, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 6) {
      // Style 6: Urban Standard C
      // Instructions: A towering mixed living building, that should have balconies, or windows. they can also have courtyards, or parking lots.
      const mainW = bw * 0.9; const mainD = bd * 0.4;
      const root = { name: '', description: '', x: bx, y: 0, z: bz + bd * 0.25, width: mainW, depth: mainD, height: h * 0.9, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz + bd * 0.25); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      // Parking Lot
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz - bd * 0.25, width: bw * 0.9, depth: bd * 0.45, height: 0.1, color: '#242528', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx + bw*0.2, y: 0.1, z: bz - bd*0.25, width: 1.2, depth: 2.2, height: 0.9, color: '#3355cc', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Balconies
      for (let yLevel = 3.0; yLevel < h * 0.9 - 3; yLevel += 3.5) {
        rawBuildings.push({ name: '', x: bx - bw*0.2, y: yLevel, z: bz + bd * 0.25 - mainD/2 - 0.4, width: 2.0, depth: 0.8, height: 0.3, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + bw*0.2, y: yLevel, z: bz + bd * 0.25 - mainD/2 - 0.4, width: 2.0, depth: 0.8, height: 0.3, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 7) {
      // Style 7: Urban Standard D
      // Instructions: A towering mixed living building, that should have balconies, or windows. they can also have courtyards, or parking lots.
      const mainW = bw * 0.5; const mainD = bd * 0.8;
      const root = { name: '', description: '', x: bx - bw * 0.2, y: 0, z: bz, width: mainW, depth: mainD, height: h * 1.1, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx - bw * 0.2, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      // Courtyard
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 0, z: bz, width: bw * 0.4, depth: bd * 0.8, height: 0.1, color: '#1a5925', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      for (let i = -1; i <= 1; i += 2) {
        rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 0.1, z: bz + i * bd * 0.2, width: 1.2, depth: 1.2, height: 2.5, color: '#00ff66', shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });
      }

      // Windows
      for (let yLevel = 4.0; yLevel < h * 1.1 - 4; yLevel += 6.0) {
        rawBuildings.push({ name: '', x: bx - bw * 0.2 + mainW/2 + 0.1, y: yLevel, z: bz, width: 0.2, depth: mainD * 0.6, height: 3.0, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 8) {
      // Style 8: Urban Standard E
      // Instructions: A towering mixed living building, that should have balconies, or windows. they can also have courtyards, or parking lots.
      const mainW = bw * 0.7; const mainD = bd * 0.7;
      const root = { name: '', description: '', x: bx, y: 0, z: bz - bd * 0.1, width: mainW, depth: mainD, height: h * 1.3, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz - bd * 0.1); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      // Parking Lot
      rawBuildings.push({ name: '', x: bx, y: 0, z: bz + bd * 0.35, width: bw * 0.9, depth: bd * 0.2, height: 0.1, color: '#242528', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: 0.1, z: bz + bd * 0.35, width: 1.5, depth: 1.0, height: 0.8, color: '#d1d5db', shape: 'box', polyCount: 5, parent_name: 'ROOT' });

      // Balconies
      for (let yLevel = 5.0; yLevel < h * 1.3 - 5; yLevel += 5.0) {
        rawBuildings.push({ name: '', x: bx - mainW/4, y: yLevel, z: bz - bd * 0.1 + mainD/2 + 0.5, width: mainW * 0.3, depth: 1.0, height: 0.2, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + mainW/4, y: yLevel, z: bz - bd * 0.1 + mainD/2 + 0.5, width: mainW * 0.3, depth: 1.0, height: 0.2, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    else if (urbanStyle === 9) {
      // Style 9: Urban Standard F
      // Instructions: A towering mixed living building, that should have balconies, or windows. they can also have courtyards, or parking lots.
      const mainW = bw * 0.65; const mainD = bd * 0.65;
      const root = { name: '', description: '', x: bx + bw * 0.1, y: 0, z: bz + bd * 0.1, width: mainW, depth: mainD, height: h * 1.15, color, shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx + bw * 0.1, bz + bd * 0.1); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      // Courtyard
      rawBuildings.push({ name: '', x: bx - bw * 0.3, y: 0, z: bz - bd * 0.3, width: bw * 0.3, depth: bd * 0.3, height: 0.1, color: '#1a5925', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx - bw * 0.3, y: 0.1, z: bz - bd * 0.3, width: 2.0, depth: 2.0, height: 2.0, color: '#00ff66', shape: 'sphere', polyCount: 5, parent_name: 'ROOT' });

      // Windows and Balconies
      for (let yLevel = 4.0; yLevel < h * 1.15 - 4; yLevel += 4.5) {
        rawBuildings.push({ name: '', x: bx + bw * 0.1 - mainW/2 - 0.1, y: yLevel, z: bz + bd * 0.1, width: 0.2, depth: mainD * 0.5, height: 2.5, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx + bw * 0.1, y: yLevel, z: bz + bd * 0.1 - mainD/2 - 0.4, width: mainW * 0.4, depth: 0.8, height: 0.2, color: '#ffffff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    }
    return;
  }
  
  // 5. MARKETS
  if (zoneTypeVal >= 2.0 && zoneTypeVal < 3.0) {
    const h = overrideH !== undefined ? overrideH : (10 + Math.random() * 20);
    const marketStyle = styleOverride !== undefined ? styleOverride % 5 : Math.floor(Math.random() * 5);

    if (marketStyle === 0 || marketStyle === 1) {
      // Stall Markets: 5-8 market stalls (small rectangles with overhangs and tables)
      const numStalls = 5 + Math.floor(Math.random() * 4); // 5 to 8
      const stallW = bw * 0.15; const stallD = bd * 0.15; const stallH = 2.5;
      
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 0.1, color: '#333', shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      for (let i = 0; i < numStalls; i++) {
        // Random placement within bounds
        const sx = bx - bw/2 + stallW/2 + Math.random() * (bw - stallW);
        const sz = bz - bd/2 + stallD/2 + Math.random() * (bd - stallD);
        
        // Main stall box
        rawBuildings.push({ name: '', x: sx, y: 0.1, z: sz, width: stallW, depth: stallD, height: stallH, color: '#666', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        // Overhang awning
        rawBuildings.push({ name: '', x: sx, y: 0.1 + stallH, z: sz + stallD*0.3, width: stallW*1.1, depth: stallD*1.2, height: 0.1, color: ['#cc3333','#3355cc','#33cc55','#ddaa22'][Math.floor(Math.random()*4)], shape: 'box', polyCount: 5, rotation: 0.1, parent_name: 'ROOT' });
        // Table in front
        rawBuildings.push({ name: '', x: sx, y: 0.1, z: sz + stallD*0.6, width: stallW*0.8, depth: stallD*0.4, height: 0.8, color: '#8b5a2b', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
      }
    } else {
      // Super Markets: Long rectangular buildings (Pipe, L, C shaped) with multiple levels and stores with outdoor stairs and walkways
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 0.1, color: '#222', shape: 'box', polyCount: 5 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      const levels = 2 + Math.floor(Math.random() * 2); // 2 to 3 levels
      const levelH = 4.0;
      const wingW = bw * 0.3; const wingD = bd * 0.3;
      
      for (let L = 0; L < levels; L++) {
        const yBase = 0.1 + L * levelH;
        
        // Base rectangular shapes depending on style (2: Pipe/I, 3: L, 4: C)
        if (marketStyle === 2) { // Pipe / I Shape
          rawBuildings.push({ name: '', x: bx, y: yBase, z: bz, width: bw * 0.8, depth: wingD, height: levelH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
          // Walkway on one side
          rawBuildings.push({ name: '', x: bx, y: yBase, z: bz + wingD/2 + 0.5, width: bw * 0.8, depth: 1.0, height: 0.2, color: '#aaa', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        } else if (marketStyle === 3) { // L Shape
          rawBuildings.push({ name: '', x: bx, y: yBase, z: bz - bd*0.25, width: bw * 0.8, depth: wingD, height: levelH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
          rawBuildings.push({ name: '', x: bx - bw*0.25, y: yBase, z: bz + bd*0.15, width: wingW, depth: bd * 0.5, height: levelH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
          // Walkway inner corner
          rawBuildings.push({ name: '', x: bx + bw*0.15, y: yBase, z: bz - bd*0.1, width: bw * 0.5, depth: 1.0, height: 0.2, color: '#aaa', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        } else if (marketStyle === 4) { // C Shape
          rawBuildings.push({ name: '', x: bx, y: yBase, z: bz - bd*0.35, width: bw * 0.9, depth: wingD, height: levelH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
          rawBuildings.push({ name: '', x: bx - bw*0.3, y: yBase, z: bz, width: wingW, depth: bd * 0.6, height: levelH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
          rawBuildings.push({ name: '', x: bx + bw*0.3, y: yBase, z: bz, width: wingW, depth: bd * 0.6, height: levelH, color, shape: 'box', polyCount: 5, parent_name: 'ROOT' });
          // Walkways inner edges
          rawBuildings.push({ name: '', x: bx, y: yBase, z: bz - bd*0.15, width: bw * 0.6, depth: 1.0, height: 0.2, color: '#aaa', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        }

        // Stores (Glass windows)
        if (marketStyle === 2) {
          rawBuildings.push({ name: '', x: bx, y: yBase + 1.0, z: bz + wingD/2, width: bw * 0.7, depth: 0.2, height: levelH - 1.5, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        } else if (marketStyle === 3) {
          rawBuildings.push({ name: '', x: bx + bw*0.15, y: yBase + 1.0, z: bz - bd*0.25 + wingD/2, width: bw * 0.5, depth: 0.2, height: levelH - 1.5, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        } else if (marketStyle === 4) {
          rawBuildings.push({ name: '', x: bx, y: yBase + 1.0, z: bz - bd*0.35 + wingD/2, width: bw * 0.5, depth: 0.2, height: levelH - 1.5, color: '#00e5ff', shape: 'box', polyCount: 5, parent_name: 'ROOT' });
        }

        // Outdoor Stairs connecting levels (if not top level)
        if (L < levels - 1) {
          rawBuildings.push({ name: '', x: bx + bw*0.3, y: yBase, z: bz + bd*0.3, width: 2.0, depth: 4.0, height: levelH, color: '#888', shape: 'pyramid', polyCount: 5, rotation: 0, parent_name: 'ROOT' });
        }
      }
    }
    return;
  }

  const bId = blockId || `plot_${bx.toFixed(3)}_${bz.toFixed(3)}`;
  for (let i = startIndex; i < rawBuildings.length; i++) {
    rawBuildings[i].temp_block_id = bId;
  }
};
