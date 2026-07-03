import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { HealthBar } from '../HealthBar';
import { useStreamerVisibility } from '../context/StreamerVisibilityContext';
import { IS_SPECTATOR } from '../streamerMode';

// Streamer name tags follow the admin's hover: the admin broadcasts hover
// state per rhombus; the spectator shows the tag only for that rhombus.
const useStreamerHover = (socket: any, locationId: number, isAdmin: boolean, isHovered: boolean) => {
  const [streamerHovered, setStreamerHovered] = useState(false);

  useEffect(() => {
    if (IS_SPECTATOR || !isAdmin || !socket) return;
    socket.emit('streamerHover', { id: locationId, hovered: isHovered });
  }, [isHovered, isAdmin, socket, locationId]);

  useEffect(() => {
    if (!IS_SPECTATOR || !socket) return;
    const handle = (d: any) => { if (d.id === locationId) setStreamerHovered(!!d.hovered); };
    socket.on('streamerHover', handle);
    return () => { socket.off('streamerHover', handle); };
  }, [socket, locationId]);

  return streamerHovered;
};

export const EnemyRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, refreshLocations, setIsDragging, socket, roads, isBattleMap, measureMode }: any) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { controls, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  
  const isAdmin = token !== '';
  const streamerVis = useStreamerVisibility();
  const [isHovered, setIsHovered] = useState(false);
  const streamerHovered = useStreamerHover(socket, location.id, isAdmin, isHovered);
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
  const pathPoints = useRef<{ x: number; z: number }[]>([]);
  const [dragOffset, setDragOffset] = useState(new THREE.Vector3());

  // Smooth movement interpolation
  const visualPos = useRef(new THREE.Vector3(location.x, location.y + (location.height / 4), location.z));

  const [animState, setAnimState] = useState<'none' | 'appearing' | 'fading'>('none');
  const animStartTime = useRef<number | null>(null);
  const hasAppeared = useRef(false);
  const waypointTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isAnimatingPath = useRef(false);

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
    const handlePath = (data: any) => {
      if (data.id !== location.id || !Array.isArray(data.waypoints)) return;
      waypointTimers.current.forEach(clearTimeout);
      waypointTimers.current = [];
      isAnimatingPath.current = true;
      const interval = 80; // ms between waypoints
      data.waypoints.forEach((wp: { x: number; z: number }, i: number) => {
        const t = setTimeout(() => {
          localPos.current = { x: wp.x, z: wp.z };
          if (i === data.waypoints.length - 1) isAnimatingPath.current = false;
        }, i * interval);
        waypointTimers.current.push(t);
      });
    };
    socket.on('rhombusFading', handleFade);
    socket.on('rhombusAppearing', handleAppear);
    socket.on('rhombusPath', handlePath);
    return () => {
      socket.off('rhombusFading', handleFade);
      socket.off('rhombusAppearing', handleAppear);
      socket.off('rhombusPath', handlePath);
      waypointTimers.current.forEach(clearTimeout);
      isAnimatingPath.current = false;
    };
  }, [location.id, socket]);

  useEffect(() => {
    if (isAnimatingPath.current) return;
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
      const battleMapScale = isBattleMap ? 4 : 1;
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
      if (measureMode) return;
      e.stopPropagation();
    dragDist.current = 0;

    // Only allow dragging if the user is an Admin
    if (!isAdmin) return;

    pathPoints.current = [{ x: localPos.current.x, z: localPos.current.z }];
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
    if (measureMode) return;
    if (!isAdmin || e.buttons !== 1) return;
    dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        const targetX = intersection.x + dragOffset.x;
        const targetZ = intersection.z + dragOffset.z;
        localPos.current = { x: targetX, z: targetZ };
        pathPoints.current.push({ x: targetX, z: targetZ });
    }
  };

  const handlePointerUp = async (e: any) => {
      if (measureMode) return;
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    if (controls) (controls as any).enabled = true;
    setIsLocalDragging(false);
    setIsDragging(false);

    // EVERYONE can open the info window with a click
    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick(); // Stationary click -> open info window
    } else if (isAdmin) {
        const pts = pathPoints.current;
        const waypoints = Array.from({ length: 30 }, (_, i) => {
          const idx = Math.round(i * (pts.length - 1) / 29);
          return pts[idx];
        });
        socket.emit('moveRhombusPath', { id: location.id, waypoints });
    }
  };

  return (
    <group
        ref={(group) => {
            groupRef.current = group as any;
            if (group) {
                if (group.position) group.position.copy(visualPos.current);
            }
            if (isSelected && group) { setTargetObject(group); }
        }}
    >
      <mesh 
          ref={meshRef as any}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerOver={(e) => { e.stopPropagation(); setIsHovered(true); }}
          onPointerOut={(e) => { e.stopPropagation(); setIsHovered(false); }}
      >
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial color="#ff0000" transparent opacity={0.9} />
      </mesh>
      
      

      {/* Enemy Core - Pulsing Void */}
      <mesh ref={coreRef as any} scale={[0.5, 0.5, 0.5]}>
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial color="#220000" />
      </mesh>
      
      {isAdmin && (
          <HealthBar hpCurrent={location.hp_current} hpMax={location.hp_max} hpTemp={location.hp_temp} position={[0, 0, 0]} isBattleMap={isBattleMap} />
      )}
      
      {location.name && (isHovered || isSelected || (IS_SPECTATOR && streamerVis.showPlayerNames && streamerHovered)) && (
          <Html position={[0, isBattleMap ? 2.5 : ((location.height * 0.8) + 3), 0]} center zIndexRange={[100, 0]} occlude style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,0.7)', border: `1px solid #ff0000`, padding: '2px 6px', fontSize: '10px', color: '#fff', whiteSpace: 'nowrap', textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '1px' }}>
                {location.name}
            </div>
          </Html>
      )}

      {/* Red Alert Light */}
      <pointLight ref={lightRef as any} color="#ff0000" intensity={3} distance={15} decay={2} />
    </group>
  );
});

export const FriendlyRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, refreshLocations, setIsDragging, socket, roads, isBattleMap, measureMode }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  const meshGroupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const { controls, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  
  const isAdmin = token !== '';
  const streamerVis = useStreamerVisibility();
  const [isHovered, setIsHovered] = useState(false);
  const streamerHovered = useStreamerHover(socket, location.id, isAdmin, isHovered);
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
  const pathPoints = useRef<{ x: number; z: number }[]>([]);
  const [dragOffset, setDragOffset] = useState(new THREE.Vector3());
  const waypointTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const visualPos = useRef(new THREE.Vector3(location.x, location.y + (location.height / 4), location.z));

  const [animState, setAnimState] = useState<'none' | 'appearing' | 'fading'>('none');
  const animStartTime = useRef<number | null>(null);
  const hasAppeared = useRef(false);
  const isAnimatingPath = useRef(false);

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
    const handlePath = (data: any) => {
      if (data.id !== location.id || !Array.isArray(data.waypoints)) return;
      waypointTimers.current.forEach(clearTimeout);
      waypointTimers.current = [];
      isAnimatingPath.current = true;
      const interval = 80;
      data.waypoints.forEach((wp: { x: number; z: number }, i: number) => {
        const t = setTimeout(() => {
          localPos.current = { x: wp.x, z: wp.z };
          if (i === data.waypoints.length - 1) isAnimatingPath.current = false;
        }, i * interval);
        waypointTimers.current.push(t);
      });
    };
    socket.on('rhombusFading', handleFade);
    socket.on('rhombusAppearing', handleAppear);
    socket.on('rhombusPath', handlePath);
    return () => {
      socket.off('rhombusFading', handleFade);
      socket.off('rhombusAppearing', handleAppear);
      socket.off('rhombusPath', handlePath);
      waypointTimers.current.forEach(clearTimeout);
      isAnimatingPath.current = false;
    };
  }, [location.id, socket]);

  useEffect(() => {
    if (isAnimatingPath.current) return;
    localPos.current = { x: location.x, z: location.z };
  }, [location.x, location.z]);

  useFrame((state, delta) => {
    if (!meshGroupRef.current) return;
    
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
    const battleMapScale = isBattleMap ? 4 : 1;
    const scale = 1.875 * finalScaleMult * battleMapScale;
      
    meshGroupRef.current.scale.set(scale, scale, scale);
    const time = state.clock.elapsedTime;
    meshGroupRef.current.rotation.y += 0.05 * rotationSpeed;
    meshGroupRef.current.rotation.x = Math.sin(time * 1.5) * Math.PI * 0.2; 
    meshGroupRef.current.rotation.z += 0.02 * rotationSpeed;
    meshGroupRef.current.position.y = Math.sin(time * 3) * 0.2;

    const pulse = (0.5 + Math.sin(state.clock.elapsedTime * 6) * 0.5) * flicker;
    
    meshGroupRef.current.children.forEach(child => {
        if ((child as any).isMesh && (child as any).material) {
            ((child as any).material as THREE.MeshBasicMaterial).color.setRGB(0, 0.2 + pulse * 0.8, 0.2 + pulse * 0.8);
            ((child as any).material as any).opacity = baseOpacity;
        }
    });

    if (lightRef.current) lightRef.current.intensity = (1.0 + pulse * 4.0) * (baseOpacity / 0.9);

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
      if (measureMode) return;
      e.stopPropagation();
    dragDist.current = 0;
    if (!isAdmin) return;
    pathPoints.current = [{ x: localPos.current.x, z: localPos.current.z }];
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
    if (measureMode) return;
    if (!isAdmin || e.buttons !== 1) return;
    dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        const targetX = intersection.x + dragOffset.x;
        const targetZ = intersection.z + dragOffset.z;
        localPos.current = { x: targetX, z: targetZ };
        pathPoints.current.push({ x: targetX, z: targetZ });
    }
  };

  const handlePointerUp = async (e: any) => {
      if (measureMode) return;
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    if (controls) (controls as any).enabled = true;
    setIsLocalDragging(false);
    setIsDragging(false);

    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick();
    } else if (isAdmin) {
        const pts = pathPoints.current;
        const waypoints = Array.from({ length: 30 }, (_, i) => {
          const idx = Math.round(i * (pts.length - 1) / 29);
          return pts[idx];
        });
        socket.emit('moveRhombusPath', { id: location.id, waypoints });
    }
  };

  return (
    <group 
        ref={(group) => { 
            groupRef.current = group as any;
            if (group) if (group.position) group.position.copy(visualPos.current);
            if (isSelected && group) setTargetObject(group);
        }}
    >
      <group
        ref={meshGroupRef as any}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={(e) => { e.stopPropagation(); setIsHovered(true); }}
        onPointerOut={(e) => { e.stopPropagation(); setIsHovered(false); }}
      >
        <mesh>
          <coneGeometry args={[0.5, 0.8, 4]} />
          <meshBasicMaterial color="#00ccff" transparent opacity={0.9} />
        </mesh>
      </group>
      
      {isAdmin && (
          <HealthBar hpCurrent={location.hp_current} hpMax={location.hp_max} hpTemp={location.hp_temp} position={[0, 0, 0]} isBattleMap={isBattleMap} />
      )}
      
      {location.name && (isHovered || isSelected || (IS_SPECTATOR && streamerVis.showPlayerNames && streamerHovered)) && (
          <Html position={[0, isBattleMap ? 2.5 : ((location.height * 0.8) + 3), 0]} center zIndexRange={[100, 0]} occlude style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,0.7)', border: `1px solid #00ccff`, padding: '2px 6px', fontSize: '10px', color: '#fff', whiteSpace: 'nowrap', textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '1px' }}>
                {location.name}
            </div>
          </Html>
      )}
      
      <pointLight ref={lightRef as any} color="#00ccff" intensity={3} distance={15} decay={2} />
    </group>
  );
});

export const PlayerRhombus = React.memo(({ location, onClick, isSelected, setTargetObject, token, userName, refreshLocations, setIsDragging, socket, activeUsers, roads, isBattleMap, battleMapPos, measureMode }: any) => {
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
  const streamerVis = useStreamerVisibility();

  const isOnline = activeUsers.some((u: any) => u.userName === location.owner);
  const [isHovered, setIsHovered] = useState(false);
  const streamerHovered = useStreamerHover(socket, location.id, isAdmin, isHovered);

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
  const pathPoints = useRef<{ x: number; z: number }[]>([]);
  const [dragOffset, setDragOffset] = useState(new THREE.Vector3());
  const waypointTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isAnimatingPath = useRef(false);

  // Smooth movement interpolation
  const visualPos = useRef(new THREE.Vector3(
    isBattleMap && battleMapPos ? battleMapPos.x : location.x, 
    isBattleMap ? 0.1 : location.y + (location.height / 2), 
    isBattleMap && battleMapPos ? battleMapPos.z : location.z
  ));

  useEffect(() => {
    if (isAnimatingPath.current) return;
    localPos.current = { x: location.x, z: location.z };
  }, [location.x, location.z]);

  const animStateRef = useRef<'none' | 'appearing' | 'fading'>('none');
  const animStartTime = useRef<number | null>(null);
  const hasAppeared = useRef(false);
  const isOnlineRef = useRef(false);

  // Trigger appearing animation on first session mount ONLY if online
  useEffect(() => {
    if (!hasAppeared.current && isOnline) {
        animStateRef.current = 'appearing';
        animStartTime.current = Date.now();
        hasAppeared.current = true;
    }
  }, [isOnline]);

  useEffect(() => {
    if (!socket) return;
    const handleFade = (data: any) => {
      if (data.id === location.id && animStateRef.current !== 'fading') {
        // Only animate if rhombus is currently visible (online or mid-appear)
        if (!isOnlineRef.current && animStateRef.current !== 'appearing') return;
        animStateRef.current = 'fading';
        animStartTime.current = Date.now();
      }
    };
    const handleAppear = (data: any) => { if (data.id === location.id) { animStateRef.current = 'appearing'; animStartTime.current = Date.now(); } };
    const handlePath = (data: any) => {
      if (data.id !== location.id || !Array.isArray(data.waypoints)) return;
      waypointTimers.current.forEach(clearTimeout);
      waypointTimers.current = [];
      isAnimatingPath.current = true;
      const interval = 80;
      data.waypoints.forEach((wp: { x: number; z: number }, i: number) => {
        const t = setTimeout(() => {
          localPos.current = { x: wp.x, z: wp.z };
          if (i === data.waypoints.length - 1) isAnimatingPath.current = false;
        }, i * interval);
        waypointTimers.current.push(t);
      });
    };
    socket.on('rhombusFading', handleFade);
    socket.on('rhombusAppearing', handleAppear);
    socket.on('rhombusPath', handlePath);
    return () => {
      socket.off('rhombusFading', handleFade);
      socket.off('rhombusAppearing', handleAppear);
      socket.off('rhombusPath', handlePath);
      waypointTimers.current.forEach(clearTimeout);
      isAnimatingPath.current = false;
    };
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
    isOnlineRef.current = isOnline;
    const animState = animStateRef.current;
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
          if (progress >= 1) { animStateRef.current = 'none'; baseOpacity = 0; scaleMult = 0.001; }
        } else if (animState === 'appearing') {
          baseOpacity = 0.8 * Math.pow(progress, 2);
          if (progress < 0.5) flicker = Math.random() > 0.5 ? 1.2 : 0.2;
          rotationSpeed = 20 * (1 - progress) + 1.0;
          scaleMult = (progress > 0.8 ? 1.0 + (1 - progress) * 2 : (1.4 * progress / 0.8));
          if (progress >= 1) { animStateRef.current = 'none'; baseOpacity = 0.8; scaleMult = 1.0; }
        }
    } else {
        // Standard online state (if not animating)
        baseOpacity = isOnline ? 0.8 : 0;
        scaleMult = isOnline ? 1.0 : 0.001;
    }

    const zoomComp = Math.max(1, d / 100); 
    const battleMapScale = isBattleMap ? 2.8 : 1;
    const finalScaleMult = scaleMult * zoomComp * battleMapScale;

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
      if (measureMode) return;
      e.stopPropagation();
    dragDist.current = 0;

    // Only allow dragging if the user has management rights (Owner or Admin)
    if (!canManage) return;

    pathPoints.current = [{ x: localPos.current.x, z: localPos.current.z }];
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
    if (measureMode) return;
    if (!canManage || e.buttons !== 1) return;
    dragDist.current += Math.abs(e.movementX) + Math.abs(e.movementY);
    const currentRaycaster = e.raycaster || raycaster;
    if (currentRaycaster && currentRaycaster.ray) {
        currentRaycaster.ray.intersectPlane(plane, intersection);
        const targetX = intersection.x + dragOffset.x;
        const targetZ = intersection.z + dragOffset.z;
        localPos.current = { x: targetX, z: targetZ };
        pathPoints.current.push({ x: targetX, z: targetZ });
    }
  };

  const handlePointerUp = async (e: any) => {
      if (measureMode) return;
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    if (controls) (controls as any).enabled = true;
    setIsLocalDragging(false);
    setIsDragging(false);

    // EVERYONE can open the info window with a click
    if (dragDist.current < 15) {
        e.stopPropagation();
        onClick(); // Stationary click -> open info window
    } else if (canManage) {
        const pts = pathPoints.current;
        const waypoints = Array.from({ length: 30 }, (_, i) => {
          const idx = Math.round(i * (pts.length - 1) / 29);
          return pts[idx];
        });
        socket.emit('moveRhombusPath', { id: location.id, waypoints });
    }
  };

  let baseColor = location.color || "#0c2b0c";
  if (location.district_color) baseColor = location.district_color;

  return (
    <group 
        ref={(group) => { 
            groupRef.current = group as any;
            if (group) {
                if (group.position) group.position.copy(visualPos.current);
            }
            if (isSelected && group) { setTargetObject(group); } 
        }}
    >
      <mesh 
          ref={meshRef as any}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerOver={(e) => { e.stopPropagation(); setIsHovered(true); }}
          onPointerOut={(e) => { e.stopPropagation(); setIsHovered(false); }}
      >
        <octahedronGeometry args={[0.5]} />
        <meshBasicMaterial transparent opacity={0.8} color={isSelected ? "#00ffff" : baseColor} />
        {/* Solid Inner Core */}
        <mesh scale={[0.4, 0.4, 0.4]}>
          <octahedronGeometry args={[0.5]} />
          <meshBasicMaterial color={isSelected ? "#ffffff" : baseColor} />
        </mesh>
      </mesh>

      {isOnline && streamerVis.showHealthBars && (
          <HealthBar hpCurrent={location.hp_current} hpMax={location.hp_max} hpTemp={location.hp_temp} position={[0, 0, 0]} isBattleMap={isBattleMap} />
      )}

      {location.name && (isHovered || isSelected || (IS_SPECTATOR && streamerVis.showPlayerNames && streamerHovered)) && (
          <Html position={[0, isBattleMap ? 2.5 : ((location.height * 0.8) + 3), 0]} center zIndexRange={[100, 0]} occlude style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,0.7)', border: `1px solid ${baseColor}`, padding: '2px 6px', fontSize: '10px', color: '#fff', whiteSpace: 'nowrap', textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '1px' }}>
                {location.name}
            </div>
          </Html>
      )}

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

export const OverlapChecker = React.memo(({ locations, setOverlapIds }: any) => {
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
