import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { ThemeContext } from '../theme/themes';
import { renderBaseGeometry } from '../utils/threeHelpers';
import { buildingParts } from '../utils/buildingParts';
import { CityNetIcon } from './CityNetIcon';

// The picture in the top left of a building's info window.
//
// Three answers, best first:
//   1. the photo the GM uploaded, which everyone sees;
//   2. the building itself, drawn from its own parts and turning slowly, the same wireframe
//      the city draws;
//   3. the CITY_NET badge, for a machine that cannot draw in 3D.
//
// The render is its own small canvas rather than a view into the city's, which would mean a
// second camera on a scene full of everything else. It draws a handful of wireframe parts,
// so the cost is a second WebGL context - which the dice tray already pays the same way.

/** Whether this browser can draw WebGL at all. Asked once; a failed context stays failed. */
let webglAnswer: boolean | null = null;
export const canRender3d = (): boolean => {
  if (webglAnswer !== null) return webglAnswer;
  try {
    const c = document.createElement('canvas');
    webglAnswer = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webglAnswer = false;
  }
  return webglAnswer;
};

/** For tests: forget the answer so the next call asks again. */
export const resetRender3dCheck = () => { webglAnswer = null; };

interface Props {
  location: any;
  /** The building's other parts - locations whose parent is this one. */
  parts?: any[];
  width?: number;
  height?: number;
}

/** The building, turning. Scaled so its longest side fills most of the view. */
function Spinning({ location, parts, color }: { location: any; parts: any[]; color: string }) {
  const group = useRef<THREE.Group>(null);
  const built = useMemo(() => buildingParts(location, parts), [location, parts]);
  // A slow turn: a full circle in about twenty seconds reads as alive without drawing the
  // eye away from the text beside it.
  useFrame((_, delta) => { if (group.current) group.current.rotation.y += delta * 0.3; });

  // Leaves a margin all round, so a building turning its long side to the camera still fits.
  const fit = 2.1 / built.size;
  return (
    <group ref={group} scale={[fit, fit, fit]}>
      <group position={[-built.center[0], -built.center[1], -built.center[2]]}>
        {built.parts.map((p) => (
          <mesh key={p.key} position={p.position} rotation={new THREE.Euler(...p.rotation, 'YXZ')} scale={p.scale}>
            {renderBaseGeometry(p.shape, p.polyCount)}
            <meshBasicMaterial color={color} wireframe />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function BuildingPreview({ location, parts = [], width = 180, height = 150 }: Props) {
  const theme = useContext(ThemeContext);
  /**
   * The wireframe's color, read from the theme's CSS variable where the preview sits.
   *
   * Not from ThemeContext alone: the info windows render outside that provider in App, so
   * the context answers with its default and every theme drew the building in classic
   * green. The CSS variable is what the window's own borders and text use, so reading it
   * makes the building match them in all seven themes. The context stays as the fallback.
   */
  const frameRef = useRef<HTMLDivElement>(null);
  const [cssColor, setCssColor] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!frameRef.current) return;
    const v = getComputedStyle(frameRef.current).getPropertyValue('--green').trim();
    if (v && v !== cssColor) setCssColor(v);
  });
  /** Set when the photo fails to load, so a dead link falls through to the render. */
  const [photoFailed, setPhotoFailed] = useState<string | null>(null);
  const photo = location?.photo_url && photoFailed !== location.photo_url ? location.photo_url : null;

  const frame: React.CSSProperties = {
    width, height, flexShrink: 0, overflow: 'hidden', position: 'relative',
    border: '1px solid var(--green)', background: 'var(--black)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  if (photo) {
    return (
      <div style={frame} data-testid="building-preview" data-kind="photo">
        <img
          src={photo}
          alt={`${location.name || 'Building'} photo`}
          onError={() => setPhotoFailed(photo)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  if (!location || !canRender3d()) {
    return (
      <div style={frame} data-testid="building-preview" data-kind="icon">
        <CityNetIcon size={Math.min(width, height) - 16} />
      </div>
    );
  }

  return (
    <div ref={frameRef} style={frame} data-testid="building-preview" data-kind="render" aria-label={`${location.name || 'Building'}, turning`} role="img">
      {/* `flat`: no tone mapping, so the lines are the theme's color exactly rather than
          the washed-out version the default mapping makes of a bright unlit color. */}
      <Canvas
        flat
        camera={{ position: [0, 0.9, 4.6], fov: 40, near: 0.1, far: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <Spinning location={location} parts={parts} color={cssColor || theme.primary} />
      </Canvas>
    </div>
  );
}
