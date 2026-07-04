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

interface SidewalkEntry {
  id: number;
  cx: number; cz: number;
  w: number; d: number;
  rotation: number;
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

const compoundBounds = (root: SidewalkLocation, children: SidewalkLocation[]) => {
  const parts = [root, ...children];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.x - p.width / 2);
    maxX = Math.max(maxX, p.x + p.width / 2);
    minZ = Math.min(minZ, p.z - p.depth / 2);
    maxZ = Math.max(maxZ, p.z + p.depth / 2);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
};

export const Sidewalks = React.memo(({ locations }: { locations: SidewalkLocation[] }) => {
  const theme = useContext(ThemeContext);

  const sidewalks = useMemo((): SidewalkEntry[] => {
    const all = locations || [];
    const childrenByParent = new Map<number, SidewalkLocation[]>();
    for (const loc of all) {
      if (loc.parent_id) {
        const arr = childrenByParent.get(loc.parent_id) ?? [];
        arr.push(loc);
        childrenByParent.set(loc.parent_id, arr);
      }
    }
    return all
      .filter(loc =>
        !loc.parent_id &&
        !NO_SIDEWALK_SHAPES.has(loc.shape ?? '') &&
        (loc.has_sidewalk ?? 1) === 1
      )
      .map(loc => ({
        id: loc.id,
        ...compoundBounds(loc, childrenByParent.get(loc.id) ?? []),
        rotation: loc.rotation ?? 0,
      }));
  }, [locations]);

  if (sidewalks.length === 0) return null;

  return (
    <group>
      {sidewalks.map(s => (
        <mesh
          key={s.id}
          geometry={ringGeometry(s.w, s.d, SIDEWALK_WIDTH)}
          position={[s.cx, SIDEWALK_Y, s.cz]}
          rotation={[-Math.PI / 2, 0, s.rotation]}
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
