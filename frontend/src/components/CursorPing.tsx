import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { BattleMapSessionData } from '../types';

interface CursorPingListenerProps {
  socket: any;
  view: string;
  activeBattleMapData: BattleMapSessionData | null;
  pingColor: string;
}

export function CursorPingListener({ socket, view, activeBattleMapData, pingColor }: CursorPingListenerProps) {
  const { raycaster, camera, scene, pointer } = useThree();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'q' || !socket) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(scene.children, true).filter((hit: any) => hit.object.visible);

      let hitPoint: THREE.Vector3 | null = null;
      if (intersects.length > 0) {
        hitPoint = intersects[0].point;
      } else {
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, target)) hitPoint = target;
      }

      if (hitPoint) {
        socket.emit('ping_location', {
          x: hitPoint.x,
          y: hitPoint.y + 0.5,
          z: hitPoint.z,
          color: pingColor,
          size: 2,
          battle_map_id: view === 'battle_map' && activeBattleMapData ? activeBattleMapData.locationId : null,
          floor_index: view === 'battle_map' && activeBattleMapData && activeBattleMapData.currentFloorIndex !== undefined
            ? activeBattleMapData.currentFloorIndex : null,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [socket, view, activeBattleMapData, pingColor, raycaster, pointer, camera, scene]);

  return null;
}
