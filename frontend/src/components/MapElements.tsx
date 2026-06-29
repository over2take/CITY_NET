import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';

export const DistrictInteractions = React.memo(({ view, locations, onSelectionChange, roadTrail, setRoadTrail, waterTrail, setWaterTrail, onWaterDrawEnd, roadDrawMode, snapToGrid, drawingRoadWidth, isBatchSelecting, setSelectedIds, rhombusState, setRhombusState, userName, refreshLocations, token }: any) => {
  const { camera, gl, controls } = useThree();
  const [dragStart, setDragStart] = useState<THREE.Vector3 | null>(null);
  const [dragEnd, setDragEnd] = useState<THREE.Vector3 | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const raycaster = useRef(new THREE.Raycaster());
  const mouseScreenPos = useRef<{ x: number, y: number } | null>(null);
  const waterTrailRef = useRef<THREE.Vector3[]>([]);

  useFrame((state, delta) => {
    if (view === 'draw_roads' && isPainting && mouseScreenPos.current && controls) {
      const rect = gl.domElement.getBoundingClientRect();
      const mx = mouseScreenPos.current.x - rect.left;
      const my = mouseScreenPos.current.y - rect.top;
      const edgeSize = 40; 
      let panX = 0;
      let panZ = 0;

      if (mx < edgeSize) panX = -1;
      else if (mx > rect.width - edgeSize) panX = 1;
      
      if (my < edgeSize) panZ = -1;
      else if (my > rect.height - edgeSize) panZ = 1;

      if (panX !== 0 || panZ !== 0) {
        const speed = 40 * delta;
        if ((controls as any).moveTo) {
            const t = new THREE.Vector3();
            (controls as any).getTarget(t);
            (controls as any).moveTo(t.x + panX * speed, t.y, t.z + panZ * speed, false);
        } else {
            camera.position.x += panX * speed;
            camera.position.z += panZ * speed;
            (controls as any).target.x += panX * speed;
            (controls as any).target.z += panZ * speed;
        }
        
        camera.updateMatrixWorld();

        // Continue drawing road while panning
        const mouse = new THREE.Vector2((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1);
        raycaster.current.setFromCamera(mouse, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3(); 
        raycaster.current.ray.intersectPlane(plane, target);
        if (snapToGrid) { target.x = Math.round(target.x); target.z = Math.round(target.z); }

        if (setRoadTrail) {
          setRoadTrail((prev: any) => {
              if (!prev || prev.length === 0) return prev;
              const newPaths = [...prev];
              const currentPath = [...newPaths[newPaths.length - 1]];
              if (roadDrawMode === 'straight') {
                  currentPath[1] = target.clone();
              } else {
                  const lastPos = currentPath[currentPath.length - 1];
                  if (!lastPos || target.distanceTo(lastPos) > 0.8) currentPath.push(target.clone());
              }
              newPaths[newPaths.length - 1] = currentPath;
              return newPaths;
          });
        }
      }
    }
  });

  useEffect(() => {
    if ((view === 'district' || view === 'draw_roads' || view === 'draw_water' || view === 'city_gen' || isBatchSelecting) && controls) {
      if ((controls as any).setLookAt) {
          (controls as any).setLookAt(0, 100, 0.1, 0, 0, 0, false);
      } else {
          camera.position.set(0, 100, 0.1);
          (controls as any).target.set(0, 0, 0);
      }
      (controls as any).update();
      (controls as any).minPolarAngle = 0;
      (controls as any).maxPolarAngle = 0.01;
    } else if (controls) {
      (controls as any).minPolarAngle = 0;
      (controls as any).maxPolarAngle = Math.PI;
    }
  }, [view, controls, camera]);

  useEffect(() => {
    if (view !== 'district' && view !== 'draw_roads' && view !== 'draw_water' && view !== 'city_gen' && !isBatchSelecting && !rhombusState?.active) return;

    const getMouseWorldPos = (e: MouseEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.current.setFromCamera(mouse, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3(); raycaster.current.ray.intersectPlane(plane, target);
        if (snapToGrid) { target.x = Math.round(target.x); target.z = Math.round(target.z); }
        return target;
    };

    const deployRhombus = async (pos: THREE.Vector3) => {
        // Enforce ONE rhombus per user per context
        const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
        
        const newRhombus = {
            name: rhombusState.name || '',
            description: rhombusState.description || '',
            x: pos.x, y: 0.1, z: pos.z,
            width: 3.75, height: 3.75, depth: 3.75,
            shape: 'rhombus',
            color: rhombusState.color,
            owner: userName,
            hp_max: existing ? (existing.hp_max ?? 100) : (rhombusState.hp_max || 100),
            hp_current: existing ? (existing.hp_current ?? existing.hp_max ?? 100) : (rhombusState.hp_max || 100),
            hp_temp: existing ? (existing.hp_temp ?? 0) : 0,
            battle_map_id: null,
            floor_index: null
        };

        if (existing) {
            // Move existing
            await fetch(`/api/locations/${existing.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(newRhombus)
            });
        } else {
            // Create new
            await fetch('/api/locations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newRhombus)
            });
        }

        refreshLocations();
        setRhombusState(p => ({ ...p, active: false }));
    };

    const handlePointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        
        const pos = getMouseWorldPos(e);

        if (rhombusState?.active) {
            deployRhombus(pos);
            return;
        }

        if (view === 'draw_roads' && setRoadTrail) {
            if (controls) (controls as any).enabled = false;
            setIsPainting(true); 
            setRoadTrail((prev: any) => [...prev, [pos.clone(), pos.clone()]]);
        } else if (view === 'draw_water' && setWaterTrail) {
            if (controls) (controls as any).enabled = false;
            setIsPainting(true);
            const initialPath = [pos.clone()];
            setWaterTrail(initialPath);
            waterTrailRef.current = initialPath;
        } else if (view === 'district' || view === 'city_gen' || isBatchSelecting) {
            if (controls) (controls as any).enabled = false;
            setDragStart(pos.clone()); setDragEnd(pos.clone());
        }
    };

    const handlePointerMove = (e: PointerEvent) => {
        mouseScreenPos.current = { x: e.clientX, y: e.clientY };
        if (view === 'draw_roads' && isPainting && setRoadTrail) {
            const pos = getMouseWorldPos(e);
            setRoadTrail((prev: any) => {
                const newPaths = [...prev];
                const currentPath = [...newPaths[newPaths.length - 1]];
                if (roadDrawMode === 'straight') {
                    currentPath[1] = pos.clone();
                } else {
                    const lastPos = currentPath[currentPath.length - 1];
                    if (!lastPos || pos.distanceTo(lastPos) > 0.8) currentPath.push(pos.clone());
                }
                newPaths[newPaths.length - 1] = currentPath;
                return newPaths;
            });
        } else if (view === 'draw_water' && isPainting && setWaterTrail) {
            const pos = getMouseWorldPos(e);
            const lastPos = waterTrailRef.current[waterTrailRef.current.length - 1];
            if (!lastPos || pos.distanceTo(lastPos) > 0.8) {
                waterTrailRef.current.push(pos.clone());
                setWaterTrail([...waterTrailRef.current]);
            }
        } else if (dragStart) {
            const pos = getMouseWorldPos(e); setDragEnd(pos.clone());
        }
    };

    const handlePointerUp = () => {
        mouseScreenPos.current = null;
        if (controls) (controls as any).enabled = true;
        if (view === 'draw_roads') { setIsPainting(false); return; }
        if (view === 'draw_water') {
            setIsPainting(false);
            if (onWaterDrawEnd && waterTrailRef.current.length > 2) {
                onWaterDrawEnd([...waterTrailRef.current]);
            }
            if (setWaterTrail) setWaterTrail([]);
            waterTrailRef.current = [];
            return;
        }
        if (!dragStart || !dragEnd) return;
        const minX = Math.min(dragStart.x, dragEnd.x); const maxX = Math.max(dragStart.x, dragEnd.x);
        const minZ = Math.min(dragStart.z, dragEnd.z); const maxZ = Math.max(dragStart.z, dragEnd.z);

        if (view === 'city_gen') {
            onSelectionChange({ min: new THREE.Vector3(minX, 0, minZ), max: new THREE.Vector3(maxX, 0, maxZ) });
        } else {
            const selectedIds: number[] = [];
            locations.forEach(loc => { if (loc.x >= minX && loc.x <= maxX && loc.z >= minZ && loc.z <= maxZ) selectedIds.push(loc.id); });
            if (selectedIds.length > 0) onSelectionChange(selectedIds);
        }
        setDragStart(null); setDragEnd(null);
    };

    gl.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
        gl.domElement.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [view, dragStart, dragEnd, isPainting, gl, camera, locations, onSelectionChange, controls, setRoadTrail, setWaterTrail, roadDrawMode, snapToGrid, rhombusState, setRhombusState, isBatchSelecting, userName, refreshLocations]);

  return (
    <>
      {dragStart && dragEnd && (
          <mesh position={[(dragStart.x + dragEnd.x) / 2, 0.1, (dragStart.z + dragEnd.z) / 2]}>
              <boxGeometry args={[Math.abs(dragEnd.x - dragStart.x), 0.1, Math.abs(dragEnd.z - dragStart.z)]} />
              <meshBasicMaterial color="#ffff00" wireframe transparent opacity={0.5} />
          </mesh>
      )}
      {view === 'draw_roads' && roadTrail && roadTrail.length > 0 && (
          <group>
              {roadTrail.map((path, pathIdx) => (
                  <group key={pathIdx}>
                      {path.map((p: any, i: number) => {
                          if (i === path.length - 1) return null;
                          const pNext = path[i+1];
                          const dist = p.distanceTo(pNext);
                          if (dist < 0.1) return null;
                          const roadPos = p.clone().lerp(pNext, 0.5);
                          roadPos.y = 0.01;
                          return (
                              <group key={i} position={roadPos} onUpdate={(self) => self.lookAt(pNext)}>
                                  <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
                                      <planeGeometry args={[dist, drawingRoadWidth]} />
                                      <meshBasicMaterial color="#ffff00" transparent opacity={0.4} side={THREE.DoubleSide} />
                                  </mesh>
                              </group>
                          );
                      })}
                  </group>
              ))}
          </group>
      )}
      {view === 'draw_water' && waterTrail && waterTrail.length > 0 && (
          <group>
              {waterTrail.map((p: any, i: number) => {
                  if (i === waterTrail.length - 1) return null;
                  const pNext = waterTrail[i+1];
                  const dist = p.distanceTo(pNext);
                  if (dist < 0.1) return null;
                  const linePos = p.clone().lerp(pNext, 0.5);
                  linePos.y = 0.02;
                  return (
                      <group key={i} position={linePos} onUpdate={(self) => self.lookAt(pNext)}>
                          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
                              <planeGeometry args={[dist, 0.5]} />
                              <meshBasicMaterial color="#0088ff" transparent opacity={0.6} side={THREE.DoubleSide} />
                          </mesh>
                      </group>
                  );
              })}
              {waterTrail.length > 2 && (
                  // Draw closing line preview
                  <group position={waterTrail[waterTrail.length - 1].clone().lerp(waterTrail[0], 0.5)} onUpdate={(self) => self.lookAt(waterTrail[0])}>
                      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
                          <planeGeometry args={[waterTrail[waterTrail.length - 1].distanceTo(waterTrail[0]), 0.5]} />
                          <meshBasicMaterial color="#0088ff" transparent opacity={0.3} side={THREE.DoubleSide} />
                      </mesh>
                  </group>
              )}
          </group>
      )}
    </>
  );
});

export const WaterBody = ({ body }: { body: any }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const shape = useMemo(() => {
    try {
      const points = JSON.parse(body.points_json);
      if (!points || points.length < 3) return null;
      const s = new THREE.Shape();
      s.moveTo(points[0].x, -points[0].z);
      for (let i = 1; i < points.length; i++) {
        s.lineTo(points[i].x, -points[i].z);
      }
      s.lineTo(points[0].x, -points[0].z);
      return s;
    } catch (e) {
      return null;
    }
  }, [body.points_json]);

  const uniforms = useMemo(() => ({
    time: { value: 0 },
    baseColor: { value: new THREE.Color("#0055aa") },
    waveColor: { value: new THREE.Color("#33aaff") },
  }), []);

  const phaseOffset = useMemo(() => Math.random() * Math.PI * 2, []);
  
  useFrame((state) => {
    if (meshRef.current) {
      const wave = Math.sin(state.clock.elapsedTime * 1.5 + phaseOffset);
      meshRef.current.position.y = 0.035 + wave * 0.005; // slight bobbing
    }
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  if (!shape) return null;

  return (
    <mesh ref={meshRef} position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <shaderMaterial 
        ref={materialRef}
        transparent={true}
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={`
          varying vec2 vUv;
          varying vec3 vPos;
          void main() {
            vUv = uv;
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float time;
          uniform vec3 baseColor;
          uniform vec3 waveColor;
          varying vec2 vUv;
          varying vec3 vPos;
          
          void main() {
            // Organic, broken-up wavy lines traveling left to right
            
            // Base wavy movement
            float wave = sin(vPos.x * 2.5 - time * 1.5 + sin(vPos.y * 3.0) * 1.2);
            
            // Secondary noise/wave to break the lines into dashes and offset them
            float dashMask = sin(vPos.x * 4.0 - time * 1.0 + vPos.y * 8.0);
            
            // Cylinder gradient running right to left (+ time moves it left)
            float cylinder = sin(vPos.x * 1.5 + time * 2.0) * 0.5 + 0.5;
            
            // Combine and sharpen to create small, disconnected wave ripples
            // Multiply by cylinder gradient to sweep the opacity
            float lines = smoothstep(0.8, 1.0, wave) * smoothstep(0.2, 0.8, dashMask) * cylinder;
            
            vec3 finalColor = mix(baseColor, waveColor, lines * 0.8);
            float alpha = 0.5 + lines * 0.5;
            
            gl_FragColor = vec4(finalColor, alpha);
          }
        `}
      />
    </mesh>
  );
};

export const WaterBodies = React.memo(({ waterBodies }: { waterBodies: any[] }) => {
  return (
    <group>
      {waterBodies.map(body => <WaterBody key={body.id} body={body} />)}
    </group>
  );
});

export const Roads = React.memo(({ roads }: { roads: any[] }) => {
  const baseMeshRef = useRef<THREE.InstancedMesh>(null);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = new THREE.Object3D();

  useFrame((state) => {
    if (coreMeshRef.current && coreMeshRef.current.material) {
      (coreMeshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(state.clock.elapsedTime * 1.5) * 0.4;
    }
  });

  useEffect(() => {
    if (!baseMeshRef.current || !coreMeshRef.current || !baseMeshRef.current.setMatrixAt) return;
    roads.forEach((r, i) => {
      const p1 = new THREE.Vector3(r.x1, 0.05, r.z1);
      const p2 = new THREE.Vector3(r.x2, 0.05, r.z2);
      const dist = p1.distanceTo(p2) + (r.width * 0.1);
      
      // Update Base (Wide, faint)
      tempObj.position.copy(p1.clone().lerp(p2, 0.5));
      tempObj.scale.set(dist, r.width, 1);
      tempObj.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), p2.clone().sub(p1).normalize());
      tempObj.rotateX(-Math.PI / 2);
      tempObj.updateMatrix();
      baseMeshRef.current!.setMatrixAt(i, tempObj.matrix);

      // Update Core (Thin, bright)
      tempObj.position.y = 0.06; // Slightly above base
      tempObj.scale.set(dist, r.width * 0.08, 1); // Thinner core
      tempObj.updateMatrix();
      coreMeshRef.current!.setMatrixAt(i, tempObj.matrix);
    });
    baseMeshRef.current.instanceMatrix.needsUpdate = true;
    coreMeshRef.current.instanceMatrix.needsUpdate = true;
  }, [roads]);

  return (
    <group>
      {/* Road Base - Vibrant Cyber Green */}
      <instancedMesh ref={baseMeshRef} args={[null as any, null as any, roads.length]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#004411" transparent opacity={0.7} side={THREE.DoubleSide} />
      </instancedMesh>
      
      {/* Road Core - Pulsing Neon Link */}
      <instancedMesh ref={coreMeshRef} args={[null as any, null as any, roads.length]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#00ffaa" transparent opacity={0.9} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
    </group>
  );
});

export const GhostTraffic = React.memo(({ roads }: { roads: any[] }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  // Calculate total road length and weights
  const roadWeights = useMemo(() => {
    const weights: number[] = [];
    let totalLength = 0;
    roads.forEach(r => {
      const len = Math.sqrt((r.x2 - r.x1)**2 + (r.z2 - r.z1)**2);
      totalLength += len;
      weights.push(totalLength);
    });
    return { weights, totalLength };
  }, [roads]);

  const packetCount = Math.min(Math.floor(roadWeights.totalLength * 0.4), 600); // Density-based count
  const tempObj = new THREE.Object3D();

  const getRandomRoadIndex = () => {
    const r = Math.random() * roadWeights.totalLength;
    return roadWeights.weights.findIndex(w => w >= r);
  };
  
  const packets = useMemo(() => {
    return Array.from({ length: packetCount }, () => ({
      roadIndex: getRandomRoadIndex(),
      progress: Math.random(),
      speed: 0.12 + Math.random() * 0.15, // Slightly slower, more consistent speed
      side: Math.random() > 0.5 ? 1 : -1,
      // 3 discrete lane slots per side for better separation
      laneSlot: Math.floor(Math.random() * 3) 
    }));
  }, [roads.length, packetCount, roadWeights]);

  useFrame((state, delta) => {
    if (!meshRef.current || roads.length === 0) return;

    packets.forEach((p, i) => {
      const roadLen = Math.max(1, roadWeights.weights[p.roadIndex] - (p.roadIndex > 0 ? roadWeights.weights[p.roadIndex-1] : 0));
      p.progress += delta * (p.speed / roadLen * 50);
      
      const r = roads[p.roadIndex];
      if (!r) { p.roadIndex = getRandomRoadIndex(); return; }

      const p1 = new THREE.Vector3(r.x1, 0.07, r.z1);
      const p2 = new THREE.Vector3(r.x2, 0.07, r.z2);
      
      const start = p.side === 1 ? p1 : p2;
      const end = p.side === 1 ? p2 : p1;
      const pos = start.clone().lerp(end, p.progress % 1);
      
      const roadDir = p2.clone().sub(p1).normalize();
      const roadNormal = new THREE.Vector3(-roadDir.z, 0, roadDir.x);
      
      // Map 0,1,2 slots to offsets within the side
      // r.width * 0.15, 0.25, 0.35
      const laneOffset = (0.15 + (p.laneSlot * 0.12)) * r.width;
      pos.add(roadNormal.multiplyScalar(laneOffset * p.side));

      tempObj.position.copy(pos);
      tempObj.scale.set(0.7, 0.08, 0.25); // Slightly smaller for more "room"
      
      const travelDir = end.clone().sub(start).normalize();
      tempObj.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), travelDir);
      
      tempObj.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObj.matrix);

      // Phasing out logic at the end of the road
      const actualProgress = p.progress % 1;
      let opacity = 0.7;
      if (actualProgress > 0.8) {
        opacity = 0.7 * (1 - (actualProgress - 0.8) / 0.2);
      } else if (actualProgress < 0.2) {
        opacity = 0.7 * (actualProgress / 0.2);
      }
      meshRef.current!.setColorAt(i, new THREE.Color("#00ffaa").multiplyScalar(opacity));

      if (p.progress >= 1) {
        p.progress = 0;
        p.roadIndex = getRandomRoadIndex();
      }
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, packetCount]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
});

const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _line = new THREE.Line3();

export const getClosestPointOnRoads = (x: number, z: number, roadsList: any[], maxSnapDistance = 15) => {
    if (!roadsList || roadsList.length === 0) return { x, z };
    
    _pt.set(x, 0, z);
    let minDistance = Infinity;
    let closestX = x;
    let closestZ = z;

    for (let i = 0; i < roadsList.length; i++) {
        const r = roadsList[i];
        _p1.set(r.x1, 0, r.z1);
        _p2.set(r.x2, 0, r.z2);
        _line.set(_p1, _p2);
        _line.closestPointToPoint(_pt, true, _closest);
        
        const dist = _closest.distanceTo(_pt);
        if (dist < minDistance) {
            minDistance = dist;
            closestX = _closest.x;
            closestZ = _closest.z;
        }
    }

    if (minDistance < maxSnapDistance) {
        return { x: closestX, z: closestZ };
    }
    return { x, z };
};

