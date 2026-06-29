import React, { useState, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { BattleMapSessionData, MeasurementData } from '../types';

interface MeasurementToolProps {
  measureMode: boolean;
  socket: any;
  view: string;
  activeBattleMapData: BattleMapSessionData | null;
  mapScaleMultiplier: string | number;
  color: string;
  userName: string;
}

function resolveScale(mapScaleMultiplier: string | number, floorIndex: number): number {
  if (typeof mapScaleMultiplier === 'string' && mapScaleMultiplier.startsWith('[')) {
    try {
      const arr = JSON.parse(mapScaleMultiplier);
      return arr[floorIndex] ?? arr[0] ?? 5;
    } catch { return 5; }
  }
  return parseFloat(String(mapScaleMultiplier)) || 5;
}

export function MeasurementTool({ measureMode, socket, view, activeBattleMapData, mapScaleMultiplier, color, userName }: MeasurementToolProps) {
  const { raycaster, camera, scene, pointer, gl } = useThree();
  const [startPoint, setStartPoint] = useState<THREE.Vector3 | null>(null);
  const [currentPoint, setCurrentPoint] = useState<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (!measureMode) { setStartPoint(null); setCurrentPoint(null); return; }

    const domElement = gl.domElement;
    const getHitPoint = () => {
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(scene.children, true).filter((hit: any) => hit.object.visible);
      if (intersects.length > 0) return intersects[0].point;
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, target)) return target;
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = getHitPoint();
      if (hit) setStartPoint(hit);
    };

    let lastEmit = 0;
    const onPointerMove = () => {
      if (!startPoint) return;
      const hit = getHitPoint();
      if (!hit) return;
      setCurrentPoint(hit);
      const now = Date.now();
      if (socket && now - lastEmit > 50) {
        lastEmit = now;
        socket.emit('drawMeasurement', {
          start: { x: startPoint.x, z: startPoint.z },
          end: { x: hit.x, z: hit.z },
          color, owner: userName, map_scale_multiplier: mapScaleMultiplier,
          view, locationId: activeBattleMapData?.locationId,
        });
      }
    };

    const onPointerUp = () => {
      if (startPoint && currentPoint && socket) {
        socket.emit('drawMeasurement', {
          start: { x: startPoint.x, z: startPoint.z },
          end: { x: currentPoint.x, z: currentPoint.z },
          color, owner: userName, map_scale_multiplier: mapScaleMultiplier,
          view, locationId: activeBattleMapData?.locationId, isFinal: true,
        });
      }
      setStartPoint(null);
      setCurrentPoint(null);
    };

    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [measureMode, pointer, camera, scene, startPoint, currentPoint, socket, color, userName, mapScaleMultiplier, view, activeBattleMapData]);

  if (!startPoint || !currentPoint) return null;

  const floorIndex = activeBattleMapData?.currentFloorIndex ?? 0;
  const scaleNum = resolveScale(mapScaleMultiplier, floorIndex);
  const distance = Math.sqrt((currentPoint.x - startPoint.x) ** 2 + (currentPoint.z - startPoint.z) ** 2) * scaleNum;
  const midPoint = new THREE.Vector3((startPoint.x + currentPoint.x) / 2, 0.2, (startPoint.z + currentPoint.z) / 2);

  return (
    <group>
      <Line points={[new THREE.Vector3(startPoint.x, 0.2, startPoint.z), new THREE.Vector3(currentPoint.x, 0.2, currentPoint.z)]} color={color} lineWidth={3} />
      <Html position={midPoint} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{ background: 'rgba(0,0,0,0.8)', color, padding: '2px 6px', borderRadius: '4px', border: `1px solid ${color}`, fontWeight: 'bold', fontSize: '14px', whiteSpace: 'nowrap', textShadow: '1px 1px 0 #000' }}>
          {distance.toFixed(1)} ft
        </div>
      </Html>
    </group>
  );
}

interface MeasurementVisualizerProps {
  socket: any;
  view: string;
  activeBattleMapData: BattleMapSessionData | null;
  userName: string;
}

export function MeasurementVisualizer({ socket, view, activeBattleMapData, userName }: MeasurementVisualizerProps) {
  const [measurements, setMeasurements] = useState<MeasurementData[]>([]);

  useEffect(() => {
    if (!socket) return;
    const handleMeasurement = (data: any) => {
      if (data.owner === userName && !data.isFinal) return;
      if (data.view !== view) return;
      if (view === 'battle_map' && data.locationId !== activeBattleMapData?.locationId) return;
      setMeasurements(prev => [...prev.filter(m => m.owner !== data.owner), { ...data, timestamp: Date.now() }]);
    };
    socket.on('measurementUpdated', handleMeasurement);
    return () => socket.off('measurementUpdated', handleMeasurement);
  }, [socket, view, activeBattleMapData, userName]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMeasurements(prev => prev.filter(m => now - m.timestamp < 5000));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {measurements.map(m => {
        const floorIndex = activeBattleMapData?.currentFloorIndex ?? 0;
        const scaleNum = resolveScale(m.map_scale_multiplier, floorIndex);
        const distance = Math.sqrt((m.end.x - m.start.x) ** 2 + (m.end.z - m.start.z) ** 2) * scaleNum;
        const midPoint = new THREE.Vector3((m.start.x + m.end.x) / 2, 0.2, (m.start.z + m.end.z) / 2);
        return (
          <group key={m.owner}>
            <Line points={[new THREE.Vector3(m.start.x, 0.2, m.start.z), new THREE.Vector3(m.end.x, 0.2, m.end.z)]} color={m.color} lineWidth={3} />
            <Html position={midPoint} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <div style={{ background: 'rgba(0,0,0,0.8)', color: m.color, padding: '2px 6px', borderRadius: '4px', border: `1px solid ${m.color}`, fontWeight: 'bold', fontSize: '14px', whiteSpace: 'nowrap', textShadow: '1px 1px 0 #000' }}>
                {distance.toFixed(1)} ft
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
