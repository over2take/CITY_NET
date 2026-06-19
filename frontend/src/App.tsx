import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, TransformControls } from '@react-three/drei';
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

const renderBaseGeometry = (shape: string) => {
  switch (shape) {
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 5]} />;
    case 'sphere': return <sphereGeometry args={[0.5, 12, 12]} />;
    case 'rhombus': return <octahedronGeometry args={[0.5]} />;
    case 'pyramid': return <coneGeometry args={[0.5, 1, 4]} />;
    default: return <boxGeometry args={[1, 1, 1]} />;
  }
};

const DistrictInteractions = React.memo(({ view, locations, onSelectionChange, roadTrail, setRoadTrail, roadDrawMode, snapToGrid, drawingRoadWidth, isBatchSelecting, setSelectedIds, rhombusState, setRhombusState, userName, refreshLocations, token, drawCityStep }: any) => {
  const { camera, gl, controls } = useThree();
  const [dragStart, setDragStart] = useState<THREE.Vector3 | null>(null);
  const [dragEnd, setDragEnd] = useState<THREE.Vector3 | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const raycaster = useRef(new THREE.Raycaster());

  useEffect(() => {
    if ((view === 'district' || view === 'draw_roads' || view === 'city_gen' || (view === 'city_draw' && (drawCityStep === 1 || drawCityStep === 2)) || isBatchSelecting) && controls) {
      camera.position.set(0, 100, 0.1);
      (controls as any).target.set(0, 0, 0);
      (controls as any).update();
      (controls as any).minPolarAngle = 0;
      (controls as any).maxPolarAngle = 0.01;
    } else if (controls) {
      (controls as any).minPolarAngle = 0;
      (controls as any).maxPolarAngle = Math.PI;
    }
  }, [view, controls, camera, drawCityStep]);

  useEffect(() => {
    if (view !== 'district' && view !== 'draw_roads' && view !== 'city_gen' && !(view === 'city_draw' && (drawCityStep === 1 || drawCityStep === 2)) && !isBatchSelecting && !rhombusState?.active) return;

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

    const handleMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        
        const pos = getMouseWorldPos(e);

        if (rhombusState?.active) {
            deployRhombus(pos);
            return;
        }

        if ((view === 'draw_roads' || (view === 'city_draw' && drawCityStep === 2)) && setRoadTrail) {
            if (controls) (controls as any).enabled = false;
            setIsPainting(true); 
            setRoadTrail((prev: any) => [...prev, [pos.clone(), pos.clone()]]);
        } else if (view === 'district' || view === 'city_gen' || (view === 'city_draw' && drawCityStep === 1) || isBatchSelecting) {
            if (controls) (controls as any).enabled = false;
            setDragStart(pos.clone()); setDragEnd(pos.clone());
        }
    };

    const handleMouseMove = (e: MouseEvent) => {
        if ((view === 'draw_roads' || (view === 'city_draw' && drawCityStep === 2)) && isPainting && setRoadTrail) {
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

    const handleMouseUp = () => {
        if (controls) (controls as any).enabled = true;
        if (view === 'draw_roads' || (view === 'city_draw' && drawCityStep === 2)) { setIsPainting(false); return; }
        if (!dragStart || !dragEnd) return;
        const minX = Math.min(dragStart.x, dragEnd.x); const maxX = Math.max(dragStart.x, dragEnd.x);
        const minZ = Math.min(dragStart.z, dragEnd.z); const maxZ = Math.max(dragStart.z, dragEnd.z);

        if (view === 'city_gen' || (view === 'city_draw' && drawCityStep === 1)) {
            onSelectionChange({ min: new THREE.Vector3(minX, 0, minZ), max: new THREE.Vector3(maxX, 0, maxZ) });
        } else {
            const selectedIds: number[] = [];
            locations.forEach(loc => { if (loc.x >= minX && loc.x <= maxX && loc.z >= minZ && loc.z <= maxZ) selectedIds.push(loc.id); });
            if (selectedIds.length > 0) onSelectionChange(selectedIds);
        }
        setDragStart(null); setDragEnd(null);
    };

    gl.domElement.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
        gl.domElement.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [view, dragStart, dragEnd, isPainting, gl, camera, locations, onSelectionChange, controls, setRoadTrail, roadDrawMode, snapToGrid, rhombusState, setRhombusState, isBatchSelecting, userName, refreshLocations, drawCityStep]);

  return (
    <>
      {dragStart && dragEnd && (
          <mesh position={[(dragStart.x + dragEnd.x) / 2, 0.1, (dragStart.z + dragEnd.z) / 2]}>
              <boxGeometry args={[Math.abs(dragEnd.x - dragStart.x), 0.1, Math.abs(dragEnd.z - dragStart.z)]} />
              <meshBasicMaterial color="#ffff00" wireframe transparent opacity={0.5} />
          </mesh>
      )}
      {(view === 'draw_roads' || (view === 'city_draw' && (drawCityStep === 2 || drawCityStep === 3))) && roadTrail && roadTrail.length > 0 && (
          <group>
              {roadTrail.map((path, pathIdx) => (
                  <group key={pathIdx}>
                      {path.map((p: any, i: number) => {
                          if (i === path.length - 1) return null;
                          const pNext = path[i+1];
                          const dist = p.distanceTo(pNext);
                          if (dist < 0.1) return null;
                          const roadPos = p.clone().lerp(pNext, 0.5);
                          roadPos.y = (view === 'city_draw' && drawCityStep === 3) ? 0.06 : 0.01;
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
      <instancedMesh ref={baseMeshRef} args={[null as any, null as any, roads.length]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#004411" transparent opacity={0.7} side={THREE.DoubleSide} />
      </instancedMesh>
      
      {/* Road Core - Pulsing Neon Link */}
      <instancedMesh ref={coreMeshRef} args={[null as any, null as any, roads.length]}>
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
    <instancedMesh ref={meshRef} args={[null as any, null as any, packetCount]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
});

const getClosestPointOnRoads = (x: number, z: number, roadsList: any[], maxSnapDistance = 15) => {
    if (!roadsList || roadsList.length === 0) return { x, z };
    let closestPt = new THREE.Vector3(x, 0, z);
    let minDistance = Infinity;

    roadsList.forEach(r => {
        const p1 = new THREE.Vector3(r.x1, 0, r.z1);
        const p2 = new THREE.Vector3(r.x2, 0, r.z2);
        const line = new THREE.Line3(p1, p2);
        const closest = new THREE.Vector3();
        line.closestPointToPoint(new THREE.Vector3(x, 0, z), true, closest);
        const dist = closest.distanceTo(new THREE.Vector3(x, 0, z));
        if (dist < minDistance) {
            minDistance = dist;
            closestPt.copy(closest);
        }
    });

    if (minDistance < maxSnapDistance) {
        return { x: closestPt.x, z: closestPt.z };
    }
    return { x, z };
};

const EnemyRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, refreshLocations, setIsDragging, socket, roads }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const { controls, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  
  const isAdmin = token !== '';
  const [localPos, setLocalPos] = useState({ x: location.x, z: location.z });
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
    setLocalPos({ x: location.x, z: location.z }); 
  }, [location.x, location.z]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Interpolate towards localPos (35% slower + frame-rate independent)
    const targetY = location.y + (location.height / 4);
    visualPos.current.x = THREE.MathUtils.lerp(visualPos.current.x, localPos.x, 2.6 * delta);
    visualPos.current.z = THREE.MathUtils.lerp(visualPos.current.z, localPos.z, 2.6 * delta);
    visualPos.current.y = THREE.MathUtils.lerp(visualPos.current.y, targetY, 2.6 * delta);

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
    const scale = 1.875 * finalScaleMult;
    
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
        coreRef.current.scale.set((0.4 + pulse * 0.1) * scaleMult, (0.4 + pulse * 0.1) * scaleMult, (0.4 + pulse * 0.1) * scaleMult);
    }
  });

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
        setDragOffset(new THREE.Vector3(localPos.x - intersection.x, 0, localPos.z - intersection.z));
    }
    if (controls) (controls as any).enabled = false;
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
        const snapped = getClosestPointOnRoads(targetX, targetZ, roads || [], 15);
        setLocalPos(snapped);
    }
  };

  const handlePointerUp = async (e: any) => {
    if (controls) (controls as any).enabled = true;
    setIsDragging(false);
    
    // EVERYONE can open the info window with a click
    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick(); // Stationary click -> open info window
    } else if (isAdmin) {
        // Only admins can actually SAVE the new position after a drag
        await fetch(`/api/locations/${location.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ...location, x: localPos.x, z: localPos.z }) });
        refreshLocations();
    }
  };

  return (
    <group 
        ref={(group) => { 
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
        {/* Enemy Core - Pulsing Void */}
        <mesh ref={coreRef as any} scale={[0.4, 0.4, 0.4]}>
          <octahedronGeometry args={[0.5]} />
          <meshBasicMaterial color="#220000" />
        </mesh>
      </mesh>
      {/* Red Alert Light */}
      <pointLight ref={lightRef as any} color="#ff0000" intensity={3} distance={15} decay={2} />
    </group>
  );
});

const PlayerRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, userName, refreshLocations, setIsDragging, socket, activeUsers, roads }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const { controls, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  
  const isAdmin = token !== '';
  const isOwner = location.owner === userName;
  const canManage = isAdmin || isOwner;

  const isOnline = activeUsers.some((u: any) => u.userName === location.owner);

  const [localPos, setLocalPos] = useState({ x: location.x, z: location.z });
  const [dragOffset, setDragOffset] = useState(new THREE.Vector3());

  // Smooth movement interpolation
  const visualPos = useRef(new THREE.Vector3(location.x, location.y + (location.height / 2), location.z));

  useEffect(() => {
    setLocalPos({ x: location.x, z: location.z });
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

  const [distToCam, setDistToCam] = useState(0);

  useFrame((state, delta) => {
    const camPos = state.camera.position;
    
    // Interpolate towards localPos (35% slower + frame-rate independent)
    const targetY = location.y + (location.height / 2);
    visualPos.current.x = THREE.MathUtils.lerp(visualPos.current.x, localPos.x, 2.6 * delta);
    visualPos.current.z = THREE.MathUtils.lerp(visualPos.current.z, localPos.z, 2.6 * delta);
    visualPos.current.y = THREE.MathUtils.lerp(visualPos.current.y, targetY, 2.6 * delta);

    const d = Math.sqrt((camPos.x - visualPos.current.x) ** 2 + (camPos.y - visualPos.current.y) ** 2 + (camPos.z - visualPos.current.z) ** 2);
    setDistToCam(d);

    if (!meshRef.current) return;
    
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
        setDragOffset(new THREE.Vector3(localPos.x - intersection.x, 0, localPos.z - intersection.z));
    }
    if (controls) (controls as any).enabled = false;
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
        const snapped = getClosestPointOnRoads(targetX, targetZ, roads || [], 15);
        setLocalPos(snapped);
    }
  };

  const handlePointerUp = async (e: any) => {
    if (controls) (controls as any).enabled = true;
    setIsDragging(false);
    
    // EVERYONE can open the info window with a click
    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick(); // Stationary click -> open info window
    } else if (canManage) {
        // Only owners/admins can actually SAVE the new position after a drag
        await fetch(`/api/locations/${location.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ...location, x: localPos.x, z: localPos.z }) });
        refreshLocations();
    }
  };

  let baseColor = location.color || "#0c2b0c";
  if (location.district_color) baseColor = location.district_color;

  return (
    <group 
        ref={(group) => { 
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

      {distToCam < 150 && (
          <>
              <mesh ref={glowRef as any} scale={[1.2, 1.2, 1.2]} raycast={() => null}>
                  <octahedronGeometry args={[0.5]} />
                  <meshBasicMaterial color={baseColor} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>
              <mesh ref={haloRef as any} scale={[1.6, 1.6, 1.6]} raycast={() => null}>
                  <sphereGeometry args={[0.5, 16, 16]} />
                  <meshBasicMaterial color={baseColor} transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} />
              </mesh>
              <pointLight ref={lightRef} color={baseColor} intensity={2.5} distance={15} decay={2} />
          </>
      )}
    </group>
  );
});

const Building = React.memo(({ location, children, onClick, isSelected, isBatchSelected, setTargetObject, editMeshRef, token, userName, refreshLocations, setIsDragging, socket, activeUsers }: any) => {
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
  
  const hasData = (location.name && location.name.trim() !== "") || 
                  (location.description && location.description.trim() !== "") ||
                  (location.npcs && location.npcs.trim() !== "");
  let baseColor = location.color || "#00aa33";
  if (location.district_color) baseColor = location.district_color;
  if (hasData) {
    baseColor = "#8800ff";
  } else {
    baseColor = "#00ff00"; // Neon green if it has no name, description, and residence
  }
  if (location.isFavorite) baseColor = "#ff7b00";
  if (location.isDanger) baseColor = "#ff0000";

  const dragDist = useRef(0);

  return (
    <group 
        position={groupPos} 
        rotation={[0, location.rotation || 0, 0]}
        ref={(group) => { if (isSelected && group) { setTargetObject(group); if (editMeshRef) editMeshRef.current = group; } }} 
    >
      {parts.map((p, idx) => {
        const isRoot = idx === 0;
        const pX = p.x - groupPos[0];
        const pZ = p.z - groupPos[2];
        
        return (
          <group key={p.id} position={[pX, (p.y - groupPos[1]) + (p.height / 2), pZ]} scale={[p.width, p.height, p.depth]}>
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
              {renderBaseGeometry(p.shape)}
              {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
              <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
            </mesh>

            {/* Visible Wireframe - No raycasting */}
            <mesh raycast={() => null}>
                {renderBaseGeometry(p.shape)}
                <meshBasicMaterial color={isSelected ? "#00ffff" : (isBatchSelected ? "#ffff00" : baseColor)} wireframe={true} />
            </mesh>

            {/* Holographic Face Fill - No raycasting */}
            <mesh raycast={() => null}>
                {renderBaseGeometry(p.shape)}
                <meshBasicMaterial 
                    color={isSelected ? "#00ffff" : (isBatchSelected ? "#ffff00" : baseColor)} 
                    transparent={true} 
                    opacity={0.08} 
                    depthWrite={false} 
                    blending={THREE.AdditiveBlending} 
                />
            </mesh>

            {/* Selection Highlight */}
            {(isSelected || isBatchSelected) && (
                <mesh scale={[1.05, 1.05, 1.05]} raycast={() => null}>
                  {renderBaseGeometry(p.shape)}
                  <meshBasicMaterial color={isBatchSelected ? "#ffff00" : "#00ffff"} wireframe={true} transparent opacity={0.5} />
                </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
});

const InstancedShape = React.memo(({ shape, elements, onSelect }: { shape: string, elements: any[], onSelect: (rootLoc: any) => void }) => {
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
            
            wireframeMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            fillMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            hitMeshRef.current!.setMatrixAt(i, tempObj.matrix);
            
            const parentLoc = el.rootLoc || el;
            const hasData = (parentLoc.name && parentLoc.name.trim() !== "") || 
                            (parentLoc.description && parentLoc.description.trim() !== "") || 
                            (parentLoc.npcs && parentLoc.npcs.trim() !== "");
            
            let color = el.district_color || el.color || "#00aa33";
            if (hasData) {
              color = "#8800ff";
            } else {
              color = "#00ff00"; // Neon green if it has no name, description, and residence
            }
            if (el.isFavorite) color = "#ff7b00";
            if (el.isDanger) color = "#ff0000";
            
            const threeColor = new THREE.Color(color);
            wireframeMeshRef.current!.setColorAt(i, threeColor);
            fillMeshRef.current!.setColorAt(i, threeColor);
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

    return (
        <group>
            {/* Visual Wireframe - No raycasting */}
            <instancedMesh ref={wireframeMeshRef} args={[null as any, null as any, elements.length]} raycast={() => null}>
                {renderBaseGeometry(shape)}
                <meshBasicMaterial wireframe={true} />
            </instancedMesh>
            
            {/* Holographic Face Fill - No raycasting */}
            <instancedMesh ref={fillMeshRef} args={[null as any, null as any, elements.length]} raycast={() => null}>
                {renderBaseGeometry(shape)}
                <meshBasicMaterial transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>

            {/* Solid Hitbox - Low opacity is more reliable for R3F raycasting than colorWrite=false */}
            <instancedMesh 
                ref={hitMeshRef} 
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
                {renderBaseGeometry(shape)}
                <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
            </instancedMesh>
        </group>
    );
});

const InstancedBuildings = React.memo(({ buildings, onSelect }: { buildings: any[], onSelect: (loc: any) => void }) => {
    const groups = useMemo(() => {
        const result: { [key: string]: any[] } = { box: [], cylinder: [], pyramid: [], sphere: [] };
        buildings.forEach(el => {
            const sh = el.shape || 'box';
            if (result[sh]) {
                result[sh].push(el);
            } else {
                result.box.push(el); // Fallback to box
            }
        });
        return result;
    }, [buildings]);

    return (
        <group>
            {Object.entries(groups).map(([shape, items]) => {
                if (items.length === 0) return null;
                return (
                    <InstancedShape 
                        key={shape} 
                        shape={shape} 
                        elements={items} 
                        onSelect={onSelect} 
                    />
                );
            })}
        </group>
    );
});

const loadMapLibre = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    // @ts-ignore
    if (window.maplibregl) {
      // @ts-ignore
      return resolve(window.maplibregl);
    }
    
    if (!document.getElementById('maplibre-css')) {
      const link = document.createElement('link');
      link.id = 'maplibre-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.js';
    script.async = true;
    script.onload = () => {
      // @ts-ignore
      if (window.maplibregl) {
        // @ts-ignore
        resolve(window.maplibregl);
      } else {
        reject(new Error('MapLibre GL JS script loaded, but maplibregl is undefined.'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load MapLibre GL JS script.'));
    document.body.appendChild(script);
  });
};

const generateThemedBuildingsForPlot = (
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  zoneTypeVal: number,
  isBlocked: (x: number, z: number, w: number, d: number, buffer?: number) => boolean,
  getGridKey: (x: number, z: number) => string,
  spatialGrid: any,
  rawBuildings: any[]
) => {
  const color = ''; // default neutral color

  // 1. SLUMS
  if (zoneTypeVal <= 0.25 && zoneTypeVal >= 0) {
    if (bw > 8 || bd > 8) {
      const shackSize = 4.0;
      const nx = Math.max(1, Math.floor(bw / shackSize)); const nz = Math.max(1, Math.floor(bd / shackSize));
      for (let ix = 0; ix < nx; ix++) { for (let iz = 0; iz < nz; iz++) {
        const shW = 2.5 + Math.random() * 1.5; const shD = 2.5 + Math.random() * 1.5;
        const shX = bx - bw/2 + (ix + 0.5) * (bw / nx) + (Math.random() - 0.5) * 1.0;
        const shZ = bz - bd/2 + (iz + 0.5) * (bd / nz) + (Math.random() - 0.5) * 1.0;
        const shH = 2.5 + Math.random() * 4.0; const shackColor = Math.random() > 0.5 ? '#8d5b4c' : '#4d4f53';

        if (!isBlocked(shX, shZ, shW, shD, 0.5)) {
          const root = { name: '', description: '', x: shX, y: 0, z: shZ, width: shW, depth: shD, height: shH, color: shackColor, shape: 'box' };
          rawBuildings.push(root);
          const key = getGridKey(shX, shZ); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
          if (Math.random() < 0.3) {
            rawBuildings.push({ name: '', x: shX, y: shH, z: shZ, width: shW * 0.9, depth: shD * 0.9, height: 1.0 + Math.random() * 1.5, color: '#3f2b24', shape: 'pyramid', parent_name: 'ROOT' });
          }
        }
      }}
    } else {
      const shH = 2.5 + Math.random() * 4.0; const shackColor = Math.random() > 0.5 ? '#8d5b4c' : '#4d4f53';
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: shH, color: shackColor, shape: 'box' };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      if (Math.random() < 0.3) {
        rawBuildings.push({ name: '', x: bx, y: shH, z: bz, width: bw * 0.9, depth: bd * 0.9, height: 1.0 + Math.random() * 1.5, color: '#3f2b24', shape: 'pyramid', parent_name: 'ROOT' });
      }
    }
    return;
  }

  // Clamping aspect ratio for non-slums buildings to eliminate long flat buildings
  const maxRatio = 1.6;
  if (bw > bd * maxRatio) {
    bw = bd * maxRatio;
  } else if (bd > bw * maxRatio) {
    bd = bw * maxRatio;
  }

  // 2. INDUSTRIAL
  if (zoneTypeVal < 0) {
    const industrialStyle = Math.floor(Math.random() * 4);
    
    if (industrialStyle === 0) {
      // Style 0: Classic Double-Tank Platform
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 1.2, color, shape: 'box', rotation: 0 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
      
      const tankR = Math.min(bw, bd) * 0.25;
      const tankH = 3.5 + Math.random() * 2;
      const t1x = bx - bw * 0.22;
      const t1z = bz - bd * 0.22;
      rawBuildings.push({ name: '', x: t1x, y: 1.2, z: t1z, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', parent_name: 'ROOT' });
      const t2x = bx - bw * 0.22;
      const t2z = bz + bd * 0.22;
      rawBuildings.push({ name: '', x: t2x, y: 1.2, z: t2z, width: tankR * 2, depth: tankR * 2, height: tankH, color, shape: 'cylinder', parent_name: 'ROOT' });
      
      const containerW = bw * 0.22; const containerD = bd * 0.5; const containerH = 2.0;
      const cx = bx + bw * 0.22;
      rawBuildings.push({ name: '', x: cx, y: 1.2, z: bz - bd * 0.12, width: containerW, depth: containerD, height: containerH, color, shape: 'box', parent_name: 'ROOT' });
      if (Math.random() > 0.5) {
        rawBuildings.push({ name: '', x: cx, y: 1.2 + containerH, z: bz - bd * 0.12, width: containerW, depth: containerD, height: containerH, color, shape: 'box', parent_name: 'ROOT' });
      } else {
        rawBuildings.push({ name: '', x: cx, y: 1.2, z: bz + bd * 0.22, width: containerW, depth: containerD, height: containerH, color, shape: 'box', parent_name: 'ROOT' });
      }
    } 
    else if (industrialStyle === 1) {
      // Style 1: Smokestack Power Station
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 1.2, color, shape: 'box', rotation: 0 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      const genW = bw * 0.45; const genD = bd * 0.65; const genH = 4.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx - bw * 0.1, y: 1.2, z: bz, width: genW, depth: genD, height: genH, color, shape: 'box', parent_name: 'ROOT' });

      // Two tall smokestacks
      const stackW = 1.0; const stackH = 15.0 + Math.random() * 10;
      const s1x = bx + bw * 0.3; const s1z = bz - bd * 0.22;
      rawBuildings.push({ name: '', x: s1x, y: 1.2, z: s1z, width: stackW, depth: stackW, height: stackH, color, shape: 'cylinder', parent_name: 'ROOT' });
      const s2x = bx + bw * 0.3; const s2z = bz + bd * 0.22;
      rawBuildings.push({ name: '', x: s2x, y: 1.2, z: s2z, width: stackW, depth: stackW, height: stackH, color, shape: 'cylinder', parent_name: 'ROOT' });

      // Connecting pipe
      rawBuildings.push({ name: '', x: bx + bw * 0.1, y: 1.2 + genH * 0.7, z: bz, width: bw * 0.4, depth: 0.4, height: 0.4, color, shape: 'box', parent_name: 'ROOT' });
    }
    else if (industrialStyle === 2) {
      // Style 2: Three-Tank Triangle Terminal
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 1.2, color, shape: 'box', rotation: 0 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      const tankW = bw * 0.3; const tankH = 5.0 + Math.random() * 4;
      // Front-left
      rawBuildings.push({ name: '', x: bx - bw * 0.22, y: 1.2, z: bz - bd * 0.22, width: tankW, depth: tankW, height: tankH, color, shape: 'cylinder', parent_name: 'ROOT' });
      // Back-left
      rawBuildings.push({ name: '', x: bx - bw * 0.22, y: 1.2, z: bz + bd * 0.22, width: tankW, depth: tankW, height: tankH, color, shape: 'cylinder', parent_name: 'ROOT' });
      // Center-right
      rawBuildings.push({ name: '', x: bx + bw * 0.22, y: 1.2, z: bz, width: tankW, depth: tankW, height: tankH * 1.2, color, shape: 'cylinder', parent_name: 'ROOT' });

      // Connecting pipes
      rawBuildings.push({ name: '', x: bx - bw * 0.22, y: 1.2 + 2.0, z: bz, width: 0.3, depth: bd * 0.44, height: 0.3, color, shape: 'box', parent_name: 'ROOT' });
      rawBuildings.push({ name: '', x: bx, y: 1.2 + 2.0, z: bz, width: bw * 0.44, depth: 0.3, height: 0.3, color, shape: 'box', parent_name: 'ROOT' });
    }
    else {
      // Style 3: Industrial Warehouse Depot
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 1.2, color, shape: 'box', rotation: 0 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Warehouse building
      const wareW = bw * 0.45; const wareD = bd * 0.75; const wareH = 6.0 + Math.random() * 2;
      rawBuildings.push({ name: '', x: bx - bw * 0.18, y: 1.2, z: bz, width: wareW, depth: wareD, height: wareH, color, shape: 'box', parent_name: 'ROOT' });

      // Cylindrical cooling tower
      const coolW = bw * 0.35; const coolH = 10.0 + Math.random() * 3;
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 1.2, z: bz + bd * 0.15, width: coolW, depth: coolW, height: coolH, color, shape: 'cylinder', parent_name: 'ROOT' });

      // Tiny security booth
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 1.2, z: bz - bd * 0.28, width: bw * 0.15, depth: bd * 0.15, height: 2.5, color, shape: 'box', parent_name: 'ROOT' });
    }
    return;
  }

  // 3. CORPO (HIGH-RISE)
  if (zoneTypeVal > 0.8) {
    const h = (100 + Math.random() * 90) * (0.85 + Math.random() * 0.3); // Proportional height randomization
    const baseW = bw * 0.75;
    const baseD = bd * 0.75;

    if (!isBlocked(bx, bz, baseW, baseD, 2.0)) {
      const corpoStyle = Math.floor(Math.random() * 8); // Expanded from 4 to 8 styles!

      if (corpoStyle === 0) {
        // Style 0: Stepped Corporate Spire
        const baseH = h * 0.45; const midH = h * 0.35; const topH = h * 0.2;
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: baseH, color, shape: 'box' };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        rawBuildings.push({ name: '', x: bx, y: baseH, z: bz, width: baseW * 0.7, depth: baseD * 0.7, height: midH, color, shape: 'box', parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx, y: baseH + midH, z: bz, width: baseW * 0.45, depth: baseD * 0.45, height: topH, color, shape: 'box', parent_name: 'ROOT' });
        rawBuildings.push({ name: '', x: bx, y: baseH + midH + topH, z: bz, width: 0.2, depth: 0.2, height: h * 0.15, color, shape: 'box', parent_name: 'ROOT' });
      } 
      else if (corpoStyle === 1) {
        // Style 1: Twin Spire with Skybridge Link
        const towerW = baseW * 0.4; const towerD = baseD * 0.8;
        const t1x = bx - baseW * 0.3; const t2x = bx + baseW * 0.3;

        if (!isBlocked(t1x, bz, towerW, towerD, 2.0) && !isBlocked(t2x, bz, towerW, towerD, 2.0)) {
          const root = { name: '', description: '', x: t1x, y: 0, z: bz, width: towerW, depth: towerD, height: h, color, shape: 'box' };
          rawBuildings.push(root);
          const key = getGridKey(t1x, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

          const beta = { name: '', x: t2x, y: 0, z: bz, width: towerW, depth: towerD, height: h, color, shape: 'box', parent_name: 'CORP_ROOT' };
          rawBuildings.push(beta);
          const key2 = getGridKey(t2x, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(beta);
          
          const bridgeH = 4.0; const bridgeW = (t2x - t1x) - towerW;
          rawBuildings.push({ name: '', x: bx, y: h * 0.7, z: bz, width: bridgeW, depth: towerD * 0.4, height: bridgeH, color, shape: 'box', parent_name: 'CORP_ROOT' });
        }
      } 
      else if (corpoStyle === 2) {
        // Style 2: Corporate Citadel with Symmetrical Wings (3 towers)
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.5, depth: baseD * 0.5, height: h, color, shape: 'box' };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        const wingW = baseW * 0.25; const wingD = baseD * 0.35; const wingH = h * 0.65;
        rawBuildings.push({ name: '', x: bx - baseW * 0.35, y: 0, z: bz, width: wingW, depth: wingD, height: wingH, color, shape: 'box', parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: bx + baseW * 0.35, y: 0, z: bz, width: wingW, depth: wingD, height: wingH, color, shape: 'box', parent_name: 'CORP_ROOT' });
      } 
      else if (corpoStyle === 3) {
        // Style 3: Split Atrium Spire with Helipad/Comms Disc
        const towerW = baseW * 0.35; const towerD = baseD * 0.8;
        const t1x = bx - baseW * 0.25; const t2x = bx + baseW * 0.25;

        if (!isBlocked(t1x, bz, towerW, towerD, 2.0) && !isBlocked(t2x, bz, towerW, towerD, 2.0)) {
          const root = { name: '', description: '', x: t1x, y: 0, z: bz, width: towerW, depth: towerD, height: h * 0.95, color, shape: 'box' };
          rawBuildings.push(root);
          const key = getGridKey(t1x, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

          const beta = { name: '', x: t2x, y: 0, z: bz, width: towerW, depth: towerD, height: h * 0.95, color, shape: 'box', parent_name: 'CORP_ROOT' };
          rawBuildings.push(beta);
          const key2 = getGridKey(t2x, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(beta);

          const helipadW = baseW * 1.1; const helipadD = baseD * 0.9;
          rawBuildings.push({ name: '', x: bx, y: h * 0.95, z: bz, width: helipadW, depth: helipadD, height: 2.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
          rawBuildings.push({ name: '', x: bx, y: h * 0.95 + 2.0, z: bz, width: 0.15, depth: 0.15, height: h * 0.18, color, shape: 'box', parent_name: 'CORP_ROOT' });
        }
      }
      else if (corpoStyle === 4) {
        // Style 4: Cylindrical Tower with Outer Ribs
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.65, depth: baseD * 0.65, height: h, color, shape: 'cylinder' };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        // 4 outer structural ribs (boxes)
        const ribW = baseW * 0.08; const ribH = h * 0.82;
        const ribDistX = baseW * 0.35; const ribDistZ = baseD * 0.35;
        rawBuildings.push({ name: '', x: bx - ribDistX, y: 0, z: bz, width: ribW, depth: ribW * 2, height: ribH, color, shape: 'box', parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: bx + ribDistX, y: 0, z: bz, width: ribW, depth: ribW * 2, height: ribH, color, shape: 'box', parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: bx, y: 0, z: bz - ribDistZ, width: ribW * 2, depth: ribW, height: ribH, color, shape: 'box', parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: bx, y: 0, z: bz + ribDistZ, width: ribW * 2, depth: ribW, height: ribH, color, shape: 'box', parent_name: 'CORP_ROOT' });

        // Glowing top sphere
        rawBuildings.push({ name: '', x: bx, y: h, z: bz, width: baseW * 0.28, depth: baseD * 0.28, height: baseW * 0.28, color, shape: 'sphere', parent_name: 'CORP_ROOT' });
      }
      else if (corpoStyle === 5) {
        // Style 5: Stepped Ziggurat / Arch Spire
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW * 0.38, depth: baseD * 0.72, height: h, color, shape: 'box' };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        // Stepped side towers
        const sideW = baseW * 0.26; const sideD = baseD * 0.55;
        rawBuildings.push({ name: '', x: bx - baseW * 0.32, y: 0, z: bz, width: sideW, depth: sideD, height: h * 0.65, color, shape: 'box', parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: bx + baseW * 0.32, y: 0, z: bz, width: sideW, depth: sideD, height: h * 0.65, color, shape: 'box', parent_name: 'CORP_ROOT' });

        // Sky arch link
        rawBuildings.push({ name: '', x: bx, y: h * 0.58, z: bz, width: baseW * 0.8, depth: sideD * 0.5, height: 3.5, color, shape: 'box', parent_name: 'CORP_ROOT' });
      }
      else if (corpoStyle === 6) {
        // Style 6: Tri-Tower Hub (Three cylinders grouped)
        const tW = baseW * 0.38; const tD = baseD * 0.38;
        const c1x = bx; const c1z = bz - baseD * 0.2;
        const c2x = bx - baseW * 0.2; const c2z = bz + baseD * 0.18;
        const c3x = bx + baseW * 0.2; const c3z = bz + baseD * 0.18;

        const root = { name: '', description: '', x: c1x, y: 0, z: c1z, width: tW, depth: tD, height: h * 0.9, color, shape: 'cylinder' };
        rawBuildings.push(root);
        const key = getGridKey(c1x, c1z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        rawBuildings.push({ name: '', x: c2x, y: 0, z: c2z, width: tW, depth: tD, height: h * 0.75, color, shape: 'cylinder', parent_name: 'CORP_ROOT' });
        rawBuildings.push({ name: '', x: c3x, y: 0, z: c3z, width: tW, depth: tD, height: h * 0.98, color, shape: 'cylinder', parent_name: 'CORP_ROOT' });

        // Central box atrium core linking them
        rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: baseW * 0.3, depth: baseD * 0.3, height: h * 0.7, color, shape: 'box', parent_name: 'CORP_ROOT' });
      }
      else {
        // Style 7: Cantilevered / Stacked Rotated Spire
        const root = { name: '', description: '', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: h * 0.35, color, shape: 'box' };
        rawBuildings.push(root);
        const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

        // Rotated tier 2
        rawBuildings.push({ name: '', x: bx + baseW * 0.08, y: h * 0.35, z: bz - baseD * 0.05, width: baseW * 0.72, depth: baseD * 0.72, height: h * 0.3, color, shape: 'box', rotation: 0.15, parent_name: 'ROOT' });
        // Rotated tier 3
        rawBuildings.push({ name: '', x: bx - baseW * 0.05, y: h * 0.65, z: bz + baseD * 0.08, width: baseW * 0.5, depth: baseD * 0.5, height: h * 0.25, color, shape: 'box', rotation: -0.15, parent_name: 'ROOT' });
        // Antenna
        rawBuildings.push({ name: '', x: bx, y: h * 0.9, z: bz, width: 0.2, depth: 0.2, height: h * 0.16, color, shape: 'box', parent_name: 'ROOT' });
      }
    }
    return;
  }

  // 4. URBAN
  if (zoneTypeVal > 0.3) {
    const h = (10 + Math.random() * 20) * (0.8 + Math.random() * 0.4);
    const urbanStyle = Math.floor(Math.random() * 6); // Expanded to 6 styles!

    if (urbanStyle === 0) {
      // Style 0: Stepped L-Shape Wing (original)
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h, color, shape: 'box', rotation: 0 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      const wingX = bx + bw * 0.22; const wingZ = bz - bd * 0.15;
      rawBuildings.push({ name: '', x: wingX, y: 0, z: wingZ, width: bw * 0.3, depth: bd * 0.3, height: h * 0.65, color, shape: 'box', parent_name: 'ROOT' });
    }
    else if (urbanStyle === 1) {
      // Style 1: Pyramidal Roof Block (original)
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h, color, shape: 'box', rotation: 0 };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      rawBuildings.push({ name: '', x: bx, y: h, z: bz, width: bw * 0.9, depth: bd * 0.9, height: 3.5, color, shape: 'pyramid', parent_name: 'ROOT' });
    }
    else if (urbanStyle === 2) {
      // Style 2: Twin H-Block
      const root = { name: '', description: '', x: bx - bw * 0.25, y: 0, z: bz, width: bw * 0.35, depth: bd * 0.95, height: h, color, shape: 'box' };
      rawBuildings.push(root);
      const key = getGridKey(bx - bw * 0.25, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Tower 2
      rawBuildings.push({ name: '', x: bx + bw * 0.25, y: 0, z: bz, width: bw * 0.35, depth: bd * 0.95, height: h * 0.92, color, shape: 'box', parent_name: 'ROOT' });

      // Connecting bridge lobby
      rawBuildings.push({ name: '', x: bx, y: h * 0.35, z: bz, width: bw * 0.2, depth: bd * 0.4, height: 3.0, color, shape: 'box', parent_name: 'ROOT' });
    }
    else if (urbanStyle === 3) {
      // Style 3: Cylindrical Core Plaza
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h * 0.4, color, shape: 'cylinder' };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Box tower on top
      rawBuildings.push({ name: '', x: bx, y: h * 0.4, z: bz, width: bw * 0.65, depth: bd * 0.65, height: h * 0.8, color, shape: 'box', parent_name: 'ROOT' });
    }
    else if (urbanStyle === 4) {
      // Style 4: Stepped Terrace Block
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h, color, shape: 'box' };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Low terrace side block
      rawBuildings.push({ name: '', x: bx + bw * 0.22, y: h * 0.5, z: bz, width: bw * 0.4, depth: bd * 0.85, height: h * 0.4, color, shape: 'box', parent_name: 'ROOT' });
    }
    else {
      // Style 5: Double-Tier Cylinder Stack
      const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h * 0.65, color, shape: 'cylinder' };
      rawBuildings.push(root);
      const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

      // Upper cylinder
      rawBuildings.push({ name: '', x: bx, y: h * 0.65, z: bz, width: bw * 0.65, depth: bd * 0.65, height: h * 0.45, color, shape: 'cylinder', parent_name: 'ROOT' });
    }
    return;
  }
};

function AdminPanel({
  socketRef, token, onLogout, refreshLocations, refreshRoads, locations, roads, editData, setEditData, editId, setEditId,
  transformMode, setTransformMode, targetObject, blockBuildings, setBlockBuildings, selectedLocation,
  setSelectedLocation, setTargetObject, view, setView, pendingRequests, setPendingRequests,
  isBatchSelecting, setIsBatchSelecting, selectedIds, setSelectedIds, toggleSelection, batchDelete,
  districtSelection, setDistrictSelection, districtConfig, setDistrictConfig,
  joinSelection, setJoinSelection, roadSelectionBounds, setRoadSelectionBounds,
  roadTrail, setRoadTrail, roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid,
  drawingRoadWidth, setDrawingRoadWidth, isGeneratingMap, setIsGeneratingMap, citySectionType, setCitySectionType,
  genExcludeRoads, setGenExcludeRoads, setRhombusState, setActiveSidebarMenu,
  drawCityStep, setDrawCityStep, drawCityBlocks, setDrawCityBlocks, selectedBlockIds, setSelectedBlockIds
}: any) {
  const [density, setDensity] = useState(8);
  const [allowedShapes, setAllowedShapes] = useState<string[]>(['box', 'cylinder', 'sphere']);
  const [activeUserEditing, setActiveUserEditing] = useState<any>(null);
  const [copyBuffer, setCopyBuffer] = useState<any>(null);
  const [showMapModal, setShowMapModal] = useState(false);

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

  const generateDrawCityBlocks = () => {
    if (roadTrail.length === 0) {
      alert("PLEASE DRAW SOME ROADS FIRST");
      return;
    }
    if (!roadSelectionBounds) {
      alert("NO BOUNDS SELECTED");
      return;
    }

    const minX = Math.min(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
    const maxX = Math.max(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
    const minZ = Math.min(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
    const maxZ = Math.max(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
    const cityW = maxX - minX;
    const cityD = maxZ - minZ;

    // 1. Convert drawn paths to segment coordinates
    let allNewSegments: any[] = [];
    for (const path of roadTrail) {
        if (path.length < 2) continue;
        let currentPath = path.map(p => p.clone());
        
        // Smoothing
        for (let iter = 0; iter < 3; iter++) {
            for (let i = 1; i < currentPath.length - 1; i++) {
                currentPath[i].lerp(currentPath[i-1].clone().lerp(currentPath[i+1], 0.5), 0.5);
            }
        }
        for (let i = 0; i < currentPath.length - 1; i++) {
          allNewSegments.push({ x1: currentPath[i].x, z1: currentPath[i].z, x2: currentPath[i+1].x, z2: currentPath[i+1].z, width: drawingRoadWidth });
        }
    }

    // 2. Partition bounds into sectors where roads cross
    let blocks = [{ id: 'block_0', x: (minX + maxX)/2, z: (minZ + maxZ)/2, w: cityW, d: cityD, type: '' }];
    let blockCounter = 1;

    allNewSegments.forEach(seg => {
      const dx = Math.abs(seg.x1 - seg.x2);
      const dz = Math.abs(seg.z1 - seg.z2);
      const isVertical = dx < dz;

      const nextBlocks: any[] = [];
      // Margin threshold to prevent splitting blocks into tiny slivers (less than 8 units)
      const minBlockMargin = 8;

      blocks.forEach(b => {
        const bMinX = b.x - b.w / 2;
        const bMaxX = b.x + b.w / 2;
        const bMinZ = b.z - b.d / 2;
        const bMaxZ = b.z + b.d / 2;

        if (isVertical) {
          const rx = (seg.x1 + seg.x2) / 2;
          const segMinZ = Math.min(seg.z1, seg.z2);
          const segMaxZ = Math.max(seg.z1, seg.z2);

          const withinX = rx > bMinX + minBlockMargin && rx < bMaxX - minBlockMargin;
          const overlapsZ = segMinZ < bMaxZ && segMaxZ > bMinZ;

          if (withinX && overlapsZ) {
            const lw = rx - bMinX;
            const rw = bMaxX - rx;
            nextBlocks.push({
              id: `block_${blockCounter++}`,
              x: bMinX + lw / 2,
              z: b.z,
              w: lw,
              d: b.d,
              type: ''
            });
            nextBlocks.push({
              id: `block_${blockCounter++}`,
              x: bMaxX - rw / 2,
              z: b.z,
              w: rw,
              d: b.d,
              type: ''
            });
          } else {
            nextBlocks.push(b);
          }
        } else {
          const rz = (seg.z1 + seg.z2) / 2;
          const segMinX = Math.min(seg.x1, seg.x2);
          const segMaxX = Math.max(seg.x1, seg.x2);

          const withinZ = rz > bMinZ + minBlockMargin && rz < bMaxZ - minBlockMargin;
          const overlapsX = segMinX < bMaxX && segMaxX > bMinX;

          if (withinZ && overlapsX) {
            const td = rz - bMinZ;
            const bd = bMaxZ - rz;
            nextBlocks.push({
              id: `block_${blockCounter++}`,
              x: b.x,
              z: bMinZ + td / 2,
              w: b.w,
              d: td,
              type: ''
            });
            nextBlocks.push({
              id: `block_${blockCounter++}`,
              x: b.x,
              z: bMaxZ - bd / 2,
              w: b.w,
              d: bd,
              type: ''
            });
          } else {
            nextBlocks.push(b);
          }
        }
      });

      blocks = nextBlocks;
    });

    setDrawCityBlocks(blocks);
    setDrawCityStep(3);
  };

  const assignZoneTypeToSelected = (type: string) => {
    setDrawCityBlocks((prev: any[]) => prev.map(b => selectedBlockIds.includes(b.id) ? { ...b, type } : b));
    setSelectedBlockIds([]); // Reset selection
  };

  const buildDrawCity = async () => {
    try {
      if (drawCityBlocks.length === 0) return alert("NO BLOCKS TO BUILD");
      setIsGeneratingMap(true);

      const minX = Math.min(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
      const maxX = Math.max(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
      const minZ = Math.min(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
      const maxZ = Math.max(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
      const cityW = maxX - minX;
      const cityD = maxZ - minZ;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const maxRadius = Math.max(1, Math.max(cityW, cityD) / 2);
      const slumAngle = Math.random() * Math.PI * 2;

      // 1. Process drawn paths to segments
      let allNewSegments: any[] = [];
      for (const path of roadTrail) {
          if (path.length < 2) continue;
          let currentPath = path.map(p => p.clone());
          for (let iter = 0; iter < 3; iter++) {
              for (let i = 1; i < currentPath.length - 1; i++) {
                  currentPath[i].lerp(currentPath[i-1].clone().lerp(currentPath[i+1], 0.5), 0.5);
              }
          }
          for (let i = 0; i < currentPath.length - 1; i++) {
            allNewSegments.push({ x1: currentPath[i].x, z1: currentPath[i].z, x2: currentPath[i+1].x, z2: currentPath[i+1].z, width: drawingRoadWidth });
          }
      }

      const finalRoads = consolidateRoads(allNewSegments, roads, 3.0);

      // 2. Subdivide large blocks into smaller building plots
      const subdivideSector = (sx: number, sz: number, sw: number, sd: number, type: string) => {
        const plots: { x: number, z: number, w: number, d: number }[] = [];
        if (type === 'PARK') {
          return [{ x: sx, z: sz, w: sw, d: sd }];
        }

        const localSplit = (lx: number, lz: number, lw: number, ld: number, depth: number) => {
          const minPlotSize = type === 'SLUMS' ? 6 : (type === 'CORPO' ? 22 : 12);
          const maxDepth = type === 'SLUMS' ? 4 : (type === 'CORPO' ? 2 : 3);

          if (depth >= maxDepth || (lw < minPlotSize * 1.8 && ld < minPlotSize * 1.8)) {
            plots.push({ x: lx, z: lz, w: lw, d: ld });
            return;
          }

          const splitV = lw > ld ? true : (lw === ld ? Math.random() > 0.5 : false);
          if (splitV) {
            const splitRatio = 0.4 + Math.random() * 0.2;
            const lw1 = lw * splitRatio;
            const lw2 = lw - lw1;
            localSplit(lx - lw/2 + lw1/2, lz, lw1, ld, depth + 1);
            localSplit(lx + lw/2 - lw2/2, lz, lw2, ld, depth + 1);
          } else {
            const splitRatio = 0.4 + Math.random() * 0.2;
            const ld1 = ld * splitRatio;
            const ld2 = ld - ld1;
            localSplit(lx, lz - ld/2 + ld1/2, lw, ld1, depth + 1);
            localSplit(lx, lz + ld/2 - ld2/2, lw, ld2, depth + 1);
          }
        };

        localSplit(sx, sz, sw, sd, 0);
        return plots;
      };

      const rawBuildings: any[] = [];
      const spatialGrid: any = {};
      const gridCell = 20;
      const getGridKey = (x: number, z: number) => `${Math.floor(x/gridCell)},${Math.floor(z/gridCell)}`;

      locations.forEach(l => {
          const key = getGridKey(l.x, l.z);
          if (!spatialGrid[key]) spatialGrid[key] = [];
          spatialGrid[key].push(l);
      });

      const allRoadsToCheck = [...roads, ...allNewSegments];

      const isBlocked = (x: number, z: number, w: number, d: number, buffer = 2) => {
          const key = getGridKey(x, z);
          const neighbors = [key];
          for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(x/gridCell)+dx},${Math.floor(z/gridCell)+dz}`); }}
          
          for(const nKey of neighbors) {
              if(!spatialGrid[nKey]) continue;
              const blocked = spatialGrid[nKey].some((l: any) => {
                  const xOverlap = Math.abs(l.x - x) < (l.width + w) / 2 + buffer;
                  const zOverlap = Math.abs(l.z - z) < (l.depth + d) / 2 + buffer;
                  return xOverlap && zOverlap;
              });
              if (blocked) return true;
          }

          for (const r of allRoadsToCheck) {
              const p1 = new THREE.Vector3(r.x1, 0, r.z1);
              const p2 = new THREE.Vector3(r.x2, 0, r.z2);
              const line = new THREE.Line3(p1, p2);
              const closest = new THREE.Vector3();
              line.closestPointToPoint(new THREE.Vector3(x, 0, z), true, closest);
              
              const rx = closest.x;
              const rz = closest.z;
              const halfW = w / 2 + r.width / 2 + 1.2;
              const halfD = d / 2 + r.width / 2 + 1.2;
              
              if (Math.abs(rx - x) < halfW && Math.abs(rz - z) < halfD) {
                  return true;
              }
          }
          return false;
      };

      drawCityBlocks.forEach((sector) => {
        if (!sector.type) return;

        const plots = subdivideSector(sector.x, sector.z, sector.w, sector.d, sector.type);

        plots.forEach((b) => {
          const pad = sector.type === 'SLUMS' ? 2 : (sector.type === 'CORPO' ? 8 : 4);
          let bw = b.w - pad; let bd = b.d - pad;
          if (bw < 4 || bd < 4) return;

          // Clamp aspect ratio to 1.6 for non-slums zones to eliminate long flat buildings
          if (sector.type !== 'SLUMS') {
            const maxRatio = 1.6;
            if (bw > bd * maxRatio) bw = bd * maxRatio;
            else if (bd > bw * maxRatio) bd = bw * maxRatio;
          }

          // 1. PARK GENERATION
          if (sector.type === 'PARK') {
             const numPlants = 6 + Math.floor(Math.random() * 7);
             for (let pIdx = 0; pIdx < numPlants; pIdx++) {
                  const px = b.x + (Math.random() - 0.5) * bw * 0.8;
                  const pz = b.z + (Math.random() - 0.5) * bd * 0.8;
                  
                  if (!isBlocked(px, pz, 0.4, 0.4, 0.5)) {
                      const trunkH = 2.0 + Math.random() * 2.5;
                      const trunkW = 0.4;
                      const color = '#00ff66';
                      const trunk = { name: 'HOLOTREE_TRUNK', description: 'ENVIRONMENTAL_HOLO_NODE', x: px, y: 0, z: pz, width: trunkW, depth: trunkW, height: trunkH, color, shape: 'cylinder' };
                      rawBuildings.push(trunk);
                      
                      const canopyW = 1.5 + Math.random() * 1.0;
                      const canopyH = 2.0 + Math.random() * 1.5;
                      const canopyShape = Math.random() > 0.5 ? 'pyramid' : 'box';
                      rawBuildings.push({ name: 'HOLOTREE_CANOPY', x: px, y: trunkH, z: pz, width: canopyW, depth: canopyW, height: canopyH, color, shape: canopyShape, parent_name: 'ROOT' });
                  }
             }
             return;
          }

          // 2. BUILDING GENERATION
          let zoneTypeVal = 0.5;
          if (sector.type === 'CORPO') zoneTypeVal = 0.9;
          else if (sector.type === 'URBAN') zoneTypeVal = 0.5;
          else if (sector.type === 'SLUMS') zoneTypeVal = 0.1;
          else if (sector.type === 'INDUSTRIAL') zoneTypeVal = -0.1;

          const color = '';

          const isLandmark = Math.random() < 0.20 && (zoneTypeVal > 0.8 || (bw > 30 && bd > 30)) && !isBlocked(b.x, b.z, bw * 0.7, bd * 0.7, 2.0);

          if (isLandmark) {
            const landmarkStyle = Math.floor(Math.random() * 4);
            
            if (landmarkStyle === 0) {
              const centralSpireH = 150 + Math.random() * 70;
              const centralSpireW = bw * 0.45; const centralSpireD = bd * 0.45;
              const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: centralSpireW, depth: centralSpireD, height: centralSpireH, color, shape: 'box' };
              rawBuildings.push(root);
              const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

              const bW = bw * 0.15; const bD = bd * 0.15;
              const offsets = [
                { dx: -bw * 0.35, dz: -bd * 0.35 }, { dx: bw * 0.35, dz: -bd * 0.35 },
                { dx: -bw * 0.35, dz: bd * 0.35 }, { dx: bw * 0.35, dz: bd * 0.35 }
              ];
              offsets.forEach(offset => {
                const bx = b.x + offset.dx; const bz = b.z + offset.dz;
                rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bW, depth: bD, height: centralSpireH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx - Math.sign(offset.dx)*bW*0.2, y: centralSpireH * 0.4, z: bz - Math.sign(offset.dz)*bD*0.2, width: bW * 0.7, depth: bD * 0.7, height: centralSpireH * 0.35, color, shape: 'box', parent_name: 'CORP_ROOT' });
              });
              rawBuildings.push({ name: '', x: b.x, y: centralSpireH * 0.8, z: b.z, width: centralSpireW * 1.3, depth: centralSpireD * 1.3, height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
              rawBuildings.push({ name: '', x: b.x, y: centralSpireH, z: b.z, width: 0.3, depth: 0.3, height: centralSpireH * 0.18, color, shape: 'box', parent_name: 'CORP_ROOT' });

            } else if (landmarkStyle === 1) {
              const base1W = bw * 0.75; const base1D = bd * 0.75; const base1H = 8.0;
              const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: base1W, depth: base1D, height: base1H, color, shape: 'box' };
              rawBuildings.push(root);
              const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

              const base2W = base1W * 0.75; const base2D = base1D * 0.75; const base2H = 12.0;
              rawBuildings.push({ name: '', x: b.x, y: base1H, z: b.z, width: base2W, depth: base2D, height: base2H, color, shape: 'box', parent_name: 'CORP_ROOT' });

              const pyramidW = base2W * 0.75; const pyramidD = base2D * 0.75; const pyramidH = 120 + Math.random() * 50;
              rawBuildings.push({ name: '', x: b.x, y: base1H + base2H, z: b.z, width: pyramidW, depth: pyramidD, height: pyramidH, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });

              const satOffsets = [
                { dx: -bw * 0.42, dz: -bd * 0.42 }, { dx: bw * 0.42, dz: -bd * 0.42 },
                { dx: -bw * 0.42, dz: bd * 0.42 }, { dx: bw * 0.42, dz: bd * 0.42 }
              ];
              satOffsets.forEach(offset => {
                const bx = b.x + offset.dx; const bz = b.z + offset.dz;
                rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bw * 0.08, depth: bd * 0.08, height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx, y: 4.0, z: bz, width: bw * 0.08, depth: bd * 0.08, height: 25.0, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });
              });

            } else if (landmarkStyle === 2) {
              const pillarW = bw * 0.22; const pillarD = bd * 0.65; const pillarH = 140 + Math.random() * 50;
              const offsetDist = bw * 0.33;

              const root = { name: '', description: '', x: b.x - offsetDist, y: 0, z: b.z, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box' };
              rawBuildings.push(root);
              const key = getGridKey(b.x - offsetDist, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

              const rightPillar = { name: '', x: b.x + offsetDist, y: 0, z: b.z, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box', parent_name: 'CORP_ROOT' };
              rawBuildings.push(rightPillar);
              const key2 = getGridKey(b.x + offsetDist, b.z); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(rightPillar);

              const archH = 12.0; const archW = offsetDist * 2 + pillarW;
              rawBuildings.push({ name: '', x: b.x, y: pillarH - archH, z: b.z, width: archW, depth: pillarD * 0.9, height: archH, color, shape: 'box', parent_name: 'CORP_ROOT' });

              const atriumW = offsetDist * 1.3; const atriumD = pillarD * 0.7; const atriumH = pillarH * 0.45;
              rawBuildings.push({ name: '', x: b.x, y: pillarH * 0.35, z: b.z, width: atriumW, depth: atriumD, height: atriumH, color, shape: 'box', parent_name: 'CORP_ROOT' });

              rawBuildings.push({ name: '', x: b.x - offsetDist, y: pillarH, z: b.z, width: 0.5, depth: 0.5, height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
              rawBuildings.push({ name: '', x: b.x + offsetDist, y: pillarH, z: b.z, width: 0.5, depth: 0.5, height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

            } else {
              const towerH = 130 + Math.random() * 60;
              const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: bw * 0.4, depth: bd * 0.4, height: towerH * 0.3, color, shape: 'box' };
              rawBuildings.push(root);
              const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

              rawBuildings.push({ name: '', x: b.x, y: towerH * 0.3, z: b.z, width: bw * 0.3, depth: bd * 0.3, height: towerH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT' });
              rawBuildings.push({ name: '', x: b.x, y: towerH * 0.7, z: b.z, width: bw * 0.2, depth: bd * 0.2, height: towerH * 0.3, color, shape: 'box', parent_name: 'CORP_ROOT' });

              const disc1W = bw * 0.65; const disc1D = bd * 0.65;
              rawBuildings.push({ name: '', x: b.x, y: towerH * 0.45, z: b.z, width: disc1W, depth: disc1D, height: 2.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
              const disc2W = bw * 0.5; const disc2D = bd * 0.5;
              rawBuildings.push({ name: '', x: b.x, y: towerH * 0.75, z: b.z, width: disc2W, depth: disc2D, height: 1.5, color, shape: 'box', parent_name: 'CORP_ROOT' });
              const disc3W = bw * 0.32; const disc3D = bd * 0.32;
              rawBuildings.push({ name: '', x: b.x, y: towerH * 0.92, z: b.z, width: disc3W, depth: disc3D, height: 1.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

              rawBuildings.push({ name: '', x: b.x, y: towerH, z: b.z, width: 0.2, depth: 0.2, height: towerH * 0.2, color, shape: 'box', parent_name: 'CORP_ROOT' });
              rawBuildings.push({ name: '', x: b.x - bw * 0.1, y: towerH * 0.92, z: b.z - bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color, shape: 'box', parent_name: 'CORP_ROOT' });
              rawBuildings.push({ name: '', x: b.x + bw * 0.1, y: towerH * 0.92, z: b.z + bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color, shape: 'box', parent_name: 'CORP_ROOT' });
            }

          } else {
            generateThemedBuildingsForPlot(b.x, b.z, bw, bd, zoneTypeVal, isBlocked, getGridKey, spatialGrid, rawBuildings);
          }
        });
      });

      // 3. Insert roads and buildings
      if (finalRoads.length > 0) {
        const rRes = await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoads) });
        if (!rRes.ok) throw new Error(`Road insertion failed: ${rRes.status}`);
      }

      if (rawBuildings.length > 0) {
        const rootLocs = rawBuildings.filter(b => !b.parent_name);
        const childLocs = rawBuildings.filter(b => b.parent_name === 'ROOT' || b.parent_name === 'CORP_ROOT');

        const bRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rootLocs) });
        if (!bRes.ok) throw new Error(`Building insertion failed: ${bRes.status}`);

        const rootData = await bRes.json();
        if (rootData.data && rootData.data.length > 0 && childLocs.length > 0) {
          const children: any[] = [];
          const rootGrid: any = {};
          rootData.data.forEach((r: any) => {
            const key = getGridKey(r.x, r.z);
            if (!rootGrid[key]) rootGrid[key] = [];
            rootGrid[key].push(r);
          });

          childLocs.forEach(c => {
            const key = getGridKey(c.x, c.z);
            const neighbors = [key];
            for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(c.x/gridCell)+dx},${Math.floor(c.z/gridCell)+dz}`); }}
            
            let matched = false;
            for(const nKey of neighbors) {
              if(!rootGrid[nKey]) continue;
              const root = rootGrid[nKey].find((r: any) => {
                const dist = Math.sqrt((r.x - c.x)**2 + (r.z - c.z)**2);
                return (c.parent_name === 'ROOT' && dist < 5) || (c.parent_name === 'CORP_ROOT' && dist < 20);
              });
              if (root) {
                children.push({ ...c, parent_id: root.id });
                matched = true; break;
              }
            }
          });

          if (children.length > 0) {
            const cRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(children) });
            if (!cRes.ok) throw new Error(`Child building insertion failed: ${cRes.status}`);
          }
        }
      }

      alert(`CUSTOM CITY BUILT SUCCESSFUL: ${drawCityBlocks.length} SECTORS, ${finalRoads.length} ROADS`);
      refreshLocations();
      if (refreshRoads) refreshRoads();
      setView('list');
      setRoadSelectionBounds(null);
      setRoadTrail([]);
      setDrawCityBlocks([]);
      setSelectedBlockIds([]);
    } catch (err: any) {
      console.error(err);
      alert(`CITY BUILD FAILED: ${err.message}`);
    } finally {
      setIsGeneratingMap(false);
    }
  };
  const mapRef = useRef<any>(null);
  const [localThrobber, setLocalThrobber] = useState('|');
  useEffect(() => {
    if (!isGeneratingMap) return;
    const chars = ['|', '/', '-', '\\'];
    let idx = 0;
    const interval = setInterval(() => {
      setLocalThrobber(chars[idx]);
      idx = (idx + 1) % chars.length;
    }, 150);
    return () => clearInterval(interval);
  }, [isGeneratingMap]);

  const handleMapSearch = async (query: string, mapInstance: any) => {
    if (!query.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        if (result.boundingbox) {
          const bbox = result.boundingbox.map(parseFloat);
          mapInstance.fitBounds([
            [bbox[2], bbox[0]],
            [bbox[3], bbox[1]]
          ]);
        } else {
          mapInstance.setCenter([lon, lat]);
          mapInstance.setZoom(15);
        }
      } else {
        alert("LOCATION_NOT_FOUND");
      }
    } catch (err: any) {
      console.error(err);
      alert(`SEARCH_ERROR: ${err.message}`);
    }
  };

  const handleConfirmImport = async (mapInstance: any) => {
    if (!roadSelectionBounds) return alert("SELECT 3D AREA ON MAP FIRST");
    try {
      setIsGeneratingMap(true);
      const bounds = mapInstance.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      
      const latSpan = north - south;
      const lonSpan = east - west;
      if (latSpan > 0.05 || lonSpan > 0.05) {
        throw new Error("SELECTED_AREA_TOO_LARGE. Zoom in closer to import.");
      }
      
      const query = `[out:json][timeout:25];
(
  way["highway"](${south},${west},${north},${east});
  way["building"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;

      const endpoints = [
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://lz4.overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://z.overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://overpass.nchc.org.tw/api/interpreter?data=${encodeURIComponent(query)}`
      ];

      let data: any = null;
      let lastError: any = null;
      for (const url of endpoints) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            data = await res.json();
            break;
          } else {
            console.warn(`Overpass mirror ${new URL(url).hostname} returned error status: ${res.status}. Trying fallback...`);
            lastError = new Error(`Overpass API error: ${res.status} from ${new URL(url).hostname}`);
          }
        } catch (err: any) {
          console.warn(`Overpass mirror ${new URL(url).hostname} connection failed. Trying fallback...`, err);
          lastError = err;
        }
      }

      if (!data) {
        throw lastError || new Error("All Overpass API mirrors failed or rate limited (429). Please try again in a few moments.");
      }
      
      if (!data.elements || data.elements.length === 0) {
        throw new Error("NO_DATA_FOUND_IN_SELECTED_AREA");
      }
      
      const nodes: { [key: string]: { lat: number, lon: number } } = {};
      data.elements.forEach((el: any) => {
        if (el.type === 'node') {
          nodes[el.id] = { lat: el.lat, lon: el.lon };
        }
      });
      
      const minX = Math.min(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
      const maxX = Math.max(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
      const minZ = Math.min(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
      const maxZ = Math.max(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
      const cityW = maxX - minX;
      const cityD = maxZ - minZ;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const maxRadius = Math.max(1, Math.max(cityW, cityD) / 2);
      const slumAngle = Math.random() * Math.PI * 2;
      
      const mapToGrid = (lat: number, lon: number) => {
        const xPct = (lon - west) / (east - west);
        const zPct = (north - lat) / (north - south);
        return {
          x: minX + xPct * cityW,
          z: minZ + zPct * cityD
        };
      };
      
      const cityRoads: any[] = [];
      const rawBuildings: any[] = [];
      const spatialGrid: any = {};
      const gridCell = 20;
      const getGridKey = (x: number, z: number) => `${Math.floor(x/gridCell)},${Math.floor(z/gridCell)}`;
      
      locations.forEach((l: any) => {
        const key = getGridKey(l.x, l.z);
        if (!spatialGrid[key]) spatialGrid[key] = [];
        spatialGrid[key].push(l);
      });

      const isBlocked = (x: number, z: number, w: number, d: number, buffer = 2) => {
        const key = getGridKey(x, z);
        const neighbors = [key];
        for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(x/gridCell)+dx},${Math.floor(z/gridCell)+dz}`); }}
        
        for(const nKey of neighbors) {
          if(!spatialGrid[nKey]) continue;
          const blocked = spatialGrid[nKey].some((l: any) => {
            const xOverlap = Math.abs(l.x - x) < (l.width + w) / 2 + buffer;
            const zOverlap = Math.abs(l.z - z) < (l.depth + d) / 2 + buffer;
            return xOverlap && zOverlap;
          });
          if (blocked) return true;
        }
        return false;
      };
      
      // 1. Pass 1: Parse all building footprints first to establish layouts
      data.elements.forEach((el: any) => {
        if (el.type === 'way') {
          const tags = el.tags || {};
          if (tags.building) {
            const wayNodes = el.nodes.map((nId: string) => nodes[nId]).filter(Boolean);
            if (wayNodes.length < 3) return;
            
            let sumX = 0, sumZ = 0;
            let minBboxX = Infinity, maxBboxX = -Infinity;
            let minBboxZ = Infinity, maxBboxZ = -Infinity;
            
            wayNodes.forEach((node: any) => {
              const p = mapToGrid(node.lat, node.lon);
              sumX += p.x;
              sumZ += p.z;
              minBboxX = Math.min(minBboxX, p.x);
              maxBboxX = Math.max(maxBboxX, p.x);
              minBboxZ = Math.min(minBboxZ, p.z);
              maxBboxZ = Math.max(maxBboxZ, p.z);
            });
            
            const bx = sumX / wayNodes.length;
            const bz = sumZ / wayNodes.length;
            const bw = Math.max(2, maxBboxX - minBboxX);
            const bd = Math.max(2, maxBboxZ - minBboxZ);
            
            let baseH = 8;
            if (tags.height) {
              const parsed = parseFloat(tags.height);
              if (!isNaN(parsed)) baseH = parsed * 0.7;
            } else if (tags["building:levels"]) {
              const parsed = parseInt(tags["building:levels"]);
              if (!isNaN(parsed)) baseH = parsed * 2.8;
            } else {
              const distToCenter = Math.sqrt((bx - (minX + maxX)/2)**2 + (bz - (minZ + maxZ)/2)**2);
              const normDist = Math.min(1.0, distToCenter / (Math.max(cityW, cityD)/2));
              baseH = normDist < 0.3 ? 35 + Math.random() * 45 : 8 + Math.random() * 12;
            }
            
            if (!isBlocked(bx, bz, bw, bd, 1.0)) {
            let shape = 'box';
            let color = '';
            
            const isHistoric = tags.historic || tags.amenity === 'place_of_worship' || tags.tourism === 'museum';
            
            // Calculate local zoning type exactly like in the procedural city generator
            const distToCenter = Math.sqrt((bx - centerX) ** 2 + (bz - centerZ) ** 2);
            const normDist = Math.min(1.0, distToCenter / maxRadius);

            const blockAngle = Math.atan2(bz - centerZ, bx - centerX);
            let angleDiff = Math.abs(blockAngle - slumAngle);
            if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

            let zoneTypeVal = Math.random();

            if (citySectionType === 'MIXED') {
              const isInSlumSector = normDist > 0.45 && angleDiff < Math.PI / 3;
              if (isInSlumSector) {
                zoneTypeVal = 0.1;
              } else if (normDist > 0.65 && Math.random() < 0.35) {
                zoneTypeVal = -0.1;
              } else {
                const innerRatio = normDist;
                zoneTypeVal = Math.random() > (innerRatio * 0.75) ? 0.9 : 0.5;
              }
            } else if (citySectionType === 'CORPO') zoneTypeVal = 0.9;
            else if (citySectionType === 'URBAN') zoneTypeVal = 0.5;
            else if (citySectionType === 'SLUMS') zoneTypeVal = 0.1;
            else if (citySectionType === 'INDUSTRIAL') zoneTypeVal = -0.1;

            // Height scaling logic: respect explicit height tags if they exist,
            // otherwise use the height profile corresponding to the zoning type.
            const hasExplicitHeight = !!(tags.height || tags["building:levels"]);
            let h = baseH;
            if (!hasExplicitHeight) {
              if (zoneTypeVal > 0.8) {
                h = 100 + Math.random() * 90;
              } else if (zoneTypeVal > 0.3) {
                h = 10 + Math.random() * 20;
              } else if (zoneTypeVal < 0) {
                h = 15 + Math.random() * 20;
              } else {
                h = 3 + Math.random() * 8;
              }
            }

            const isLandmark = Math.random() < 0.20 && (zoneTypeVal > 0.8 || (bw > 25 && bd > 25));

            if (isHistoric) {
              const style = Math.floor(Math.random() * 2);
              if (style === 0) {
                const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h * 0.5, color, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
                rawBuildings.push({ name: '', x: bx, y: h * 0.5, z: bz, width: bw * 0.6, depth: bd * 0.6, height: h * 0.5, color, shape: 'box', parent_name: 'ROOT' });
                rawBuildings.push({ name: '', x: bx, y: h, z: bz, width: 0.2, depth: 0.2, height: h * 0.2, color, shape: 'box', parent_name: 'ROOT' });
              } else {
                const root = { name: '', description: '', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h * 0.2, color, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
                rawBuildings.push({ name: '', x: bx, y: h * 0.2, z: bz, width: bw * 0.8, depth: bd * 0.8, height: h * 0.8, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });
              }
            } else if (isLandmark) {
              const landmarkStyle = Math.floor(Math.random() * 4);
              const cyColor = '#00ffff';
              
              if (landmarkStyle === 0) {
                // Style 0: Cyber-Citadel (Stepped buttresses + tall central spire)
                const centralSpireH = hasExplicitHeight ? h : 150 + Math.random() * 70;
                const centralSpireW = bw * 0.45;
                const centralSpireD = bd * 0.45;
                const root = { name: '', description: 'CYBER_CITADEL', x: bx, y: 0, z: bz, width: centralSpireW, depth: centralSpireD, height: centralSpireH, color: cyColor, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

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
                  const cx = bx + offset.dx;
                  const cz = bz + offset.dz;
                  rawBuildings.push({ name: '', x: cx, y: 0, z: cz, width: bW, depth: bD, height: centralSpireH * 0.4, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                  rawBuildings.push({ name: '', x: cx - Math.sign(offset.dx)*bW*0.2, y: centralSpireH * 0.4, z: cz - Math.sign(offset.dz)*bD*0.2, width: bW * 0.7, depth: bD * 0.7, height: centralSpireH * 0.35, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                });

                rawBuildings.push({ name: '', x: bx, y: centralSpireH * 0.8, z: bz, width: centralSpireW * 1.3, depth: centralSpireD * 1.3, height: 4.0, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx, y: centralSpireH, z: bz, width: 0.3, depth: 0.3, height: centralSpireH * 0.18, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

              } else if (landmarkStyle === 1) {
                // Style 1: Hyper-Pyramid Complex
                const base1W = bw * 0.75;
                const base1D = bd * 0.75;
                const base1H = 8.0;
                const root = { name: '', description: 'HYPER_PYRAMID_MONUMENT', x: bx, y: 0, z: bz, width: base1W, depth: base1D, height: base1H, color: cyColor, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                const base2W = base1W * 0.75;
                const base2D = base1D * 0.75;
                const base2H = 12.0;
                rawBuildings.push({ name: '', x: bx, y: base1H, z: bz, width: base2W, depth: base2D, height: base2H, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                const pyramidW = base2W * 0.75;
                const pyramidD = base2D * 0.75;
                const pyramidH = hasExplicitHeight ? h - base1H - base2H : 120 + Math.random() * 50;
                rawBuildings.push({ name: '', x: bx, y: base1H + base2H, z: bz, width: pyramidW, depth: pyramidD, height: Math.max(10, pyramidH), color: cyColor, shape: 'pyramid', parent_name: 'CORP_ROOT' });

                const satOffsets = [
                  { dx: -bw * 0.42, dz: -bd * 0.42 },
                  { dx: bw * 0.42, dz: -bd * 0.42 },
                  { dx: -bw * 0.42, dz: bd * 0.42 },
                  { dx: bw * 0.42, dz: bd * 0.42 }
                ];
                satOffsets.forEach(offset => {
                  const cx = bx + offset.dx;
                  const cz = bz + offset.dz;
                  rawBuildings.push({ name: '', x: cx, y: 0, z: cz, width: bw * 0.08, depth: bd * 0.08, height: 4.0, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                  rawBuildings.push({ name: '', x: cx, y: 4.0, z: cz, width: bw * 0.08, depth: bd * 0.08, height: 25.0, color: cyColor, shape: 'pyramid', parent_name: 'CORP_ROOT' });
                });

              } else if (landmarkStyle === 2) {
                // Style 2: Megastructure Arch
                const pillarW = bw * 0.22;
                const pillarD = bd * 0.65;
                const pillarH = hasExplicitHeight ? h : 140 + Math.random() * 50;
                const offsetDist = bw * 0.33;

                const root = { name: '', description: 'ARCOLOGY_LEFT', x: bx - offsetDist, y: 0, z: bz, width: pillarW, depth: pillarD, height: pillarH, color: cyColor, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx - offsetDist, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                const rightPillar = { name: '', x: bx + offsetDist, y: 0, z: bz, width: pillarW, depth: pillarD, height: pillarH, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' };
                rawBuildings.push(rightPillar);
                const key2 = getGridKey(bx + offsetDist, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(rightPillar);

                const archH = 12.0;
                const archW = offsetDist * 2 + pillarW;
                rawBuildings.push({ name: '', x: bx, y: pillarH - archH, z: bz, width: archW, depth: pillarD * 0.9, height: archH, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                const atriumW = offsetDist * 1.3;
                const atriumD = pillarD * 0.7;
                const atriumH = pillarH * 0.45;
                rawBuildings.push({ name: '', x: bx, y: pillarH * 0.35, z: bz, width: atriumW, depth: atriumD, height: atriumH, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                rawBuildings.push({ name: '', x: bx - offsetDist, y: pillarH, z: bz, width: 0.5, depth: 0.5, height: 15.0, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx + offsetDist, y: pillarH, z: bz, width: 0.5, depth: 0.5, height: 15.0, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

              } else {
                // Style 3: Communications Array
                const towerH = hasExplicitHeight ? h : 130 + Math.random() * 60;
                const root = { name: '', description: 'COMMS_ARRAY_TOWER', x: bx, y: 0, z: bz, width: bw * 0.4, depth: bd * 0.4, height: towerH * 0.3, color: cyColor, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                rawBuildings.push({ name: '', x: bx, y: towerH * 0.3, z: bz, width: bw * 0.3, depth: bd * 0.3, height: towerH * 0.4, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx, y: towerH * 0.7, z: bz, width: bw * 0.2, depth: bd * 0.2, height: towerH * 0.3, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                const disc1W = bw * 0.65; const disc1D = bd * 0.65;
                rawBuildings.push({ name: '', x: bx, y: towerH * 0.45, z: bz, width: disc1W, depth: disc1D, height: 2.0, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                const disc2W = bw * 0.5; const disc2D = bd * 0.5;
                rawBuildings.push({ name: '', x: bx, y: towerH * 0.75, z: bz, width: disc2W, depth: disc2D, height: 1.5, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                const disc3W = bw * 0.32; const disc3D = bd * 0.32;
                rawBuildings.push({ name: '', x: bx, y: towerH * 0.92, z: bz, width: disc3W, depth: disc3D, height: 1.0, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });

                rawBuildings.push({ name: '', x: bx, y: towerH, z: bz, width: 0.2, depth: 0.2, height: towerH * 0.2, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx - bw * 0.1, y: towerH * 0.92, z: bz - bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx + bw * 0.1, y: towerH * 0.92, z: bz + bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color: cyColor, shape: 'box', parent_name: 'CORP_ROOT' });
              }

            } else if (zoneTypeVal > 0.8) {
              // Corpo Regular Towers (Styles A, B, C, D)
              const baseW = bw * 0.75;
              const baseD = bd * 0.75;
              const corpoStyle = Math.floor(Math.random() * 4);
              const color = ''; // Neutral wireframe

              if (corpoStyle === 0) {
                // Style A: Stepped Corporate Spire
                const baseH = h * 0.45;
                const midH = h * 0.35;
                const topH = h * 0.2;
                const root = { name: '', description: 'CORPO_TOWER_CENTRAL', x: bx, y: 0, z: bz, width: baseW, depth: baseD, height: baseH, color, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                rawBuildings.push({ name: '', x: bx, y: baseH, z: bz, width: baseW * 0.7, depth: baseD * 0.7, height: midH, color, shape: 'box', parent_name: 'ROOT' });
                rawBuildings.push({ name: '', x: bx, y: baseH + midH, z: bz, width: baseW * 0.45, depth: baseD * 0.45, height: topH, color, shape: 'box', parent_name: 'ROOT' });
                rawBuildings.push({ name: '', x: bx, y: baseH + midH + topH, z: bz, width: 0.2, depth: 0.2, height: h * 0.15, color, shape: 'box', parent_name: 'ROOT' });
              } else if (corpoStyle === 1) {
                // Style B: Twin Spire with Skybridge Link
                const towerW = baseW * 0.4;
                const towerD = baseD * 0.8;
                const t1x = bx - baseW * 0.3;
                const t2x = bx + baseW * 0.3;

                const root = { name: '', description: 'CORPO_TOWER_ALPHA', x: t1x, y: 0, z: bz, width: towerW, depth: towerD, height: h, color, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(t1x, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                const beta = { name: '', x: t2x, y: 0, z: bz, width: towerW, depth: towerD, height: h, color, shape: 'box', parent_name: 'CORP_ROOT' };
                rawBuildings.push(beta);
                const key2 = getGridKey(t2x, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(beta);
                
                const bridgeH = 4.0;
                const bridgeW = (t2x - t1x) - towerW;
                rawBuildings.push({ name: '', x: bx, y: h * 0.7, z: bz, width: bridgeW, depth: towerD * 0.4, height: bridgeH, color, shape: 'box', parent_name: 'CORP_ROOT' });
              } else if (corpoStyle === 2) {
                // Style C: Corporate Citadel with Symmetrical Wings
                const root = { name: '', description: 'CORPO_TOWER_CENTRAL', x: bx, y: 0, z: bz, width: baseW * 0.5, depth: baseD * 0.5, height: h, color, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                const wingW = baseW * 0.25;
                const wingD = baseD * 0.35;
                const wingH = h * 0.65;
                rawBuildings.push({ name: '', x: bx - baseW * 0.35, y: 0, z: bz, width: wingW, depth: wingD, height: wingH, color, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx + baseW * 0.35, y: 0, z: bz, width: wingW, depth: wingD, height: wingH, color, shape: 'box', parent_name: 'CORP_ROOT' });
              } else {
                // Style D: Split Atrium Spire with Helipad/Comms Disc
                const towerW = baseW * 0.35;
                const towerD = baseD * 0.8;
                const t1x = bx - baseW * 0.25;
                const t2x = bx + baseW * 0.25;

                const root = { name: '', description: 'CORPO_TOWER_ALPHA', x: t1x, y: 0, z: bz, width: towerW, depth: towerD, height: h * 0.95, color, shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(t1x, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                const beta = { name: '', x: t2x, y: 0, z: bz, width: towerW, depth: towerD, height: h * 0.95, color, shape: 'box', parent_name: 'CORP_ROOT' };
                rawBuildings.push(beta);
                const key2 = getGridKey(t2x, bz); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(beta);

                const helipadW = baseW * 1.1;
                const helipadD = baseD * 0.9;
                rawBuildings.push({ name: '', x: bx, y: h * 0.95, z: bz, width: helipadW, depth: helipadD, height: 2.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                rawBuildings.push({ name: '', x: bx, y: h * 0.95 + 2.0, z: bz, width: 0.15, depth: 0.15, height: h * 0.18, color, shape: 'box', parent_name: 'CORP_ROOT' });
              }

            } else if (zoneTypeVal > 0.3) {
              // Urban Grid (Stepped L-Shapes or Roof Pyramids - sub-divided for large footprints)
              if (bw > 25 || bd > 25) {
                const rows = bw > 40 ? 3 : 2; const cols = bd > 40 ? 3 : 2;
                const pw = bw / cols; const pd = bd / rows;
                for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) {
                  if (Math.random() < 0.30) continue;
                  
                  const jitterX = (Math.random() - 0.5) * pw * 0.2;
                  const jitterZ = (Math.random() - 0.5) * pd * 0.2;
                  const subX = bx - bw/2 + pw/2 + c * pw + jitterX;
                  const subZ = bz - bd/2 + pd/2 + r * pd + jitterZ;

                  if (!isBlocked(subX, subZ, pw * 0.6, pd * 0.6, 0.5)) {
                    const subH = hasExplicitHeight ? h : 10 + Math.random() * 20;
                    const root = { name: '', description: 'URBAN_APARTMENT', x: subX, y: 0, z: subZ, width: pw * 0.6, depth: pd * 0.6, height: subH, color: '', shape: 'box', rotation: 0 };
                    rawBuildings.push(root);
                    const key = getGridKey(subX, subZ); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
                    
                    const urbanStyle = Math.random();
                    if (urbanStyle > 0.5) {
                      const wingX = subX + pw * 0.22;
                      const wingZ = subZ - pd * 0.15;
                      rawBuildings.push({ name: '', x: wingX, y: 0, z: wingZ, width: pw * 0.3, depth: pd * 0.3, height: subH * 0.65, color: '', shape: 'box', parent_name: 'ROOT' });
                    } else {
                      const roofH = 3.5;
                      rawBuildings.push({ name: '', x: subX, y: subH, z: subZ, width: pw * 0.6, depth: pd * 0.6, height: roofH, color: '', shape: 'pyramid', parent_name: 'ROOT' });
                    }
                  }
                }}
              } else {
                const root = { name: '', description: 'URBAN_APARTMENT', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h, color: '', shape: 'box', rotation: 0 };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
                
                const urbanStyle = Math.random();
                if (urbanStyle > 0.5) {
                  rawBuildings.push({ name: '', x: bx + bw * 0.22, y: 0, z: bz - bd * 0.15, width: bw * 0.3, depth: bd * 0.3, height: h * 0.65, color: '', shape: 'box', parent_name: 'ROOT' });
                } else {
                  rawBuildings.push({ name: '', x: bx, y: h, z: bz, width: bw * 0.9, depth: bd * 0.9, height: 3.5, color: '', shape: 'pyramid', parent_name: 'ROOT' });
                }
              }

            } else if (zoneTypeVal < 0) {
              // Industrial Sector
              const root = { name: '', description: 'INDUSTRIAL_PLATFORM', x: bx, y: 0, z: bz, width: bw, depth: bd, height: 1.2, color: '', shape: 'box', rotation: 0 };
              rawBuildings.push(root);
              const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
              
              const numStructures = Math.random() > 0.5 ? 2 : 1;
              for (let i = 0; i < numStructures; i++) {
                const shapeType = Math.random() > 0.5 ? 'cylinder' : 'box';
                const strW = bw * 0.35;
                const strD = bd * 0.35;
                const strH = hasExplicitHeight ? h : 15 + Math.random() * 20;
                const offsetX = numStructures > 1 ? (i === 0 ? -bw * 0.25 : bw * 0.25) : 0;
                const offsetZ = numStructures > 1 ? (i === 0 ? -bd * 0.25 : bd * 0.25) : 0;
                rawBuildings.push({ name: '', x: bx + offsetX, y: 1.2, z: bz + offsetZ, width: strW, depth: strD, height: strH, color: '', shape: shapeType, parent_name: 'ROOT' });
              }

            } else {
              // Slums Zoning (Organic Shacks)
              if (bw > 8 || bd > 8) {
                const shackSize = 4.0;
                const nx = Math.max(1, Math.floor(bw / shackSize));
                const nz = Math.max(1, Math.floor(bd / shackSize));
                for (let ix = 0; ix < nx; ix++) {
                  for (let iz = 0; iz < nz; iz++) {
                    const shW = 2.5 + Math.random() * 1.5;
                    const shD = 2.5 + Math.random() * 1.5;
                    const shX = bx - bw/2 + (ix + 0.5) * (bw / nx) + (Math.random() - 0.5) * 1.0;
                    const shZ = bz - bd/2 + (iz + 0.5) * (bd / nz) + (Math.random() - 0.5) * 1.0;
                    const shH = hasExplicitHeight ? h : 2.5 + Math.random() * 4.0;
                    const shackColor = Math.random() > 0.5 ? '#8d5b4c' : '#4d4f53';
                    if (!isBlocked(shX, shZ, shW, shD, 0.5)) {
                      const root = { name: '', description: 'SLUM_SHACK', x: shX, y: 0, z: shZ, width: shW, depth: shD, height: shH, color: shackColor, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(shX, shZ); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
                      if (Math.random() < 0.3) {
                        rawBuildings.push({ name: '', x: shX, y: shH, z: shZ, width: shW * 0.9, depth: shD * 0.9, height: 1.0 + Math.random() * 1.5, color: '#3f2b24', shape: 'pyramid', parent_name: 'ROOT' });
                      }
                    }
                  }
                }
              } else {
                const root = { name: '', description: 'SLUM_SHACK', x: bx, y: 0, z: bz, width: bw, depth: bd, height: h, color: '#8d5b4c', shape: 'box' };
                rawBuildings.push(root);
                const key = getGridKey(bx, bz); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);
                if (Math.random() < 0.3) {
                  rawBuildings.push({ name: '', x: bx, y: h, z: bz, width: bw * 0.9, depth: bd * 0.9, height: 1.0 + Math.random() * 1.5, color: '#3f2b24', shape: 'pyramid', parent_name: 'ROOT' });
                }
              }
            }
            }
          }
        }
      });

      // 2. Pass 2: Parse raw roads
      data.elements.forEach((el: any) => {
        if (el.type === 'way') {
          const tags = el.tags || {};
          const allowedHighways = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified'];
          if (tags.highway && !genExcludeRoads && allowedHighways.includes(tags.highway)) {
            let roadWidth = 3;
            if (['motorway', 'trunk', 'primary'].includes(tags.highway)) roadWidth = 6;
            else if (['secondary', 'tertiary'].includes(tags.highway)) roadWidth = 4.5;
            
            for (let i = 0; i < el.nodes.length - 1; i++) {
              const n1 = nodes[el.nodes[i]];
              const n2 = nodes[el.nodes[i+1]];
              if (n1 && n2) {
                const p1 = mapToGrid(n1.lat, n1.lon);
                const p2 = mapToGrid(n2.lat, n2.lon);
                cityRoads.push({ x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z, width: roadWidth });
              }
            }
          }
        }
      });

      // Consolidate parsed road segments first to connect intersections nicely
      const consolidatedRoads = genExcludeRoads ? [] : consolidateRoads(cityRoads, roads, 5.5);

      // Combine existing board locations (excluding players/enemies) and newly parsed buildings
      const allBuildings = [
        ...locations.filter((l: any) => l.shape !== 'rhombus' && l.shape !== 'enemy_rhombus'),
        ...rawBuildings
      ];

      // Segment intersection with AABB bounding box helper
      const segmentIntersectsBox = (
        x1: number, z1: number,
        x2: number, z2: number,
        minBx: number, maxBx: number,
        minBz: number, maxBz: number
      ): boolean => {
        const p1Inside = x1 >= minBx && x1 <= maxBx && z1 >= minBz && z1 <= maxBz;
        const p2Inside = x2 >= minBx && x2 <= maxBx && z2 >= minBz && z2 <= maxBz;
        if (p1Inside || p2Inside) return true;

        let t0 = 0;
        let t1 = 1;
        const dx = x2 - x1;
        const dz = z2 - z1;

        if (dx === 0) {
          if (x1 < minBx || x1 > maxBx) return false;
        } else {
          const t_min = (minBx - x1) / dx;
          const t_max = (maxBx - x1) / dx;
          const t_near = Math.min(t_min, t_max);
          const t_far = Math.max(t_min, t_max);
          t0 = Math.max(t0, t_near);
          t1 = Math.min(t1, t_far);
          if (t0 > t1) return false;
        }

        if (dz === 0) {
          if (z1 < minBz || z1 > maxBz) return false;
        } else {
          const t_min = (minBz - z1) / dz;
          const t_max = (maxBz - z1) / dz;
          const t_near = Math.min(t_min, t_max);
          const t_far = Math.max(t_min, t_max);
          t0 = Math.max(t0, t_near);
          t1 = Math.min(t1, t_far);
          if (t0 > t1) return false;
        }

        return true;
      };

      // Push a point to the nearest box boundary with safety epsilon buffer
      const pushPointToBoxEdge = (
        x: number, z: number,
        minBx: number, maxBx: number,
        minBz: number, maxBz: number,
        eps = 0.05
      ): { x: number, z: number } => {
        if (x < minBx || x > maxBx || z < minBz || z > maxBz) {
          return { x, z };
        }
        const dx1 = x - minBx;
        const dx2 = maxBx - x;
        const dz1 = z - minBz;
        const dz2 = maxBz - z;
        const minDist = Math.min(dx1, dx2, dz1, dz2);
        if (minDist === dx1) return { x: minBx - eps, z };
        if (minDist === dx2) return { x: maxBx + eps, z };
        if (minDist === dz1) return { x, z: minBz - eps };
        return { x, z: maxBz + eps };
      };

      // 1. Construct a spatial grid for all buildings
      const buildingSpatialGrid: { [key: string]: any[] } = {};
      const bGridCell = 20;
      const getBGridKey = (x: number, z: number) => `${Math.floor(x / bGridCell)},${Math.floor(z / bGridCell)}`;

      allBuildings.forEach((b: any) => {
        if (b.x === undefined || b.z === undefined || b.width === undefined || b.depth === undefined) return;
        const padding = 1.5;
        const minXCell = Math.floor((b.x - b.width / 2 - padding) / bGridCell);
        const maxXCell = Math.floor((b.x + b.width / 2 + padding) / bGridCell);
        const minZCell = Math.floor((b.z - b.depth / 2 - padding) / bGridCell);
        const maxZCell = Math.floor((b.z + b.depth / 2 + padding) / bGridCell);

        for (let gx = minXCell; gx <= maxXCell; gx++) {
          for (let gz = minZCell; gz <= maxZCell; gz++) {
            const key = `${gx},${gz}`;
            if (!buildingSpatialGrid[key]) buildingSpatialGrid[key] = [];
            buildingSpatialGrid[key].push(b);
          }
        }
      });

      // Iteratively deform and route road segments around candidate building boundaries
      let segmentQueue = [...consolidatedRoads];
      const deformedRoads: any[] = [];
      const MAX_DEFORM_ITER = 50000;
      let deforms = 0;

      while (segmentQueue.length > 0 && deforms < MAX_DEFORM_ITER) {
        deforms++;
        const seg = segmentQueue.shift()!;
        let intersected = false;

        const minSegX = Math.min(seg.x1, seg.x2);
        const maxSegX = Math.max(seg.x1, seg.x2);
        const minSegZ = Math.min(seg.z1, seg.z2);
        const maxSegZ = Math.max(seg.z1, seg.z2);

        const minXCell = Math.floor(minSegX / bGridCell);
        const maxXCell = Math.floor(maxSegX / bGridCell);
        const minZCell = Math.floor(minSegZ / bGridCell);
        const maxZCell = Math.floor(maxSegZ / bGridCell);

        const candidates = new Set<any>();
        for (let gx = minXCell; gx <= maxXCell; gx++) {
          for (let gz = minZCell; gz <= maxZCell; gz++) {
            const key = `${gx},${gz}`;
            const cellBuildings = buildingSpatialGrid[key];
            if (cellBuildings) {
              cellBuildings.forEach(b => candidates.add(b));
            }
          }
        }

        for (const b of candidates) {
          if (b.x === undefined || b.z === undefined || b.width === undefined || b.depth === undefined) continue;

          // Padding around building footprint (e.g. 1.5 units safety margin)
          const padding = 1.5;
          const bMinX = b.x - b.width / 2 - padding;
          const bMaxX = b.x + b.width / 2 + padding;
          const bMinZ = b.z - b.depth / 2 - padding;
          const bMaxZ = b.z + b.depth / 2 + padding;

          if (segmentIntersectsBox(seg.x1, seg.z1, seg.x2, seg.z2, bMinX, bMaxX, bMinZ, bMaxZ)) {
            intersected = true;

            const p1 = pushPointToBoxEdge(seg.x1, seg.z1, bMinX, bMaxX, bMinZ, bMaxZ);
            const p2 = pushPointToBoxEdge(seg.x2, seg.z2, bMinX, bMaxX, bMinZ, bMaxZ);

            const mx = (p1.x + p2.x) / 2;
            const mz = (p1.z + p2.z) / 2;

            if (mx >= bMinX && mx <= bMaxX && mz >= bMinZ && mz <= bMaxZ) {
              const pm = pushPointToBoxEdge(mx, mz, bMinX, bMaxX, bMinZ, bMaxZ);
              segmentQueue.push(
                { ...seg, x1: p1.x, z1: p1.z, x2: pm.x, z2: pm.z },
                { ...seg, x1: pm.x, z1: pm.z, x2: p2.x, z2: p2.z }
              );
            } else {
              segmentQueue.push({ ...seg, x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z });
            }
            break;
          }
        }

        if (!intersected) {
          // Clamp deformed segment coordinates to stay strictly within the selection grid bounds
          seg.x1 = Math.max(minX, Math.min(maxX, seg.x1));
          seg.x2 = Math.max(minX, Math.min(maxX, seg.x2));
          seg.z1 = Math.max(minZ, Math.min(maxZ, seg.z1));
          seg.z2 = Math.max(minZ, Math.min(maxZ, seg.z2));

          // Calculate length and discard short debris segments (< 0.8 units)
          const length = Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.z2 - seg.z1) ** 2);
          if (length >= 0.8) {
            deformedRoads.push(seg);
          }
        }
      }

      const finalRoads = deformedRoads;
      
      if (finalRoads.length > 0) {
        const rRes = await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoads) });
        if (!rRes.ok) throw new Error(`Road insertion failed: ${rRes.status}`);
      }
      
      const bRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rawBuildings.filter(b => !b.parent_name)) });
      if (!bRes.ok) throw new Error(`Building insertion failed: ${bRes.status}`);
      
      const rootData = await bRes.json();
      if (rootData.data && rootData.data.length > 0) {
        const children: any[] = [];
        const rootGrid: any = {};
        rootData.data.forEach((r: any) => {
          const key = getGridKey(r.x, r.z);
          if (!rootGrid[key]) rootGrid[key] = [];
          rootGrid[key].push(r);
        });

        rawBuildings.filter(b => b.parent_name === 'ROOT' || b.parent_name === 'CORP_ROOT').forEach(c => {
          const key = c.x === undefined || c.z === undefined ? '' : getGridKey(c.x, c.z);
          if (!key) return;
          const neighbors = [key];
          for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(c.x/gridCell)+dx},${Math.floor(c.z/gridCell)+dz}`); }}
          
          let matched = false;
          for(const nKey of neighbors) {
            if(!rootGrid[nKey]) continue;
            const root = rootGrid[nKey].find((r: any) => {
              const dist = Math.sqrt((r.x - c.x)**2 + (r.z - c.z)**2);
              return (c.parent_name === 'ROOT' && dist < 5) || (c.parent_name === 'CORP_ROOT' && dist < 20);
            });
            if (root) {
              children.push({ ...c, parent_id: root.id });
              matched = true; break;
            }
          }
        });

        if (children.length > 0) {
          const cRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(children) });
          if (!cRes.ok) throw new Error(`Child building insertion failed: ${cRes.status}`);
        }
      }
      
      alert(`IMPORT_SUCCESSFUL: ${rawBuildings.length} BUILDINGS, ${finalRoads.length} ROAD SEGMENTS`);
      refreshLocations();
      if (refreshRoads) refreshRoads();
      setView('list');
      setRoadSelectionBounds(null);
      setShowMapModal(false);
    } catch (err: any) {
      console.error(err);
      alert(`IMPORT_FAILED: ${err.message}`);
    } finally {
      setIsGeneratingMap(false);
    }
  };

  useEffect(() => {
    if (!showMapModal) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    let active = true;
    
    loadMapLibre().then((maplibregl) => {
      if (!active) return;
      
      const map = new maplibregl.Map({
        container: 'real-world-map-container',
        style: {
          version: 8,
          sources: {
            'cartodb-dark': {
              type: 'raster',
              tiles: [
                'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
              ],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors, © CARTO'
            }
          },
          layers: [
            {
              id: 'dark-layer',
              type: 'raster',
              source: 'cartodb-dark',
              minzoom: 0,
              maxzoom: 20
            }
          ]
        },
        center: [2.3522, 48.8566],
        zoom: 13
      });

      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl());
    }).catch(err => {
      console.error("Failed to init MapLibre:", err);
      alert("Failed to load map library: " + err.message);
    });

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [showMapModal]);

  useEffect(() => {
    socketRef.current.on('editingStarted', (data: any) => setActiveUserEditing(data));
    socketRef.current.on('editingStopped', () => setActiveUserEditing(null));
    return () => { socketRef.current.off('editingStarted'); socketRef.current.off('editingStopped'); };
  }, []);

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [showDefined, setShowDefined] = useState(false);
  const [showUndefined, setShowUndefined] = useState(false);
  const defined = locations.filter(l => l.name && l.name.trim() !== "");
  const undefined = locations.filter(l => !l.name || l.name.trim() === "");

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

  const startNew = () => {
    setEditId(null); setSelectedLocation(null); setTargetObject(null);
    setEditData({ name: '', description: '', npcs: '', x: 0, y: 0, z: 0, width: 2, height: 4, depth: 2, baseWidth: 2, baseHeight: 4, baseDepth: 2, shape: 'box', color: '#00ff00', isFavorite: false, isDanger: false, owner: '' });
    setView('editor');
  };

  const startNewEnemy = () => {
    setEditId(null); setSelectedLocation(null); setTargetObject(null);
    setEditData({ 
        name: '', description: '', npcs: '', x: 0, y: 0, z: 0, 
        width: 1.875, height: 1.875, depth: 1.875, 
        baseWidth: 1.875, baseHeight: 1.875, baseDepth: 1.875,
        shape: 'enemy_rhombus', color: '#ff0000', isFavorite: false, isDanger: false, owner: 'SYSTEM' 
    });
    setView('editor');
  };

  const startEdit = (loc: any) => {
    setEditId(loc.id);
    setEditData({ ...loc, baseWidth: loc.width, baseHeight: loc.height, baseDepth: loc.depth, shape: loc.shape || 'box' });
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
    if (res.ok) { alert("BLOCK_COMMITTED"); refreshLocations(); setBlockBuildings([]); setView('list'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!targetObject) return;
    if (!editId) {
        const h = editData.baseHeight || editData.height || 4;
        const finalData = { ...editData, x: targetObject.position.x, z: targetObject.position.z, y: targetObject.position.y, width: (editData.baseWidth || editData.width || 2) * targetObject.scale.x, height: h * targetObject.scale.y, depth: (editData.baseDepth || editData.depth || 2) * targetObject.scale.z, rotation: targetObject.rotation.y };
        const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalData) });
        if (res.ok) { alert("LOCATION_UPLOADED"); targetObject.scale.set(1, 1, 1); refreshLocations(); setView('list'); }
        return;
    }
    const children = locations.filter(l => l.parent_id === editId);
    const updates: any[] = [];
    targetObject.traverse((mesh: any) => {
        if (!mesh.isMesh || !mesh.userData || !mesh.userData.id) return;
        const partId = mesh.userData.id;
        const worldPos = new THREE.Vector3(); mesh.getWorldPosition(worldPos);
        const part = [editData, ...children].find(p => p.id === partId) || editData;
        const baseW = part.baseWidth || part.width || 2;
        const baseH = part.baseHeight || part.height || 4;
        const baseD = part.baseDepth || part.depth || 2;
        const newWidth = baseW * targetObject.scale.x;
        const newHeight = baseH * targetObject.scale.y;
        const newDepth = baseD * targetObject.scale.z;
        updates.push({ ...part, x: worldPos.x, z: worldPos.z, y: worldPos.y - (newHeight / 2), width: newWidth, height: newHeight, depth: newDepth, rotation: targetObject.rotation.y });
    });
    if (updates.length === 0) {
        // Fallback for objects that might not have children with IDs (like simple boxes)
        const h = editData.baseHeight || editData.height || 4;
        updates.push({ ...editData, x: targetObject.position.x, z: targetObject.position.z, y: targetObject.position.y, width: (editData.baseWidth || editData.width || 2) * targetObject.scale.x, height: h * targetObject.scale.y, depth: (editData.baseDepth || editData.depth || 2) * targetObject.scale.z, rotation: targetObject.rotation.y });
    }
    const finalRoot = updates.find(u => u.id === editId) || updates[0];
    const res = await fetch(`/api/locations/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoot) });
    if (res.ok) {
        for (const childUpdate of updates.filter(u => u.id !== editId)) {
            await fetch(`/api/locations/${childUpdate.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(childUpdate) });
        }
        alert("DATA_UPDATED"); targetObject.scale.set(1, 1, 1); refreshLocations(); setView('list');
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    const idsToDelete = [deleteTarget.id, ...locations.filter(l => l.parent_id === deleteTarget.id).map(l => l.id)];
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
        alert(err.error || "UNDO_FAILED");
    }
  };

  const handleCopy = () => {
    if (!selectedLocation) return;
    const children = locations.filter((l: any) => l.parent_id === selectedLocation.id);
    setCopyBuffer({ root: selectedLocation, children });
    alert("DATA_LINK_COPIED");
  };

  const handlePaste = async () => {
    if (!copyBuffer) return;
    // Offset slightly so it's not exactly on top
    const offsetX = 5;
    const offsetZ = 5;
    
    const newRoot = { ...copyBuffer.root, id: undefined, x: copyBuffer.root.x + offsetX, z: copyBuffer.root.z + offsetZ };
    const res = await fetch('/api/locations', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
        body: JSON.stringify(newRoot) 
    });
    
    if (res.ok) {
        const result = await res.json();
        const newRootId = result.data[0].id;
        
        if (copyBuffer.children.length > 0) {
            const newChildren = copyBuffer.children.map((c: any) => ({
                ...c,
                id: undefined,
                parent_id: newRootId,
                x: c.x + offsetX,
                z: c.z + offsetZ
            }));
            await fetch('/api/locations', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
                body: JSON.stringify(newChildren) 
            });
        }
        alert("DATA_LINK_PASTED");
        refreshLocations();
    }
  };

  return (
    <div className="panel admin-panel">
      {deleteTarget && (
        <div className="modal-overlay"><div className="panel critical-alert"><h2 className="alert-text">!! CRITICAL_WARNING !!</h2><p>CONFIRM DESTRUCTION OF {locations.filter(l => l.parent_id === deleteTarget.id).length > 0 ? 'STRUCTURE GROUP' : 'DATA POINT'}:</p><p className="highlight">[{deleteTarget.name || `STRUCT_${deleteTarget.id}`}]</p><div className="button-group" style={{marginTop: '20px'}}><button className="upload-btn danger-btn" onClick={executeDelete}>PURGE_DATA</button><button className="utility-btn" onClick={() => setDeleteTarget(null)}>ABORT_OPERATION</button></div></div></div>
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
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setTargetObject(null); setView('generator'); generateBlock(); }}>+ BLOCK_GEN</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadSelectionBounds(null); setView('city_gen'); }}>+ CITY_GEN</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadSelectionBounds(null); setRoadTrail([]); setDrawCityBlocks([]); setSelectedBlockIds([]); setDrawCityStep(1); setView('city_draw'); }}>+ DRAW_CITY</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadTrail([]); setView('draw_roads'); }}>+ DRAW_ROADS</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setDistrictSelection([]); setView('district'); }}>+ ADD_DISTRICT</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setJoinSelection([]); setView('join'); }}>+ JOIN_STRUCTS</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1, borderColor: '#ff0000', color: '#ff0000'}} onClick={startNewEnemy}>+ ADD_ENEMY</button>
          </div>
          <button className="utility-btn danger-btn" style={{marginTop: '10px', width: '100%'}} onClick={async () => {
            if (confirm("PURGE ALL ROAD DATA?")) {
              const res = await fetch('/api/roads', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
              if (res.ok) {
                alert("ALL ROADS PURGED FROM DATABASE");
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
                  <p className="highlight">{selectedLocation.name || `STRUCT_${selectedLocation.id}`}</p>
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
                    PASTE: {copyBuffer.root.name || `STRUCT_${copyBuffer.root.id}`}
                  </button>
                </div>
              )}
            </div>
          )}
          {pendingRequests.length > 0 && pendingRequests.map((req: any, i: number) => (
            <div key={i} className="panel" style={{marginTop: '15px', borderColor: 'var(--green)'}}>
              <h4>ACCESS_REQUEST: {req.userName}</h4>
              <p style={{fontSize: '0.7rem'}}>TARGET: {req.locationName || `STRUCT_${req.locationId}`}</p>
              <div className="button-group" style={{marginTop: '10px'}}>
                <button className="upload-btn" onClick={() => {
                  socketRef.current.emit('approveEditing', { userId: req.userId, location: locations.find((l: any) => l.id === req.locationId) });
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
              <div key={loc.id} className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => setSelectedLocation(loc)} style={{cursor: 'pointer', paddingLeft: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}><div style={{display: 'flex', alignItems: 'center', gap: '10px', flex: 1, overflow: 'hidden'}}><input type="checkbox" checked={selectedIds.includes(loc.id)} onChange={() => toggleSelection(loc.id)} onClick={(e) => e.stopPropagation()} /><span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{`STRUCT_${loc.id}`}</span></div>{!isBatchSelecting && <div style={{display: 'flex', gap: '5px'}}><button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); startEdit(loc); }}>EDIT</button><button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); setDeleteTarget(loc); }}>DEL</button></div>}</div>
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
                if (roadTrail.length === 0) return alert("DRAW A PATH FIRST");
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

                if (allNewSegments.length === 0) return alert("NO VALID PATHS DRAWN");
                
                const finalSegments = consolidateRoads(allNewSegments, roads);
                await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalSegments) });
                alert(`DRAWN NETWORK GENERATED: ${finalSegments.length} SEGMENTS`); refreshLocations(); setView('list'); setRoadTrail([]);
            }}>GENERATE_FROM_DRAWINGS</button>
        </>
      )}

      {view === 'district' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>ADD_DISTRICT</h3><button onClick={() => { setView('list'); setDistrictSelection([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>DISTRICT_NAME</label><input placeholder="Name" value={districtConfig.name} onChange={e => setDistrictConfig({...districtConfig, name: e.target.value})} style={{width: '100%', marginBottom: '10px'}} />
            <label style={{fontSize: '0.7rem'}}>DISTRICT_COLOR</label><div className="button-group" style={{marginTop: '5px'}}>{['#00ff00', '#00ffff', '#ffff00', '#ff00ff'].map(c => <button key={c} className={districtConfig.color === c ? 'active' : ''} style={{backgroundColor: c, color: '#000'}} onClick={() => setDistrictConfig({...districtConfig, color: c})}>■</button>)}</div>
            <input type="color" value={districtConfig.color} onChange={e => setDistrictConfig({...districtConfig, color: e.target.value})} style={{width: '100%', marginTop: '5px', height: '30px', padding: '0', background: 'none', border: '1px solid var(--green)'}} />
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>SELECTION: {districtSelection.length} UNITS</p><p style={{opacity: 0.7}}>DRAG TO SELECT MULTIPLE UNITS</p><p style={{opacity: 0.7}}>CLICK TO TOGGLE INDIVIDUALS</p></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { if (!districtConfig.name.trim()) return alert("NAME REQUIRED"); const res = await fetch('/api/locations/batch-district', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: districtSelection, district_name: districtConfig.name, district_color: districtConfig.color }) }); if (res.ok) { alert("DISTRICT_SAVED"); refreshLocations(); setView('list'); setDistrictSelection([]); } }}>ASSIGN_DISTRICT</button>
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
            <button className="utility-btn" style={{marginTop: '5px', width: '100%', borderColor: 'var(--cyan)', color: 'var(--cyan)'}} onClick={() => setShowMapModal(true)}>IMPORT REAL MAP</button>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>{roadSelectionBounds ? <p>AREA_SELECTED: {Math.round(Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x))}x{Math.round(Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z))} units</p> : <p style={{opacity: 0.7}}>DRAG ON MAP TO SELECT GENERATION AREA</p>}<p style={{opacity: 0.7, marginTop: '5px'}}>HIERARCHICAL BSP: ENABLED</p><p style={{opacity: 0.7}}>ZONING: {citySectionType}</p><p style={{opacity: 0.7}}>INFRASTRUCTURE: {genExcludeRoads ? 'BUILDINGS_ONLY' : 'ROADS_+_BUILDINGS'}</p></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
              try {
                if (!roadSelectionBounds) return alert("SELECT AREA FIRST");
                const minX = Math.min(roadSelectionBounds.min.x, roadSelectionBounds.max.x); const maxX = Math.max(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
                const minZ = Math.min(roadSelectionBounds.min.z, roadSelectionBounds.max.z); const maxZ = Math.max(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
                const cityW = maxX - minX; const cityD = maxZ - minZ;
                const centerX = (minX + maxX) / 2;
                const centerZ = (minZ + maxZ) / 2;
                const maxRadius = Math.max(1, Math.max(cityW, cityD) / 2);
                const slumAngle = Math.random() * Math.PI * 2;

                const blocks: {x: number, z: number, w: number, d: number}[] = [];
                const cityRoads: any[] = [];
                const mainRoadW = 6; const sideRoadW = 3;

                const split = (x: number, z: number, w: number, d: number, iter: number) => {
                  if (iter > 4 || (w < 35 && d < 35)) { blocks.push({x, z, w, d}); return; }
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
                              const trunk = { name: 'HOLOTREE_TRUNK', description: 'ENVIRONMENTAL_HOLO_NODE', x: px, y: 0, z: pz, width: trunkW, depth: trunkW, height: trunkH, color, shape: 'cylinder' };
                              rawBuildings.push(trunk);
                              
                              const canopyW = 1.5 + Math.random() * 1.0;
                              const canopyH = 2.0 + Math.random() * 1.5;
                              const canopyShape = Math.random() > 0.5 ? 'pyramid' : 'box';
                              rawBuildings.push({ name: 'HOLOTREE_CANOPY', x: px, y: trunkH, z: pz, width: canopyW, depth: canopyW, height: canopyH, color, shape: canopyShape, parent_name: 'ROOT' });
                          }
                     }
                     return; 
                  }

                  let blockAngle = Math.atan2(b.z - centerZ, b.x - centerX);
                  let angleDiff = Math.abs(blockAngle - slumAngle);
                  if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

                  let zoneTypeVal = Math.random();

                  if (citySectionType === 'MIXED') {
                    // A single localized slum district occupies the outer edge (normDist > 0.45) of one 120-degree wedge
                    const isInSlumSector = normDist > 0.45 && angleDiff < Math.PI / 3;
                    
                    if (isInSlumSector) {
                      // Confine slums strictly to this single outer district
                      zoneTypeVal = 0.1;
                    } else if (normDist > 0.65 && Math.random() < 0.35) {
                      // Outer transition zone has a 35% chance to generate Industrial blocks
                      zoneTypeVal = -0.1;
                    } else {
                      // Inner core of the city contains Corporate or Urban zones
                      const innerRatio = normDist; // 0 to 1
                      // Near center -> Corporate, further out -> Urban
                      zoneTypeVal = Math.random() > (innerRatio * 0.75) ? 0.9 : 0.5;
                    }
                  } else if (citySectionType === 'CORPO') zoneTypeVal = 0.9;
                  else if (citySectionType === 'URBAN') zoneTypeVal = 0.5;
                  else if (citySectionType === 'SLUMS') zoneTypeVal = 0.1;
                  else if (citySectionType === 'INDUSTRIAL') zoneTypeVal = -0.1;
                  
                  // Clamp aspect ratio to 1.6 for non-slums zones to eliminate long flat buildings
                  const isSlum = zoneTypeVal <= 0.25 && zoneTypeVal >= 0;
                  if (!isSlum) {
                    const maxRatio = 1.6;
                    if (bw > bd * maxRatio) bw = bd * maxRatio;
                    else if (bd > bw * maxRatio) bd = bw * maxRatio;
                  }

                  // 2. LANDMARKS / HERO BUILDINGS
                  // Occasionally create a unique, large building that acts as a visual anchor (with footprint check)
                  const isLandmark = Math.random() < 0.20 && (zoneTypeVal > 0.8 || (bw > 30 && bd > 30)) && !isBlocked(b.x, b.z, bw * 0.7, bd * 0.7, 2.0);

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
                    
                    return; // Done with this block
                  }

                  generateThemedBuildingsForPlot(b.x, b.z, bw, bd, zoneTypeVal, isBlocked, getGridKey, spatialGrid, rawBuildings);
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
                        const dist = Math.sqrt((r.x - c.x)**2 + (r.z - c.z)**2);
                        return (c.parent_name === 'ROOT' && dist < 5) || (c.parent_name === 'CORP_ROOT' && dist < 20);
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

                alert(`CITY GENERATED: ${blocks.length} SECTORS`); refreshLocations(); setView('list'); setRoadSelectionBounds(null);
            } catch (err: any) {
              console.error(err);
              alert(`SYSTEM_ERROR: ${err.message}. Area might be too large or complex.`);
            }
            }}>GENERATE_CITY_GRID</button>
        </>
      )}

      {view === 'city_draw' && (
        <>
          <header style={{marginBottom: '10px'}}>
            <h3>DRAW_CITY // STEP {drawCityStep}</h3>
            <button onClick={() => { setView('list'); setRoadSelectionBounds(null); setRoadTrail([]); setDrawCityBlocks([]); setSelectedBlockIds([]); }} className="close-btn" style={{position: 'static'}}>X</button>
          </header>

          {drawCityStep === 1 && (
            <>
              <div className="editor-controls">
                <p style={{fontSize: '0.75rem', opacity: 0.8, lineHeight: '1.4'}}>
                  Define the city bounds by left-clicking and dragging a selection box on the tabletop grid map.
                </p>
              </div>
              <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>
                {roadSelectionBounds ? (
                  <p>AREA_SELECTED: {Math.round(Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x))}x{Math.round(Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z))} units</p>
                ) : (
                  <p style={{color: 'var(--cyan)'}}>AWAITING BOUNDS SELECTION...</p>
                )}
              </div>
              <button 
                className="upload-btn" 
                style={{marginTop: '15px'}} 
                disabled={!roadSelectionBounds}
                onClick={() => setDrawCityStep(2)}
              >
                NEXT: DRAW ROADS
              </button>
            </>
          )}

          {drawCityStep === 2 && (
            <>
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
              <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>
                <p>PATHS_DRAWN: {roadTrail.length}</p>
                <p>TOTAL_NODES: {roadTrail.reduce((acc, curr) => acc + curr.length, 0)}</p>
                <p style={{opacity: 0.7, marginTop: '5px'}}>HOLD LEFT-CLICK TO PAINT ROADS WITHIN SELECTION</p>
                <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setRoadTrail([])}>CLEAR_ALL_DRAWINGS</button>
              </div>
              <div style={{display: 'flex', gap: '10px', marginTop: '15px'}}>
                <button className="utility-btn" style={{flex: 1}} onClick={() => setDrawCityStep(1)}>BACK</button>
                <button 
                  className="upload-btn" 
                  style={{flex: 2}} 
                  disabled={roadTrail.length === 0}
                  onClick={generateDrawCityBlocks}
                >
                  NEXT: GEN SECTORS
                </button>
              </div>
            </>
          )}

          {drawCityStep === 3 && (
            <>
              <div className="editor-controls">
                <p style={{fontSize: '0.75rem', opacity: 0.8, lineHeight: '1.4', marginBottom: '10px'}}>
                  Click on neighborhood sectors in the 3D viewport to select them, then assign a zone type.
                </p>
                <label style={{fontSize: '0.7rem'}}>ASSIGN ZONE TYPE TO SELECTED ({selectedBlockIds.length}):</label>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '5px'}}>
                  <button className="utility-btn" style={{flex: '1 1 80px', borderColor: '#00ffff', color: '#00ffff'}} onClick={() => assignZoneTypeToSelected('CORPO')}>CORPO</button>
                  <button className="utility-btn" style={{flex: '1 1 80px', borderColor: '#d300d3', color: '#d300d3'}} onClick={() => assignZoneTypeToSelected('URBAN')}>URBAN</button>
                  <button className="utility-btn" style={{flex: '1 1 80px', borderColor: '#8d5b4c', color: '#8d5b4c'}} onClick={() => assignZoneTypeToSelected('SLUMS')}>SLUMS</button>
                  <button className="utility-btn" style={{flex: '1 1 80px', borderColor: '#ffff00', color: '#ffff00'}} onClick={() => assignZoneTypeToSelected('INDUSTRIAL')}>INDUSTRIAL</button>
                  <button className="utility-btn" style={{flex: '1 1 80px', borderColor: '#00ff66', color: '#00ff66'}} onClick={() => assignZoneTypeToSelected('PARK')}>PARK</button>
                </div>
              </div>
              <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px', maxHeight: '150px', overflowY: 'auto'}}>
                <p>TOTAL SECTORS: {drawCityBlocks.length}</p>
                <p>ZONED: {drawCityBlocks.filter((b: any) => b.type).length} / {drawCityBlocks.length}</p>
                <div style={{marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '3px'}}>
                  {drawCityBlocks.map((b: any, idx: number) => (
                    <div key={b.id} style={{display: 'flex', justifyContent: 'space-between', opacity: 0.8}}>
                      <span>Sector #{idx + 1} ({Math.round(b.w)}x{Math.round(b.d)})</span>
                      <span style={{color: b.type ? (b.type === 'CORPO' ? '#00ffff' : b.type === 'URBAN' ? '#d300d3' : b.type === 'SLUMS' ? '#8d5b4c' : b.type === 'INDUSTRIAL' ? '#ffff00' : '#00ff66') : '#aaa'}}>
                        {b.type || 'UNZONED'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{display: 'flex', gap: '10px', marginTop: '15px'}}>
                <button className="utility-btn" style={{flex: 1}} onClick={() => { setDrawCityStep(2); setDrawCityBlocks([]); setSelectedBlockIds([]); }}>BACK</button>
                <button 
                  className="upload-btn" 
                  style={{flex: 2}} 
                  disabled={drawCityBlocks.filter((b: any) => b.type).length === 0}
                  onClick={buildDrawCity}
                >
                  BUILD CITY
                </button>
              </div>
            </>
          )}
        </>
      )}

      {view === 'join' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>JOIN_STRUCTURES</h3><button onClick={() => { setView('list'); setJoinSelection([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>SELECTION: {joinSelection.length} UNITS</p><p style={{opacity: 0.7}}>CLICK BUILDINGS ON MAP TO ADD TO GROUP</p><p style={{opacity: 0.7}}>FIRST SELECTION BECOMES GROUP ROOT</p></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { if (joinSelection.length < 2) return alert("SELECT AT LEAST 2 UNITS"); const res = await fetch('/api/locations/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: joinSelection }) }); if (res.ok) { alert("STRUCTURES_JOINED"); refreshLocations(); setView('list'); setJoinSelection([]); } }}>JOIN_SELECTED</button>
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
              <button type="button" className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>
            </div>
          </div>
          <form onSubmit={handleSubmit}>
            {editData.district_name && <div style={{ fontSize: '0.7rem', color: editData.district_color || 'var(--green)', marginBottom: '10px', padding: '5px', border: '1px dashed currentColor', opacity: 0.9, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}><span>ASSIGNED_DISTRICT: {editData.district_name}</span><button type="button" onClick={() => setEditData({...editData, district_name: null, district_color: null})} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', fontSize: '0.9rem', lineHeight: 1 }} title="REMOVE_FROM_DISTRICT">🗑</button></div>}
            <input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} />
            <textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} />
            
            {editData.shape !== 'enemy_rhombus' && (
                <>
                    <textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} />
                    <div style={{display: 'flex', gap: '10px', marginTop: '10px', marginBottom: '10px'}}>
                        <button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}>★</button>
                        <button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button>
                    </div>
                </>
            )}
            
            <button type="submit" className="upload-btn">
                {editData.shape === 'enemy_rhombus' ? (editId ? 'UPDATE_ENEMY_DATA' : 'UPLOAD_NEW_ENEMY') : (editId ? 'UPDATE_DATA_POINT' : 'UPLOAD_NEW')}
            </button>
          </form>
        </>
      )}
      {showMapModal && (
        <div className="modal-overlay" style={{zIndex: 9999}}>
          <div className="panel" style={{width: '90%', maxWidth: '600px', backgroundColor: '#000', border: '1px solid var(--green)', padding: '15px'}}>
            <header style={{display: 'flex', justifyContent: 'space-between', marginBottom: '10px'}}>
              <h3>REAL_WORLD_MAP_SELECTOR</h3>
              <button disabled={isGeneratingMap} className="close-btn" style={{position: 'static'}} onClick={() => setShowMapModal(false)}>X</button>
            </header>
            
            <div style={{display: 'flex', gap: '5px', marginBottom: '10px'}}>
              <input 
                disabled={isGeneratingMap}
                id="map-search-input"
                placeholder="Search location (e.g. Times Square, Tokyo)..." 
                style={{flex: 1, backgroundColor: '#000', color: 'var(--green)', border: '1px solid var(--green)', padding: '5px'}}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const btn = document.getElementById('map-search-btn');
                    if (btn) btn.click();
                  }
                }}
              />
              <button 
                disabled={isGeneratingMap}
                id="map-search-btn"
                className="utility-btn" 
                onClick={() => {
                  const input = document.getElementById('map-search-input') as HTMLInputElement;
                  if (input && mapRef.current) {
                    handleMapSearch(input.value, mapRef.current);
                  }
                }}
              >
                SEARCH
              </button>
              <button 
                disabled={isGeneratingMap}
                className="utility-btn"
                style={{borderColor: 'var(--cyan)', color: 'var(--cyan)'}}
                onClick={() => {
                  if (mapRef.current) {
                    mapRef.current.setZoom(15.5);
                  }
                }}
              >
                FIT_ZOOM
              </button>
            </div>
            
            <div 
              id="real-world-map-container" 
              style={{width: '100%', height: '350px', border: '1px solid var(--green)', backgroundColor: '#111'}}
            />
            
            <div style={{marginTop: '10px', fontSize: '0.65rem', color: '#888'}}>
              <p>PAN AND ZOOM TO AREA. VIEWPORT BBOX WILL BE IMPORTED AND AUTOSCALED TO FIT YOUR SELECTED TABLETOP BOARD GRID.</p>
            </div>
            
            {isGeneratingMap && (
              <div style={{
                marginTop: '10px',
                border: '1px dashed var(--cyan)',
                padding: '10px',
                textAlign: 'center',
                color: 'var(--cyan)',
                textShadow: '0 0 5px var(--cyan)',
                fontFamily: 'Courier New, Courier, monospace',
                fontSize: '0.75rem',
                letterSpacing: '1px'
              }}>
                PROCESSING_MAP // RETRIEVING_GEOMETRIES {localThrobber}
              </div>
            )}
            
            <div className="button-group" style={{marginTop: '15px'}}>
              <button 
                disabled={isGeneratingMap}
                className="upload-btn" 
                onClick={() => {
                  if (mapRef.current) {
                    handleConfirmImport(mapRef.current);
                  }
                }}
              >
                CONFIRM_IMPORT
              </button>
              <button disabled={isGeneratingMap} className="utility-btn" onClick={() => setShowMapModal(false)}>CANCEL</button>
            </div>
          </div>
        </div>
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

function ChatWindow({ pos, setPos, onClose, messages, activeUsers, userName, onSendMessage, notificationsEnabled, onToggleNotifications }: any) {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  return (
    <DraggableWindow 
        title="CITY_NET // GLOBAL_CHAT" 
        pos={pos} 
        setPos={setPos} 
        onClose={onClose}
        windowStyle={{ maxWidth: 'none', width: '850px' }}
        contentStyle={{ maxHeight: 'none', padding: 0, overflow: 'hidden' }}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={onToggleNotifications}
    >
      <div style={{ display: 'flex', flexDirection: 'row', height: '600px', background: 'var(--black)' }}>
        {/* Main Section: History & Input */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '2px solid var(--dark-green)' }}>
          <div 
            ref={scrollRef}
            style={{ flex: 1, overflowY: 'auto', padding: '15px', fontSize: '0.8rem' }}
          >
            {messages.map((msg: any) => (
              <div key={msg.id} style={{ marginBottom: '10px', opacity: msg.sender === 'SYSTEM' ? 0.6 : 1 }}>
                <span style={{ color: 'var(--green)', fontSize: '0.65rem', marginRight: '8px', fontFamily: 'monospace' }}>[{msg.timestamp}]</span>
                <span style={{ color: msg.sender === userName ? 'var(--cyan)' : (msg.sender === 'SYSTEM' ? '#ff0000' : 'var(--green)'), fontWeight: 'bold' }}>
                  {msg.sender}:
                </span>
                <span style={{ marginLeft: '8px', wordBreak: 'break-all', color: '#fff' }}>{msg.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={handleSubmit} style={{ padding: '15px', display: 'flex', gap: '10px', background: 'rgba(0,25,0,0.5)', borderTop: '2px solid var(--dark-green)' }}>
            <input 
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="TYPE_UPLINK_MESSAGE..."
              style={{ flex: 1, background: 'rgba(0,40,0,0.6)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px', fontSize: '0.9rem' }}
            />
            <button type="submit" className="upload-btn" style={{ width: '100px', margin: 0 }}>SEND</button>
          </form>
        </div>

        {/* User Roster: Right Side */}
        <div style={{ width: '220px', display: 'flex', flexDirection: 'column', background: 'rgba(0,10,0,0.3)' }}>
          <div style={{ padding: '12px', fontSize: '0.75rem', fontWeight: 'bold', borderBottom: '2px solid var(--dark-green)', color: 'var(--green)', textShadow: 'var(--glow)' }}>OPERATORS_ONLINE</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {activeUsers.map((user: any) => (
              <div key={user.userName} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '5px', background: user.userName === userName ? 'rgba(0,255,255,0.05)' : 'transparent' }}>
                <div style={{ width: '6px', height: '6px', background: user.isAdmin ? '#ff0000' : 'var(--green)', borderRadius: '50%', boxShadow: user.isAdmin ? '0 0 5px #ff0000' : '0 0 5px var(--green)' }}></div>
                <span style={{ color: user.userName === userName ? 'var(--cyan)' : '#888', fontSize: '0.7rem' }}>
                    {user.userName}{user.isAdmin ? ' - Admin' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DraggableWindow>
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
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5.219 11.34l5.96-7.925a1.02 1.02 0 0 1 1.642 0l5.96 7.925c.292.388.292.932 0 1.32l-5.96 7.925a1.02 1.02 0 0 1-1.642 0L5.22 12.66a1.1 1.1 0 0 1 0-1.32" />
              </svg>
            </button>
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
      const isDefined = (loc.name && loc.name.trim() !== "") || (loc.description && loc.description.trim() !== "");
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
  const definedLocations = locations.filter(l => (l.name && l.name.trim() !== "") || (l.description && l.description.trim() !== ""));
  const danger = definedLocations.filter(l => l.isDanger); const starred = definedLocations.filter(l => l.isFavorite); const others = definedLocations.filter(l => !l.isDanger && !l.isFavorite && !l.district_name);
  const ListItem = ({ loc }: any) => (
    <div className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => onSelect(loc)} style={{ cursor: 'pointer', paddingLeft: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{!!loc.isDanger && <span style={{ color: '#ff0000', marginRight: '5px' }}>!</span>}{!!loc.isFavorite && <span style={{ color: '#ff7b00', marginRight: '5px' }}>★</span>}{loc.name || `STRUCT_${loc.id}`}</span><button className="utility-btn" onClick={(e) => { e.stopPropagation(); onZoom({ pos: [loc.x, loc.y + loc.height/2, loc.z], size: Math.max(loc.width, loc.height, loc.depth) }); }} style={{ padding: '0 4px', fontSize: '0.6rem', marginLeft: '5px' }}>◎</button></div>
  );
  return (
    <div className="panel quick-access-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}><h3 style={{ margin: 0 }}>QUICK_ACCESS</h3><button onClick={() => setIsOpen(false)} className="close-btn" style={{ position: 'static' }}>◀</button></header>
      <div className="location-list" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        {danger.length > 0 && (<><h4 className="category-header danger-text" onClick={() => setShowDanger(!showDanger)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showDanger ? '▼' : '▶'}</span>!! CRITICAL_SITES ({danger.length})</h4>{showDanger && danger.map(loc => <ListItem key={loc.id} loc={loc} />)}</>)}
        {starred.length > 0 && (<><h4 className="category-header starred-text" onClick={() => setShowStarred(!showStarred)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showStarred ? '▼' : '▶'}</span>★ PRIORITY_NODES ({starred.length})</h4>{showStarred && starred.map(loc => <ListItem key={loc.id} loc={loc} />)}</>)}
        {Object.keys(districts).length > 0 && (<><h4 className="category-header" onClick={() => setShowDistricts(!showDistricts)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showDistricts ? '▼' : '▶'}</span>DISTRICT_ZONES</h4>{showDistricts && Object.entries(districts).map(([name, data]: any) => (<div key={name} style={{ marginBottom: '10px' }}><div style={{ color: data.color, fontSize: '0.65rem', fontWeight: 'bold', paddingLeft: '20px', marginBottom: '5px', borderLeft: `2px solid ${data.color}`, marginLeft: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{name.toUpperCase()}</span><button className="utility-btn" onClick={(e) => { e.stopPropagation(); onZoom({ pos: data.center, size: data.size }); }} style={{ padding: '0 4px', fontSize: '0.6rem', color: data.color, borderColor: data.color }}>◎</button></div>{data.locations.length > 0 ? data.locations.map((loc: any) => <ListItem key={loc.id} loc={loc} />) : <div style={{ fontSize: '0.6rem', opacity: 0.5, paddingLeft: '35px' }}>NO_DEFINED_DATA</div>}</div>))}</>)}
        {others.length > 0 && (<><h4 className="category-header" onClick={() => setShowOthers(!showOthers)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ width: '20px', display: 'inline-block' }}>{showOthers ? '▼' : '▶'}</span>DEFINED_STRUCTURES ({others.length})</h4>{showOthers && others.map(loc => <ListItem key={loc.id} loc={loc} />)}</>)}
        {definedLocations.length === 0 && Object.keys(districts).length === 0 && (<p style={{ fontSize: '0.7rem', opacity: 0.5 }}>NO_DEFINED_DATA_POINTS</p>)}
      </div>
    </div>
  );
}

function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
  const { camera, controls } = useThree();
  const startTime = useRef<number | null>(null);
  const startPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const startTarget = useRef<THREE.Vector3>(new THREE.Vector3());

  useFrame((state) => {
    if (!target || !controls) {
        startTime.current = null;
        return;
    }
    
    if (startTime.current === null) {
        startTime.current = state.clock.elapsedTime;
        startPos.current.copy(camera.position);
        startTarget.current.copy((controls as any).target);
    }

    const duration = 2.0; // Slightly longer for more cinematic feel
    const elapsed = state.clock.elapsedTime - startTime.current;
    const progress = Math.min(1, elapsed / duration);
    
    // Smooth easing
    const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const [tx, ty, tz] = target.pos;
    const size = target.size;
    const destTarget = new THREE.Vector3(tx, ty, tz);
    
    // Calculate final position
    const distance = Math.max(45, size * 3.8);
    const destPos = new THREE.Vector3(tx + distance * 0.7, ty + distance * 0.6, tz + distance * 0.7);

    // --- CINEMATIC ARC & PAN ---
    // 1. Linear interpolation for basic path
    const currentPos = new THREE.Vector3().lerpVectors(startPos.current, destPos, t);
    
    // 2. Add an "Arc" (Swoop up in the middle)
    const arcHeight = startPos.current.distanceTo(destPos) * 0.25;
    const swoop = Math.sin(t * Math.PI) * arcHeight;
    currentPos.y += swoop;

    // 3. Add a "Pan" (Horizontal curve)
    // We calculate a vector perpendicular to the movement and the up-axis
    const moveDir = new THREE.Vector3().subVectors(destPos, startPos.current).normalize();
    const panAxis = new THREE.Vector3(0, 1, 0).cross(moveDir).normalize();
    const panAmount = Math.sin(t * Math.PI) * (distance * 0.4);
    currentPos.add(panAxis.multiplyScalar(panAmount));

    // Apply to camera and controls
    camera.position.copy(currentPos);
    (controls as any).target.lerpVectors(startTarget.current, destTarget, t);
    (controls as any).update();

    if (progress >= 1) {
        onComplete();
        startTime.current = null;
    }
  });
  return null;
}

function App() {
  const [locations, setLocations] = useState<any[]>([]);
  const [roads, setRoads] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<any | null>(null);
  const [cameraTarget, setCameraTarget] = useState<{ pos: [number, number, number], size: number } | null>(null);
  const [showZoomComplete, setShowZoomComplete] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState('');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [view, setView] = useState<'list' | 'editor' | 'generator' | 'district' | 'join' | 'draw_roads' | 'city_gen' | 'city_draw'>('list');
  const [drawCityStep, setDrawCityStep] = useState<number>(1);
  const [drawCityBlocks, setDrawCityBlocks] = useState<any[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(true);
  const [userName, setUserName] = useState<string>('');
  const [tempUserName, setTempUserName] = useState('');
  const [currentController, setCurrentController] = useState<string>('');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeEditLocation, setActiveEditLocation] = useState<any>(null);
  const [isSomeoneEditing, setIsSomeoneEditing] = useState(false);
  const [activeSidebarMenu, setActiveSidebarMenu] = useState<'none' | 'quick_access' | 'nav_controls' | 'system_info' | 'geometry_protocols'>('none');
  const [infoPanelPos, setInfoPanelPos] = useState({ x: 100, y: 100 });
  const [chatPos, setChatPos] = useState({ x: 400, y: 100 });
  const [chatMessages, setChatMessages] = useState<any[]>([]);
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
  const [roadSelectionBounds, setRoadSelectionBounds] = useState<{ min: THREE.Vector3, max: THREE.Vector3 } | null>(null);
  const [roadTrail, setRoadTrail] = useState<THREE.Vector3[][]>([]);
  const [roadDrawMode, setRoadDrawMode] = useState<'free' | 'straight'>('free');
  const [snapToGrid, setSnapToGrid] = useState(false);
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
      
      if (!isSelected && !isBatchSelected) {
        // Flatten parent and all its children into the simple (instanced) rendering list
        const pushSimple = (p: any) => {
          simple.push({
            id: p.id,
            shape: p.shape,
            x: p.x,
            y: p.y,
            z: p.z,
            width: p.width,
            height: p.height,
            depth: p.depth,
            color: p.color,
            rotation: p.rotation,
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
        interactive.push({ loc, children, isSelected, isBatchSelected });
      }
    });
    return { simple, interactive };
  }, [groupedLocations, isBatchSelecting, view, selectedLocation, selectedIds, districtSelection, joinSelection]);

  const toggleSelection = (id: number) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };

  const handleBuildingClick = (loc: any) => {
    if (view === 'editor' || view === 'generator') return;
    if (isBatchSelecting) {
      toggleSelection(loc.id);
    } else if (view === 'district') {
      setDistrictSelection(prev => prev.includes(loc.id) ? prev.filter(i => i !== loc.id) : [...prev, loc.id]);
    } else if (view === 'join') {
      setJoinSelection(prev => prev.includes(loc.id) ? prev.filter(i => i !== loc.id) : [...prev, loc.id]);
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
  const [editData, setEditData] = useState({ name: '', description: '', npcs: '', x: 0, y: 0, z: 0, width: 2, height: 4, depth: 2, baseWidth: 2, baseHeight: 4, baseDepth: 2, shape: 'box', color: '#00ff00', isFavorite: false, isDanger: false, owner: '' });
  const [blockBuildings, setBlockBuildings] = useState<any[]>([]);
  const [targetObject, setTargetObject] = useState<any>(null);
  const genGroupRef = useRef<any>(null);
  const editMeshRef = useRef<any>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    const savedName = localStorage.getItem('userName');
    if (savedName) { setUserName(savedName); setTempUserName(savedName); }
  }, []);

  useEffect(() => {
    if (!userName || !isLoggedIn) return;
    const interval = setInterval(() => { fetch('/api/control').then(res => res.json()).then(data => setCurrentController(data.controller)).catch(err => console.error(err)); }, 2000);
    return () => clearInterval(interval);
  }, [userName, isLoggedIn]);

  useEffect(() => { if (view !== 'generator') setTargetObject(null); }, [view]);

  const fetchLocations = () => { fetch('/api/locations').then(res => res.json()).then(data => setLocations(data)).catch(err => console.error("Error fetching locations:", err)); };
  const fetchRoads = () => { fetch('/api/roads').then(res => res.json()).then(data => setRoads(data)).catch(err => console.error("Error fetching roads:", err)); };

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
    fetchLocations(); fetchRoads();
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

    newSocket.on('connect', () => {
      console.log("Socket connected, identifying as:", userName);
      newSocket.emit('identify', { userName, isAdmin: !!token });
    });

    newSocket.on('dataUpdated', () => { fetchLocations(); fetchRoads(); });
    newSocket.on('activeUsersUpdated', (users: any[]) => setActiveUsers(users));
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
        socket.emit('identify', { userName, isAdmin: !!token });
    }
  }, [token, socket, userName]);

  useEffect(() => { if (isEditModalOpen && activeEditLocation) setEditData({ ...activeEditLocation, baseWidth: activeEditLocation.width, baseHeight: activeEditLocation.height, baseDepth: activeEditLocation.depth }); }, [isEditModalOpen, activeEditLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) });
    const data = await res.json();
    if (data.token) { setToken(data.token); setIsAdmin(true); } else { setNotification("LOGIN_FAILED"); }
  };

  const startBootSequence = () => { if (!tempUserName.trim()) return; localStorage.setItem('userName', tempUserName); setUserName(tempUserName); setIsLoggedIn(true); if (socketRef.current) socketRef.current.emit('identify', tempUserName); if (audioEnabled) { const startupSound = new Audio('/StartUp.mp3'); startupSound.volume = 0.20; startupSound.play().catch(() => {}); } };

  const handleSendMessage = (text: string) => {
    if (socketRef.current) {
        socketRef.current.emit('sendMessage', { sender: userName, text });
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
            {notification && <div className="modal-overlay" onClick={() => setNotification(null)} style={{cursor: 'pointer'}}><div className="panel" style={{color: '#ff0000', borderColor: '#ff0000'}}><h2 style={{fontSize: '2rem'}}>{notification}</h2></div></div>}
            {isEditModalOpen && activeEditLocation && (
              <div className="modal-overlay"><div className="panel"><h2>EDIT_DATA_POINT</h2><form onSubmit={async (e) => { e.preventDefault(); const res = await fetch(`/api/locations/${activeEditLocation.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editData) }); if (res.ok) { setNotification("DATA_POINT_UPDATED"); setIsEditModalOpen(false); socketRef.current.emit('editingFinished'); } }} style={{display: 'flex', flexDirection: 'column', gap: '10px'}}><label>NAME</label><input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} style={{width: '100%'}} /><div style={{display: 'flex', gap: '10px', width: '100%'}}><div style={{flex: 1}}><label>DESCRIPTION</label><textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} style={{width: '100%', height: '100px'}} /></div><div style={{flex: 1}}><label>RESIDENTS</label><textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} style={{width: '100%', height: '100px'}} /></div></div><div style={{display: 'flex', gap: '10px', marginTop: '10px'}}><button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}>★</button><button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button></div><button type="submit" className="upload-btn">SAVE</button><button className="utility-btn" onClick={() => { setIsEditModalOpen(false); socketRef.current.emit('editingFinished'); }}>CLOSE</button></form></div></div>
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
                <div style={{display: 'flex', gap: '10px'}}>{token && <button className="admin-toggle" onClick={() => setShowAdminPanel(!showAdminPanel)}>{showAdminPanel ? 'HIDE_DASHBOARD' : 'SHOW_DASHBOARD'}</button>}<button className="admin-toggle" onClick={() => !token && setIsAdmin(!isAdmin)}>{token ? 'ADMIN_MODE' : (isAdmin ? 'CANCEL' : 'ADMIN_LOGIN')}</button></div>
              </div>
            </header>
            {isAdmin && !token && <div className="panel admin-login"><form onSubmit={handleLogin}><input placeholder="USERNAME" onChange={e => setLoginForm({...loginForm, username: e.target.value})} /><input type="password" placeholder="PASSWORD" onChange={e => setLoginForm({...loginForm, password: e.target.value})} /><button type="submit">ACCESS_SYSTEM</button></form></div>}
            {token && showAdminPanel && (
              <AdminPanel
                socketRef={socketRef}
                token={token}
                onLogout={() => { setToken(''); setIsAdmin(false); setShowAdminPanel(false); }}
                refreshLocations={fetchLocations}
                refreshRoads={fetchRoads}
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
                roadSelectionBounds={roadSelectionBounds} 
                setRoadSelectionBounds={setRoadSelectionBounds} 
                roadTrail={roadTrail} 
                setRoadTrail={setRoadTrail} 
                roadDrawMode={roadDrawMode} 
                setRoadDrawMode={setRoadDrawMode} 
                snapToGrid={snapToGrid} 
                setSnapToGrid={setSnapToGrid}
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
                drawCityStep={drawCityStep}
                setDrawCityStep={setDrawCityStep}
                drawCityBlocks={drawCityBlocks}
                setDrawCityBlocks={setDrawCityBlocks}
                selectedBlockIds={selectedBlockIds}
                setSelectedBlockIds={setSelectedBlockIds}
                />
            )}
            {isChatOpen && (
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
              />
            )}
            {(() => {
              const isRhombus = selectedLocation?.shape === 'rhombus' || selectedLocation?.shape === 'enemy_rhombus';
              const isOwner = selectedLocation?.owner === userName;
              const isAdmin = token !== '';
              const canManage = isRhombus && (isAdmin || isOwner);
              
              // Show window if not admin OR if it's a rhombus that needs management OR just to view info
              if (selectedLocation && (!token || !showAdminPanel || canManage)) {
                return (
                  <DraggableWindow 
                    title={selectedLocation.name || (selectedLocation.shape === 'enemy_rhombus' ? 'HOSTILE_NODE' : (selectedLocation.shape === 'rhombus' ? 'TACTICAL_BEACON' : 'UNIDENTIFIED_STRUCTURE'))} 
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
                    {!token && !isRhombus && <button className="upload-btn" onClick={() => { if (isSomeoneEditing) { setNotification("ANOTHER_USER_ACCESSING_DATA_POINTS"); } else { socketRef.current.emit('requestEditing', { userId: userName, userName, locationId: selectedLocation.id, locationName: selectedLocation.name }); setNotification("REQUEST_SENT_TO_ADMIN"); } }}>REQUEST_EDITING_RIGHTS</button>}
                  </DraggableWindow>
                );
              }
              return null;
            })()}
            <div className="bottom-bar"><p>{token ? 'EDITOR_ACTIVE // USE GIZMO TO MANIPULATE DATA_POINT' : (<><span style={{ display: 'inline-block', width: '250px', textAlign: 'right' }}>{isWaiting ? 'SYSTEM READY // ' : `SYSTEM CHECKING ${throbber} // `}</span><span style={{ display: 'inline-block', width: '300px', textAlign: 'left', whiteSpace: 'nowrap' }}>{statusText}</span></>)}</p></div>
          </div>
          <Canvas shadows frameloop="always" onPointerDown={() => { if (!rhombusState.active) setActiveSidebarMenu('none'); }}>
            <PerspectiveCamera makeDefault position={[80, 80, 80]} />
            <OrbitControls makeDefault enabled={!isDragging} zoomToCursor dampingFactor={0.1} enableDamping />
            <color attach="background" args={['#000000']} />
            {/* @ts-ignore */}
            <Grid infiniteGrid fadeDistance={750} fadeStrength={1.5} cellSize={1} cellThickness={0.7} sectionSize={10} sectionThickness={1.2} sectionColor="#006600" cellColor="#003300" pointerEvents="none" />
            <CameraController target={cameraTarget} onComplete={() => { setCameraTarget(null); setShowZoomComplete(true); setTimeout(() => setShowZoomComplete(false), 3000); }} />
            <Roads roads={roads} />
            <GhostTraffic roads={roads} />
            <DistrictInteractions view={view} locations={locations} onSelectionChange={(data: any) => { if (view === 'city_gen' || (view === 'city_draw' && drawCityStep === 1)) { setRoadSelectionBounds(data); } else if (view === 'district') { setDistrictSelection(prev => [...new Set([...prev, ...data])]); } else if (isBatchSelecting) { setSelectedIds(prev => [...new Set([...prev, ...data])]); } }} roadTrail={roadTrail} setRoadTrail={setRoadTrail} roadDrawMode={roadDrawMode} snapToGrid={snapToGrid} drawingRoadWidth={drawingRoadWidth} isBatchSelecting={isBatchSelecting} setSelectedIds={setSelectedIds} rhombusState={rhombusState} setRhombusState={setRhombusState} userName={userName} refreshLocations={fetchLocations} token={token} drawCityStep={drawCityStep} />
            {roadSelectionBounds && (view === 'city_gen' || view === 'city_draw') && (
              <mesh position={[(roadSelectionBounds.min.x + roadSelectionBounds.max.x) / 2, 0.02, (roadSelectionBounds.min.z + roadSelectionBounds.max.z) / 2]}>
                <boxGeometry args={[Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x), 0.05, Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z)]} />
                <meshBasicMaterial color="#00ff66" wireframe transparent opacity={0.3} />
              </mesh>
            )}
            {view === 'city_draw' && drawCityStep === 3 && drawCityBlocks.map((b: any) => {
              const isSel = selectedBlockIds.includes(b.id);
              let color = '#555555';
              if (b.type === 'CORPO') color = '#00ffff';
              else if (b.type === 'URBAN') color = '#aa00ff';
              else if (b.type === 'SLUMS') color = '#8d5b4c';
              else if (b.type === 'INDUSTRIAL') color = '#ffff00';
              else if (b.type === 'PARK') color = '#00ff66';

              // Visual buffer to leave spacing for roads between blocks
              const visualW = Math.max(2, b.w - drawingRoadWidth);
              const visualD = Math.max(2, b.d - drawingRoadWidth);

              return (
                <group key={b.id} position={[b.x, 0.05, b.z]}>
                  <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockIds(prev => prev.includes(b.id) ? prev.filter(id => id !== b.id) : [...prev, b.id]);
                  }}>
                    <planeGeometry args={[visualW, visualD]} />
                    <meshBasicMaterial color={color} transparent opacity={isSel ? 0.35 : 0.15} side={THREE.DoubleSide} />
                  </mesh>
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[visualW, visualD]} />
                    <meshBasicMaterial color={isSel ? '#ffffff' : color} wireframe transparent opacity={0.8} />
                  </mesh>
                </group>
              );
            })}
            <InstancedBuildings buildings={renderLists.simple} onSelect={handleBuildingClick} />
            {renderLists.interactive.map(({ loc, children, isSelected, isBatchSelected }: any) => (
              <Building key={loc.id} location={loc} children={children} onClick={() => handleBuildingClick(loc)} isSelected={isSelected} isBatchSelected={isBatchSelected} setTargetObject={setTargetObject} editMeshRef={editMeshRef} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} />
            ))}
            {/* Dedicated Player Rhombus Rendering */}
            {locations.filter(l => l.shape === 'rhombus').map(loc => (
              <PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} activeUsers={activeUsers} roads={roads} />
            ))}
            {/* Dedicated Enemy Rhombus Rendering */}
            {locations.filter(l => l.shape === 'enemy_rhombus').map(loc => (
              <EnemyRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socket} roads={roads} />
            ))}
            {token && view === 'editor' && !editId && (
              <group ref={(group) => { if (group && targetObject !== group) { setTargetObject(group); editMeshRef.current = group; } }} position={[editData.x, editData.y, editData.z]}><mesh position={[0, editData.height / 2, 0]} scale={[editData.width, editData.height, editData.depth]}>{renderBaseGeometry(editData.shape)}<meshBasicMaterial color="#00ff00" wireframe /></mesh></group>
            )}
            {/* @ts-ignore */}
            {token && (view === 'editor' || view === 'generator') && targetObject && <TransformControls object={targetObject} mode={view === 'generator' ? 'translate' : transformMode} translationSnap={snapToGrid ? 1 : null} onDraggingChanged={(e: any) => setIsDragging(e.value)} />}
            {token && view === 'generator' && (
              <group ref={(group) => { genGroupRef.current = group; setTargetObject(group); }}>
                  {blockBuildings.length > 0 ? (
                    blockBuildings.map((b, i) => {
                      const renderGenGeometry = () => { switch (b.shape) { case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 5]} />; case 'sphere': return <sphereGeometry args={[0.5, 12, 12]} />; default: return <boxGeometry args={[1, 1, 1]} />; } };
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
