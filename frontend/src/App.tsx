import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh, Html, OrthographicCamera } from '@react-three/drei';
import { BattleMapManager } from './BattleMapManager';
import { BattleMapScene } from './BattleMapScene';
import { io } from 'socket.io-client';
import * as THREE from 'three';
import rhombusIcon from './assets/rhombus.svg';
import terminalIcon from './assets/terminal-thin.svg';
import notifyOnIcon from './assets/Notification-on.svg';
import notifyOffIcon from './assets/Notification-off.svg';
import './App.css';

const messages = [
  "SCANNING FOR LOCATIONS...", 
  "CONNECTING TO DATA_LINK...", 
  "SYNCING CITY_NET...", 
  "SYSTEM_CALIBRATION...",
  "SCANNING SECTOR GRID...",
  "PINGING NODE CLUSTERS...",
  "QUERYING BLACKNET REGISTRY...",
  "TRACING SIGNAL ORIGIN...",
  "SWEEPING ENCRYPTED CHANNELS...",
  "LOCATING GHOST SIGNATURES...",
  "PROBING SUBNET_7_OMEGA...",
  "DECRYPTING LOCATION HASH...",
  "TRIANGULATING UPLINK SOURCE...",
  "MAPPING DEAD ZONES...", 
  "SYNCING NEURAL MAP DATA...",
  "PATCHING SECTOR BOUNDARIES...",
  "UPLOADING STREET_LEVEL OVERLAYS...",
  "INJECTING LIVE FEED COORDINATES...",
  "FLUSHING STALE CACHE...",
  "REWRITING DISTRICT MANIFESTS...",
  "PUSHING ENCRYPTED WAYPOINTS...",
  "CALIBRATING GRID ALIGNMENT...",
  "OVERWRITING CORRUPTED NODES...",
  "MERGING FRAGMENTED DATA_STREAMS...",
  "ANALYZING THREAT VECTORS...",
  "CROSS_REFERENCING KNOWN ALIASES...",
  "RUNNING PROBABILITY CASCADE...",
  "CALCULATING OPTIMAL ROUTE...",
  "WEIGHING EXTRACTION OPTIONS...",
  "PROCESSING INTERCEPTED INTEL...",
  "CORRELATING SIGNAL PATTERNS...",
  "SIMULATING BREACH SCENARIOS...",
  "EVALUATING HOSTILE PRESENCE...",
  "RECONSTRUCTING TIMELINE FRAGMENTS..."
];

// Zone type prefixes used by the city generator — these are NOT user-given names
const ZONE_TYPE_NAMES = new Set(['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'PARK', 'HOLOTREE_CANOPY']);
const isUserDefinedName = (name: string | undefined | null) => !!name && name.trim() !== '' && !ZONE_TYPE_NAMES.has(name.trim());
const getStructLabel = (loc: any) => {
  const prefix = loc.name && ZONE_TYPE_NAMES.has(loc.name.trim()) && loc.name.trim() !== 'HOLOTREE_CANOPY' ? loc.name.trim() : '';
  return prefix ? `${prefix}_struct_${loc.id}` : `STRUCT_${loc.id}`;
};

const renderBaseGeometry = (shape: string, polyCount: number = 5) => {
  switch (shape) {
    case 'none': return <boxGeometry args={[0.001, 0.001, 0.001]} />;
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, Math.max(3, polyCount)]} />;
    case 'sphere': return <sphereGeometry args={[0.5, Math.max(3, polyCount), Math.max(3, polyCount)]} />;
    case 'rhombus': return <octahedronGeometry args={[0.5]} />;
    case 'pyramid': return <coneGeometry args={[0.5, 1, Math.max(3, polyCount)]} />;
    default: return <boxGeometry args={[1, 1, 1]} />;
  }
};

const DistrictInteractions = React.memo(({ view, locations, onSelectionChange, roadTrail, setRoadTrail, roadDrawMode, snapToGrid, drawingRoadWidth, isBatchSelecting, setSelectedIds, rhombusState, setRhombusState, userName, refreshLocations, token }: any) => {
  const { camera, gl, controls } = useThree();
  const [dragStart, setDragStart] = useState<THREE.Vector3 | null>(null);
  const [dragEnd, setDragEnd] = useState<THREE.Vector3 | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const raycaster = useRef(new THREE.Raycaster());
  const mouseScreenPos = useRef<{ x: number, y: number } | null>(null);

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
    if ((view === 'district' || view === 'draw_roads' || view === 'city_gen' || isBatchSelecting) && controls) {
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
    if (view !== 'district' && view !== 'draw_roads' && view !== 'city_gen' && !isBatchSelecting && !rhombusState?.active) return;

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
        // Enforce ONE rhombus per user
        const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
        
        const newRhombus = {
            name: rhombusState.name || '',
            description: rhombusState.description || '',
            x: pos.x, y: 0.1, z: pos.z,
            width: 3.75, height: 3.75, depth: 3.75,
            shape: 'rhombus',
            color: rhombusState.color,
            owner: userName
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
        } else if (dragStart) {
            const pos = getMouseWorldPos(e); setDragEnd(pos.clone());
        }
    };

    const handlePointerUp = () => {
        mouseScreenPos.current = null;
        if (controls) (controls as any).enabled = true;
        if (view === 'draw_roads') { setIsPainting(false); return; }
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
  }, [view, dragStart, dragEnd, isPainting, gl, camera, locations, onSelectionChange, controls, setRoadTrail, roadDrawMode, snapToGrid, rhombusState, setRhombusState, isBatchSelecting, userName, refreshLocations]);

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
    </>
  );
});

const Roads = React.memo(({ roads }: { roads: any[] }) => {
  const baseMeshRef = useRef<THREE.InstancedMesh>(null);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = new THREE.Object3D();

  useFrame((state) => {
    if (coreMeshRef.current && coreMeshRef.current.material) {
      (coreMeshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(state.clock.elapsedTime * 1.5) * 0.4;
    }
  });

  useEffect(() => {
    if (!baseMeshRef.current || !coreMeshRef.current) return;
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

const GhostTraffic = React.memo(({ roads }: { roads: any[] }) => {
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

const getClosestPointOnRoads = (x: number, z: number, roadsList: any[], maxSnapDistance = 15) => {
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

const EnemyRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, refreshLocations, setIsDragging, socket, roads, isBattleMap }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { controls, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  
  const isAdmin = token !== '';
  const [isLocalDragging, setIsLocalDragging] = useState(false);
    useEffect(() => {
        const handleGlobalUp = () => {
            setIsLocalDragging((prev) => {
                if (prev) {
                    if (controls) (controls as any).enabled = true;
                    setIsDragging(false);
                }
                return false;
            });
        };
        window.addEventListener('pointerup', handleGlobalUp);
        return () => window.removeEventListener('pointerup', handleGlobalUp);
    }, [controls, setIsDragging]);
  const localPos = useRef({ x: location.x, z: location.z });
  const [dragOffset, setDragOffset] = useState(new THREE.Vector3());

  // Smooth movement interpolation
  const visualPos = useRef(new THREE.Vector3(location.x, location.y + (location.height / 4), location.z));

  const [animState, setAnimState] = useState<'none' | 'appearing' | 'fading'>('none');
  const animStartTime = useRef<number | null>(null);
  const hasAppeared = useRef(false);

  const isOnline = true; // Enemies are system-owned and always 'online'

  // Trigger appearing animation on first session mount
  useEffect(() => {
    if (!hasAppeared.current) {
        setAnimState('appearing');
        animStartTime.current = Date.now();
        hasAppeared.current = true;
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleFade = (data: any) => { if (data.id === location.id) { setAnimState('fading'); animStartTime.current = Date.now(); } };
    const handleAppear = (data: any) => { if (data.id === location.id) { setAnimState('appearing'); animStartTime.current = Date.now(); } };
    socket.on('rhombusFading', handleFade);
    socket.on('rhombusAppearing', handleAppear);
    return () => { socket.off('rhombusFading', handleFade); socket.off('rhombusAppearing', handleAppear); };
  }, [location.id, socket]);

  useEffect(() => { 
    localPos.current = { x: location.x, z: location.z }; 
  }, [location.x, location.z]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Interpolate towards localPos (35% slower + frame-rate independent)
    const targetY = location.y + (location.height / 4);
    visualPos.current.x = THREE.MathUtils.lerp(visualPos.current.x, localPos.current.x, 2.6 * delta);
    visualPos.current.z = THREE.MathUtils.lerp(visualPos.current.z, localPos.current.z, 2.6 * delta);
    visualPos.current.y = THREE.MathUtils.lerp(visualPos.current.y, targetY, 2.6 * delta);

    if (groupRef.current) {
        groupRef.current.position.copy(visualPos.current);
    }

    const d = state.camera.position.distanceTo(visualPos.current);
    const zoomComp = Math.max(1, d / 120);
    
    let baseOpacity = 0.9;
    let scaleMult = 1.0;
    let rotationSpeed = 1.0;
    let flicker = 1.0;

    if (animState !== 'none' && animStartTime.current) {
        const elapsed = (Date.now() - animStartTime.current) / 1000;
        const progress = Math.min(1, elapsed / 3); 
        if (animState === 'fading') {
          baseOpacity = Math.max(0, 0.9 * (1 - Math.pow(progress, 2)));
          if (progress > 0.5) flicker = Math.random() > 0.5 ? 1.2 : 0.2;
          rotationSpeed = 1.0 + progress * 20;
          scaleMult = (progress < 0.2 ? 1.0 + progress * 2 : (1.4 * (1 - (progress - 0.2) / 0.8)));
          if (progress >= 1) { setAnimState('none'); baseOpacity = 0; scaleMult = 0.001; }
        } else if (animState === 'appearing') {
          baseOpacity = 0.9 * Math.pow(progress, 2);
          if (progress < 0.5) flicker = Math.random() > 0.5 ? 1.2 : 0.2;
          rotationSpeed = 20 * (1 - progress) + 1.0;
          scaleMult = (progress > 0.8 ? 1.0 + (1 - progress) * 2 : (1.4 * progress / 0.8));
          if (progress >= 1) { setAnimState('none'); baseOpacity = 0.9; scaleMult = 1.0; }
        }
    } else {
        baseOpacity = 0.9;
        scaleMult = 1.0;
    }

    const finalScaleMult = scaleMult * zoomComp;
      const battleMapScale = isBattleMap ? 2 : 1;
      const scale = 1.875 * finalScaleMult * battleMapScale;
      
      meshRef.current.scale.set(scale, scale, scale);
    meshRef.current.rotation.y += 0.04 * rotationSpeed;
    meshRef.current.rotation.z += 0.02 * rotationSpeed;

    // Red Pulsing Effect (Dramatic Red to Dark Red)
    const pulse = (0.5 + Math.sin(state.clock.elapsedTime * 6) * 0.5) * flicker;
    if (meshRef.current.material) {
        (meshRef.current.material as THREE.MeshBasicMaterial).color.setRGB(0.2 + pulse * 0.8, 0, 0);
        (meshRef.current.material as any).opacity = baseOpacity;
    }
    if (lightRef.current) lightRef.current.intensity = (1.0 + pulse * 4.0) * (baseOpacity / 0.9);
    
    if (coreRef.current) {
        coreRef.current.rotation.y -= 0.06 * rotationSpeed;
        coreRef.current.scale.set((0.4 + pulse * 0.1) * scaleMult * battleMapScale, (0.4 + pulse * 0.1) * scaleMult * battleMapScale, (0.4 + pulse * 0.1) * scaleMult * battleMapScale);
    }

    if (!(window as any).activeRhombuses) (window as any).activeRhombuses = {};
    (window as any).activeRhombuses[location.id] = visualPos.current;
  });

  useEffect(() => {
    return () => {
      if ((window as any).activeRhombuses) {
        delete (window as any).activeRhombuses[location.id];
      }
    };
  }, [location.id]);

  const dragDist = useRef(0);

  const handlePointerDown = (e: any) => {
      e.stopPropagation();
    dragDist.current = 0;
    
    // Only allow dragging if the user is an Admin
    if (!isAdmin) return;

    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        setDragOffset(new THREE.Vector3(localPos.current.x - intersection.x, 0, localPos.current.z - intersection.z));
    }
    if (controls) (controls as any).enabled = false;
    setIsLocalDragging(true);
    setIsDragging(true);
  };

  const handlePointerMove = (e: any) => {
    if (!isAdmin || e.buttons !== 1) return;
    dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        const targetX = intersection.x + dragOffset.x;
        const targetZ = intersection.z + dragOffset.z;
        localPos.current = { x: targetX, z: targetZ };
    }
  };

  const handlePointerUp = async (e: any) => {
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    if (controls) (controls as any).enabled = true;
    setIsLocalDragging(false);
    setIsDragging(false);
    
    // EVERYONE can open the info window with a click
    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick(); // Stationary click -> open info window
    } else if (isAdmin) {
        // Only admins can actually SAVE the new position after a drag
        socket.emit('moveRhombus', { id: location.id, x: localPos.current.x, z: localPos.current.z });
    }
  };

  return (
    <group 
        ref={(group) => { 
            groupRef.current = group as any;
            if (group) {
                group.position.copy(visualPos.current);
            }
            if (isSelected && group) { setTargetObject(group); } 
        }}
    >
      <mesh 
          ref={meshRef as any}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
      >
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial color="#ff0000" transparent opacity={0.9} />
      </mesh>
      
      

      {/* Enemy Core - Pulsing Void */}
      <mesh ref={coreRef as any} scale={[0.5, 0.5, 0.5]}>
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial color="#220000" />
      </mesh>
      
      {/* Red Alert Light */}
      <pointLight ref={lightRef as any} color="#ff0000" intensity={3} distance={15} decay={2} />
    </group>
  );
});

const PlayerRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, userName, refreshLocations, setIsDragging, socket, activeUsers, roads, isBattleMap, battleMapPos }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { controls, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  
  const isAdmin = token !== '';
  const isOwner = location.owner === userName;
  const canManage = isAdmin || isOwner;

  const isOnline = activeUsers.some((u: any) => u.userName === location.owner);

  const [isLocalDragging, setIsLocalDragging] = useState(false);
    useEffect(() => {
        const handleGlobalUp = () => {
            setIsLocalDragging((prev) => {
                if (prev) {
                    if (controls) (controls as any).enabled = true;
                    setIsDragging(false);
                }
                return false;
            });
        };
        window.addEventListener('pointerup', handleGlobalUp);
        return () => window.removeEventListener('pointerup', handleGlobalUp);
    }, [controls, setIsDragging]);
  const localPos = useRef({ x: location.x, z: location.z });
  const [dragOffset, setDragOffset] = useState(new THREE.Vector3());

  // Smooth movement interpolation
  const visualPos = useRef(new THREE.Vector3(
    isBattleMap && battleMapPos ? battleMapPos.x : location.x, 
    isBattleMap ? 0.1 : location.y + (location.height / 2), 
    isBattleMap && battleMapPos ? battleMapPos.z : location.z
  ));

  useEffect(() => {
    localPos.current = { x: location.x, z: location.z };
  }, [location.x, location.z]);

  const [animState, setAnimState] = useState<'none' | 'appearing' | 'fading'>('none');
  const animStartTime = useRef<number | null>(null);
  const hasAppeared = useRef(false);

  // Trigger appearing animation on first session mount ONLY if online
  useEffect(() => {
    if (!hasAppeared.current && isOnline) {
        setAnimState('appearing');
        animStartTime.current = Date.now();
        hasAppeared.current = true;
    }
  }, [isOnline]);

  useEffect(() => {
    if (!socket) return;
    const handleFade = (data: any) => { if (data.id === location.id) { setAnimState('fading'); animStartTime.current = Date.now(); } };
    const handleAppear = (data: any) => { if (data.id === location.id) { setAnimState('appearing'); animStartTime.current = Date.now(); } };
    socket.on('rhombusFading', handleFade);
    socket.on('rhombusAppearing', handleAppear);
    return () => { socket.off('rhombusFading', handleFade); socket.off('rhombusAppearing', handleAppear); };
  }, [location.id, socket]);

  useFrame((state, delta) => {
    const camPos = state.camera.position;
    
    // Interpolate towards localPos (35% slower + frame-rate independent)
    const targetY = location.y + (location.height / 2);
    visualPos.current.x = THREE.MathUtils.lerp(visualPos.current.x, localPos.current.x, 2.6 * delta);
    visualPos.current.z = THREE.MathUtils.lerp(visualPos.current.z, localPos.current.z, 2.6 * delta);
    visualPos.current.y = THREE.MathUtils.lerp(visualPos.current.y, targetY, 2.6 * delta);

    if (groupRef.current) {
        groupRef.current.position.copy(visualPos.current);
    }

    const d = Math.sqrt((camPos.x - visualPos.current.x) ** 2 + (camPos.y - visualPos.current.y) ** 2 + (camPos.z - visualPos.current.z) ** 2);

    if (!meshRef.current) return;
    
    const isClose = d < 150;
    if (glowRef.current) glowRef.current.visible = isClose;
    if (haloRef.current) haloRef.current.visible = isClose;
    if (lightRef.current) lightRef.current.visible = isClose;
    
    const isOnline = activeUsers.some((u: any) => u.userName === location.owner);
    let baseOpacity = isOnline ? 0.8 : 0;
    let scaleMult = 1.0;
    let rotationSpeed = 1.0;
    let flicker = 1.0;

    if (animState !== 'none' && animStartTime.current) {
        const elapsed = (Date.now() - animStartTime.current) / 1000;
        const progress = Math.min(1, elapsed / 3); 
        if (animState === 'fading') {
          baseOpacity = Math.max(0, 0.8 * (1 - Math.pow(progress, 2)));
          if (progress > 0.5) flicker = Math.random() > 0.5 ? 1.2 : 0.2;
          rotationSpeed = 1.0 + progress * 20;
          scaleMult = (progress < 0.2 ? 1.0 + progress * 2 : (1.4 * (1 - (progress - 0.2) / 0.8)));
          if (progress >= 1) { setAnimState('none'); baseOpacity = 0; scaleMult = 0.001; }
        } else if (animState === 'appearing') {
          baseOpacity = 0.8 * Math.pow(progress, 2);
          if (progress < 0.5) flicker = Math.random() > 0.5 ? 1.2 : 0.2;
          rotationSpeed = 20 * (1 - progress) + 1.0;
          scaleMult = (progress > 0.8 ? 1.0 + (1 - progress) * 2 : (1.4 * progress / 0.8));
          if (progress >= 1) { setAnimState('none'); baseOpacity = 0.8; scaleMult = 1.0; }
        }
    } else {
        // Standard online state (if not animating)
        baseOpacity = isOnline ? 0.8 : 0;
        scaleMult = isOnline ? 1.0 : 0.001;
    }

    const zoomComp = Math.max(1, d / 100); 
    const finalScaleMult = scaleMult * zoomComp;

    // Player Pulse Effect (Sync with their own color)
    const pulse = (0.7 + Math.sin(state.clock.elapsedTime * 4) * 0.3) * flicker;
    const rotStepY = 0.02 * rotationSpeed;
    const rotStepZ = 0.01 * rotationSpeed;
    
    meshRef.current.rotation.y += rotStepY;
    meshRef.current.rotation.z += rotStepZ;
    if (glowRef.current) {
      glowRef.current.rotation.copy(meshRef.current.rotation);
      glowRef.current.scale.set(location.width * 1.2 * finalScaleMult, location.height * 1.2 * finalScaleMult, location.depth * 1.2 * finalScaleMult);
      if (glowRef.current.material) (glowRef.current.material as any).opacity = (baseOpacity * 0.4) * pulse;
      if (!(window as any).activeRhombuses) (window as any).activeRhombuses = {};
      (window as any).activeRhombuses[location.id] = visualPos.current;
    }

    if (haloRef.current) {
      haloRef.current.scale.set(location.width * 1.6 * finalScaleMult, location.height * 1.6 * finalScaleMult, location.depth * 1.6 * finalScaleMult);
      if (haloRef.current.material) (haloRef.current.material as any).opacity = (baseOpacity * 0.15) * pulse;
    }

    if (lightRef.current) {
      lightRef.current.intensity = 2.5 * baseOpacity * pulse;
    }

    meshRef.current.scale.set(location.width * finalScaleMult, location.height * finalScaleMult, location.depth * finalScaleMult);
    if (meshRef.current.material) (meshRef.current.material as any).opacity = baseOpacity * pulse;
  });

  useEffect(() => {
    return () => {
      if ((window as any).activeRhombuses) {
        delete (window as any).activeRhombuses[location.id];
      }
    };
  }, [location.id]);

  const dragDist = useRef(0);

  const handlePointerDown = (e: any) => {
      e.stopPropagation();
    dragDist.current = 0;
    
    // Only allow dragging if the user has management rights (Owner or Admin)
    if (!canManage) return;

    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        setDragOffset(new THREE.Vector3(localPos.current.x - intersection.x, 0, localPos.current.z - intersection.z));
    }
    if (controls) (controls as any).enabled = false;
    setIsLocalDragging(true);
    setIsDragging(true);
  };

  const handlePointerMove = (e: any) => {
    if (!canManage || e.buttons !== 1) return;
    dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        const targetX = intersection.x + dragOffset.x;
        const targetZ = intersection.z + dragOffset.z;
        localPos.current = { x: targetX, z: targetZ };
    }
  };

  const handlePointerUp = async (e: any) => {
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    if (controls) (controls as any).enabled = true;
    setIsLocalDragging(false);
    setIsDragging(false);
    
    // EVERYONE can open the info window with a click
    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick(); // Stationary click -> open info window
    } else if (canManage) {
        // Only owners/admins can actually SAVE the new position after a drag
        socket.emit('moveRhombus', { id: location.id, x: localPos.current.x, z: localPos.current.z });
    }
  };

  let baseColor = location.color || "#0c2b0c";
  if (location.district_color) baseColor = location.district_color;

  return (
    <group 
        ref={(group) => { 
            groupRef.current = group as any;
            if (group) {
                group.position.copy(visualPos.current);
            }
            if (isSelected && group) { setTargetObject(group); } 
        }}
    >
      <mesh 
          ref={meshRef as any}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
      >
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial transparent opacity={0.8} color={isSelected ? "#00ffff" : baseColor} />
        {/* Solid Inner Core */}
        <mesh scale={[0.4, 0.4, 0.4]}>
          <octahedronGeometry args={[0.5]} />
          <meshBasicMaterial color={isSelected ? "#ffffff" : baseColor} />
        </mesh>
      </mesh>

      

      <>
          <mesh ref={glowRef as any} scale={[1.2, 1.2, 1.2]} raycast={() => null}>
              <octahedronGeometry args={[0.5]} />
              <meshBasicMaterial color={baseColor} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <mesh ref={haloRef as any} scale={[1.6, 1.6, 1.6]} raycast={() => null}>
              <sphereGeometry args={[0.5, 6, 6]} />
              <meshBasicMaterial color={baseColor} transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          <pointLight ref={lightRef} color={baseColor} intensity={2.5} distance={15} decay={2} />
      </>
    </group>
  );
});

const OverlapChecker = React.memo(({ locations, setOverlapIds }: any) => {
    const lastOverlaps = useRef('');
    useFrame(() => {
        const activeRhombuses = (window as any).activeRhombuses || {};
        const overlaps: number[] = [];
        for (let i = 0; i < locations.length; i++) {
            const l = locations[i];
            if (l.shape === 'rhombus' || l.shape === 'enemy_rhombus' || l.shape === 'road' || l.shape === 'intersection') continue;
            
            // Check against ALL active rhombuses
            let isOverlapping = false;
            for (const id in activeRhombuses) {
                const pPos = activeRhombuses[id];
                if (Math.abs(l.x - pPos.x) <= l.width/2 + 0.1 && Math.abs(l.z - pPos.z) <= l.depth/2 + 0.1) {
                    isOverlapping = true;
                    break;
                }
            }
            if (isOverlapping) {
                overlaps.push(l.id);
            }
        }
        const str = overlaps.join(',');
        if (str !== lastOverlaps.current) {
            lastOverlaps.current = str;
            setOverlapIds(overlaps);
        }
    });
    return null;
});

const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, isOverlapped, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, isDragging, socket, activeUsers }: any) => {
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
          <Html position={[0, maxY - minY + 2, 0]} center zIndexRange={[100, 0]}>
            <div style={{
                fontSize: '24px', 
                filter: 'drop-shadow(0 0 10px #ff0000)',
                animation: 'pulse 1.5s infinite' 
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
                  color={isBatchSelected ? "#ffff00" : location.isDanger ? "#ff0000" : location.isFavorite ? "#ff7b00" : hasData ? "#8800ff" : ((p.color && p.color !== "#00ff00") ? p.color : location.district_color ? location.district_color : "#00ff00")} 
                  wireframe={true} 
                />
              </mesh>
              
              {/* Solid Fill */}
              <mesh raycast={() => null}>
                {renderBaseGeometry(p.shape, p.polyCount || 5)}
                <meshBasicMaterial 
                  color={location.isDanger ? "#ff0000" : location.isFavorite ? "#ff7b00" : hasData ? "#8800ff" : ((p.color && p.color !== "#00ff00") ? p.color : location.district_color ? location.district_color : "#00ff00")} 
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

const InstancedShape = React.memo(({ shape, polyCount, elements, onSelect, isDragging }: { shape: string, polyCount: number, elements: any[], onSelect: (rootLoc: any) => void, isDragging?: boolean }) => {
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
            
            wireframeMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            fillMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            hitMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            
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

const InstancedBuildings = React.memo(({ buildings, onSelect, isDragging }: { buildings: any[], onSelect: (loc: any) => void, isDragging?: boolean }) => {
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

const generateThemedBuildingsForPlot = (
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

    if (bw > 8 || bd > 8) {
      const shackArea = 50.0;
      const shackCount = Math.max(1, Math.floor((bw * bd) / shackArea));
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

function AdminPanel({
  socketRef, token, onLogout, refreshLocations, refreshRoads, locations, roads, editData, setEditData, editId, setEditId,
  transformMode, setTransformMode, targetObject, blockBuildings, setBlockBuildings, selectedLocation,
  setSelectedLocation, setTargetObject, isChatOpen, setIsChatOpen, controlsRef, view, setView, pendingRequests, setPendingRequests,
  isBatchSelecting, setIsBatchSelecting, selectedIds, setSelectedIds, toggleSelection, batchDelete,
  districtSelection, setDistrictSelection, districtConfig, setDistrictConfig,
  districts, fetchDistricts, editingDistrict, setEditingDistrict,
  joinSelection, setJoinSelection, selectedClassification, setSelectedClassification, roadSelectionBounds, setRoadSelectionBounds,
  roadTrail, setRoadTrail, roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid, snapRotation, setSnapRotation,
  drawingRoadWidth, setDrawingRoadWidth, isGeneratingMap, setIsGeneratingMap, citySectionType, setCitySectionType,
  genExcludeRoads, setGenExcludeRoads, setRhombusState, setActiveSidebarMenu,
  editorGenParts, setEditorGenParts, editorGenType, setEditorGenType, editorStyleIndex, setEditorStyleIndex,
  isCopyingSize, setIsCopyingSize, isAdmin, isPrimaryAdmin, setShowBattleMapManager,
  isPlantingTrees, setIsPlantingTrees, treeBatchSize, setTreeBatchSize, userName,
    isDeployingEnemy, setIsDeployingEnemy
  }: any) {
  if (view === 'battle_map') {
    return (
      <div className="panel admin-panel" style={{ width: '300px', maxHeight: '90vh', overflowY: 'auto', pointerEvents: 'auto' }}>
        <h3 style={{ textShadow: '0 0 10px #00ff00', margin: '0 0 10px 0' }}>BATTLE ADMIN</h3>
        <button className="upload-btn" onClick={() => setIsDeployingEnemy(!isDeployingEnemy)} style={{ width: '100%', marginBottom: '10px', backgroundColor: isDeployingEnemy ? '#ff0000' : '' }}>{isDeployingEnemy ? 'CANCEL_DEPLOY' : 'ADD_ENEMY'}</button>
        <button className="utility-btn danger-btn" onClick={() => {
            onLogout();
        }} style={{ width: '100%' }}>EXIT_ADMIN_MODE</button>
      </div>
    );
  }

  const [density, setDensity] = useState(8);
  const [allowedShapes, setAllowedShapes] = useState<string[]>(['box', 'cylinder', 'sphere']);
  const [activeUserEditing, setActiveUserEditing] = useState<any>(null);
  const [copyBuffer, setCopyBuffer] = useState<any>(null);

  const [fps, setFps] = useState(0);
  useEffect(() => {
    let lastTime = performance.now();
    let frames = 0;
    let animationId: number;

    const tick = () => {
      const now = performance.now();
      frames++;
      if (now >= lastTime + 1000) {
        setFps(Math.round((frames * 1000) / (now - lastTime)));
        frames = 0;
        lastTime = now;
      }
      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, []);

  useEffect(() => {
    socketRef.current.on('editingStarted', (data: any) => setActiveUserEditing(data));
    socketRef.current.on('editingStopped', () => setActiveUserEditing(null));
    return () => { socketRef.current.off('editingStarted'); socketRef.current.off('editingStopped'); };
  }, []);

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [adminAlert, setAdminAlert] = useState<string | null>(null);
  const [showDefined, setShowDefined] = useState(false);
  const [showUndefined, setShowUndefined] = useState(false);
  const defined = locations.filter((l: any) => !l.parent_id && isUserDefinedName(l.name));
  const undefined = locations.filter((l: any) => !l.parent_id && !isUserDefinedName(l.name));

  const consolidateRoads = (newSegments: any[], existingRoads: any[], snapDist = 6) => {
    const points: THREE.Vector3[] = [];
    newSegments.forEach(s => { points.push(new THREE.Vector3(s.x1, 0, s.z1), new THREE.Vector3(s.x2, 0, s.z2)); });
    
    // Snap to existing nodes OR project onto existing segments
    points.forEach(p => {
        let bestDist = snapDist;
        let snapTarget: THREE.Vector3 | null = null;

        for (const r of existingRoads) {
            const p1 = new THREE.Vector3(r.x1, 0, r.z1); 
            const p2 = new THREE.Vector3(r.x2, 0, r.z2);
            
            // Check endpoints
            const d1 = p.distanceTo(p1);
            const d2 = p.distanceTo(p2);
            if (d1 < bestDist) { bestDist = d1; snapTarget = p1; }
            if (d2 < bestDist) { bestDist = d2; snapTarget = p2; }

            // Project onto segment if not near endpoints
            const line = new THREE.Line3(p1, p2);
            const closest = new THREE.Vector3();
            line.closestPointToPoint(p, true, closest);
            const dLine = p.distanceTo(closest);
            if (dLine < bestDist) { bestDist = dLine; snapTarget = closest; }
        }
        if (snapTarget) p.copy(snapTarget);
    });

    // Snap new points to each other
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (points[i].distanceTo(points[j]) < snapDist) points[j].copy(points[i]);
        }
    }

    return newSegments.map((s, i) => ({ 
        ...s, 
        x1: points[i*2].x, z1: points[i*2].z, 
        x2: points[i*2+1].x, z2: points[i*2+1].z 
    })).filter(s => new THREE.Vector3(s.x1, 0, s.z1).distanceTo(new THREE.Vector3(s.x2, 0, s.z2)) > 0.5);
  };

  const getCenterGroundTarget = () => {
    let tx = 0, tz = 0;
    if (controlsRef.current) {
        const camera = controlsRef.current._camera || controlsRef.current.camera;
        if (camera) {
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(0, 0), camera);
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const target = new THREE.Vector3();
            rc.ray.intersectPlane(plane, target);
            tx = target.x; tz = target.z;
        } else if (controlsRef.current.getTarget) {
            const t = new THREE.Vector3();
            controlsRef.current.getTarget(t);
            tx = t.x; tz = t.z;
        }
    }
    return { tx, tz };
  };

  const startNew = () => {
    setEditId(null); setSelectedLocation(null);
    const { tx, tz } = getCenterGroundTarget();
    setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
    setEditData({ name: '', description: '', npcs: '', x: tx, y: 0, z: tz, width: 8, height: 16, depth: 8, baseWidth: 8, baseHeight: 16, baseDepth: 8, shape: 'box', color: '#00ff00', isFavorite: false, isDanger: false, owner: '', polyCount: 5 });
    setView('editor');
  };

  const startNewEnemy = () => {
    setEditId(null); setSelectedLocation(null);
    const { tx, tz } = getCenterGroundTarget();
    setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
    setEditData({ 
        name: '', description: '', npcs: '', x: tx, y: 0, z: tz, 
        width: 1.875, height: 1.875, depth: 1.875, 
        baseWidth: 1.875, baseHeight: 1.875, baseDepth: 1.875,
        shape: 'enemy_rhombus', color: '#ff0000', isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5
    });
    setView('editor');
  };

  const startEdit = (loc: any) => {
    setEditId(loc.id);
    setEditData({ ...loc, baseWidth: loc.width, baseHeight: loc.height, baseDepth: loc.depth, shape: loc.shape || 'box', polyCount: loc.polyCount || 5 });
    if (targetObject) targetObject.scale.set(1, 1, 1);
    setView('editor');
  };

  const generateBlock = () => {
    const newBuildings: any[] = []; const blockSize = 24; const rows = Math.ceil(Math.sqrt(density)); const cols = Math.ceil(density / rows);
    const plotW = (blockSize / cols); const plotD = (blockSize / rows);
    for (let i = 0; i < density; i++) {
      const r = Math.floor(i / cols); const c = i % cols;
      const x = (c * plotW) - (blockSize / 2) + (plotW / 2) + (Math.random() - 0.5) * (plotW * 0.3);
      const z = (r * plotD) - (blockSize / 2) + (plotD / 2) + (Math.random() - 0.5) * (plotD * 0.3);
      newBuildings.push({ name: '', description: '', npcs: '', x, y: 0, z, width: Math.max(1.5, plotW * 0.7), height: 2 + Math.random() * 15, depth: Math.max(1.5, plotD * 0.7), shape: 'box', color: '' });
    }
    setBlockBuildings(newBuildings);
  };

  const commitBlock = async () => {
    if (!targetObject) return;
    const finalBuildings = blockBuildings.map(b => ({ ...b, x: b.x + targetObject.position.x, z: b.z + targetObject.position.z, y: b.y + targetObject.position.y }));
    const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalBuildings) });
    if (res.ok) { setAdminAlert("BLOCK_COMMITTED"); refreshLocations(); setBlockBuildings([]); setView('list'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!targetObject) return;
    
    if (!editId) {
        if (editorGenParts && editorGenParts.length > 0) {
            const finalDataArray = editorGenParts.map(part => {
                const isRoot = !part.parent_name;
                const pos = new THREE.Vector3(part.x, part.y, part.z);
                pos.multiply(targetObject.scale);
                pos.applyEuler(new THREE.Euler(targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z, 'YXZ'));
                  pos.add(targetObject.position);
                  
                  const targetQuat = targetObject.quaternion;
                  const partQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation_x || 0, part.rotation || 0, part.rotation_z || 0, 'YXZ'));
                  const finalQuat = targetQuat.clone().multiply(partQuat);
                  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'YXZ');

                  return {
                      ...editData,
                      name: isRoot ? editData.name : `${editData.name}_PART`,
                      description: isRoot ? editData.description : '',
                      npcs: isRoot ? editData.npcs : '',
                      x: pos.x,
                      y: pos.y,
                      z: pos.z,
                      width: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.width * targetObject.scale.x,
                      height: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.height * targetObject.scale.y,
                      depth: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.depth * targetObject.scale.z,
                      rotation: finalEuler.y,
                      rotation_x: finalEuler.x,
                      rotation_z: finalEuler.z,
                    shape: part.shape,
                    color: part.color,
                    parent_name: part.parent_name,
                    isFavorite: isRoot ? editData.isFavorite : false,
                    isDanger: isRoot ? editData.isDanger : false,
                };
            });
            const rootParts = finalDataArray.filter(p => !p.parent_name);
            const childParts = finalDataArray.filter(p => p.parent_name);
            
            const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rootParts) });
            if (res.ok) { 
                const rootData = await res.json();
                if (rootData.data && childParts.length > 0) {
                    const rootId = rootData.data[0].id;
                    childParts.forEach(c => c.parent_id = rootId);
                    await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(childParts) });
                }
                setAdminAlert("LOCATION_UPLOADED"); 
                targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); 
            }
            return;
        }

        let finalW = (editData.baseWidth || editData.width || 2) * targetObject.scale.x;
        let finalH = (editData.baseHeight || editData.height || 4) * targetObject.scale.y;
        let finalD = (editData.baseDepth || editData.depth || 2) * targetObject.scale.z;
        if (editData.shape === 'sphere') {
            const r = Math.min(finalW, finalD);
            finalW = r; finalH = r; finalD = r;
        }
        const finalData = { ...editData, x: targetObject.position.x, z: targetObject.position.z, y: targetObject.position.y, width: finalW, height: finalH, depth: finalD, rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z };
        const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalData) });
        if (res.ok) { setAdminAlert("LOCATION_UPLOADED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }
        return;
    }
    const children = locations.filter(l => l.parent_id === editId);
    const updates: any[] = [];
    const worldScale = new THREE.Vector3();
    const euler = new THREE.Euler().setFromQuaternion(targetObject.quaternion);

    targetObject.traverse((mesh: any) => {
        if (!mesh.isMesh || !mesh.userData || !mesh.userData.id) return;
        const partId = mesh.userData.id;
        const isRoot = partId === editId;
        const originalData = [editData, ...children].find(p => p.id === partId);
        if (!originalData) return;

        const worldPos = new THREE.Vector3(); mesh.getWorldPosition(worldPos);
          mesh.getWorldScale(worldScale);
          const meshWorldQuat = new THREE.Quaternion();
          mesh.getWorldQuaternion(meshWorldQuat);
          const meshEuler = new THREE.Euler().setFromQuaternion(meshWorldQuat, 'YXZ');
        
        let w = worldScale.x;
        let h = worldScale.y;
        let d = worldScale.z;
        
        if (originalData && originalData.shape === 'sphere') {
            const sphereR = Math.min(w, d);
            w = sphereR;
            h = sphereR;
            d = sphereR;
        }
        
        const mergedData = { ...originalData };
        if (!isRoot) {
            mergedData.name = editData.name;
            mergedData.description = editData.description;
            mergedData.npcs = editData.npcs;
            mergedData.color = editData.color;
            mergedData.district_name = editData.district_name;
            mergedData.district_color = editData.district_color;
            mergedData.isFavorite = editData.isFavorite;
            mergedData.isDanger = editData.isDanger;
        }

        updates.push({ ...mergedData, x: worldPos.x, y: worldPos.y - (h / 2), z: worldPos.z, width: w, height: h, depth: d, rotation: meshEuler.y, rotation_x: meshEuler.x, rotation_z: meshEuler.z });
    });
    if (updates.length === 0) {
        // Fallback for objects that might not have children with IDs (like simple boxes)
        let finalW = (editData.baseWidth || editData.width || 2) * targetObject.scale.x;
        let finalH = (editData.baseHeight || editData.height || 4) * targetObject.scale.y;
        let finalD = (editData.baseDepth || editData.depth || 2) * targetObject.scale.z;
        if (editData.shape === 'sphere') {
            const r = Math.min(finalW, finalD);
            finalW = r; finalH = r; finalD = r;
        }
        updates.push({ ...editData, x: targetObject.position.x, z: targetObject.position.z, y: targetObject.position.y, width: finalW, height: finalH, depth: finalD, rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z });
    }
    const finalRoot = updates.find(u => u.id === editId) || updates[0];
    const res = await fetch(`/api/locations/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoot) });
    if (res.ok) {
        for (const childUpdate of updates.filter(u => u.id !== editId)) {
            await fetch(`/api/locations/${childUpdate.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(childUpdate) });
        }
        setAdminAlert("DATA_UPDATED"); targetObject.scale.set(1, 1, 1); refreshLocations(); setView('list');
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    
    let root = deleteTarget;
    if (deleteTarget.parent_id) {
        const foundRoot = locations.find((l: any) => l.id === deleteTarget.parent_id);
        if (foundRoot) root = foundRoot;
    }
    
    const idsToDelete = [root.id, ...locations.filter((l: any) => l.parent_id === root.id).map((l: any) => l.id)];
    const res = await fetch('/api/locations/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: idsToDelete }) });
    if (res.ok) { 
        refreshLocations(); 
        setDeleteTarget(null); 
        // Force-deactivate Rhombus deployment state to prevent moving Admin character on next click
        setRhombusState((p: any) => ({ ...p, active: false }));
    }
  };

  const handleUndo = async () => {
    const res = await fetch('/api/undo', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const data = await res.json();
        // Option to show what was undone
        console.log("Undone:", data.type);
        refreshLocations();
    } else {
        const err = await res.json();
        setAdminAlert(err.error || "UNDO_FAILED");
    }
  };

  const handleCopy = () => {
    if (!selectedLocation) return;
    
    let root = selectedLocation;
    // If the user selected a child part, resolve the root structure first
    if (selectedLocation.parent_id) {
        const foundRoot = locations.find((l: any) => String(l.id) === String(selectedLocation.parent_id));
        if (foundRoot) root = foundRoot;
    }
    
    const children = locations.filter((l: any) => String(l.parent_id) === String(root.id));
    setCopyBuffer({ root, children });
    setAdminAlert("DATA_LINK_COPIED");
  };

  const handlePaste = async () => {
    if (!copyBuffer) return;
    
    // Spawn at the center of the user's view
    const target = getCenterGroundTarget();
    const offsetX = target.tx - copyBuffer.root.x;
    const offsetZ = target.tz - copyBuffer.root.z;
    
    const newRoot = { ...copyBuffer.root, x: copyBuffer.root.x + offsetX, z: copyBuffer.root.z + offsetZ };
    delete newRoot.id; // explicitly remove id to avoid serialization anomalies

    const res = await fetch('/api/locations', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
        body: JSON.stringify(newRoot) 
    });
    
    if (res.ok) {
        const result = await res.json();
        const newRootId = result.data[0].id;
        
        if (copyBuffer.children.length > 0) {
            const newChildren = copyBuffer.children.map((c: any) => {
                const newChild = { ...c, parent_id: Number(newRootId), x: c.x + offsetX, z: c.z + offsetZ };
                delete newChild.id;
                return newChild;
            });
            await fetch('/api/locations', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
                body: JSON.stringify(newChildren) 
            });
        }
        setAdminAlert("DATA_LINK_PASTED");
        refreshLocations();
    }
  };

  const resolvedDeleteTarget = deleteTarget?.parent_id ? locations.find((l: any) => l.id === deleteTarget.parent_id) || deleteTarget : deleteTarget;

  return (
    <div className="panel admin-panel">
      {adminAlert && createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="panel critical-alert">
            <h2 className="alert-text">!! SYSTEM_ALERT !!</h2>
            <p>{adminAlert}</p>
            <div className="button-group" style={{marginTop: '20px'}}>
              <button className="upload-btn danger-btn" onClick={() => setAdminAlert(null)}>ACKNOWLEDGE</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {deleteTarget && resolvedDeleteTarget && (
        <div className="modal-overlay"><div className="panel critical-alert"><h2 className="alert-text">!! CRITICAL_WARNING !!</h2><p>CONFIRM DESTRUCTION OF {locations.filter((l: any) => l.parent_id === resolvedDeleteTarget.id).length > 0 ? 'STRUCTURE GROUP' : 'DATA POINT'}:</p><p className="highlight">[{isUserDefinedName(resolvedDeleteTarget.name) ? resolvedDeleteTarget.name : getStructLabel(resolvedDeleteTarget)}]</p><div className="button-group" style={{marginTop: '20px'}}><button className="upload-btn danger-btn" onClick={executeDelete}>PURGE_DATA</button><button className="utility-btn" onClick={() => setDeleteTarget(null)}>ABORT_OPERATION</button></div></div></div>
      )}
      
      {view === 'list' && (
        <>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <h3>ADMIN_ACCESS // DATA_NET</h3>
              <span style={{
                fontSize: '0.6rem',
                color: 'var(--cyan)',
                border: '1px solid var(--cyan)',
                padding: '1px 5px',
                borderRadius: '3px',
                textShadow: '0 0 3px var(--cyan)',
                fontFamily: 'monospace',
                background: 'rgba(0, 255, 255, 0.05)'
              }}>
                FPS: {fps}
              </span>
            </div>
            <button className="utility-btn" onClick={handleUndo} title="UNDO LAST CHANGE" style={{fontSize: '0.65rem', padding: '2px 8px'}}>⟲ UNDO</button>
          </div>
          <button className="upload-btn" onClick={startNew}>+ ADD_NEW_DATA_POINT</button>
          <button className={`utility-btn ${isPlantingTrees ? 'active' : ''}`} onClick={() => setIsPlantingTrees(!isPlantingTrees)} style={{marginTop: '10px', width: '100%'}}>{isPlantingTrees ? 'PLANTING_TREES: ON' : 'PLANTING_TREES: OFF'}</button>
          {isPlantingTrees && (
              <div style={{marginTop: '10px', padding: '10px', border: '1px solid #00ff66', background: 'rgba(0, 255, 102, 0.1)'}}>
                  <label style={{fontSize: '0.7rem', color: '#00ff66'}}>TREES_PER_CLICK: {treeBatchSize}</label>
                  <input type="range" min="1" max="20" value={treeBatchSize} onChange={e => setTreeBatchSize(parseInt(e.target.value))} style={{width: '100%'}} />
              </div>
          )}
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { 
                setSelectedLocation(null); 
                const { tx, tz } = getCenterGroundTarget();
                setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
                setView('generator'); generateBlock(); 
              }}>+ BLOCK_GEN</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadSelectionBounds(null); setView('city_gen'); }}>+ CITY_GEN</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadTrail([]); setView('draw_roads'); }}>+ DRAW_ROADS</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setDistrictSelection([]); setEditingDistrict(null); setView('district'); }}>+ MNG_DISTRICT</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setJoinSelection([]); setView('join'); }}>+ JOIN_STRUCTS</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1, borderColor: '#ff0000', color: '#ff0000'}} onClick={startNewEnemy}>+ ADD_ENEMY</button>
          </div>
          <button className="utility-btn danger-btn" style={{marginTop: '10px', width: '100%'}} onClick={async () => {
            if (confirm("PURGE ALL ROAD DATA?")) {
              const res = await fetch('/api/roads', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
              if (res.ok) {
                setAdminAlert("ALL ROADS PURGED FROM DATABASE");
                if (refreshRoads) refreshRoads();
              }
            }
          }}>PURGE_ALL_ROADS</button>
          <button className="utility-btn danger-btn" style={{marginTop: '5px', width: '100%'}} onClick={async () => { if (confirm("PURGE ALL CHAT HISTORY?")) { await fetch('/api/chat/purge', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); } }}>PURGE_CHAT_HISTORY</button>
          <button className={`utility-btn ${isBatchSelecting ? 'active' : ''}`} style={{marginTop: '10px', width: '100%'}} onClick={() => { if (isBatchSelecting) setSelectedIds([]); setIsBatchSelecting(!isBatchSelecting); }}>{isBatchSelecting ? 'CANCEL_BATCH_DELETE' : 'BATCH_DELETE_MODE'}</button>
          {isBatchSelecting && <button className="upload-btn danger-btn" style={{marginTop: '10px'}} onClick={batchDelete}>PURGE_SELECTED ({selectedIds.length})</button>}
          {!isBatchSelecting && (selectedLocation || copyBuffer) && (
            <div className="panel selection-panel" style={{marginTop: '15px', marginBottom: '15px'}}>
              <button className="close-btn" onClick={() => setSelectedLocation(null)}>X</button>
              {selectedLocation && (
                <>
                  <h4>CURRENT_SELECTION:</h4>
                  <p className="highlight">{isUserDefinedName(selectedLocation.name) ? selectedLocation.name : getStructLabel(selectedLocation)}</p>
                  <div className="button-group">
                    <button className="upload-btn" onClick={() => startEdit(selectedLocation)}>EDIT</button>
                    <button className="upload-btn" onClick={handleCopy}>COPY</button>
                    <button className="upload-btn danger-btn" onClick={() => setDeleteTarget(selectedLocation)}>DEL</button>
                  </div>
                </>
              )}
              {copyBuffer && (
                <div style={{marginTop: selectedLocation ? '10px' : '0'}}>
                  <button className="upload-btn" style={{width: '100%', borderColor: 'var(--cyan)', color: 'var(--cyan)'}} onClick={handlePaste}>
                    PASTE: {isUserDefinedName(copyBuffer.root.name) ? copyBuffer.root.name : getStructLabel(copyBuffer.root)}
                  </button>
                </div>
              )}
            </div>
          )}
          {pendingRequests.length > 0 && pendingRequests.map((req: any, i: number) => (
            <div key={i} className="panel" style={{marginTop: '15px', borderColor: 'var(--green)'}}>
              <h4>ACCESS_REQUEST: {req.userName}</h4>
              <p style={{fontSize: '0.7rem'}}>TARGET: {isUserDefinedName(req.locationName) ? req.locationName : `STRUCT_${req.locationId}`}</p>
              <div className="button-group" style={{marginTop: '10px'}}>
                <button className="upload-btn" onClick={() => {
                  socketRef.current.emit('approveEditing', { userId: req.userId, location: locations.find((l: any) => String(l.id) === String(req.locationId)) });
                  setPendingRequests((prev: any[]) => prev.filter(r => r.userId !== req.userId));
                }}>APPROVE</button>
                <button className="upload-btn danger-btn" onClick={() => {
                  socketRef.current.emit('denyEditing', { userId: req.userId });
                  setPendingRequests((prev: any[]) => prev.filter(r => r.userId !== req.userId));
                }}>DENY</button>
              </div>
            </div>
          ))}
          {activeUserEditing && <div className="panel" style={{marginTop: '15px', borderColor: '#ff0000'}}><h4>ACTIVE_EDIT: {activeUserEditing.userId}</h4><button className="upload-btn danger-btn" onClick={() => socketRef.current.emit('revokeEditing', { userId: activeUserEditing.userId })}>REVOKE_ACCESS</button></div>}
          <div className="location-list" style={{maxHeight: '250px', marginTop: '15px'}}>
            <h4 style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}} onClick={() => setShowDefined(!showDefined)}><span style={{width: '20px', display: 'inline-block'}}>{showDefined ? '▼' : '▶'}</span> DEFINED_STRUCTURES ({defined.length})</h4>
            {showDefined && defined.map(loc => (
              <div key={loc.id} className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => setSelectedLocation(loc)} style={{cursor: 'pointer', paddingLeft: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}><div style={{display: 'flex', alignItems: 'center', gap: '10px', flex: 1, overflow: 'hidden'}}><input type="checkbox" checked={selectedIds.includes(loc.id)} onChange={() => toggleSelection(loc.id)} onClick={(e) => e.stopPropagation()} /><span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{loc.name}</span></div>{!isBatchSelecting && <div style={{display: 'flex', gap: '5px'}}><button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); startEdit(loc); }}>EDIT</button><button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); setDeleteTarget(loc); }}>DEL</button></div>}</div>
            ))}
            <h4 style={{cursor: 'pointer', marginTop: '10px', display: 'flex', alignItems: 'center'}} onClick={() => setShowUndefined(!showUndefined)}><span style={{width: '20px', display: 'inline-block'}}>{showUndefined ? '▼' : '▶'}</span> UNDEFINED_STRUCTURES ({undefined.length})</h4>
            {showUndefined && undefined.map(loc => (
              <div key={loc.id} className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => setSelectedLocation(loc)} style={{cursor: 'pointer', paddingLeft: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}><div style={{display: 'flex', alignItems: 'center', gap: '10px', flex: 1, overflow: 'hidden'}}><input type="checkbox" checked={selectedIds.includes(loc.id)} onChange={() => toggleSelection(loc.id)} onClick={(e) => e.stopPropagation()} /><span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{getStructLabel(loc)}</span></div>{!isBatchSelecting && <div style={{display: 'flex', gap: '5px'}}><button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); startEdit(loc); }}>EDIT</button><button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); setDeleteTarget(loc); }}>DEL</button></div>}</div>
            ))}
          </div>
          <button onClick={onLogout} className="logout-btn">EXIT_ADMIN_MODE</button>
        </>
      )}

      {view === 'draw_roads' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>DRAW_ROADS</h3><button onClick={() => { setView('list'); setRoadTrail([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
              <label style={{fontSize: '0.7rem'}}>DRAWING_MODE</label>
              <div className="button-group" style={{marginTop: '5px'}}>
                  <button className={roadDrawMode === 'free' ? 'active' : ''} onClick={() => { setRoadDrawMode('free'); }}>FREE_DRAW</button>
                  <button className={roadDrawMode === 'straight' ? 'active' : ''} onClick={() => { setRoadDrawMode('straight'); }}>STRAIGHT</button>
              </div>
              <button className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{marginTop: '10px', width: '100%'}}>{snapToGrid ? 'SNAP_TO_GRID: ON' : 'SNAP_TO_GRID: OFF'}</button>
              <div style={{marginTop: '10px'}}>
                <label style={{fontSize: '0.7rem'}}>ROAD_THICKNESS: {drawingRoadWidth.toFixed(1)}</label>
                <input type="range" min="0.5" max="10" step="0.1" value={drawingRoadWidth} onChange={(e) => setDrawingRoadWidth(parseFloat(e.target.value))} style={{width: '100%'}} />
              </div>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>PATHS_DRAWN: {roadTrail.length}</p><p>TOTAL_NODES: {roadTrail.reduce((acc, curr) => acc + curr.length, 0)}</p><p style={{opacity: 0.7, marginTop: '5px'}}>HOLD LEFT-CLICK TO DRAW PATH</p><button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setRoadTrail([])}>CLEAR_ALL_DRAWINGS</button></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
                if (roadTrail.length === 0) return setAdminAlert("DRAW A PATH FIRST");
                const roadWidth = drawingRoadWidth;
                let allNewSegments: any[] = [];

                for (const path of roadTrail) {
                    if (path.length < 2) continue;
                    let currentPath = path.map(p => p.clone());
                    
                    // --- STEP 1: SNAPPING ---
                    const snapDist = 5;
                    const snapToExisting = (pos: THREE.Vector3) => {
                      let bestDist = snapDist; let bestPos = pos;
                      roads.forEach(r => {
                        const p1 = new THREE.Vector3(r.x1, 0, r.z1); const p2 = new THREE.Vector3(r.x2, 0, r.z2);
                        const d1 = pos.distanceTo(p1); const d2 = pos.distanceTo(p2);
                        if (d1 < bestDist) { bestDist = d1; bestPos = p1; }
                        if (d2 < bestDist) { bestDist = d2; bestPos = p2; }
                      });
                      return bestPos;
                    };
                    currentPath[0] = snapToExisting(currentPath[0]);
                    currentPath[currentPath.length - 1] = snapToExisting(currentPath[currentPath.length - 1]);

                    // --- STEP 2: SMOOTHING ---
                    for (let iter = 0; iter < 3; iter++) {
                        for (let i = 1; i < currentPath.length - 1; i++) {
                            currentPath[i].lerp(currentPath[i-1].clone().lerp(currentPath[i+1], 0.5), 0.5);
                        }
                    }

                    for (let i = 0; i < currentPath.length - 1; i++) {
                      allNewSegments.push({ x1: currentPath[i].x, z1: currentPath[i].z, x2: currentPath[i+1].x, z2: currentPath[i+1].z, width: roadWidth });
                    }
                }

                if (allNewSegments.length === 0) return setAdminAlert("NO VALID PATHS DRAWN");
                
                const finalSegments = consolidateRoads(allNewSegments, roads);
                await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalSegments) });
                setAdminAlert(`DRAWN NETWORK GENERATED: ${finalSegments.length} SEGMENTS`); refreshLocations(); setView('list'); setRoadTrail([]);
            }}>GENERATE_FROM_DRAWINGS</button>
        </>
      )}

      {view === 'district' && !editingDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>MNG_DISTRICT</h3><button onClick={() => { setView('list'); setDistrictSelection([]); setEditingDistrict(null); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          
          {districts.map(d => (
            <div key={d.id} className="list-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <div>
                  <span style={{display: 'inline-block', width: '12px', height: '12px', backgroundColor: d.color, marginRight: '8px', border: '1px solid #000'}}></span>
                  <span>{d.name}</span>
                </div>
                <div style={{display: 'flex', gap: '5px'}}>
                  <button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={() => { 
                      setEditingDistrict(d); 
                      // Pre-fill selection with current buildings in district
                      setDistrictSelection(locations.filter((l: any) => l.district_name === d.name).map((l: any) => l.id)); 
                  }}>EDIT</button>
                  <button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={async () => {
                      if (!confirm('Delete District?')) return;
                      await fetch(`/api/districts/${d.name}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                      fetchDistricts();
                      refreshLocations();
                  }}>DEL</button>
                </div>
            </div>
          ))}

          <div className="editor-controls" style={{marginTop: '20px', borderTop: '1px solid #333', paddingTop: '10px'}}>
            <h4>CREATE NEW DISTRICT</h4>
            <label style={{fontSize: '0.7rem'}}>DISTRICT_NAME</label><input placeholder="Name" value={districtConfig.name} onChange={e => setDistrictConfig({...districtConfig, name: e.target.value})} style={{width: '100%', marginBottom: '10px'}} />
            <label style={{fontSize: '0.7rem'}}>DISTRICT_COLOR</label>
            <input type="color" value={districtConfig.color} onChange={e => setDistrictConfig({...districtConfig, color: e.target.value})} style={{width: '100%', marginTop: '5px', height: '30px', padding: '0', background: 'none', border: '1px solid var(--green)'}} />
            <button className="upload-btn" style={{marginTop: '10px'}} onClick={async () => { 
                if (!districtConfig.name.trim()) return setAdminAlert("NAME REQUIRED"); 
                const res = await fetch('/api/districts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: districtConfig.name, color: districtConfig.color }) }); 
                if (res.ok) { fetchDistricts(); setDistrictConfig({name: '', color: '#00ff00'}); } 
            }}>CREATE</button>
          </div>
        </>
      )}

      {view === 'district' && editingDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>EDITING: {editingDistrict.name}</h3><button onClick={() => { setEditingDistrict(null); setDistrictSelection([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>SELECTION: {districtSelection.length} UNITS</p><p style={{opacity: 0.7}}>DRAG TO SELECT MULTIPLE UNITS</p><p style={{opacity: 0.7}}>CLICK TO TOGGLE INDIVIDUALS</p></div>
          
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { 
              const res = await fetch('/api/locations/batch-district', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: districtSelection, district_name: editingDistrict.name, district_color: editingDistrict.color }) }); 
              if (res.ok) { setAdminAlert("DISTRICT_SAVED"); refreshLocations(); setEditingDistrict(null); setDistrictSelection([]); } 
          }}>SAVE DISTRICT</button>
        </>
      )}

      {view === 'city_gen' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>CITY_GENERATOR</h3><button onClick={() => { setView('list'); setRoadSelectionBounds(null); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>SECTION_TYPE</label>
            <div className="button-group" style={{marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
              {['MIXED', 'CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL'].map(t => (
                <button 
                  key={t} 
                  className={citySectionType === t ? 'active' : ''} 
                  style={{ flex: '1 1 80px', minWidth: '80px' }}
                  onClick={() => setCitySectionType(t as any)}
                >
                  {t}
                </button>
              ))}
            </div>
            <button className={`utility-btn ${genExcludeRoads ? 'active' : ''}`} style={{marginTop: '10px', width: '100%'}} onClick={() => setGenExcludeRoads(!genExcludeRoads)}>{genExcludeRoads ? 'EXCLUDE_ROADS: ON' : 'EXCLUDE_ROADS: OFF'}</button>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>{roadSelectionBounds ? <p>AREA_SELECTED: {Math.round(Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x))}x{Math.round(Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z))} units</p> : <p style={{opacity: 0.7}}>DRAG ON MAP TO SELECT GENERATION AREA</p>}<p style={{opacity: 0.7, marginTop: '5px'}}>HIERARCHICAL BSP: ENABLED</p><p style={{opacity: 0.7}}>ZONING: {citySectionType}</p><p style={{opacity: 0.7}}>INFRASTRUCTURE: {genExcludeRoads ? 'BUILDINGS_ONLY' : 'ROADS_+_BUILDINGS'}</p></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
              try {
                if (!roadSelectionBounds) return setAdminAlert("SELECT AREA FIRST");
                const minX = Math.min(roadSelectionBounds.min.x, roadSelectionBounds.max.x); const maxX = Math.max(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
                const minZ = Math.min(roadSelectionBounds.min.z, roadSelectionBounds.max.z); const maxZ = Math.max(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
                const cityW = maxX - minX; const cityD = maxZ - minZ;
                const centerX = (minX + maxX) / 2;
                const centerZ = (minZ + maxZ) / 2;
                const maxRadius = Math.max(1, Math.max(cityW, cityD) / 2);
                const slumAngle = Math.random() * Math.PI * 2;
                // Industrial clusters in its own sector, offset from slums by ~120-180 degrees
                const industrialAngle = slumAngle + Math.PI * (0.65 + Math.random() * 0.35);

                const blocks: {x: number, z: number, w: number, d: number}[] = [];
                const cityRoads: any[] = [];
                const mainRoadW = 6; const sideRoadW = 3;

                // Dynamic max depth: scale recursion with area size so larger selections produce more blocks, not bigger blocks
                const minBlockSize = 35;
                const maxDimension = Math.max(cityW, cityD);
                const maxSplitDepth = Math.max(4, Math.ceil(Math.log2(maxDimension / minBlockSize)) + 2);

                const split = (x: number, z: number, w: number, d: number, iter: number) => {
                  if (iter > maxSplitDepth || (w < minBlockSize && d < minBlockSize)) { blocks.push({x, z, w, d}); return; }
                  const splitV = w > d ? true : (w === d ? Math.random() > 0.5 : false);
                  const roadW = iter < 2 ? mainRoadW : sideRoadW;
                  const jitter = (Math.random() - 0.5) * (iter < 2 ? 10 : 5);
                  if (splitV) {
                    const ratio = 0.35 + Math.random() * 0.3; const lw = w * ratio; const rw = w - lw;
                    const rx = x - w/2 + lw + jitter; 
                    const midZ = z + (Math.random() - 0.5) * d * 0.25;
                    if (!genExcludeRoads) {
                      const offset = (Math.random() - 0.5) * 4.5;
                      cityRoads.push({ x1: rx, z1: z - d/2, x2: rx + offset, z2: midZ, width: roadW });
                      cityRoads.push({ x1: rx + offset, z1: midZ, x2: rx, z2: z + d/2, width: roadW });
                    }
                    split(x - w/2 + (lw + jitter)/2, z, lw + jitter, d, iter + 1); split(x + w/2 - (rw - jitter)/2, z, rw - jitter, d, iter + 1);
                  } else {
                    const ratio = 0.35 + Math.random() * 0.3; const td = d * ratio; const bd = d - td;
                    const rz = z - d/2 + td + jitter;
                    const midX = x + (Math.random() - 0.5) * w * 0.25;
                    if (!genExcludeRoads) {
                      const offset = (Math.random() - 0.5) * 4.5;
                      cityRoads.push({ x1: x - w/2, z1: rz, x2: midX + offset, z2: rz, width: roadW });
                      cityRoads.push({ x1: midX + offset, z1: rz, x2: x + w/2, z2: rz, width: roadW });
                    }
                    split(x, z - d/2 + (td + jitter)/2, w, td + jitter, iter + 1); split(x, z + d/2 - (bd - jitter)/2, w, bd - jitter, iter + 1);
                  }
                };

                split((minX + maxX)/2, (minZ + maxZ)/2, cityW, cityD, 0);
                const finalRoads = genExcludeRoads ? [] : consolidateRoads(cityRoads, roads, 3.0);
                
                const rawBuildings: any[] = [];
                // SPATIAL GRID FOR COLLISION SPEED
                const spatialGrid: any = {};
                const gridCell = 20;
                const getGridKey = (x: number, z: number) => `${Math.floor(x/gridCell)},${Math.floor(z/gridCell)}`;
                
                // Pre-populate grid with existing buildings
                locations.forEach(l => {
                    const key = getGridKey(l.x, l.z);
                    if (!spatialGrid[key]) spatialGrid[key] = [];
                    spatialGrid[key].push(l);
                });

                // Combine existing roads and new sector roads for collision checks
                const allRoadsToCheck = [...roads, ...cityRoads];

                const isBlocked = (x: number, z: number, w: number, d: number, buffer = 2) => {
                    // 1. Check building-to-building collision
                    const key = getGridKey(x, z);
                    const neighbors = [key];
                    for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(x/gridCell)+dx},${Math.floor(z/gridCell)+dz}`); }}
                    
                    for(const nKey of neighbors) {
                        if(!spatialGrid[nKey]) continue;
                        const blocked = spatialGrid[nKey].some((l: any) => {
                            // AABB intersection check with custom safety buffer
                            const xOverlap = Math.abs(l.x - x) < (l.width + w) / 2 + buffer;
                            const zOverlap = Math.abs(l.z - z) < (l.depth + d) / 2 + buffer;
                            return xOverlap && zOverlap;
                        });
                        if (blocked) return true;
                    }

                    // 2. Check building-to-road collision to prevent spawning on roads
                    if (!genExcludeRoads) {
                        for (const r of allRoadsToCheck) {
                            const p1 = new THREE.Vector3(r.x1, 0, r.z1);
                            const p2 = new THREE.Vector3(r.x2, 0, r.z2);
                            const line = new THREE.Line3(p1, p2);
                            const closest = new THREE.Vector3();
                            line.closestPointToPoint(new THREE.Vector3(x, 0, z), true, closest);
                            
                            const rx = closest.x;
                            const rz = closest.z;
                            // Add safety padding from road margins
                            const halfW = w / 2 + r.width / 2 + 1.2;
                            const halfD = d / 2 + r.width / 2 + 1.2;
                            
                            if (Math.abs(rx - x) < halfW && Math.abs(rz - z) < halfD) {
                                return true;
                            }
                        }
                    }
                    
                    return false;
                };

                blocks.forEach((b, bIdx) => {
                  const plotId = `gen_${bIdx}`;
                  const startIndex = rawBuildings.length;
                  const pad = 10; let bw = b.w - pad; let bd = b.d - pad;
                  if (bw < 8 || bd < 8) return;
                  
                  let distToCenter = Math.sqrt((b.x - centerX)**2 + (b.z - centerZ)**2);
                  let normDist = Math.min(1.0, distToCenter / maxRadius);

                  // 1. NEGATIVE SPACE (Parks / Plazas with Holographic Plants)
                  // Bias park probability to be higher near the center (max 20%), sliding to 0 at the slum boundary (0.8)
                  const parkProb = normDist > 0.8 ? 0.0 : 0.20 * (1.0 - normDist / 0.8);
                  if (Math.random() < parkProb) {
                     // Generate a Park with simple low-poly holographic trees
                     const numPlants = 6 + Math.floor(Math.random() * 7); // 6 to 12 trees
                     for (let pIdx = 0; pIdx < numPlants; pIdx++) {
                          const px = b.x + (Math.random() - 0.5) * bw * 0.8;
                          const pz = b.z + (Math.random() - 0.5) * bd * 0.8;
                          
                          if (!isBlocked(px, pz, 0.4, 0.4, 0.5)) {
                              const trunkH = 2.0 + Math.random() * 2.5;
                              const trunkW = 0.4;
                              const color = '#00ff66'; // Glowing Green
                              const trunk = { name: '', description: '', x: px, y: 0, z: pz, width: trunkW, depth: trunkW, height: trunkH, color, shape: 'cylinder' };
                              rawBuildings.push(trunk);
                              
                              const canopyW = 1.5 + Math.random() * 1.0;
                              const canopyH = 2.0 + Math.random() * 1.5;
                              const canopyShape = Math.random() > 0.5 ? 'pyramid' : 'box';
                              rawBuildings.push({ name: 'HOLOTREE_CANOPY', x: px, y: trunkH, z: pz, width: canopyW, depth: canopyW, height: canopyH, color, shape: canopyShape, parent_name: 'ROOT' });
                          }
                     }
                      for (let i = startIndex; i < rawBuildings.length; i++) {
                        rawBuildings[i].temp_block_id = plotId;
                        if (!rawBuildings[i].name) rawBuildings[i].name = 'PARK';
                      }
                      return; 
                  }

                  let blockAngle = Math.atan2(b.z - centerZ, b.x - centerX);
                  let angleDiff = Math.abs(blockAngle - slumAngle);
                  if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

                  let zoneTypeVal = Math.random();

                  if (citySectionType === 'MIXED') {
                    // Concentric ring city layout:
                    //   Core (0-0.3):   Corporate downtown
                    //   Inner (0.3-0.55): Corporate → Urban transition
                    //   Middle (0.55-0.75): Urban, slums creeping in from slum sector
                    //   Outer (0.75-1.0): Slums + Industrial on the edges

                    // Angular proximity to the industrial sector
                    let indAngleDiff = Math.abs(blockAngle - industrialAngle);
                    if (indAngleDiff > Math.PI) indAngleDiff = Math.PI * 2 - indAngleDiff;
                    const isInIndustrialSector = indAngleDiff < Math.PI / 3; // ~120° wedge
                    const isInSlumSector = angleDiff < Math.PI * 5 / 12;     // ~150° wedge

                    if (normDist < 0.30) {
                      // CORE: Corporate downtown — tall towers, clean
                      zoneTypeVal = Math.random() < 0.88 ? 0.9 : 0.5;
                    } else if (normDist < 0.55) {
                      // INNER RING: Corporate fading into Urban
                      // Linear transition: corpo chance drops from ~80% to ~20% across this band
                      const t = (normDist - 0.30) / 0.25;
                      const corpoChance = 0.80 - t * 0.60;
                      zoneTypeVal = Math.random() < corpoChance ? 0.9 : 0.5;
                    } else if (normDist < 0.75) {
                      // MIDDLE RING: Primarily Urban, slums starting to bleed in from the slum sector
                      const t = (normDist - 0.55) / 0.20;
                      if (isInSlumSector && Math.random() < t * 0.45) {
                        zoneTypeVal = 0.1; // slums growing outward
                      } else if (isInIndustrialSector && Math.random() < t * 0.30) {
                        zoneTypeVal = -0.1; // early industrial on the fringe
                      } else {
                        zoneTypeVal = 0.5; // urban
                      }
                    } else {
                      // OUTER EDGE: Slums and Industrial dominate, clustered in their sectors
                      if (isInIndustrialSector && Math.random() < 0.70) {
                        zoneTypeVal = -0.1; // industrial zone
                      } else if (isInSlumSector && Math.random() < 0.65) {
                        zoneTypeVal = 0.1; // slum district
                      } else if (Math.random() < 0.35) {
                        // Spillover: some slums/industrial scatter outside their main sectors
                        zoneTypeVal = Math.random() < 0.5 ? 0.1 : -0.1;
                      } else {
                        zoneTypeVal = 0.5; // remaining urban pockets on the outskirts
                      }
                    }
                  } else if (citySectionType === 'CORPO') zoneTypeVal = 0.9;
                  else if (citySectionType === 'URBAN') zoneTypeVal = 0.5;
                  else if (citySectionType === 'SLUMS') zoneTypeVal = 0.1;
                  else if (citySectionType === 'INDUSTRIAL') zoneTypeVal = -0.1;

                  // Determine zone prefix for structure naming
                  const zonePrefix = zoneTypeVal < 0 ? 'INDUSTRIAL' : zoneTypeVal <= 0.25 ? 'SLUMS' : zoneTypeVal > 0.7 ? 'CORPO' : 'URBAN';
                  
                  // Clamp aspect ratio to 1.3 for non-slums zones to eliminate long flat buildings
                  const isSlum = zoneTypeVal <= 0.25 && zoneTypeVal >= 0;
                  if (!isSlum) {
                    const maxRatio = 1.3;
                    if (bw > bd * maxRatio) bw = bd * maxRatio;
                    else if (bd > bw * maxRatio) bd = bw * maxRatio;
                  }

                  // 2. LANDMARKS / HERO BUILDINGS
                  // Occasionally create a unique, large building that acts as a visual anchor (with footprint check)
                  const isLandmark = Math.random() < 0.20 && zoneTypeVal > 0.3 && (zoneTypeVal > 0.8 || (bw > 30 && bd > 30)) && !isBlocked(b.x, b.z, bw * 0.7, bd * 0.7, 2.0);

                  if (isLandmark) {
                    const landmarkStyle = Math.floor(Math.random() * 4);
                    const color = ''; // Neutral color, default wireframe style
                    
                    if (landmarkStyle === 0) {
                      // Style 0: Cyber-Citadel (Stepped buttresses + tall central spire)
                      const centralSpireH = 150 + Math.random() * 70;
                      const centralSpireW = bw * 0.45;
                      const centralSpireD = bd * 0.45;
                      const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: centralSpireW, depth: centralSpireD, height: centralSpireH, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Tiered corner buttresses
                      const bW = bw * 0.15;
                      const bD = bd * 0.15;
                      const offsets = [
                        { dx: -bw * 0.35, dz: -bd * 0.35 },
                        { dx: bw * 0.35, dz: -bd * 0.35 },
                        { dx: -bw * 0.35, dz: bd * 0.35 },
                        { dx: bw * 0.35, dz: bd * 0.35 }
                      ];
                      offsets.forEach(offset => {
                        const bx = b.x + offset.dx;
                        const bz = b.z + offset.dz;
                        // Tier 1 (Lower)
                        rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bW, depth: bD, height: centralSpireH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT' });
                        // Tier 2 (Middle, slightly narrower)
                        rawBuildings.push({ name: '', x: bx - Math.sign(offset.dx)*bW*0.2, y: centralSpireH * 0.4, z: bz - Math.sign(offset.dz)*bD*0.2, width: bW * 0.7, depth: bD * 0.7, height: centralSpireH * 0.35, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      });

                      // Large top ring / horizontal slab near the top
                      rawBuildings.push({ name: '', x: b.x, y: centralSpireH * 0.8, z: b.z, width: centralSpireW * 1.3, depth: centralSpireD * 1.3, height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      // Top antenna
                      rawBuildings.push({ name: '', x: b.x, y: centralSpireH, z: b.z, width: 0.3, depth: 0.3, height: centralSpireH * 0.18, color, shape: 'box', parent_name: 'CORP_ROOT' });

                    } else if (landmarkStyle === 1) {
                      // Style 1: Hyper-Pyramid Complex (Grand tiered pyramid monument)
                      const base1W = bw * 0.75;
                      const base1D = bd * 0.75;
                      const base1H = 8.0;
                      const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: base1W, depth: base1D, height: base1H, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Stepped Tier 2 Base
                      const base2W = base1W * 0.75;
                      const base2D = base1D * 0.75;
                      const base2H = 12.0;
                      rawBuildings.push({ name: '', x: b.x, y: base1H, z: b.z, width: base2W, depth: base2D, height: base2H, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Crown Pyramid
                      const pyramidW = base2W * 0.75;
                      const pyramidD = base2D * 0.75;
                      const pyramidH = 120 + Math.random() * 50;
                      rawBuildings.push({ name: '', x: b.x, y: base1H + base2H, z: b.z, width: pyramidW, depth: pyramidD, height: pyramidH, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });

                      // Satellite Obelisks (smaller pyramids at corners)
                      const satOffsets = [
                        { dx: -bw * 0.42, dz: -bd * 0.42 },
                        { dx: bw * 0.42, dz: -bd * 0.42 },
                        { dx: -bw * 0.42, dz: bd * 0.42 },
                        { dx: bw * 0.42, dz: bd * 0.42 }
                      ];
                      satOffsets.forEach(offset => {
                        const bx = b.x + offset.dx;
                        const bz = b.z + offset.dz;
                        rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bw * 0.08, depth: bd * 0.08, height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                        rawBuildings.push({ name: '', x: bx, y: 4.0, z: bz, width: bw * 0.08, depth: bd * 0.08, height: 25.0, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });
                      });

                    } else if (landmarkStyle === 2) {
                      // Style 2: Megastructure Arch / Arcology (Twin massive pillars + top joining arch + suspended atrium)
                      const pillarW = bw * 0.22;
                      const pillarD = bd * 0.65;
                      const pillarH = 140 + Math.random() * 50;
                      const offsetDist = bw * 0.33;

                      const root = { name: '', description: '', x: b.x - offsetDist, y: 0, z: b.z, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x - offsetDist, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Right Pillar
                      const rightPillar = { name: '', x: b.x + offsetDist, y: 0, z: b.z, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box', parent_name: 'CORP_ROOT' };
                      rawBuildings.push(rightPillar);
                      const key2 = getGridKey(b.x + offsetDist, b.z); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(rightPillar);

                      // Top Connecting Arch/Sky-bridge
                      const archH = 12.0;
                      const archW = offsetDist * 2 + pillarW;
                      rawBuildings.push({ name: '', x: b.x, y: pillarH - archH, z: b.z, width: archW, depth: pillarD * 0.9, height: archH, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Center Suspended Atrium (hanging block in the middle)
                      const atriumW = offsetDist * 1.3;
                      const atriumD = pillarD * 0.7;
                      const atriumH = pillarH * 0.45;
                      rawBuildings.push({ name: '', x: b.x, y: pillarH * 0.35, z: b.z, width: atriumW, depth: atriumD, height: atriumH, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Twin spires on top of the arch
                      rawBuildings.push({ name: '', x: b.x - offsetDist, y: pillarH, z: b.z, width: 0.5, depth: 0.5, height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      rawBuildings.push({ name: '', x: b.x + offsetDist, y: pillarH, z: b.z, width: 0.5, depth: 0.5, height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

                    } else {
                      // Style 3: Communications Array (Stepped tower + wide horizontal array discs + needles)
                      const towerH = 130 + Math.random() * 60;
                      const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: bw * 0.4, depth: bd * 0.4, height: towerH * 0.3, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Mid and Upper Sections
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.3, z: b.z, width: bw * 0.3, depth: bd * 0.3, height: towerH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.7, z: b.z, width: bw * 0.2, depth: bd * 0.2, height: towerH * 0.3, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Horizontal Array Discs (wide flat boxes at different heights)
                      const disc1W = bw * 0.65;
                      const disc1D = bd * 0.65;
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.45, z: b.z, width: disc1W, depth: disc1D, height: 2.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      const disc2W = bw * 0.5;
                      const disc2D = bd * 0.5;
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.75, z: b.z, width: disc2W, depth: disc2D, height: 1.5, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      const disc3W = bw * 0.32;
                      const disc3D = bd * 0.32;
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.92, z: b.z, width: disc3W, depth: disc3D, height: 1.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Central array needle
                      rawBuildings.push({ name: '', x: b.x, y: towerH, z: b.z, width: 0.2, depth: 0.2, height: towerH * 0.2, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      // Side needles
                      rawBuildings.push({ name: '', x: b.x - bw * 0.1, y: towerH * 0.92, z: b.z - bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      rawBuildings.push({ name: '', x: b.x + bw * 0.1, y: towerH * 0.92, z: b.z + bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color, shape: 'box', parent_name: 'CORP_ROOT' });
                    }
                    for (let i = startIndex; i < rawBuildings.length; i++) {
                      rawBuildings[i].temp_block_id = plotId;
                      if (!rawBuildings[i].name) rawBuildings[i].name = zonePrefix;
                    }
                    return; // Done with this block
                  }

                  generateThemedBuildingsForPlot(b.x, b.z, bw, bd, zoneTypeVal, isBlocked, getGridKey, spatialGrid, rawBuildings, locations, plotId);
                  for (let i = startIndex; i < rawBuildings.length; i++) {
                    rawBuildings[i].temp_block_id = plotId;
                    if (!rawBuildings[i].name) rawBuildings[i].name = zonePrefix;
                  }
                });

                if (finalRoads.length > 0) {
                  const rRes = await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoads) });
                  if (!rRes.ok) throw new Error(`Road creation failed: ${rRes.status}`);
                }
                
                // Grouping logic for parent_id using SPATIAL GRID for O(N) speed
                const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rawBuildings.filter(b => !b.parent_name)) });
                if (!res.ok) throw new Error(`Building creation failed: ${res.status}`);
                
                const rootData = await res.json();
                if (rootData.data) {
                  const children: any[] = [];
                  const rootGrid: any = {};
                  rootData.data.forEach((r: any) => {
                    const key = getGridKey(r.x, r.z);
                    if (!rootGrid[key]) rootGrid[key] = [];
                    rootGrid[key].push(r);
                  });

                  rawBuildings.filter(b => b.parent_name === 'ROOT' || b.parent_name === 'CORP_ROOT').forEach(c => {
                    const key = getGridKey(c.x, c.z);
                    const neighbors = [key];
                    for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(c.x/gridCell)+dx},${Math.floor(c.z/gridCell)+dz}`); }}
                    
                    let matched = false;
                    for(const nKey of neighbors) {
                      if(!rootGrid[nKey]) continue;
                      const root = rootGrid[nKey].find((r: any) => {
                        if (c.temp_block_id && r.temp_block_id) {
                          return c.temp_block_id === r.temp_block_id;
                        }
                        const dist = Math.sqrt((r.x - c.x)**2 + (r.z - c.z)**2);
                        return (c.parent_name === 'ROOT' && dist < 20) || (c.parent_name === 'CORP_ROOT' && dist < 20);
                      });
                      if (root) {
                        children.push({ ...c, parent_id: root.id });
                        matched = true; break;
                      }
                    }
                  });

                  if (children.length > 0) {
                    const cRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(children) });
                    if (!cRes.ok) throw new Error(`Child building creation failed: ${cRes.status}`);
                  }
                }

                setAdminAlert(`CITY GENERATED: ${blocks.length} SECTORS`); refreshLocations(); setView('list'); setRoadSelectionBounds(null);
            } catch (err: any) {
              console.error(err);
              setAdminAlert(`SYSTEM_ERROR: ${err.message}. Area might be too large or complex.`);
            }
            }}>GENERATE_CITY_GRID</button>
        </>
      )}

      {view === 'join' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>JOIN_STRUCTURES</h3><button onClick={() => { setView('list'); setJoinSelection([]); setSelectedClassification(''); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>SELECTION: {joinSelection.length} UNITS</p><p style={{opacity: 0.7}}>CLICK BUILDINGS ON MAP TO ADD TO GROUP</p><p style={{opacity: 0.7}}>FIRST SELECTION BECOMES GROUP ROOT</p></div>
          <div style={{marginTop: '15px'}}>
            <label style={{fontSize: '0.7rem', display: 'block', marginBottom: '5px'}}>OPTIONAL_CLASSIFICATION</label>
            <div className="button-group" style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
              {['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'LANDMARK', 'MARKETS', 'CUSTOM'].map(t => (
                <button key={t} type="button" className={selectedClassification === t ? 'active' : ''} onClick={() => setSelectedClassification(selectedClassification === t ? '' : t)} style={{fontSize: '0.7rem', padding: '4px 8px'}}>{t}</button>
              ))}
            </div>
          </div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { if (joinSelection.length < 1) return setAdminAlert("SELECT AT LEAST 1 UNIT"); const res = await fetch('/api/locations/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: joinSelection, classification: selectedClassification || undefined }) }); if (res.ok) { setAdminAlert("STRUCTURES_CLASSIFIED/JOINED"); refreshLocations(); setView('list'); setJoinSelection([]); setSelectedClassification(''); } }}>JOIN_SELECTED</button>
        </>
      )}

      {view === 'generator' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>BLOCK_GENERATOR</h3><button onClick={() => { setView('list'); setBlockBuildings([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>DENSITY: {density}</label><input type="range" min="1" max="16" value={density} onChange={(e) => setDensity(parseInt(e.target.value))} style={{width: '100%'}} />
            <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={generateBlock}>REROLL_BLOCK</button>
            <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
              <button className="utility-btn" onClick={() => targetObject && (targetObject.position.y = 0)} style={{flex: 1}}>SNAP_TO_GROUND</button>
              <button className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>
            </div>
          </div>
          <p style={{fontSize: '0.65rem', color: '#888', margin: '10px 0'}}>DRAG THE PURPLE GIZMO TO POSITION THE BLOCK CENTER.</p>
          <button className="upload-btn" onClick={commitBlock}>COMMIT_BLOCK</button>
        </>
      )}

      {view === 'editor' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>{editData.shape === 'enemy_rhombus' ? (editId ? 'EDIT_ENEMY_DATA_POINT' : 'New_ENEMY_DATA_POINT') : (editId ? 'EDIT_DATA_POINT' : 'NEW_DATA_POINT')}</h3><button onClick={() => setView('list')} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <div className="button-group">
                <button className={transformMode === 'translate' ? 'active' : ''} onClick={() => setTransformMode('translate')}>MOVE</button>
                {editData.shape !== 'enemy_rhombus' && <button className={transformMode === 'scale' ? 'active' : ''} onClick={() => setTransformMode('scale')}>STRETCH</button>}
                <button className={transformMode === 'rotate' ? 'active' : ''} onClick={() => setTransformMode('rotate')}>ROTATE</button>
            </div>
            <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                <button type="button" className="utility-btn" onClick={() => { if (targetObject) targetObject.position.y = 0; }} style={{flex: 1, fontSize: '0.7rem'}}>SNAP_TO_GROUND</button>
                <button type="button" className={`utility-btn ${isCopyingSize ? 'active priority-danger-btn' : ''}`} onClick={() => setIsCopyingSize(!isCopyingSize)} style={{flex: 1, fontSize: '0.7rem'}}>{isCopyingSize ? 'SELECT_ON_MAP...' : 'COPY_SIZE'}</button>
              </div>
              <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                <button type="button" className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>
                <button type="button" className={`utility-btn ${snapRotation ? 'active' : ''}`} onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1, fontSize: '0.7rem'}}>{snapRotation ? 'ROT_SNAP: ON' : 'ROT_SNAP: OFF'}</button>
              </div>
          </div>
          <form onSubmit={handleSubmit}>
            {editData.district_name && <div style={{ fontSize: '0.7rem', color: editData.district_color || 'var(--green)', marginBottom: '10px', padding: '5px', border: '1px dashed currentColor', opacity: 0.9, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}><span>ASSIGNED_DISTRICT: {editData.district_name}</span><button type="button" onClick={() => setEditData({...editData, district_name: null, district_color: null})} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', fontSize: '0.9rem', lineHeight: 1 }} title="REMOVE_FROM_DISTRICT">🗑</button></div>}
            <input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} />
            <textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} />
            
            {editData.shape !== 'enemy_rhombus' && (
                <>
                    <textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} />
                    
                    <div style={{marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '5px'}}>
                        <label style={{fontSize: '0.7rem'}}>BASE SHAPE</label>
                        <select 
                            value={editData.shape} 
                            onChange={e => setEditData({...editData, shape: e.target.value})} 
                            style={{width: '100%', padding: '5px', background: 'rgba(0,40,0,0.6)', border: '1px solid var(--green)', color: 'var(--green)', outline: 'none'}}
                        >
                            <option value="box">Box</option>
                            <option value="cylinder">Cylinder</option>
                            <option value="sphere">Sphere</option>
                            <option value="pyramid">Pyramid</option>
                        </select>
                        {editorGenParts.length === 0 && (editData.shape === 'sphere' || editData.shape === 'cylinder' || editData.shape === 'pyramid') && (
                            <div style={{marginTop: '5px'}}>
                                <label style={{fontSize: '0.7rem'}}>POLYGON DETAIL: {editData.polyCount || 5}</label>
                                <input 
                                    type="range" min="3" max="32" 
                                    value={editData.polyCount || 5} 
                                    onChange={(e) => setEditData({...editData, polyCount: parseInt(e.target.value)})} 
                                    style={{width: '100%'}} 
                                />
                            </div>
                        )}
                    </div>

                    {/* NEW PREMADE STRUCTURES SECTION */}
                    <div style={{marginTop: '10px', padding: '10px', border: '1px solid #333', background: 'rgba(0,0,0,0.5)'}}>
                      <label style={{fontSize: '0.7rem'}}>PREMADE STRUCTURES</label>
                      <div className="button-group" style={{marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
                        {['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'LANDMARK', 'MARKETS', 'CUSTOM'].map(t => (
                          <button key={t} type="button" className={editorGenType === t ? 'active' : ''} onClick={() => {
                            setEditorGenType(t);
                            setEditorStyleIndex(0); // Reset cycle when switching type
                            const raw: any[] = [];
                            const bWidth = (editData.baseWidth || editData.width || 2) * (targetObject ? targetObject.scale.x : 1);
                            const bDepth = (editData.baseDepth || editData.depth || 2) * (targetObject ? targetObject.scale.z : 1);
                            let zoneVal = 0.5;
                            if (t === 'CORPO') zoneVal = 0.9;
                            else if (t === 'URBAN') zoneVal = 0.5;
                            else if (t === 'SLUMS') zoneVal = 0.1;
                            else if (t === 'INDUSTRIAL') zoneVal = -0.1;
                            else if (t === 'LANDMARK') zoneVal = 1.5;
                            else if (t === 'MARKETS') zoneVal = 2.0;
                            else if (t === 'CUSTOM') zoneVal = 3.0;
                            
                            const localIsBlocked = (x: number, z: number, w: number, d: number, buffer = 1.5) => {
                                return raw.some(l => {
                                    const xOverlap = Math.abs(l.x - x) < (l.width + w) / 2 + buffer;
                                    const zOverlap = Math.abs(l.z - z) < (l.depth + d) / 2 + buffer;
                                    return xOverlap && zOverlap;
                                });
                            };
                            
                            const bHeight = (editData.baseHeight || editData.height || 4) * (targetObject ? targetObject.scale.y : 1);
                            generateThemedBuildingsForPlot(0, 0, bWidth, bDepth, zoneVal, localIsBlocked, () => '', {}, raw, locations, undefined, bHeight, 0);
                            setEditorStyleIndex(1);
                            setEditorGenParts(raw);
                            if (targetObject) {
                                setEditData({...editData, baseWidth: bWidth, baseDepth: bDepth, baseHeight: bHeight});
                                targetObject.scale.set(1, 1, 1);
                            }
                          }}>
                            {t}
                          </button>
                        ))}
                      </div>
                      {editorGenType && (() => {
                        const baseMaxStyle = editorGenType === 'CORPO' ? 11 : editorGenType === 'URBAN' ? 10 : editorGenType === 'INDUSTRIAL' ? 10 : editorGenType === 'SLUMS' ? 1 : editorGenType === 'LANDMARK' ? 13 : editorGenType === 'MARKETS' ? 5 : 0;
                        const customPoolSize = locations.filter((b: any) => b.classification === editorGenType && !b.parent_id).length;
                        const maxStyle = baseMaxStyle + customPoolSize;
                        if (maxStyle === 0) return null;
                        const currentStyle = editorStyleIndex % maxStyle;
                        return (
                          <button type="button" className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => {
                              const raw: any[] = [];
                              const bWidth = (editData.baseWidth || editData.width || 2) * (targetObject ? targetObject.scale.x : 1);
                              const bDepth = (editData.baseDepth || editData.depth || 2) * (targetObject ? targetObject.scale.z : 1);
                              let zoneVal = 0.5;
                              if (editorGenType === 'CORPO') zoneVal = 0.9;
                              else if (editorGenType === 'URBAN') zoneVal = 0.5;
                              else if (editorGenType === 'SLUMS') zoneVal = 0.1;
                              else if (editorGenType === 'INDUSTRIAL') zoneVal = -0.1;
                              else if (editorGenType === 'LANDMARK') zoneVal = 1.5;
                              else if (editorGenType === 'MARKETS') zoneVal = 2.0;
                              else if (editorGenType === 'CUSTOM') zoneVal = 3.0;
                              const bHeight = (editData.baseHeight || editData.height || 4) * (targetObject ? targetObject.scale.y : 1);
                              generateThemedBuildingsForPlot(0, 0, bWidth, bDepth, zoneVal, () => false, () => '', {}, raw, locations, undefined, bHeight, currentStyle);
                              setEditorStyleIndex(editorStyleIndex + 1);
                              setEditorGenParts(raw);
                          }}>NEXT_STYLE [{currentStyle === 0 ? maxStyle : currentStyle}/{maxStyle}]</button>
                        );
                      })()}
                    </div>

                    <div style={{display: 'flex', gap: '10px', marginTop: '10px', marginBottom: '10px'}}>
                        <button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}>★</button>
                        <button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button>
                    </div>
                </>
            )}
            
            <button type="submit" className="upload-btn">
                {editData.shape === 'enemy_rhombus' ? (editId ? 'UPDATE_ENEMY_DATA' : 'UPLOAD_NEW_ENEMY') : (editId ? 'UPDATE_DATA_POINT' : 'UPLOAD_NEW')}
            </button>
            {isAdmin && isPrimaryAdmin && editId && editData.shape !== 'enemy_rhombus' && (
                <button type="button" className="upload-btn" style={{backgroundColor: '#5500ff', marginTop: '10px'}} onClick={() => setShowBattleMapManager(true)}>BATTLE MAPS</button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

function DraggableWindow({ title, children, pos, setPos, onClose, windowStyle = {}, contentStyle = {}, notificationsEnabled, onToggleNotifications }: any) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
      }
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, setPos]);

  return (
    <div className="win95-window" style={{ left: `${pos.x}px`, top: `${pos.y}px`, ...windowStyle }}>
      <div className="win95-title-bar" onMouseDown={handleMouseDown}>
        <div className="win95-title-text">{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {onToggleNotifications && (
            <button 
              onClick={onToggleNotifications} 
              className="win95-close-btn"
              style={{ background: 'var(--black)', padding: '2px', width: '22px', height: '22px' }}
              title="TOGGLE_NOTIFICATIONS"
            >
              <img 
                src={notificationsEnabled ? notifyOnIcon : notifyOffIcon} 
                width="14" height="14" 
                alt="Notify"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </button>
          )}
          <button className="win95-close-btn" onClick={onClose} style={{ width: '22px', height: '22px' }}>×</button>
        </div>
      </div>
      <div className="win95-content" style={contentStyle}>
        {children}
      </div>
    </div>
  );
}

function ChatWindow({ pos, setPos, onClose, messages, activeUsers, userName, onSendMessage, notificationsEnabled, onToggleNotifications, isPrimaryAdmin, onGrantAccess, onRevokeAccess, socket, token, isChatOpen }: any) {
  const [inputText, setInputText] = useState('');
  
  // Private messaging states
  const [activeTab, setActiveTab] = useState('GLOBAL');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [privateMessages, setPrivateMessages] = useState<Record<string, any[]>>({});
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());
  const [sendAs, setSendAs] = useState(userName);
  
  // NPC Creation UI
  const [npcNameInput, setNpcNameInput] = useState('');
  const [showNpcPrompt, setShowNpcPrompt] = useState(false);
  const [lastNpcContext, setLastNpcContext] = useState<Record<string, string>>({});

  // Dropdown UI
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

      const scrollRef = useRef<HTMLDivElement>(null);
    const lastMessageCountRef = useRef(messages.length);
  
    useEffect(() => {
        if (messages.length > lastMessageCountRef.current) {
            if (activeTab !== 'GLOBAL') {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.sender !== userName && lastMsg.sender !== sendAs) {
                    setUnreadTabs(prev => new Set(prev).add('GLOBAL'));
                }
            }
        }
        lastMessageCountRef.current = messages.length;
    }, [messages, activeTab, userName, sendAs]);

    useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, privateMessages, activeTab]);

  useEffect(() => {
    if (!socket) return;
    
    const handleReceivePM = (msg: any) => {
        const npcs = activeUsers.filter((u: any) => u.isNPC).map((u: any) => u.userName);
        let tabName = '';
        
        const senderIsNPC = npcs.includes(msg.sender);
        const recipientIsNPC = npcs.includes(msg.recipient);

        if (msg.sender === userName || (isPrimaryAdmin && senderIsNPC)) {
            tabName = msg.recipient;
            if (senderIsNPC) {
                tabName = `${msg.recipient} (${msg.sender})`;
                setLastNpcContext(prev => ({ ...prev, [tabName]: msg.sender }));
            }
        } else if (msg.recipient === userName || (isPrimaryAdmin && recipientIsNPC)) {
            tabName = msg.sender;
            if (recipientIsNPC) {
                tabName = `${msg.sender} (${msg.recipient})`;
                setLastNpcContext(prev => ({ ...prev, [tabName]: msg.recipient }));
            }
        } else {
            return;
        }

        setPrivateMessages(prev => {
            const history = prev[tabName] || [];
            return { ...prev, [tabName]: [...history, msg] };
        });

        setActiveTab(currentActive => {
            if (currentActive !== tabName) {
                setUnreadTabs(prev => new Set(prev).add(tabName));
                setOpenTabs(prev => prev.includes(tabName) ? prev : [...prev, tabName]);
            }
            return currentActive;
        });
    };

    const handlePrivateHistory = (data: any) => {
        setPrivateMessages(prev => ({ ...prev, [data.targetUser]: data.history }));
    };

    const handlePurge = () => {
        setPrivateMessages({});
        setOpenTabs([]);
        setActiveTab('GLOBAL');
        setUnreadTabs(new Set());
    };

    socket.on('receivePrivateMessage', handleReceivePM);
    socket.on('privateHistory', handlePrivateHistory);
    socket.on('purgePrivateMessages', handlePurge);

    return () => {
        socket.off('receivePrivateMessage', handleReceivePM);
        socket.off('privateHistory', handlePrivateHistory);
        socket.off('purgePrivateMessages', handlePurge);
    };
  }, [socket, userName, isPrimaryAdmin, activeUsers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      if (activeTab === 'GLOBAL') {
          onSendMessage(inputText, sendAs);
      } else {
          let realRecipient = activeTab;
          const match = activeTab.match(/^(.+?) \((.+?)\)$/);
          if (match) {
              realRecipient = match[1];
          }
          socket.emit('sendPrivateMessage', { sender: sendAs, recipient: realRecipient, text: inputText });
      }
      setInputText('');
    }
  };

  const handleCreateNPC = () => {
    if (npcNameInput.trim() && token) {
        socket.emit('createNPC', { adminToken: token, npcName: npcNameInput.trim() });
        setNpcNameInput('');
        setShowNpcPrompt(false);
    }
  };

  const openTab = (targetUser: string) => {
      if (!openTabs.includes(targetUser)) {
          setOpenTabs(prev => [...prev, targetUser]);
      }
      setActiveTab(targetUser);
      setActiveDropdown(null);
      setUnreadTabs(prev => { const next = new Set(prev); next.delete(targetUser); return next; });

      let historyUser1 = userName;
      let historyUser2 = targetUser;
      const match = targetUser.match(/^(.+?) \((.+?)\)$/);
      if (match) {
          historyUser1 = match[2];
          historyUser2 = match[1];
          setSendAs(match[2]);
      } else {
          setSendAs(userName);
      }
      
      socket.emit('getPrivateHistory', { user1: historyUser1, user2: historyUser2, originalTab: targetUser });
  };
  
  const closeTab = (e: React.MouseEvent, targetUser: string) => {
      e.stopPropagation();
      setOpenTabs(prev => prev.filter(t => t !== targetUser));
      if (activeTab === targetUser) setActiveTab('GLOBAL');
  };

  const handleUserClick = (user: any) => {
      if (user.userName === userName) return;
      setActiveDropdown(activeDropdown === user.userName ? null : user.userName);
  };

  const displayMessages = activeTab === 'GLOBAL' ? messages : (privateMessages[activeTab] || []);
  const myNPCs = activeUsers.filter((u: any) => u.isNPC && u.isActive !== false).map((u: any) => u.userName);
  const showSendAs = isPrimaryAdmin && myNPCs.length > 0;

  return (
    <div style={{ display: isChatOpen ? 'block' : 'none' }}>
        <DraggableWindow 
            title="CITY_NET // COMMS" 
            pos={pos} 
            setPos={setPos} 
            onClose={onClose}
            windowStyle={{ maxWidth: 'none', width: '850px' }}
            contentStyle={{ maxHeight: 'none', padding: 0, overflow: 'visible' }}
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={onToggleNotifications}
        >
          {/* Click outside listener for dropdowns */}
          {activeDropdown && (
            <div 
                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} 
                onClick={() => setActiveDropdown(null)} 
            />
          )}

          {/* TABS BAR */}
          <div style={{ display: 'flex', background: 'var(--dark-green)', padding: '5px 5px 0 5px', gap: '5px', overflowX: 'auto' }}>
              <div 
                  className={unreadTabs.has('GLOBAL') ? 'unread-blink' : ''}
                  onClick={() => { setActiveTab('GLOBAL'); setSendAs(userName); setUnreadTabs(prev => { const next = new Set(prev); next.delete('GLOBAL'); return next; }); }}
                  style={{ padding: '8px 15px', background: activeTab === 'GLOBAL' ? 'var(--black)' : 'transparent', color: activeTab === 'GLOBAL' ? 'var(--green)' : (unreadTabs.has('GLOBAL') ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  [ GLOBAL ] {unreadTabs.has('GLOBAL') && '*'}
                </div>
              {openTabs.map(tab => (
                    <div 
                        key={tab}
                        className={unreadTabs.has(tab) ? 'unread-blink' : ''}
                        onClick={() => openTab(tab)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 15px', background: activeTab === tab ? 'var(--black)' : 'transparent', color: activeTab === tab ? 'var(--cyan)' : (unreadTabs.has(tab) ? '#ffaa00' : '#888'), borderTopLeftRadius: '5px', borderTopRightRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      {tab} {unreadTabs.has(tab) && '*'}
                      <span onClick={(e) => closeTab(e, tab)} style={{ color: '#ff0000', marginLeft: '5px', cursor: 'pointer' }}>×</span>
                  </div>
              ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'row', height: '560px', background: 'var(--black)' }}>
            {/* Main Section: History & Input */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '2px solid var(--dark-green)' }}>
              <div 
                ref={scrollRef}
                style={{ flex: 1, overflowY: 'auto', padding: '15px', fontSize: '0.8rem' }}
              >
                {displayMessages.map((msg: any) => (
                  <div key={msg.id || Math.random()} style={{ marginBottom: '10px', opacity: msg.sender === 'SYSTEM' ? 0.6 : 1 }}>
                    <span style={{ color: 'var(--green)', fontSize: '0.65rem', marginRight: '8px', fontFamily: 'monospace' }}>[{msg.timestamp}]</span>
                    <span style={{ color: msg.sender === userName ? 'var(--cyan)' : (msg.sender === 'SYSTEM' ? '#ff0000' : (myNPCs.includes(msg.sender) ? '#ffaa00' : 'var(--green)')), fontWeight: 'bold' }}>
                      {msg.sender}:
                    </span>
                    <span style={{ marginLeft: '8px', wordBreak: 'break-all', color: activeTab === 'GLOBAL' ? '#fff' : '#aaa' }}>{msg.text}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={handleSubmit} style={{ padding: '15px', display: 'flex', gap: '10px', background: 'rgba(0,25,0,0.5)', borderTop: '2px solid var(--dark-green)', alignItems: 'center' }}>
                {showSendAs && (
                  <select 
                    value={sendAs} 
                    onChange={(e) => setSendAs(e.target.value)}
                    style={{ background: 'var(--black)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    <option value={userName}>{userName}</option>
                    {myNPCs.map((npc: string) => (
                      <option key={npc} value={npc}>[NPC] {npc}</option>
                    ))}
                  </select>
                )}
                <input 
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder={activeTab === 'GLOBAL' ? "TYPE_GLOBAL_BROADCAST..." : `ENCRYPTED_MESSAGE_TO_${activeTab}...`}
                  style={{ flex: 1, background: 'rgba(0,40,0,0.6)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px', fontSize: '0.9rem' }}
                />
                <button type="submit" className="upload-btn" style={{ width: '100px', margin: 0 }}>SEND</button>
              </form>
            </div>

            {/* User Roster: Right Side */}
            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', background: 'rgba(0,10,0,0.3)' }}>
              <div style={{ padding: '12px', fontSize: '0.75rem', fontWeight: 'bold', borderBottom: '2px solid var(--dark-green)', color: 'var(--green)', textShadow: 'var(--glow)' }}>OPERATORS_ONLINE</div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px', position: 'relative' }}>
                {activeUsers.map((user: any) => {
                  const dotColor = user.isAdmin ? '#ff0000' : (user.isTemporaryAdmin ? '#ffaa00' : (user.isNPC ? (user.isActive === false ? '#555' : '#aa00ff') : 'var(--green)'));
                  const dotShadow = (user.isNPC && user.isActive === false) ? 'none' : `0 0 5px ${dotColor}`;
                  return (
                    <div key={user.userName} style={{ position: 'relative' }}>
                        <div 
                          onClick={() => handleUserClick(user)}
                          style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '10px', 
                              marginBottom: '10px', 
                              padding: '5px', 
                              background: user.userName === userName ? 'rgba(0,255,255,0.05)' : 'transparent',
                              cursor: user.userName !== userName ? 'pointer' : 'default',
                              borderRadius: '4px',
                              opacity: (user.isNPC && user.isActive === false) ? 0.5 : 1
                          }}
                          onMouseOver={(e) => {
                              if (user.userName !== userName) {
                                  e.currentTarget.style.background = 'rgba(0,255,255,0.1)';
                              }
                          }}
                          onMouseOut={(e) => {
                              e.currentTarget.style.background = user.userName === userName ? 'rgba(0,255,255,0.05)' : 'transparent';
                          }}
                        >
                          <div style={{ width: '6px', height: '6px', background: dotColor, borderRadius: '50%', boxShadow: dotShadow }}></div>
                          <span style={{ color: user.userName === userName ? 'var(--cyan)' : '#888', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              {user.userName}
                              {user.isAdmin && <span title="Primary Admin">⭐</span>}
                              {user.isTemporaryAdmin && <span title="Temporary Admin">🌟</span>}
                              {user.isNPC && <span title="NPC" style={{ color: user.isActive === false ? '#555' : '#aa00ff' }}>[NPC]</span>}
                          </span>
                        </div>

                        {/* Context Menu Dropdown */}
                        {activeDropdown === user.userName && (
                          <div style={{ position: 'absolute', top: '25px', left: '15px', background: 'var(--black)', border: '1px solid var(--green)', padding: '5px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '150px' }}>
                              <button 
                                className="utility-btn" 
                                style={{ margin: 0, textAlign: 'left', width: '100%' }}
                                onClick={() => openTab(user.userName)}
                              >
                                PRIVATE_MESSAGE
                              </button>
                              
                              {isPrimaryAdmin && !user.isAdmin && !user.isNPC && (
                                  <button 
                                    className={`utility-btn ${user.isTemporaryAdmin ? 'danger-btn' : ''}`} 
                                    style={{ margin: 0, textAlign: 'left', width: '100%' }}
                                    onClick={() => {
                                        if (user.isTemporaryAdmin) onRevokeAccess(user.userName);
                                        else onGrantAccess(user.userName);
                                        setActiveDropdown(null);
                                    }}
                                  >
                                    {user.isTemporaryAdmin ? 'REVOKE_ADMIN' : 'GRANT_ADMIN'}
                                  </button>
                              )}

                              {isPrimaryAdmin && user.isNPC && (
                                  <>
                                      <button 
                                        className="utility-btn" 
                                        style={{ margin: 0, textAlign: 'left', width: '100%' }}
                                        onClick={() => {
                                            socket.emit('toggleNPCStatus', { adminToken: token, npcName: user.userName, isActive: user.isActive === false ? true : false });
                                            setActiveDropdown(null);
                                        }}
                                      >
                                        {user.isActive === false ? 'ACTIVATE_NPC' : 'DEACTIVATE_NPC'}
                                      </button>
                                      <button 
                                        className="danger-btn" 
                                        style={{ margin: 0, textAlign: 'left', width: '100%' }}
                                        onClick={() => {
                                            socket.emit('deleteNPC', { adminToken: token, npcName: user.userName });
                                            setActiveDropdown(null);
                                        }}
                                      >
                                        DELETE_NPC
                                      </button>
                                  </>
                              )}
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
              
              {/* NPC Creation Block */}
              {isPrimaryAdmin && (
                <div style={{ padding: '10px', borderTop: '2px solid var(--dark-green)' }}>
                    {showNpcPrompt ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <input 
                              value={npcNameInput}
                              onChange={e => setNpcNameInput(e.target.value)}
                              placeholder="NPC NAME..."
                              style={{ background: 'var(--black)', border: '1px solid var(--green)', color: 'var(--green)', padding: '5px', fontSize: '0.7rem' }}
                            />
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button className="upload-btn" style={{ margin: 0, flex: 1, padding: '5px' }} onClick={handleCreateNPC}>CREATE</button>
                                <button className="utility-btn" style={{ margin: 0, flex: 1, padding: '5px' }} onClick={() => setShowNpcPrompt(false)}>CANCEL</button>
                            </div>
                        </div>
                    ) : (
                        <button className="utility-btn" style={{ margin: 0, width: '100%' }} onClick={() => setShowNpcPrompt(true)}>
                            [+] ADD NPC
                        </button>
                    )}
                </div>
              )}
            </div>
          </div>
        </DraggableWindow>
    </div>
  );
}

function CityDataBaseMenu({ token, emitUpdate }: any) {
  const [maps, setMaps] = useState<any[]>([]);
  const [mapName, setMapName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string, message: string, onConfirm: () => void, confirmText?: string, isAlert?: boolean } | null>(null);

  const showAlert = (message: string) => {
    setConfirmDialog({ title: "!! SYSTEM_ALERT !!", message, onConfirm: () => setConfirmDialog(null), confirmText: "ACKNOWLEDGE", isAlert: true });
  };

  const fetchMaps = async () => {
    try {
      const res = await fetch('/api/maps');
      if (res.ok) {
        const data = await res.json();
        setMaps(data);
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchMaps();
  }, []);

  const handleSave = async () => {
    if (!token) return showAlert("ADMIN_ACCESS_REQUIRED");
    if (!mapName.trim()) return showAlert("MAP_NAME_REQUIRED");

    const existing = maps.find(m => m.name === mapName.trim());
    
    const executeSave = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/maps/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name: mapName.trim() })
        });
        if (res.ok) {
          fetchMaps();
          window.dispatchEvent(new CustomEvent('clearUnsavedChanges'));
        } else {
          showAlert("SAVE_FAILED");
        }
      } catch (e) { console.error(e); }
      setIsLoading(false);
    };

    if (existing) {
      setConfirmDialog({
        title: "!! CRITICAL_WARNING !!",
        message: `OVERWRITE_MAP: '${mapName.trim()}'?`,
        confirmText: "OVERWRITE_DATA",
        onConfirm: () => { setConfirmDialog(null); executeSave(); }
      });
    } else {
      executeSave();
    }
  };

  const handleNewMap = async () => {
    if (!token) return showAlert("ADMIN_ACCESS_REQUIRED");
    
    const executeClear = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/maps/clear', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          setMapName("");
          window.dispatchEvent(new CustomEvent('clearUnsavedChanges'));
        }
      } catch (e) { console.error(e); }
      setIsLoading(false);
    };

    const confirmClear = () => {
      setConfirmDialog({
        title: "!! CRITICAL_WARNING !!",
        message: "CLEAR_ACTIVE_MAP?",
        confirmText: "PURGE_MAP",
        onConfirm: () => { setConfirmDialog(null); executeClear(); }
      });
    };

    if ((window as any).hasUnsavedChanges) {
      setConfirmDialog({
        title: "!! CRITICAL_WARNING !!",
        message: "UNSAVED_CHANGES_DETECTED. PROCEED_WITH_NEW_MAP?",
        confirmText: "PROCEED",
        onConfirm: () => { setConfirmDialog(null); confirmClear(); }
      });
    } else {
      confirmClear();
    }
  };

  const handleLoad = async (name: string) => {
    if (!token) return showAlert("ADMIN_ACCESS_REQUIRED");

    const executeLoad = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/maps/load/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          setMapName(name);
          window.dispatchEvent(new CustomEvent('clearUnsavedChanges'));
        } else {
          showAlert("LOAD_FAILED");
        }
      } catch (e) { console.error(e); }
      setIsLoading(false);
    };

    if ((window as any).hasUnsavedChanges) {
      setConfirmDialog({
        title: "!! CRITICAL_WARNING !!",
        message: "UNSAVED_CHANGES_DETECTED. PROCEED_WITH_LOAD?",
        confirmText: "OVERWRITE_CURRENT",
        onConfirm: () => { setConfirmDialog(null); executeLoad(); }
      });
    } else {
      executeLoad();
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!token) return showAlert("ADMIN_ACCESS_REQUIRED");

    setConfirmDialog({
      title: "!! CRITICAL_WARNING !!",
      message: `CONFIRM_DELETE_MAP: '${name}'?`,
      confirmText: "PURGE_DATA",
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsLoading(true);
        try {
          const res = await fetch(`/api/maps/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) fetchMaps();
        } catch (e) { console.error(e); }
        setIsLoading(false);
      }
    });
  };

  return (
    <div className="panel city-database-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>CITY_DATA_BASE</h3>
      </header>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <input 
          placeholder="MAP_DESIGNATION" 
          value={mapName} 
          onChange={e => setMapName(e.target.value)} 
          style={{ flex: 1, minWidth: '150px' }}
        />
        <button className="upload-btn" onClick={handleSave} disabled={isLoading}>SAVE</button>
        <button className="upload-btn danger-btn" onClick={handleNewMap} disabled={isLoading}>NEW_MAP</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <h4 className="category-header">ARCHIVED_MAPS</h4>
        {maps.length === 0 ? (
          <p style={{ fontSize: '0.7rem', opacity: 0.5 }}>NO_ARCHIVED_DATA</p>
        ) : (
          maps.map(m => (
            <div key={m.id} className="list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <span 
                onClick={() => setMapName(m.name)} 
                style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1 }}
                title="Populate Map Designation"
              >
                {m.name}
              </span>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button className="utility-btn" onClick={() => handleLoad(m.name)} disabled={isLoading} style={{ fontSize: '0.6rem', padding: '2px 8px' }}>LOAD</button>
                <button className="utility-btn danger-btn" onClick={() => handleDelete(m.id, m.name)} disabled={isLoading} style={{ fontSize: '0.6rem', padding: '2px 8px' }}>DELETE</button>
              </div>
            </div>
          ))
        )}
      </div>

      {confirmDialog && createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="panel critical-alert">
            <h2 className="alert-text">{confirmDialog.title}</h2>
            <p>{confirmDialog.message}</p>
            <div className="button-group" style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button className="upload-btn danger-btn" onClick={confirmDialog.onConfirm}>{confirmDialog.confirmText || 'PROCEED'}</button>
              {!confirmDialog.isAlert && (
                <button className="utility-btn" onClick={() => setConfirmDialog(null)}>ABORT_OPERATION</button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


function NavControlsMenu({ onToggleHelp }: any) {
  return (
    <div className="panel sidebar-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>NAV_CONTROLS</h3>
        <button onClick={() => onToggleHelp(false)} className="close-btn" style={{ position: 'static' }}>◀</button>
      </header>
      <div style={{ fontSize: '0.75rem', lineHeight: '1.6' }}>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>GIMBALL / ROTATE</span><br />LEFT-CLICK + DRAG
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>PAN / MOVE VIEW</span><br />RIGHT-CLICK + DRAG
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>ZOOM IN/OUT</span><br />SCROLL WHEEL
        </div>
        <div style={{ opacity: 0.7, fontSize: '0.65rem' }}>* Zoom targets your cursor position</div>
      </div>
    </div>
  );
}

function GeometryMenu({ rhombusState, setRhombusState, selectedLocation, setSelectedLocation, refreshLocations, token, userName, locations, socketRef, syncRhombusToDB }: any) {
  const userRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
  const isSelectedRhombus = selectedLocation?.shape === 'rhombus';
  const isAdmin = token !== '';
  const isOwner = selectedLocation?.owner === userName;
  
  // Can remove if it's yours OR if you're an admin removing any rhombus
  const canRemoveSelected = isSelectedRhombus && (isAdmin || isOwner);

  const removeRhombus = async (id: number) => {
    // Instead of deleting immediately, we request a cinematic purge
    // which triggers the fading animation for everyone first.
    if (socketRef.current) {
        socketRef.current.emit('requestRhombusPurge', { id, owner: userName });
        if (selectedLocation?.id === id) setSelectedLocation(null);
        // The server will handle the actual deletion after 3 seconds
    } else {
        // Fallback if socket is down
        const res = await fetch(`/api/locations/${id}`, { 
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            if (selectedLocation?.id === id) setSelectedLocation(null);
            refreshLocations();
        }
    }
  };

  return (
    <div className="panel sidebar-panel">
      <header style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>GEOMETRY_PROTOCOLS</h3>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        <button 
          className={`rhombus-trigger-btn ${rhombusState.active ? 'active' : ''} ${userRhombus ? 'disabled' : ''}`}
          onClick={() => !userRhombus && setRhombusState((p: any) => ({ ...p, active: !p.active }))}
          disabled={!!userRhombus}
          style={{ color: rhombusState.color }}
        >
          <svg width="60" height="60" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5.219 11.34l5.96-7.925a1.02 1.02 0 0 1 1.642 0l5.96 7.925c.292.388.292.932 0 1.32l-5.96 7.925a1.02 1.02 0 0 1-1.642 0L5.22 12.66a1.1 1.1 0 0 1 0-1.32" />
          </svg>
          <span style={{ fontSize: '0.6rem', marginTop: '10px', display: 'block' }}>
            {userRhombus ? 'RHOMBUS_ACTIVE' : (rhombusState.active ? 'SCANNING_MAP...' : 'INITIALIZE_RHOMBUS')}
          </span>
        </button>

        {userRhombus && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(userRhombus.id)} style={{ width: '100%', fontSize: '0.65rem' }}>PURGE_YOUR_RHOMBUS</button>
        )}

        {canRemoveSelected && selectedLocation?.id !== userRhombus?.id && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(selectedLocation.id)} style={{ width: '100%', fontSize: '0.65rem' }}>REMOVE_SELECTED_RHOMBUS</button>
        )}

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>BEACON_NAME</label>
              <input 
                placeholder="ID_TAG" 
                value={rhombusState.name} 
                onChange={(e) => { 
                  const ns = { ...rhombusState, name: e.target.value };
                  setRhombusState(ns);
                  syncRhombusToDB(ns);
                }}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>DATA_DESCRIPTION</label>
              <textarea 
                placeholder="BEACON_FEED_SUMMARY" 
                value={rhombusState.description} 
                onChange={(e) => { 
                  const ns = { ...rhombusState, description: e.target.value };
                  setRhombusState(ns);
                  syncRhombusToDB(ns);
                }}
                style={{ width: '100%', height: '60px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>RHOMBUS_CHROMA_SYNC</label>
              <input 
                  type="color" 
                  value={rhombusState.color} 
                  onChange={(e) => { 
                    const ns = { ...rhombusState, color: e.target.value };
                    setRhombusState(ns);
                    syncRhombusToDB(ns);
                  }}
                  style={{ width: '100%', height: '40px', background: 'none', border: '1px solid var(--green)', cursor: 'pointer' }}
              />
            </div>
        </div>

        <div className="info-box" style={{ fontSize: '0.65rem', opacity: 0.8, lineHeight: '1.6', borderTop: '1px solid var(--dark-green)', paddingTop: '15px', width: '100%' }}>
            <p style={{ color: 'var(--green)', fontWeight: 'bold', marginBottom: '5px' }}>INTERFACE_GUIDE:</p>
            <p>• [CLICK MAP] TO DEPLOY RHOMBUS</p>
            <p>• [CLICK & DRAG] TO REPOSITION</p>
            <p>• [PURGE] TO RESET DEPLOYMENT</p>
        </div>
      </div>
    </div>
  );
}

function SystemInfoMenu({ userName, token }: any) {
  return (
    <div className="panel sidebar-panel">
      <header style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0, textShadow: 'var(--glow)' }}>CITY_NET</h1>
        <div style={{ fontSize: '0.65rem', opacity: 0.7, letterSpacing: '2px', marginTop: '2px' }}>NAV_OS_v1.0.4</div>
      </header>
      <div style={{ fontSize: '0.8rem', lineHeight: '1.8', borderTop: '1px solid var(--dark-green)', paddingTop: '15px' }}>
        <div style={{ marginBottom: '10px' }}>
          <span style={{ opacity: 0.6 }}>OPERATOR_ID:</span><br />
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>{userName}</span>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <span style={{ opacity: 0.6 }}>ACCESS_LEVEL:</span><br />
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>{token ? 'ADMIN_PRIVILEGES' : 'UNPRIVILEGED_USER'}</span>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ activeMenu, setActiveMenu, locations, onSelect, onZoom, selectedLocation, userName, token, onLogout, audioEnabled, setAudioEnabled, rhombusState, setRhombusState, refreshLocations, socketRef, isChatOpen, setIsChatOpen, hasUnreadChat, syncRhombusToDB }: any) {
  let isPrimaryAdmin = false;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      isPrimaryAdmin = !payload.isTemporary;
    } catch (e) { }
  }

  return (
    <div className={`sidebar ${activeMenu !== 'none' ? 'expanded' : ''}`}>
      <div className="icon-rail">
        <div className="rail-top" style={{ borderBottom: '1px solid var(--dark-green)' }}>
            <button className={`rail-btn system-trigger ${activeMenu === 'system_info' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'system_info' ? 'none' : 'system_info')} title="SYSTEM_INFO">
              <svg width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="system-icon-svg">
                <g fill="none">
                  <path fill="currentColor" d="M3.75 18a.75.75 0 0 0-1.5 0zm-1.5-4a.75.75 0 0 0 1.5 0zM7 8.75c.964 0 1.612.002 2.095.067c.461.062.659.169.789.3l1.06-1.062c-.455-.455-1.022-.64-1.65-.725c-.606-.082-1.372-.08-2.294-.08zM11.75 12c0-.922.002-1.688-.08-2.294c-.084-.628-.27-1.195-.726-1.65l-1.06 1.06c.13.13.237.328.3.79c.064.482.066 1.13.066 2.094zM7 7.25c-.922 0-1.688-.002-2.294.08c-.628.084-1.195.27-1.65.725l1.06 1.061c.13-.13.328-.237.79-.3c.482-.064 1.13-.066 2.094-.066zM3.75 12c0-.964.002-1.612.067-2.095c.062-.461.169-.659.3-.789l-1.062-1.06c-.455.455-.64 1.022-.725 1.65c-.082.606-.08 1.372-.08 2.294zm0 10v-4h-1.5v4zm0-8v-2h-1.5v2z" />
                  <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M7 22v-6c0-1.886 0-2.828.586-3.414S9.114 12 11 12h2c1.886 0 2.828 0 3.414.586c.472.471.564 1.174.582 2.414M17 22v-2.75m4-11.478c0-1.34 0-2.011-.356-2.525s-.984-.75-2.24-1.22c-2.455-.921-3.682-1.381-4.543-.785C13 3.84 13 5.15 13 7.772V12m8 10V12M4 8V6.5c0-.943 0-1.414.293-1.707S5.057 4.5 6 4.5h2c.943 0 1.414 0 1.707.293S10 5.557 10 6.5V8M7 4V2m15 20H2m8-7h.5m3.5 0h-1.5M10 18h4" />
                </g>
              </svg>
            </button>
        </div>
        <div style={{ padding: '10px 0', display: 'flex', justifyContent: 'center' }}>
            <button className="rail-btn" onClick={onLogout} title="TERMINATE_SESSION">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path fill="currentColor" d="m22.5 5.74l-1 1.73a11 11 0 1 1-11 0l-1-1.73a13 13 0 1 0 13 0" />
                <path fill="currentColor" d="M15 2h2v14h-2z" />
              </svg>
            </button>
        </div>
        <div className="rail-center">
            <button className={`rail-btn ${activeMenu === 'quick_access' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'quick_access' ? 'none' : 'quick_access')} title="QUICK_ACCESS">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </button>
            <button className={`rail-btn ${activeMenu === 'nav_controls' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'nav_controls' ? 'none' : 'nav_controls')} title="NAV_CONTROLS">
              <svg width="24" height="24" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="0" strokeLinecap="round" strokeLinejoin="round">
                <path fill="currentColor" d="M208 144h-72V95.19a40 40 0 1 0-16 0V144H48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16M104 56a24 24 0 1 1 24 24a24 24 0 0 1-24-24m104 152H48v-48h160zm-40-96h32a8 8 0 0 1 0 16h-32a8 8 0 0 1 0-16" />
              </svg>
            </button>
            <button className={`rail-btn ${activeMenu === 'geometry_protocols' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'geometry_protocols' ? 'none' : 'geometry_protocols')} title="GEOMETRY_PROTOCOLS">
              <svg width="24" height="24" viewBox="0 0 24 24" fill={rhombusState?.color || 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5.219 11.34l5.96-7.925a1.02 1.02 0 0 1 1.642 0l5.96 7.925c.292.388.292.932 0 1.32l-5.96 7.925a1.02 1.02 0 0 1-1.642 0L5.22 12.66a1.1 1.1 0 0 1 0-1.32" />
              </svg>
            </button>
            {isPrimaryAdmin && (
              <button className={`rail-btn ${activeMenu === 'city_data_base' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'city_data_base' ? 'none' : 'city_data_base')} title="CITY_DATA_BASE">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
                  <line x1="9" y1="3" x2="9" y2="21"></line>
                  <line x1="15" y1="3" x2="15" y2="21"></line>
                </svg>
              </button>
            )}
            <button className={`rail-btn ${isChatOpen ? 'active' : ''} ${hasUnreadChat && !isChatOpen ? 'unread-flash' : ''}`} onClick={() => setIsChatOpen(!isChatOpen)} title="GLOBAL_CHAT">
              <svg width="24" height="24" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="0" strokeLinecap="round" strokeLinejoin="round">
                <path fill="currentColor" d="M122.5 124.88a4 4 0 0 1 0 6.24l-40 32a4 4 0 0 1-5-6.24L113.6 128L77.5 99.12a4 4 0 0 1 5-6.24ZM176 156h-40a4 4 0 0 0 0 8h40a4 4 0 0 0 0-8m52-100v144a12 12 0 0 1-12 12H40a12 12 0 0 1-12-12V56a12 12 0 0 1 12-12h176a12 12 0 0 1 12 12m-8 0a4 4 0 0 0-4-4H40a4 4 0 0 0-4 4v144a4 4 0 0 0 4 4h176a4 4 0 0 0 4-4Z" />
              </svg>
            </button>
        </div>
        <div className="rail-bottom" style={{ paddingBottom: '20px', display: 'flex', justifyContent: 'center' }}>
            <button className={`rail-btn ${!audioEnabled ? 'muted' : ''}`} onClick={() => setAudioEnabled(!audioEnabled)} title={audioEnabled ? "MUTE_AUDIO" : "UNMUTE_AUDIO"}>
              {audioEnabled ? (
                <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                  <path fill="currentColor" fillRule="evenodd" d="m403.966 426.944l-33.285-26.63c74.193-81.075 74.193-205.015-.001-286.09l33.285-26.628c86.612 96.712 86.61 242.635.001 339.348M319.58 155.105l-33.324 26.659c39.795 42.568 39.794 108.444.001 151.012l33.324 26.658c52.205-58.22 52.205-146.109-.001-204.329m-85.163-69.772l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                  <path fill="currentColor" fillRule="evenodd" d="m403.375 257.27l59.584 59.584l-30.167 30.166l-59.583-59.583l-59.584 59.583l-30.166-30.166l59.583-59.584l-59.583-59.583l30.166-30.166l59.584 59.583l59.583-59.583l30.167 30.166zM234.417 85.333l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                </svg>
              )}
            </button>
        </div>
      </div>
      <div className="menu-container">
        <div className="menu-content">
          {activeMenu === 'system_info' && <SystemInfoMenu userName={userName} token={token} />}
          {activeMenu === 'quick_access' && <QuickAccessMenu locations={locations} onSelect={onSelect} onZoom={onZoom} selectedLocation={selectedLocation} isOpen={true} setIsOpen={() => setActiveMenu('none')} />}
          {activeMenu === 'nav_controls' && <NavControlsMenu onToggleHelp={() => setActiveMenu('none')} />}
          {activeMenu === 'geometry_protocols' && <GeometryMenu rhombusState={rhombusState} setRhombusState={setRhombusState} selectedLocation={selectedLocation} setSelectedLocation={onSelect} refreshLocations={refreshLocations} token={token} userName={userName} locations={locations} socketRef={socketRef} syncRhombusToDB={syncRhombusToDB} />}
          {activeMenu === 'city_data_base' && <CityDataBaseMenu token={token} emitUpdate={() => {}} />}

        </div>
      </div>
    </div>
  );
}

function QuickAccessMenu({ locations, onSelect, onZoom, selectedLocation, isOpen, setIsOpen }: any) {
  const [showDanger, setShowDanger] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showDistricts, setShowDistricts] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const districts: any = {};
  locations.forEach(loc => {
    if (loc.district_name) {
      if (!districts[loc.district_name]) districts[loc.district_name] = { color: loc.district_color || '#00ff00', locations: [], center: [0,0,0], size: 0 };
      const isDefined = isUserDefinedName(loc.name) || (loc.description && loc.description.trim() !== "");
      if (isDefined && !loc.isDanger && !loc.isFavorite) districts[loc.district_name].locations.push(loc);
    }
  });
  Object.keys(districts).forEach(name => {
    const members = locations.filter(l => l.district_name === name);
    if (members.length > 0) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
        members.forEach(l => { minX = Math.min(minX, l.x - l.width/2); maxX = Math.max(maxX, l.x + l.width/2); minZ = Math.min(minZ, l.z - l.depth/2); maxZ = Math.max(maxZ, l.z + l.depth/2); minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y + l.height); });
        districts[name].center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
        districts[name].size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    }
  });
  const definedLocations = locations.filter((l: any) => !l.parent_id && (isUserDefinedName(l.name) || (l.description && l.description.trim() !== "")));
  const danger = definedLocations.filter(l => l.isDanger); const starred = definedLocations.filter(l => l.isFavorite); const others = definedLocations.filter(l => !l.isDanger && !l.isFavorite && !l.district_name);
  const ListItem = ({ loc }: any) => (
    <div className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => onSelect(loc)} style={{ cursor: 'pointer', paddingLeft: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{!!loc.isDanger && <span style={{ color: '#ff0000', marginRight: '5px' }}>!</span>}{!!loc.isFavorite && <span style={{ color: '#ff7b00', marginRight: '5px' }}>★</span>}{isUserDefinedName(loc.name) ? loc.name : getStructLabel(loc)}</span><button className="utility-btn" onClick={(e) => { e.stopPropagation(); onZoom({ pos: [loc.x, loc.y + loc.height/2, loc.z], size: Math.max(loc.width, loc.height, loc.depth) }); }} style={{ padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer', marginLeft: '5px' }}>◎</button></div>
  );
  return (
    <div className="panel quick-access-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}><h3 style={{ margin: 0 }}>QUICK_ACCESS</h3><button onClick={() => setIsOpen(false)} className="close-btn" style={{ position: 'static' }}>◀</button></header>
      <div className="location-list" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        {danger.length > 0 && (<><h4 className="category-header danger-text" onClick={() => setShowDanger(!showDanger)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showDanger ? '▼' : '▶'}</span>!! CRITICAL_SITES ({danger.length})</h4>{showDanger && danger.map(loc => <ListItem key={loc.id} loc={loc} />)}</>)}
        {starred.length > 0 && (<><h4 className="category-header starred-text" onClick={() => setShowStarred(!showStarred)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showStarred ? '▼' : '▶'}</span>★ PRIORITY_NODES ({starred.length})</h4>{showStarred && starred.map(loc => <ListItem key={loc.id} loc={loc} />)}</>)}
        {Object.keys(districts).length > 0 && (<><h4 className="category-header" onClick={() => setShowDistricts(!showDistricts)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showDistricts ? '▼' : '▶'}</span>DISTRICT_ZONES</h4>{showDistricts && Object.entries(districts).map(([name, data]: any) => (<div key={name} style={{ marginBottom: '10px' }}><div style={{ color: data.color, fontSize: '0.65rem', fontWeight: 'bold', paddingLeft: '20px', marginBottom: '5px', borderLeft: `2px solid ${data.color}`, marginLeft: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{name.toUpperCase()}</span><button className="utility-btn" onClick={(e) => { e.stopPropagation(); onZoom({ pos: data.center, size: data.size }); }} style={{ padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer', color: data.color, borderColor: data.color }}>◎</button></div>{data.locations.length > 0 ? data.locations.map((loc: any) => <ListItem key={loc.id} loc={loc} />) : <div style={{ fontSize: '0.6rem', opacity: 0.5, paddingLeft: '35px' }}>NO_DEFINED_DATA</div>}</div>))}</>)}
        {others.length > 0 && (<><h4 className="category-header" onClick={() => setShowOthers(!showOthers)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showOthers ? '▼' : '▶'}</span>DEFINED_STRUCTURES ({others.length})</h4>{showOthers && others.map(loc => <ListItem key={loc.id} loc={loc} />)}</>)}
        {definedLocations.length === 0 && Object.keys(districts).length === 0 && (<p style={{ fontSize: '0.7rem', opacity: 0.5 }}>NO_DEFINED_DATA_POINTS</p>)}
      </div>
    </div>
  );
}

const GlobalCameraCapture = () => {
  const { camera } = useThree();
  useEffect(() => {
    (window as any).globalCamera = camera;
  }, [camera]);
  return null;
};

function CursorPivotControls() {
  const { camera, controls, raycaster, pointer, scene } = useThree();

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      // Rotate on left or right click
      if ((e.button === 0 || e.button === 2) && controls && (controls as any).setOrbitPoint) {
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = -(e.clientY / window.innerHeight) * 2 + 1;
        const mouse = new THREE.Vector2(x, y);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        if (intersects.length > 0) {
          const point = intersects[0].point;
          (controls as any).setOrbitPoint(point.x, point.y, point.z);
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [camera, pointer, raycaster, scene, controls]);

  return null;
}

function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { camera, controls, size } = useThree();
    const startTime = useRef<number | null>(null);
    const initialPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const initialTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const destPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const moveDir = useRef<THREE.Vector3>(new THREE.Vector3());
    const panAxis = useRef<THREE.Vector3>(new THREE.Vector3());
    const upVec = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

    useFrame((state) => {
        if (!target || !controls || !(camera as any).fov) return;
        
        if (!isSetup.current) {
            isSetup.current = true;
            startTime.current = state.clock.elapsedTime;
            
            // 1. Store initial state
            initialPos.current.copy(camera.position);
            if (typeof (controls as any).getTarget === 'function') {
                (controls as any).getTarget(initialTarget.current);
            } else if ((controls as any).target) {
                initialTarget.current.copy((controls as any).target);
            }

            // 2. Compute exact mathematical framing distance
            const [tx, ty, tz] = target.pos;
            destTarget.current.set(tx, ty, tz);
            
            // Radius of the object's bounding sphere
            const radius = Math.max(15, target.size * 1.5);
            
            // Calculate distance needed to fit radius in FOV
            const fov = (camera as any).fov * (Math.PI / 180);
            const aspect = size.width / size.height;
            let fitDistance = radius / Math.sin(fov / 2);
            
            // If window is tall and narrow, increase distance to prevent cropping sides
            if (aspect < 1) {
                fitDistance = fitDistance / aspect;
            }

            // 3. Force 45-degree up and 45-degree right angle (Isometric)
            // x: right, y: up, z: toward viewer
            const isoDir = new THREE.Vector3(0.5, 0.7071, 0.5).normalize();
            
            // Dest position is exactly the target center + offset direction * fitDistance
            destPos.current.copy(destTarget.current).add(isoDir.multiplyScalar(fitDistance));

            distanceRef.current = initialPos.current.distanceTo(destPos.current);
        }

        if (startTime.current === null) return;

        const duration = 2.0; 
        const elapsed = state.clock.elapsedTime - startTime.current;
        const progress = Math.min(1, elapsed / duration);
        
        // Smooth easing
        const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // 1. Linear interpolation for basic path
        currentPos.current.lerpVectors(initialPos.current, destPos.current, t);
        
        // 2. Add an "Arc" (Swoop up in the middle)
        const arcHeight = distanceRef.current * 0.25;
        const swoop = Math.sin(t * Math.PI) * arcHeight;
        currentPos.current.y += swoop;

        // 3. Add a "Pan" (Horizontal curve)
        moveDir.current.subVectors(destPos.current, initialPos.current).normalize();
        if (moveDir.current.lengthSq() > 0.001) {
            panAxis.current.copy(upVec.current).cross(moveDir.current).normalize();
            const panAmount = Math.sin(t * Math.PI) * (distanceRef.current * 0.4);
            currentPos.current.add(panAxis.current.multiplyScalar(panAmount));
        }

        // Apply to camera and controls
        currentTarget.current.lerpVectors(initialTarget.current, destTarget.current, t);
        
        if (typeof (controls as any).setLookAt === 'function') {
            (controls as any).setLookAt(
                currentPos.current.x, currentPos.current.y, currentPos.current.z, 
                currentTarget.current.x, currentTarget.current.y, currentTarget.current.z, 
                false
            );
        } else {
            camera.position.copy(currentPos.current);
            camera.lookAt(currentTarget.current);
            if ((controls as any).target) (controls as any).target.copy(currentTarget.current);
        }
        
        // Force sync controls to prevent internal tweening conflicts
        (controls as any).update(0);

        if (progress >= 1) {
            isSetup.current = false;
            startTime.current = null;
            onComplete();
        }
    });

    return null;
  }

function App() {
  const controlsRef = useRef<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [editingDistrict, setEditingDistrict] = useState<any>(null);
  const [overlapIds, setOverlapIds] = useState<number[]>([]);
  const [roads, setRoads] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<any | null>(null);
  const [showBattleMapManager, setShowBattleMapManager] = useState(false);
  const [activeBattleMapData, setActiveBattleMapData] = useState<any>(null);
  const [battleMapPositions, setBattleMapPositions] = useState<Record<string, {x: number, z: number}>>({});
  const [currentLocBattleMaps, setCurrentLocBattleMaps] = useState<any[]>([]);
  const [cameraTarget, setCameraTarget] = useState<{ pos: [number, number, number], size: number } | null>(null);
  const [showZoomComplete, setShowZoomComplete] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState('');
  
  let isPrimaryAdmin = false;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      isPrimaryAdmin = !payload.isTemporary;
    } catch (e) { }
  }

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [view, setView] = useState<'list' | 'editor' | 'generator' | 'district' | 'join' | 'draw_roads' | 'city_gen' | 'battle_map'>('list');
  const [editId, setEditId] = useState<number | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [userName, setUserName] = useState<string>('');
  const [tempUserName, setTempUserName] = useState('');
  const [currentController, setCurrentController] = useState<string>('');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeEditLocation, setActiveEditLocation] = useState<any>(null);
  const [isSomeoneEditing, setIsSomeoneEditing] = useState(false);
  const [activeSidebarMenu, setActiveSidebarMenu] = useState<'none' | 'quick_access' | 'nav_controls' | 'system_info' | 'geometry_protocols' | 'city_data_base'>('none');
  const [infoPanelPos, setInfoPanelPos] = useState({ x: 100, y: 100 });
  const [chatPos, setChatPos] = useState({ x: 400, y: 100 });
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  useEffect(() => {
    const handleClear = () => { (window as any).hasUnsavedChanges = false; };
    window.addEventListener('clearUnsavedChanges', handleClear);
    return () => window.removeEventListener('clearUnsavedChanges', handleClear);
  }, []);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Load notification preference from the user's rhombus data
  useEffect(() => {
    if (!userName || !locations.length) return;
    const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
    if (existing) {
        setNotificationsEnabled(existing.notifications_enabled !== 0);
    }
  }, [userName, locations.length]);

  const toggleNotifications = () => {
    const nextState = !notificationsEnabled;
    setNotificationsEnabled(nextState);
    if (socketRef.current) {
        socketRef.current.emit('updateNotifications', { userName, enabled: nextState });
    }
  };

  useEffect(() => {
    if (isChatOpen) setHasUnreadChat(false);
  }, [isChatOpen]);

  const [notification, setNotification] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(() => { const saved = localStorage.getItem('audioEnabled'); return saved !== null ? JSON.parse(saved) : true; });
  const [isBatchSelecting, setIsBatchSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [districtSelection, setDistrictSelection] = useState<number[]>([]);
  const [districtConfig, setDistrictConfig] = useState({ name: '', color: '#00ff00' });
  const [joinSelection, setJoinSelection] = useState<number[]>([]);
  const [selectedClassification, setSelectedClassification] = useState<string>('');
  const [roadSelectionBounds, setRoadSelectionBounds] = useState<{ min: THREE.Vector3, max: THREE.Vector3 } | null>(null);
  const [roadTrail, setRoadTrail] = useState<THREE.Vector3[][]>([]);
  const [roadDrawMode, setRoadDrawMode] = useState<'free' | 'straight'>('free');
  const [snapToGrid, setSnapToGrid] = useState(false);
    const [snapRotation, setSnapRotation] = useState(false);
  const [drawingRoadWidth, setDrawingRoadWidth] = useState(2.4);
  const [citySectionType, setCitySectionType] = useState<'MIXED' | 'CORPO' | 'URBAN' | 'SLUMS' | 'INDUSTRIAL'>('MIXED');
  const [genExcludeRoads, setGenExcludeRoads] = useState(false);
  const [socket, setSocket] = useState<any>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [rhombusState, setRhombusState] = useState(() => {
    const savedColor = localStorage.getItem('rhombusColor') || '#00ff00';
    return { active: false, color: savedColor, name: '', description: '' };
  });

  // Load player configuration from the database when locations are fetched
  useEffect(() => {
    if (!userName || !locations.length) return;
    const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
    if (existing) {
        setRhombusState(prev => ({
            ...prev,
            // DO NOT set active: true here. That should only happen when the user clicks 'DEPLOY'
            color: existing.color || prev.color,
            name: existing.name || '',
            description: existing.description || ''
        }));
    }
  }, [userName, locations.length]);

  // Sync player configuration to DB whenever they change it in the sidebar
  const syncRhombusToDB = async (newState: any) => {
    const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
    if (existing) {
        await fetch(`/api/locations/${existing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ ...existing, name: newState.name, description: newState.description, color: newState.color })
        });
        // fetchLocations() is not strictly needed here as local state is ahead, 
        // but it keeps everyone in sync via sockets
    }
  };

  useEffect(() => {
    localStorage.setItem('rhombusColor', rhombusState.color);
  }, [rhombusState.color]);

  const groupedLocations = useMemo(() => {
    const groups: any = {};
    locations.forEach(loc => {
      const pid = loc.parent_id || 'root';
      if (!groups[pid]) groups[pid] = [];
      groups[pid].push(loc);
    });
    return groups;
  }, [locations]);

  // High-performance render list split
  const renderLists = useMemo(() => {
    const roots = groupedLocations['root'] || [];
    const simple: any[] = [];
    const interactive: any[] = [];

    roots.forEach((loc: any) => {
      if (loc.shape === 'rhombus' || loc.shape === 'enemy_rhombus') return; // Dedicated components handle these

      const children = groupedLocations[loc.id] || [];
      const isSelected = !isBatchSelecting && view !== 'district' && view !== 'join' && selectedLocation?.id === loc.id;
      const isBatchSelected = selectedIds.includes(loc.id) || districtSelection.includes(loc.id) || joinSelection.includes(loc.id);
      const isOverlapped = overlapIds.includes(loc.id) || children.some((c: any) => overlapIds.includes(c.id));
      
      if (!isSelected && !isBatchSelected && !isOverlapped) {
        // Flatten parent and all its children into the simple (instanced) rendering list
        const pushSimple = (p: any) => {
          simple.push({
            id: p.id,
            shape: p.shape,
            polyCount: p.polyCount,
            x: p.x,
            y: p.y,
            z: p.z,
            width: p.width,
            height: p.height,
            depth: p.depth,
            color: p.color,
            rotation: p.rotation,
              rotation_x: p.rotation_x,
              rotation_z: p.rotation_z,
              district_color: p.district_color,
            isFavorite: p.isFavorite,
            isDanger: p.isDanger,
            name: p.name,
            description: p.description,
            npcs: p.npcs,
            rootLoc: loc // Pointer to root parent location for click selection
          });
        };
        pushSimple(loc);
        children.forEach((c: any) => pushSimple(c));
      } else {
        interactive.push({ loc, children, isSelected, isBatchSelected, isOverlapped });
      }
    });
    return { simple, interactive };
  }, [groupedLocations, isBatchSelecting, view, selectedLocation, selectedIds, districtSelection, joinSelection, overlapIds]);

  const toggleSelection = (id: number) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };

  useEffect(() => {
    if (selectedLocation && selectedLocation.shape !== 'rhombus' && selectedLocation.shape !== 'enemy_rhombus') {
      fetch(`/api/locations/${selectedLocation.id}/battle_maps`)
        .then(res => res.json())
        .then(data => setCurrentLocBattleMaps(Array.isArray(data) ? data : []))
        .catch(() => setCurrentLocBattleMaps([]));
    } else {
      setCurrentLocBattleMaps([]);
    }
  }, [selectedLocation?.id]);

  const enterBattleMap = (locId: number) => {
    if (currentLocBattleMaps.length === 0) return;
    
    let targetFloor = 0;
    const adminInMap = activeUsers.find((u: any) => u.isAdmin && u.currentBattleMapId === locId);
    if (adminInMap && adminInMap.currentFloorIndex !== undefined) {
      targetFloor = adminInMap.currentFloorIndex;
    }

    if (userName && socketRef.current) {
        const userLoc = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
        if (userLoc) {
            socketRef.current.emit('requestInstantRhombusPurge', { id: userLoc.id, owner: userName });
        }
        setRhombusState((prev: any) => ({ ...prev, active: false }));
    }

    setActiveBattleMapData({ locationId: locId, maps: currentLocBattleMaps, currentFloorIndex: targetFloor });
    setView('battle_map');
    setSelectedLocation(null);
    if (socketRef.current) socketRef.current.emit('battle_map_enter', { locationId: locId, floorIndex: targetFloor });
  };

  const exitBattleMap = () => {
    setActiveBattleMapData(null);
    setView('list'); // or previous view
    setBattleMapPositions({});
    if (socketRef.current) socketRef.current.emit('battle_map_leave');
  };

  const handleBuildingClick = (loc: any) => {
    if (isCopyingSize) {
        const rootId = loc.parent_id || loc.id;
        
        // If the clicked building IS the one currently being edited, read from live Three.js bounding box
        // so we capture the stretched (unsaved) size, not the stale database values.
        const isCurrentlyEdited = targetObject && (editData as any).id && ((editData as any).id === rootId || (editData as any).id === loc.id);
        
        let totalW: number, totalH: number, totalD: number;
        
        if (isCurrentlyEdited && targetObject) {
            // Compute bounding box of the live Three.js object (respects current scale)
            const box = new THREE.Box3().setFromObject(targetObject);
            const size = new THREE.Vector3();
            box.getSize(size);
            totalW = size.x;
            totalH = size.y;
            totalD = size.z;
        } else {
            // Read from database locations[] array (for saved buildings)
            const allParts = locations.filter((l: any) => l.id === rootId || l.parent_id === rootId);
            
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            
            const rootLoc = locations.find((l: any) => l.id === rootId) || loc;
            const rootAngle = rootLoc.rotation || 0;
            const cosA = Math.cos(-rootAngle);
            const sinA = Math.sin(-rootAngle);
            
            allParts.forEach((p: any) => {
                const dx = p.x - rootLoc.x;
                const dz = p.z - rootLoc.z;
                const localX = dx * cosA - dz * sinA;
                const localZ = dx * sinA + dz * cosA;
                
                const hW = p.width / 2;
                const hH = p.height;
                const hD = p.depth / 2;
                
                if (localX - hW < minX) minX = localX - hW;
                if (localX + hW > maxX) maxX = localX + hW;
                if (p.y < minY) minY = p.y;
                if (p.y + hH > maxY) maxY = p.y + hH;
                if (localZ - hD < minZ) minZ = localZ - hD;
                if (localZ + hD > maxZ) maxZ = localZ + hD;
            });
            
            totalW = maxX - minX;
            totalH = maxY - minY;
            totalD = maxZ - minZ;
        }
        
        // Guard against degenerate sizes
        if (!isFinite(totalW) || totalW <= 0) totalW = editData.width || 8;
        if (!isFinite(totalH) || totalH <= 0) totalH = editData.height || 16;
        if (!isFinite(totalD) || totalD <= 0) totalD = editData.depth || 8;

        if (editId && targetObject) {
            // EXISTING building: compute its current bounding box, then scale targetObject
            // so the building visually stretches to match the copied size.
            const editingParts = locations.filter((l: any) => l.id === editId || l.parent_id === editId);
            let curMinX = Infinity, curMaxX = -Infinity;
            let curMinY = Infinity, curMaxY = -Infinity;
            let curMinZ = Infinity, curMaxZ = -Infinity;
            const editRoot = locations.find((l: any) => l.id === editId);
            const eAngle = editRoot ? (editRoot.rotation || 0) : 0;
            const eCos = Math.cos(-eAngle);
            const eSin = Math.sin(-eAngle);
            editingParts.forEach((p: any) => {
                const dx = p.x - (editRoot?.x || 0);
                const dz = p.z - (editRoot?.z || 0);
                const lX = dx * eCos - dz * eSin;
                const lZ = dx * eSin + dz * eCos;
                if (lX - p.width/2 < curMinX) curMinX = lX - p.width/2;
                if (lX + p.width/2 > curMaxX) curMaxX = lX + p.width/2;
                if (p.y < curMinY) curMinY = p.y;
                if (p.y + p.height > curMaxY) curMaxY = p.y + p.height;
                if (lZ - p.depth/2 < curMinZ) curMinZ = lZ - p.depth/2;
                if (lZ + p.depth/2 > curMaxZ) curMaxZ = lZ + p.depth/2;
            });
            const curW = curMaxX - curMinX;
            const curH = curMaxY - curMinY;
            const curD = curMaxZ - curMinZ;
            // Apply scale ratio to the THREE.js group so the building stretches to match
            const scaleX = (curW > 0) ? totalW / curW : 1;
            const scaleY = (curH > 0) ? totalH / curH : 1;
            const scaleZ = (curD > 0) ? totalD / curD : 1;
            targetObject.scale.set(scaleX, scaleY, scaleZ);
            setEditData({ ...editData, baseWidth: curW, baseHeight: curH, baseDepth: curD });
        } else {
            // NEW building: update editData dimensions and reset scale
            setEditData({ ...editData, baseWidth: totalW, baseHeight: totalH, baseDepth: totalD, width: totalW, height: totalH, depth: totalD });
            if (targetObject) targetObject.scale.set(1, 1, 1);
            
            // If a generation type is already selected, regenerate at the new size (keep same type, cycle style)
            if (editorGenType) {
                const raw: any[] = [];
                let zoneVal = 0.5;
                if (editorGenType === 'CORPO') zoneVal = 0.9;
                else if (editorGenType === 'URBAN') zoneVal = 0.5;
                else if (editorGenType === 'SLUMS') zoneVal = 0.1;
                else if (editorGenType === 'INDUSTRIAL') zoneVal = -0.1;
                else if (editorGenType === 'LANDMARK') zoneVal = 1.5;
                else if (editorGenType === 'MARKETS') zoneVal = 2.0;
                else if (editorGenType === 'CUSTOM') zoneVal = 3.0;
                const baseMaxStyle = editorGenType === 'CORPO' ? 11 : editorGenType === 'URBAN' ? 10 : editorGenType === 'INDUSTRIAL' ? 10 : editorGenType === 'SLUMS' ? 1 : editorGenType === 'LANDMARK' ? 13 : editorGenType === 'MARKETS' ? 5 : 0;
                const customPoolSize = locations.filter((b: any) => b.classification === editorGenType && !b.parent_id).length;
                const maxStyle = baseMaxStyle + customPoolSize;
                if (maxStyle === 0) return;
                const currentStyle = editorStyleIndex % maxStyle;
                generateThemedBuildingsForPlot(0, 0, totalW, totalD, zoneVal, () => false, () => '', {}, raw, locations, undefined, totalH, currentStyle);
                setEditorStyleIndex(editorStyleIndex + 1);
                for (let i = 0; i < raw.length; i++) {
                    if (!raw[i].name) raw[i].name = editorGenType + '_';
                    if (editData.color) raw[i].color = editData.color;
                }
                setEditorGenParts(raw);
            }
        }
        
        setIsCopyingSize(false);
        return;
    }
    if (view === 'editor' || view === 'generator') return;
    if (isBatchSelecting) {
      toggleSelection(loc.id);
    } else if (view === 'district') {
      setDistrictSelection(prev => prev.includes(loc.id) ? prev.filter(i => i !== loc.id) : [...prev, loc.id]);
    } else if (view === 'join') {
        const getAllDescendants = (id) => {
          let ids = [id];
          const childrenList = locations.filter(l => l.parent_id === id);
          childrenList.forEach(c => {
            ids = ids.concat(getAllDescendants(c.id));
          });
          return ids;
        };
        const locIds = getAllDescendants(loc.id);

        setJoinSelection(prev => {
          const isSelected = prev.includes(loc.id);
          const next = isSelected 
             ? prev.filter(i => !locIds.includes(i))
             : Array.from(new Set([...prev, ...locIds]));

          if (next.length === locIds.length && !isSelected) {
            setSelectedClassification(loc.classification || '');
          } else if (next.length === 0) {
            setSelectedClassification('');
          }
          return next;
        });
      } else {
      setSelectedLocation(prev => prev?.id === loc.id ? null : loc);
    }
  };

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const startupPlayed = useRef(false);

  useEffect(() => {
    localStorage.setItem('audioEnabled', JSON.stringify(audioEnabled));
    const loopSound = new Audio('/Loop_seamless_fixed.mp3');
    loopSound.loop = true; loopSound.volume = 0.01;
    const playAudio = async () => { if (audioEnabled) { try { await loopSound.play(); } catch (e) {} } };
    if (!audioEnabled) loopSound.pause();
    document.addEventListener('click', playAudio, { once: true });
    return () => { document.removeEventListener('click', playAudio); loopSound.pause(); };
  }, [audioEnabled]);

  const [statusText, setStatusText] = useState('');
  const [statusHistory, setStatusHistory] = useState<string[]>([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isGeneratingMap, setIsGeneratingMap] = useState(false);
  const [throbber, setThrobber] = useState('');

  useEffect(() => {
    const typeSpeed = 50; const waitTime = 2000; const throbbers = ['|', '/', '-', '\\'];
    if (isWaiting) {
      setThrobber('');
      const timer = setTimeout(() => {
        setIsWaiting(false); setCharIndex(0);
        setStatusHistory(prev => [...prev, messages[messageIndex]].slice(-4));
        setStatusText('');
        let nextIndex; do { nextIndex = Math.floor(Math.random() * messages.length); } while (messages.length > 1 && nextIndex === messageIndex);
        setMessageIndex(nextIndex);
      }, waitTime);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setThrobber(throbbers[Math.floor(Date.now() / 200) % throbbers.length]);
      const currentMessage = messages[messageIndex];
      if (charIndex < currentMessage.length) { setStatusText(prev => prev + currentMessage[charIndex]); setCharIndex(prev => prev + 1); } else { setIsWaiting(true); }
    }, typeSpeed);
    return () => clearTimeout(timer);
  }, [charIndex, isWaiting, messageIndex]);

  const [transformMode, setTransformMode] = useState<'translate' | 'scale'>('translate');
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    const handleGlobalPointerUp = () => { setIsDragging(false); };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, []);
  const [editData, setEditData] = useState({ name: '', description: '', npcs: '', x: 0, y: 0, z: 0, width: 8, height: 16, depth: 8, baseWidth: 8, baseHeight: 16, baseDepth: 8, shape: 'box', color: '#00ff00', isFavorite: false, isDanger: false, owner: '', polyCount: 5 });
  const [editorGenParts, setEditorGenParts] = useState<any[]>([]);
  const [editorGenType, setEditorGenType] = useState<string>('');
  const [editorStyleIndex, setEditorStyleIndex] = useState(0);
  const [isCopyingSize, setIsCopyingSize] = useState(false);
  const [isPlantingTrees, setIsPlantingTrees] = useState(false);
  const [isDeployingEnemy, setIsDeployingEnemy] = useState(false);
  const [treeBatchSize, setTreeBatchSize] = useState(5);
  const [blockBuildings, setBlockBuildings] = useState<any[]>([]);

  const handleTreePlantClick = async (e: any) => {
      if (!isPlantingTrees || !isAdmin) return;
      e.stopPropagation();
      
      const cx = e.point.x;
      const cz = e.point.z;
      
      const root = {
          name: 'PARK',
          description: 'Holographic Forest Cluster',
          x: cx, y: 0, z: cz,
          width: 1.0, depth: 1.0, height: 0.1,
          color: '#1a5925', shape: 'none', polyCount: 5
      };
      
      const res = await fetch('/api/locations', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
          body: JSON.stringify(root) 
      });
      
      if (res.ok) {
          const result = await res.json();
          const rootId = result.data[0].id;
          
          const trees: any[] = [];
          const placedPoints: {x: number, z: number}[] = [];
          const minSpread = 2.5;
          const maxSpread = Math.max(3, treeBatchSize * 1.5);
          
          for (let i = 0; i < treeBatchSize; i++) {
              let px = cx;
              let pz = cz;
              
              if (treeBatchSize > 1) {
                  let attempts = 0;
                  while (attempts < 50) {
                      const r = Math.sqrt(Math.random()) * maxSpread;
                      const theta = Math.random() * Math.PI * 2;
                      px = cx + r * Math.cos(theta);
                      pz = cz + r * Math.sin(theta);
                      
                      const isFarEnough = placedPoints.every(p => Math.sqrt((p.x - px)**2 + (p.z - pz)**2) > minSpread);
                      if (isFarEnough) break;
                      attempts++;
                  }
              }
              
              placedPoints.push({x: px, z: pz});
              
              const trunkHFixed = 1.5;
              const canopyWFixed = 1.2;
              
              trees.push({
                  name: 'HOLOTREE_TRUNK', x: px, y: 0.1, z: pz, 
                  width: 0.15, depth: 0.15, height: trunkHFixed, 
                  color: '#00ff66', shape: 'cylinder', parent_id: Number(rootId), polyCount: 5
              });
              
              trees.push({
                  name: 'HOLOTREE_CANOPY', x: px, y: 0.1 + trunkHFixed, z: pz, 
                  width: canopyWFixed, depth: canopyWFixed, height: canopyWFixed, 
                  color: '#00ff66', shape: 'sphere', parent_id: Number(rootId), polyCount: 5
              });
          }
          
          await fetch('/api/locations', { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
              body: JSON.stringify(trees) 
          });
      }
  };
  const [targetObject, setTargetObject] = useState<any>(null);
  const genGroupRef = useRef<any>(null);
  const editMeshRef = useRef<any>(null);
  const socketRef = useRef<any>(null);
  const wasGrantedForEditRef = useRef<boolean>(false);

  useEffect(() => {
    const savedName = localStorage.getItem('userName');
    if (savedName) { setUserName(savedName); setTempUserName(savedName); }
  }, []);

  useEffect(() => {
    if (!userName || !isLoggedIn) return;
    const interval = setInterval(() => { fetch('/api/control').then(res => res.json()).then(data => setCurrentController(data.controller)).catch(err => console.error(err)); }, 2000);
    return () => clearInterval(interval);
  }, [userName, isLoggedIn]);

  useEffect(() => { if (view !== 'generator') setTargetObject(null); if (view !== 'editor') { setEditorGenParts([]); setEditorGenType(''); setIsCopyingSize(false); } }, [view]);

  const fetchLocations = () => { fetch(`/api/locations?_t=${Date.now()}`).then(res => res.json()).then(data => setLocations(data)).catch(err => console.error("Error fetching locations:", err)); };
  const fetchDistricts = () => { fetch(`/api/districts?_t=${Date.now()}`).then(res => res.json()).then(data => setDistricts(data)).catch(err => console.error("Error fetching districts:", err)); };
  const fetchRoads = () => { fetch(`/api/roads?_t=${Date.now()}`).then(res => res.json()).then(data => setRoads(data)).catch(err => console.error("Error fetching roads:", err)); };

  const batchDelete = async () => {
    if (selectedIds.length === 0) return;
    const res = await fetch('/api/locations/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { 
        fetchLocations(); 
        setSelectedIds([]); 
        setIsBatchSelecting(false); 
        // Force-deactivate Rhombus deployment state to prevent moving Admin character on next click
        setRhombusState((p: any) => ({ ...p, active: false }));
    }
  };

  const isChatOpenRef = useRef(isChatOpen);
  const notificationsEnabledRef = useRef(notificationsEnabled);
  
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);
  useEffect(() => { notificationsEnabledRef.current = notificationsEnabled; }, [notificationsEnabled]);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchLocations(); fetchRoads(); fetchDistricts();
    const newSocket = io();
    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.on('chatHistory', (history: any[]) => setChatMessages(history));
    newSocket.on('receiveMessage', (msg: any) => {
        setChatMessages(prev => [...prev, msg]);
        // Trigger notification flash if window is closed AND notifications are enabled AND message is not from self
        if (!isChatOpenRef.current && notificationsEnabledRef.current && msg.sender !== userName) {
            setHasUnreadChat(true);
        }
    });

    newSocket.on('receivePrivateMessage', (msg: any) => {
        if (!isChatOpenRef.current && notificationsEnabledRef.current && msg.sender !== userName) {
            setHasUnreadChat(true);
        }
    });

    newSocket.on('accessGranted', (data: any) => {
        if (data.targetUser === userName) {
            setToken(data.token);
            setIsAdmin(true);
            if (data.forEditing) {
                wasGrantedForEditRef.current = true;
                setNotification(null);
            } else {
                setNotification("TEMPORARY_ADMIN_ACCESS_GRANTED");
            }
        }
    });

    newSocket.on('accessRevoked', (data: any) => {
        if (data.targetUser === userName) {
            setToken('');
            setNotification("TEMPORARY_ADMIN_ACCESS_REVOKED");
        }
    });

    newSocket.on('connect', () => {
      console.log("Socket connected, identifying as:", userName);
      newSocket.emit('identify', { userName, isAdmin: !!token, token });
    });

    newSocket.on('dataUpdated', (payload: any) => { fetchLocations(); fetchRoads(); fetchDistricts(); if (!payload || !payload.isRhombusOnly) { (window as any).hasUnsavedChanges = true; } });
    newSocket.on('activeUsersUpdated', (users: any[]) => setActiveUsers(users));
    newSocket.on('force_floor_change', (data: any) => {
        setActiveBattleMapData((prev: any) => {
          if (prev && prev.locationId === data.locationId) {
             return { ...prev, currentFloorIndex: data.floorIndex };
          }
          return prev;
        });
      });
      newSocket.on('battle_map_moved', (data: any) => {
        setBattleMapPositions(prev => ({ ...prev, [data.userName]: { x: data.x, z: data.z } }));
      });
      newSocket.on('editingRequested', (data: any) => {
      if (data.userId !== userName && notification === "REQUEST_SENT_TO_ADMIN") {
        setNotification(`ANOTHER_USER_REQUESTING_ACCESS: ${data.userName}`);
      }
      setPendingRequests(prev => [...prev, data]);
    });
    newSocket.on('editingStarted', (data: any) => { setIsSomeoneEditing(true); if (data.userId === userName) { setActiveEditLocation(data.location); setIsEditModalOpen(true); } });
    newSocket.on('editingStopped', () => setIsSomeoneEditing(false));
    newSocket.on('editingDenied', (data: any) => { if (data.userId === userName) setNotification("EDITING_ACCESS_DENIED_BY_ADMIN"); });
    newSocket.on('editingRevoked', (data: any) => { setIsEditModalOpen(false); setActiveEditLocation(null); setIsSomeoneEditing(false); if (data.userId === userName) setNotification("ACCESS_TO_DATA_POINT_REVOKED"); });
    return () => { newSocket.disconnect(); };
  }, [userName, isLoggedIn]);

  // Re-identify when admin token changes to update roster rank
  useEffect(() => {
    if (socket && userName) {
        socket.emit('identify', { userName, isAdmin: !!token, token });
    }
  }, [token, socket, userName]);

  useEffect(() => { if (isEditModalOpen && activeEditLocation) setEditData({ ...activeEditLocation, baseWidth: activeEditLocation.width, baseHeight: activeEditLocation.height, baseDepth: activeEditLocation.depth, polyCount: activeEditLocation.polyCount || 5 }); }, [isEditModalOpen, activeEditLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) });
    const data = await res.json();
    if (data.token) { setToken(data.token); setIsAdmin(true); setShowAdminPanel(true); } else { setNotification("LOGIN_FAILED"); }
  };

  const startBootSequence = () => { if (!tempUserName.trim()) return; localStorage.setItem('userName', tempUserName); setUserName(tempUserName); setIsLoggedIn(true); if (socketRef.current) socketRef.current.emit('identify', tempUserName); if (audioEnabled) { const startupSound = new Audio('/StartUp.mp3'); startupSound.volume = 0.20; startupSound.play().catch(() => {}); } };

  const handleSendMessage = (text: string, senderOverride?: string) => {
    if (socketRef.current) {
        socketRef.current.emit('sendMessage', { sender: senderOverride || userName, text });
    }
  };

  const handleGrantAccess = (targetUser: string) => {
    if (socketRef.current && token) {
      socketRef.current.emit('grantElevatedAccess', { adminToken: token, targetUser });
    }
  };

  const handleRevokeAccess = (targetUser: string) => {
    if (socketRef.current && token) {
      socketRef.current.emit('revokeElevatedAccess', { adminToken: token, targetUser });
    }
  };

  const handleLogout = () => {
    // 1. Immediately close all UI elements for a clean fade-out
    setIsChatOpen(false);
    setActiveSidebarMenu('none');
    setSelectedLocation(null);
    setTargetObject(null);
    setIsEditModalOpen(false);
    setIsBatchSelecting(false);
    setSelectedIds([]);
    setDistrictSelection([]);
    setJoinSelection([]);
    setRoadSelectionBounds(null);
    setRoadTrail([]);
    setCameraTarget(null);
    setShowAdminPanel(false);
    
    // Reset Rhombus state but keep color for next login preference
    setRhombusState((p: any) => ({ ...p, active: false }));

    if (socketRef.current && userName) {
        socketRef.current.emit('requestRhombusPurge', { owner: userName });
    }
    
    setNotification("TERMINATING_SESSION...");
    
    // 2. Wait for animation to finish before unmounting map
    setTimeout(() => {
        if (socket) socket.disconnect();
        setToken('');
        setIsAdmin(false);
        setIsLoggedIn(false);
        setNotification(null);
    }, 2500);
  };

  const cleanupEditModal = () => {
      setIsEditModalOpen(false);
      if (socketRef.current) socketRef.current.emit('editingFinished');
      if (wasGrantedForEditRef.current) {
          if (socketRef.current) socketRef.current.emit('surrenderAccess', { token });
          setToken('');
          setIsAdmin(false);
          wasGrantedForEditRef.current = false;
      }
  };

  return (
    <div className="crt-container">
      <div className="scanlines"></div>
      {!isLoggedIn && (
        <div className="modal-overlay">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div className="panel login-panel" style={{textAlign: 'center', minWidth: '350px', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                <button className={`admin-toggle ${!audioEnabled ? 'muted' : ''}`} onClick={() => setAudioEnabled(!audioEnabled)} style={{padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  {audioEnabled ? (
                    <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                      <path fill="currentColor" fillRule="evenodd" d="m403.966 426.944l-33.285-26.63c74.193-81.075 74.193-205.015-.001-286.09l33.285-26.628c86.612 96.712 86.61 242.635.001 339.348M319.58 155.105l-33.324 26.659c39.795 42.568 39.794 108.444.001 151.012l33.324 26.658c52.205-58.22 52.205-146.109-.001-204.329m-85.163-69.772l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                      <path fill="currentColor" fillRule="evenodd" d="m403.375 257.27l59.584 59.584l-30.167 30.166l-59.583-59.583l-59.584 59.583l-30.166-30.166l59.583-59.584l-59.583-59.583l30.166-30.166l59.584 59.583l59.583-59.583l30.167 30.166zM234.417 85.333l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                    </svg>
                  )}
                </button>
              </div>
              <h1 style={{fontSize: '3rem', margin: '0', textShadow: 'var(--glow)'}}>CITY_NET</h1>
              <div style={{ fontSize: '0.65rem', opacity: 0.5, letterSpacing: '4px', marginTop: '35px', marginBottom: '15px' }}>NAV_OS_v1.0.4</div>
              <div><input value={tempUserName} onChange={e => setTempUserName(e.target.value)} placeholder="OPERATOR_ID" style={{fontSize: '1.2rem', textAlign: 'center'}} /><button className="upload-btn" onClick={startBootSequence} style={{fontSize: '1.2rem', padding: '10px'}}>LOGIN</button></div>
            </div>
            <div className="status-log-container">{statusHistory.map((msg, i) => <div key={i} className="status-line old-line">{msg}</div>)}<div className="status-line current-line">{isWaiting ? 'SYSTEM READY // ' : `SYSTEM CHECKING ${throbber} // `}{statusText}</div></div>
          </div>
        </div>
      )}
      {isLoggedIn && (
        <>
          <div className="ui-overlay">
      {showBattleMapManager && (selectedLocation || activeEditLocation || editId) && (
        <BattleMapManager locationId={selectedLocation ? selectedLocation.id : (activeEditLocation ? activeEditLocation.id : editId)} token={token} onClose={() => setShowBattleMapManager(false)} />
      )}
      {view === 'battle_map' && activeBattleMapData && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 100 }}>
          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'auto' }}>
            <h2 style={{ margin: 0, textShadow: '0 0 10px #00ff00', fontSize: '2em' }}>{activeBattleMapData.maps[activeBattleMapData.currentFloorIndex]?.designation?.toUpperCase() || 'UNKNOWN FLOOR'}</h2>
            <button onClick={exitBattleMap} style={{ padding: '10px 30px', marginTop: '10px', backgroundColor: '#ff0000', color: 'white', border: '1px solid #ff0000', cursor: 'pointer', fontWeight: 'bold' }}>EXIT</button>
          </div>
          {isAdmin && isPrimaryAdmin && (
            <div style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '10px', pointerEvents: 'auto' }}>
              {activeBattleMapData.maps.map((m: any, idx: number) => {
                let lbl = m.designation;
                if (lbl === 'Lobby') lbl = 'Lby';
                else if (lbl === 'Penthouse') lbl = 'PH';
                else if (lbl.startsWith('Level ')) lbl = 'L' + lbl.split(' ')[1];
                
                return (
                  <button key={m.id} 
                    style={{ padding: '15px', backgroundColor: activeBattleMapData.currentFloorIndex === idx ? '#00ff00' : '#222', color: activeBattleMapData.currentFloorIndex === idx ? '#000' : '#00ff00', border: '1px solid #00ff00', cursor: 'pointer', fontWeight: 'bold' }}
                    onClick={() => {
                      setActiveBattleMapData((p: any) => ({ ...p, currentFloorIndex: idx }));
                      if (socketRef.current) socketRef.current.emit('admin_force_floor_change', { locationId: activeBattleMapData.locationId, floorIndex: idx });
                    }}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
            {notification && <div className="modal-overlay" onClick={() => setNotification(null)} style={{cursor: 'pointer'}}><div className="panel" style={{color: '#ff0000', borderColor: '#ff0000'}}><h2 style={{fontSize: '2rem'}}>{notification}</h2></div></div>}
            {isEditModalOpen && activeEditLocation && (
              <div className="modal-overlay"><div className="panel"><h2>EDIT_DATA_POINT</h2><form onSubmit={async (e) => { e.preventDefault(); const res = await fetch(`/api/locations/${activeEditLocation.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(editData) }); if (res.ok) { setNotification("DATA_POINT_UPDATED"); cleanupEditModal(); } }} style={{display: 'flex', flexDirection: 'column', gap: '10px'}}><label>NAME</label><input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} style={{width: '100%'}} /><div style={{display: 'flex', gap: '10px', width: '100%'}}><div style={{flex: 1}}><label>DESCRIPTION</label><textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} style={{width: '100%', height: '100px'}} /></div><div style={{flex: 1}}><label>RESIDENTS</label><textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} style={{width: '100%', height: '100px'}} /></div></div><div style={{display: 'flex', gap: '10px', marginTop: '10px'}}><button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}>★</button><button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button></div>{isAdmin && isPrimaryAdmin && <button type="button" className="upload-btn" style={{backgroundColor: '#5500ff'}} onClick={() => setShowBattleMapManager(true)}>BATTLE MAPS</button>}<button type="submit" className="upload-btn">SAVE</button><button type="button" className="utility-btn" onClick={() => { cleanupEditModal(); }}>CLOSE</button></form></div></div>
            )}
            <Sidebar
              activeMenu={activeSidebarMenu}
              setActiveMenu={setActiveSidebarMenu}
              locations={locations}
              onSelect={setSelectedLocation}
              onZoom={setCameraTarget}
              selectedLocation={selectedLocation}
              userName={userName}
              token={token}
              onLogout={handleLogout}
              audioEnabled={audioEnabled}
              setAudioEnabled={setAudioEnabled}
              rhombusState={rhombusState}
              setRhombusState={setRhombusState}
              refreshLocations={fetchLocations}
              socketRef={socketRef}
              isChatOpen={isChatOpen}
              setIsChatOpen={setIsChatOpen}
              hasUnreadChat={hasUnreadChat}
              syncRhombusToDB={syncRhombusToDB}
              />
            <header style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                <div></div>

                {cameraTarget && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_ACTION: ZOOM TO POI IN PROGRESS `}<span style={{ width: '10px', display: 'inline-block' }}>{['|', '/', '-', '\\'][Math.floor(Date.now() / 150) % 4]}</span></div>}
                {showZoomComplete && !cameraTarget && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_STATUS: ZOOM COMPLETE`}</div>}
                {view === 'city_gen' && !roadSelectionBounds && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_PROMPT: LEFT-CLICK + DRAG TO SELECT GENERATION AREA`}</div>}
                {view === 'draw_roads' && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_PROMPT: HOLD LEFT-CLICK + DRAG TO DRAW PATH`}</div>}
                <div style={{display: 'flex', gap: '10px'}}>{token && <button className={`admin-toggle ${pendingRequests.length > 0 && !showAdminPanel ? 'unread-flash' : ''}`} onClick={() => setShowAdminPanel(!showAdminPanel)}>{showAdminPanel ? 'HIDE_DASHBOARD' : 'SHOW_DASHBOARD'}</button>}<button className="admin-toggle" onClick={() => !token && setIsAdmin(!isAdmin)}>{token ? 'ADMIN_MODE' : (isAdmin ? 'CANCEL' : 'ADMIN_LOGIN')}</button></div>
              </div>
            </header>
            {isAdmin && !token && <div className="panel admin-login"><form onSubmit={handleLogin}><input placeholder="USERNAME" onChange={e => setLoginForm({...loginForm, username: e.target.value})} /><input type="password" placeholder="PASSWORD" onChange={e => setLoginForm({...loginForm, password: e.target.value})} /><button type="submit">ACCESS_SYSTEM</button></form></div>}
            {token && showAdminPanel && (
              <AdminPanel
                isAdmin={isAdmin}
                isPrimaryAdmin={isPrimaryAdmin}
                setShowBattleMapManager={setShowBattleMapManager}
                isPlantingTrees={isPlantingTrees} setIsPlantingTrees={setIsPlantingTrees}
                  treeBatchSize={treeBatchSize} setTreeBatchSize={setTreeBatchSize}
                  isDeployingEnemy={isDeployingEnemy} setIsDeployingEnemy={setIsDeployingEnemy}
                  socketRef={socketRef}
                token={token}
                userName={userName}
                controlsRef={controlsRef}
                onLogout={() => { setToken(''); setIsAdmin(false); setShowAdminPanel(false); }}
                refreshLocations={fetchLocations}
                refreshRoads={fetchRoads}
                districts={districts}
                fetchDistricts={fetchDistricts}
                editingDistrict={editingDistrict}
                setEditingDistrict={setEditingDistrict}
                locations={locations} 
                roads={roads} 
                editData={editData} 
                setEditData={setEditData} 
                editId={editId} 
                setEditId={setEditId} 
                transformMode={transformMode} 
                setTransformMode={setTransformMode} 
                targetObject={targetObject} 
                blockBuildings={blockBuildings} 
                setBlockBuildings={setBlockBuildings} 
                selectedLocation={selectedLocation} 
                setSelectedLocation={setSelectedLocation} 
                setTargetObject={setTargetObject} 
                view={view} 
                setView={setView} 
                pendingRequests={pendingRequests} 
                setPendingRequests={setPendingRequests} 
                isBatchSelecting={isBatchSelecting} 
                setIsBatchSelecting={setIsBatchSelecting} 
                selectedIds={selectedIds} 
                setSelectedIds={setSelectedIds}
                toggleSelection={toggleSelection} 
                batchDelete={batchDelete} 
                districtSelection={districtSelection} 
                setDistrictSelection={setDistrictSelection} 
                districtConfig={districtConfig} 
                setDistrictConfig={setDistrictConfig} 
                joinSelection={joinSelection} 
                setJoinSelection={setJoinSelection} 
                selectedClassification={selectedClassification}
                setSelectedClassification={setSelectedClassification} 
                roadSelectionBounds={roadSelectionBounds} 
                setRoadSelectionBounds={setRoadSelectionBounds} 
                roadTrail={roadTrail} 
                setRoadTrail={setRoadTrail} 
                roadDrawMode={roadDrawMode} 
                setRoadDrawMode={setRoadDrawMode} 
                snapToGrid={snapToGrid} 
                  setSnapToGrid={setSnapToGrid}
                  snapRotation={snapRotation}
                  setSnapRotation={setSnapRotation}
                drawingRoadWidth={drawingRoadWidth}
                setDrawingRoadWidth={setDrawingRoadWidth}
                isGeneratingMap={isGeneratingMap}
                setIsGeneratingMap={setIsGeneratingMap}
                citySectionType={citySectionType}
                setCitySectionType={setCitySectionType}
                genExcludeRoads={genExcludeRoads}
                setGenExcludeRoads={setGenExcludeRoads}
                setRhombusState={setRhombusState}
                setActiveSidebarMenu={setActiveSidebarMenu}
                editorGenParts={editorGenParts}
                setEditorGenParts={setEditorGenParts}
                editorGenType={editorGenType}
                setEditorGenType={setEditorGenType}
                editorStyleIndex={editorStyleIndex}
                setEditorStyleIndex={setEditorStyleIndex}
                isCopyingSize={isCopyingSize}
                setIsCopyingSize={setIsCopyingSize}
                />
            )}
              <ChatWindow 
                  pos={chatPos} 
                  setPos={setChatPos} 
                  onClose={() => setIsChatOpen(false)} 
                  messages={chatMessages} 
                  activeUsers={activeUsers} 
                  userName={userName}
                  onSendMessage={handleSendMessage}
                  notificationsEnabled={notificationsEnabled}
                  onToggleNotifications={toggleNotifications}
                  isPrimaryAdmin={isPrimaryAdmin}
                  onGrantAccess={handleGrantAccess}
                  onRevokeAccess={handleRevokeAccess}
                  socket={socketRef.current}
                  token={token}
                  isChatOpen={isChatOpen}
              />
            {(() => {
              const isRhombus = selectedLocation?.shape === 'rhombus' || selectedLocation?.shape === 'enemy_rhombus';
              const isOwner = selectedLocation?.owner === userName;
              const isAdmin = token !== '';
              const canManage = isRhombus && (isAdmin || isOwner);
              
              // Show window if not admin OR if it's a rhombus that needs management OR just to view info
              if (selectedLocation && (!token || !showAdminPanel || canManage)) {
                return (
                  <DraggableWindow 
                    title={isUserDefinedName(selectedLocation.name) ? selectedLocation.name : (selectedLocation.shape === 'enemy_rhombus' ? 'HOSTILE_NODE' : (selectedLocation.shape === 'rhombus' ? 'TACTICAL_BEACON' : getStructLabel(selectedLocation)))} 
                    pos={infoPanelPos} 
                    setPos={setInfoPanelPos} 
                    onClose={() => setSelectedLocation(null)}
                  >
                    <div className="content">
                      {isRhombus ? (
                        <>
                          <p><strong>ID_TAG:</strong> {selectedLocation.name || (selectedLocation.shape === 'enemy_rhombus' ? 'UNKNOWN_HOSTILE' : 'UNTAGGED')}</p>
                          <p><strong>DATA_DESCRIPTION:</strong> {selectedLocation.description || 'NO_DATA'}</p>
                        </>
                      ) : (
                        <>
                          {selectedLocation.district_name && <p><strong>DISTRICT:</strong> {selectedLocation.district_name}</p>}
                          <p><strong>DESCRIPTION:</strong> {selectedLocation.description || 'NO_DATA'}</p>
                          <p><strong>RESIDENTS:</strong> {selectedLocation.npcs || 'UNKNOWN'}</p>
                        </>
                      )}
                    </div>
                    {canManage && (
                      <button className="upload-btn danger-btn" style={{marginTop: '10px'}} onClick={async () => {
                        const res = await fetch(`/api/locations/${selectedLocation.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                        if (res.ok) { setSelectedLocation(null); fetchLocations(); }
                      }}>PURGE_DATA_POINT</button>
                    )}
                    {isAdmin && isPrimaryAdmin && !isRhombus && (
      <></>
  )}
  {currentLocBattleMaps.length > 0 && (
      <button className="upload-btn" style={{backgroundColor: '#ff00ff', color: 'white'}} onClick={() => enterBattleMap(selectedLocation.id)}>ENTER BATTLE MAP</button>
  )}
  {!token && !isRhombus && <button className="upload-btn" onClick={() => { if (isSomeoneEditing) { setNotification("ANOTHER_USER_ACCESSING_DATA_POINTS"); } else { socketRef.current.emit('requestEditing', { userId: userName, userName, locationId: selectedLocation.id, locationName: selectedLocation.name }); setNotification("REQUEST_SENT_TO_ADMIN"); } }}>REQUEST_EDITING_RIGHTS</button>}
                  </DraggableWindow>
                );
              }
              return null;
            })()}
            <div className="bottom-bar"><p>{token ? 'EDITOR_ACTIVE // USE GIZMO TO MANIPULATE DATA_POINT' : (<><span style={{ display: 'inline-block', width: '250px', textAlign: 'right' }}>{isWaiting ? 'SYSTEM READY // ' : `SYSTEM CHECKING ${throbber} // `}</span><span style={{ display: 'inline-block', width: '300px', textAlign: 'left', whiteSpace: 'nowrap' }}>{statusText}</span></>)}</p></div>
          </div>
          <Canvas shadows frameloop="always" onPointerDown={() => { if (!rhombusState.active) setActiveSidebarMenu('none'); }}>
            {view === 'battle_map' ? (
              activeBattleMapData && activeBattleMapData.maps[activeBattleMapData.currentFloorIndex] && (
                <BattleMapScene 
                  mapUrl={activeBattleMapData.maps[activeBattleMapData.currentFloorIndex].image_url} 
                  onMapClick={(pos: any) => {
                    if (isDeployingEnemy && userName) {
                      const newRhombus = {
                          name: 'NEW ENEMY',
                          description: '',
                          x: pos.x, y: 0.1, z: pos.z,
                          width: 4, height: 4, depth: 4,
                          shape: 'enemy_rhombus',
                          color: '#ff0000',
                          owner: userName,
                          isDanger: true,
                          isFavorite: false,
                          npcs: ''
                      };
                      fetch('/api/locations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify(newRhombus)
                      }).then(() => {
                          fetchLocations();
                          setIsDeployingEnemy(false);
                      });
                    } else if (rhombusState?.active && userName) {
                      const newRhombus = {
                          name: rhombusState.name || '',
                          description: rhombusState.description || '',
                          x: pos.x, y: 0.1, z: pos.z,
                          width: 3.75, height: 3.75, depth: 3.75,
                          shape: 'rhombus',
                          color: rhombusState.color,
                          owner: userName
                      };
                      fetch('/api/locations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(newRhombus)
                      }).then(() => {
                          fetchLocations();
                          setRhombusState((prev: any) => ({ ...prev, active: false }));
                      });
                    }
                  }}
                />
              )
            ) : (
              <>
                <PerspectiveCamera makeDefault position={[0, 200, 250]} />
            <CameraControls ref={controlsRef} makeDefault enabled={!isDragging} dollyToCursor={true} />
            <OverlapChecker locations={locations} setOverlapIds={setOverlapIds} />
            <GlobalCameraCapture />
            <CursorPivotControls />
            <color attach="background" args={['#000000']} />
            {/* @ts-ignore */}
            {isPlantingTrees && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} onPointerDown={handleTreePlantClick}>
                    <planeGeometry args={[10000, 10000]} />
                    <meshBasicMaterial visible={false} />
                </mesh>
            )}
            <Grid raycast={() => null} infiniteGrid fadeDistance={750} fadeStrength={1.5} cellSize={1} cellThickness={0.7} sectionSize={10} sectionThickness={1.2} sectionColor="#006600" cellColor="#003300" />
            {token !== '' && (
              <group position={[0, 0.01, 0]}>
                {/* Center Lines (Blue) */}
                <mesh position={[0, 0, 0]} raycast={() => null}>
                  <boxGeometry args={[0.2, 0.01, 2000]} />
                  <meshBasicMaterial color="#0044ff" transparent opacity={0.6} />
                </mesh>
                <mesh position={[0, 0, 0]} raycast={() => null}>
                  <boxGeometry args={[2000, 0.01, 0.2]} />
                  <meshBasicMaterial color="#0044ff" transparent opacity={0.6} />
                </mesh>

                {/* Bifurcating Lines (White) */}
                <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 4, 0]} raycast={() => null}>
                  <boxGeometry args={[0.1, 0.01, 2000]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={0.4} />
                </mesh>
                <mesh position={[0, 0, 0]} rotation={[0, -Math.PI / 4, 0]} raycast={() => null}>
                  <boxGeometry args={[0.1, 0.01, 2000]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={0.4} />
                </mesh>
              </group>
            )}
            <CameraController target={cameraTarget} onComplete={() => { setCameraTarget(null); setShowZoomComplete(true); setTimeout(() => setShowZoomComplete(false), 3000); }} />
            <Roads roads={roads} />
            <GhostTraffic roads={roads} />
            <DistrictInteractions view={view} locations={locations} onSelectionChange={(data: any) => { if (view === 'city_gen') { setRoadSelectionBounds(data); } else if (view === 'district') { setDistrictSelection(prev => [...new Set([...prev, ...data])]); } else if (isBatchSelecting) { setSelectedIds(prev => [...new Set([...prev, ...data])]); } }} roadTrail={roadTrail} setRoadTrail={setRoadTrail} roadDrawMode={roadDrawMode} snapToGrid={snapToGrid} drawingRoadWidth={drawingRoadWidth} isBatchSelecting={isBatchSelecting} setSelectedIds={setSelectedIds} rhombusState={rhombusState} setRhombusState={setRhombusState} userName={userName} refreshLocations={fetchLocations} token={token} />
            {roadSelectionBounds && view === 'city_gen' && (
              <mesh position={[(roadSelectionBounds.min.x + roadSelectionBounds.max.x) / 2, 0.02, (roadSelectionBounds.min.z + roadSelectionBounds.max.z) / 2]}>
                <boxGeometry args={[Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x), 0.05, Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z)]} />
                <meshBasicMaterial color="#00ff66" wireframe transparent opacity={0.3} />
              </mesh>
            )}
<InstancedBuildings buildings={renderLists.simple} onSelect={handleBuildingClick} isDragging={isDragging} />
            {renderLists.interactive.map(({ loc, children, isSelected, isBatchSelected, isOverlapped }: any) => (
              <Building key={loc.id} location={loc} children={children} onClick={() => handleBuildingClick(loc)} isSelected={isSelected} isBatchSelected={isBatchSelected} isOverlapped={isOverlapped} setTargetObject={setTargetObject} editMeshRef={editMeshRef} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} isDragging={isDragging} socket={socket} activeUsers={activeUsers} />
            ))}
            </>
            )}
            {/* Dedicated Player Rhombus Rendering */}
            {locations.filter(l => l.shape === 'rhombus').map(loc => (
              <PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} roads={roads} />
            ))}
            {/* Dedicated Enemy Rhombus Rendering */}
            {locations.filter(l => l.shape === 'enemy_rhombus').map(loc => (
              <EnemyRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} roads={roads} isBattleMap={view === 'battle_map'} />
            ))}
            {token && view === 'editor' && !editId && (
              <group ref={(group) => { if (group && targetObject !== group) { setTargetObject(group); editMeshRef.current = group; } }} position={[editData.x, editData.y, editData.z]}>
                {editorGenParts.length > 0 ? (
                  <>
                    {editorGenType === 'SLUMS' && (
                      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <circleGeometry args={[Math.max(editData.width, editData.depth) * 0.8, 32]} />
                        <meshBasicMaterial color="#00ff00" transparent opacity={0.3} wireframe />
                      </mesh>
                    )}
                    {editorGenParts.map((b, i) => {
                      const renderGenGeometry = () => { switch (b.shape) { case 'none': return <boxGeometry args={[0.001, 0.001, 0.001]} />; case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 5]} />; case 'sphere': return <sphereGeometry args={[0.5, 6, 6]} />; case 'pyramid': return <cylinderGeometry args={[0, 0.5, 1, 4]} />; default: return <boxGeometry args={[1, 1, 1]} />; } };
                      return (
                        <mesh key={i} userData={{ id: b.id }} position={[b.x, b.y + (b.height / 2), b.z]} scale={[b.width, b.height, b.depth]} rotation={new THREE.Euler(b.rotation_x || 0, b.rotation || 0, b.rotation_z || 0, 'YXZ')}>
                          {renderGenGeometry()}
                          <meshBasicMaterial color={b.color || "#00ff00"} wireframe />
                        </mesh>
                      );
                    })}
                  </>
                ) : (
                  <mesh position={[0, editData.height / 2, 0]} scale={[editData.width, editData.height, editData.depth]}>
                    {renderBaseGeometry(editData.shape, editData.polyCount || 5)}
                    <meshBasicMaterial color="#00ff00" wireframe />
                  </mesh>
                )}
              </group>
            )}
            {/* @ts-ignore */}
            {token && (view === 'editor' || view === 'generator') && targetObject && <TransformControls object={targetObject} mode={view === 'generator' ? 'translate' : transformMode} translationSnap={snapToGrid ? 1 : null} rotationSnap={snapRotation ? Math.PI / 18 : null} onDraggingChanged={(e: any) => setIsDragging(e.value)} />}
            {token && view === 'generator' && (
              <group ref={(group) => { 
                  if (group) {
                      if (targetObject && !targetObject.isObject3D) {
                          group.position.copy(targetObject.position);
                      }
                      genGroupRef.current = group; 
                      if (targetObject !== group) setTargetObject(group); 
                  }
              }}>
                  {blockBuildings.length > 0 ? (
                    blockBuildings.map((b, i) => {
                      const renderGenGeometry = () => { switch (b.shape) { case 'none': return <boxGeometry args={[0.001, 0.001, 0.001]} />; case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 5]} />; case 'sphere': return <sphereGeometry args={[0.5, 6, 6]} />; default: return <boxGeometry args={[1, 1, 1]} />; } };
                      return ( <mesh key={i} position={[b.x, b.y + (b.height / 2), b.z]} scale={[b.width, b.height, b.depth]}>{renderGenGeometry()}<meshBasicMaterial color="#ff00ff" wireframe /></mesh> );
                    })
                  ) : ( <mesh position={[0, 0, 0]}><boxGeometry args={[2, 4, 2]} /><meshBasicMaterial color="#ffff00" wireframe /></mesh> )}
                </group>
            )}
            <ambientLight intensity={0.5} />
          </Canvas>
        </>
      )}
    </div>
  );
}

export default App;





