import React, { useEffect, useState } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { OrthographicCamera } from '@react-three/drei';

export const BattleMapScene = ({ mapUrl, onFloorChange, floors, isAdmin, activeFloorIndex, onExit }: any) => {
  const textureObj = useLoader(THREE.TextureLoader, mapUrl);
  const texture = (Array.isArray(textureObj) ? textureObj[0] : textureObj) as THREE.Texture;
  
  // Calculate aspect ratio to fit nicely
  const image = texture.image as any;
  const aspect = image ? image.width / image.height : 1;
  const mapWidth = 200 * aspect;
  const mapHeight = 200;

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 10, 0]} zoom={4} near={0.1} far={1000} />
      <ambientLight intensity={1} />
      
      {/* Map Background */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[mapWidth, mapHeight]} />
        <meshBasicMaterial map={texture} />
      </mesh>

      {/* Grid Helper for visual scale (optional) */}
      <gridHelper args={[Math.max(mapWidth, mapHeight), 20, 0x00ff00, 0x003300]} position={[0, 0.01, 0]} />
    </>
  );
};
