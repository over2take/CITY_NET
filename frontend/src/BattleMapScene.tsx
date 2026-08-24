import React, { useEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import { IS_SPECTATOR } from './streamerMode';
import { isVideoMap } from './battleMapMedia';
import { useVideoMapTexture } from './hooks/useVideoMapTexture';

// The two kinds of map are separate components rather than one with a branch in it,
// because `useLoader` suspends and the video path must not — there is no Suspense
// boundary above this, so a still map that is still loading and a loop that has not
// started yet cannot be handled the same way. Hooks also cannot be called conditionally,
// which settles it.

const MapPlane = ({ texture, aspect, onMapClick }: any) => {
  const mapHeight = 200;
  const mapWidth = mapHeight * aspect;
  return (
    <mesh
      position={[0, 0, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(e: any) => {
        if (e.button === 0 && typeof onMapClick === 'function') {
          e.stopPropagation();
          onMapClick(e.point);
        }
      }}
    >
      <planeGeometry args={[mapWidth, mapHeight]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
};

/** A still map. Unchanged: this is the path every existing map takes. */
const ImageMapPlane = ({ mapUrl, onMapClick }: any) => {
  const textureObj = useLoader(THREE.TextureLoader, mapUrl);
  const texture = (Array.isArray(textureObj) ? textureObj[0] : textureObj) as THREE.Texture;
  const image = texture.image as any;
  const aspect = image && image.height ? image.width / image.height : 1;
  return <MapPlane texture={texture} aspect={aspect} onMapClick={onMapClick} />;
};

/** An animated map. Nothing is drawn until the loop has a texture to draw. */
const VideoMapPlane = ({ mapUrl, onMapClick }: any) => {
  const { texture, aspect } = useVideoMapTexture(mapUrl);
  if (!texture) return null;
  return <MapPlane texture={texture} aspect={aspect} onMapClick={onMapClick} />;
};

export const BattleMapScene = ({ mapUrl, onFloorChange, floors, isAdmin, activeFloorIndex, onExit, onMapClick, measureMode }: any) => {
  const controlsRef = React.useRef<any>(null);
  useEffect(() => {
      if (controlsRef.current) {
          controlsRef.current.enabled = !measureMode && !IS_SPECTATOR;
          controlsRef.current.enablePan = !measureMode && !IS_SPECTATOR;
          controlsRef.current.enableZoom = !measureMode && !IS_SPECTATOR;
      }
  }, [measureMode]);

  const Plane = isVideoMap(mapUrl) ? VideoMapPlane : ImageMapPlane;

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 100, 0]} up={[0, 0, -1]} zoom={2} near={0.1} far={1000} />
      <MapControls ref={controlsRef} makeDefault enableRotate={false} minZoom={0.5} maxZoom={20} enabled={!measureMode && !IS_SPECTATOR} />
      <ambientLight intensity={1} />

      {/* Map Background */}
      <Plane mapUrl={mapUrl} onMapClick={onMapClick} />
    </>
  );
};
