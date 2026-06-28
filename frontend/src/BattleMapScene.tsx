import React, { useEffect, useState } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { OrthographicCamera, MapControls } from '@react-three/drei';

export const BattleMapScene = ({ mapUrl, onFloorChange, floors, isAdmin, activeFloorIndex, onExit, onMapClick, measureMode }: any) => {
  const textureObj = useLoader(THREE.TextureLoader, mapUrl);
  const texture = (Array.isArray(textureObj) ? textureObj[0] : textureObj) as THREE.Texture;
  
  // Calculate aspect ratio to fit nicely
  const image = texture.image as any;
  const aspect = image ? image.width / image.height : 1;
  const mapWidth = 200 * aspect;
  const mapHeight = 200;

  const controlsRef = React.useRef<any>(null);
  useEffect(() => {
      if (controlsRef.current) {
          controlsRef.current.enabled = !measureMode;
          controlsRef.current.enablePan = !measureMode;
          controlsRef.current.enableZoom = !measureMode;
      }
  }, [measureMode]);

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 100, 0]} up={[0, 0, -1]} zoom={2} near={0.1} far={1000} />
      <MapControls ref={controlsRef} makeDefault enableRotate={false} minZoom={0.5} maxZoom={20} enabled={!measureMode} />
      <ambientLight intensity={1} />
      
      {/* Map Background */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={(e) => {
        if (e.button === 0 && typeof onMapClick === 'function') {
          e.stopPropagation();
          onMapClick(e.point);
        }
      }}>
        <planeGeometry args={[mapWidth, mapHeight]} />
        <meshBasicMaterial map={texture} />
      </mesh>

      {/* Removed gridHelper per user request */}
    </>
  );
};
