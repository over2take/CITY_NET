import React, { useMemo, useContext } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '../theme/themes';

const SIDEWALK_WIDTH = 1.5;
const SIDEWALK_Y = 0.02;

const NO_SIDEWALK_SHAPES = new Set(['rhombus', 'enemy_rhombus', 'friendly_rhombus', 'none']);

interface SidewalkLocation {
  id: number;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
  shape?: string;
  parent_id?: number | null;
  has_sidewalk?: number | null;
}

const ringGeometry = (w: number, d: number, sw: number): THREE.ShapeGeometry => {
  const hw = w / 2 + sw, hd = d / 2 + sw;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo( hw, -hd);
  shape.lineTo( hw,  hd);
  shape.lineTo(-hw,  hd);
  shape.lineTo(-hw, -hd);
  const hole = new THREE.Path();
  hole.moveTo(-w / 2, -d / 2);
  hole.lineTo( w / 2, -d / 2);
  hole.lineTo( w / 2,  d / 2);
  hole.lineTo(-w / 2,  d / 2);
  hole.lineTo(-w / 2, -d / 2);
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
};

export const Sidewalks = React.memo(({ locations }: { locations: SidewalkLocation[] }) => {
  const theme = useContext(ThemeContext);

  const sidewalks = useMemo(() => {
    return (locations || []).filter(
      loc => !loc.parent_id &&
             !NO_SIDEWALK_SHAPES.has(loc.shape ?? '') &&
             (loc.has_sidewalk ?? 1) === 1
    );
  }, [locations]);

  if (sidewalks.length === 0) return null;

  return (
    <group>
      {sidewalks.map(loc => (
        <mesh
          key={loc.id}
          geometry={ringGeometry(loc.width, loc.depth, SIDEWALK_WIDTH)}
          position={[loc.x, SIDEWALK_Y, loc.z]}
          rotation={[-Math.PI / 2, 0, loc.rotation ?? 0]}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={theme.border}
            transparent
            opacity={0.45}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
});
