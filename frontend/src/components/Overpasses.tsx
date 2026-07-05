import React, { useEffect, useMemo, useRef, useContext } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { buildOverpassGeometry, parseOverpassPoints } from '../utils/overpassHelpers';
import type { DeckTile, OverpassPillar, OverpassPoint } from '../utils/overpassHelpers';
import { ThemeContext } from '../theme/themes';

const DECK_THICKNESS = 0.5;

interface OverpassRow {
  id: number;
  points: string | OverpassPoint[]; // JSON array of {x, z}
  height: number;
  width: number;
  ramp_length: number;
  ramp_length_start?: number | null;
  ramp_length_end?: number | null;
  pillar_spacing: number;
}

const parsePoints = parseOverpassPoints;

/** Set an instance matrix for one deck tile (Euler 'YZX': pitch in the local frame, then yaw). */
const applyTileMatrix = (obj: THREE.Object3D, t: DeckTile, width: number) => {
  obj.position.set(t.x, t.y, t.z);
  obj.rotation.set(0, t.yaw, t.pitch, 'YZX');
  obj.scale.set(t.length, DECK_THICKNESS, width);
  obj.updateMatrix();
};

const applyPillarMatrix = (obj: THREE.Object3D, p: OverpassPillar) => {
  obj.position.set(p.x, p.height / 2, p.z);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, p.height, 1);
  obj.updateMatrix();
};

/** Saved overpasses from the DB, rendered as instanced decks + pillars. */
export const Overpasses = React.memo(({ overpasses, roads }: { overpasses: OverpassRow[]; roads: any[] }) => {
  const theme = useContext(ThemeContext);
  const deckRef = useRef<THREE.InstancedMesh>(null);
  const edgeRef = useRef<THREE.InstancedMesh>(null);
  const pillarRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    const tiles: Array<DeckTile & { width: number }> = [];
    const pillars: OverpassPillar[] = [];
    const allParsed = (overpasses || []).map(o => ({ points: parsePoints(o.points), width: o.width || 4 }));
    (overpasses || []).forEach((o, idx) => {
      const pts = allParsed[idx].points;
      if (pts.length < 2) return;
      const otherOverpasses = allParsed.filter((_, i) => i !== idx);
      const g = buildOverpassGeometry(pts, {
        height: o.height, width: o.width,
        rampLength: o.ramp_length,
        rampLengthStart: o.ramp_length_start ?? undefined,
        rampLengthEnd: o.ramp_length_end ?? undefined,
        pillarSpacing: o.pillar_spacing,
      }, roads || [], { otherOverpasses });
      g.tiles.forEach(t => tiles.push({ ...t, width: o.width }));
      pillars.push(...g.pillars);
    });
    return { tiles, pillars };
  }, [overpasses, roads]);

  useFrame((state) => {
    if (edgeRef.current?.material) {
      (edgeRef.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(state.clock.elapsedTime * 1.5) * 0.3;
    }
  });

  useEffect(() => {
    const tmp = new THREE.Object3D();
    if (deckRef.current?.setMatrixAt) {
      geometry.tiles.forEach((t, i) => { applyTileMatrix(tmp, t, t.width); deckRef.current!.setMatrixAt(i, tmp.matrix); });
      deckRef.current.count = geometry.tiles.length;
      deckRef.current.instanceMatrix.needsUpdate = true;
    }
    if (edgeRef.current?.setMatrixAt) {
      geometry.tiles.forEach((t, i) => {
        // Thin glowing strip riding on top of each deck tile
        tmp.position.set(t.x, t.y + DECK_THICKNESS / 2 + 0.02, t.z);
        tmp.rotation.set(0, t.yaw, t.pitch, 'YZX');
        tmp.scale.set(t.length, 0.04, t.width * 0.12);
        tmp.updateMatrix();
        edgeRef.current!.setMatrixAt(i, tmp.matrix);
      });
      edgeRef.current.count = geometry.tiles.length;
      edgeRef.current.instanceMatrix.needsUpdate = true;
    }
    if (pillarRef.current?.setMatrixAt) {
      geometry.pillars.forEach((p, i) => { applyPillarMatrix(tmp, p); pillarRef.current!.setMatrixAt(i, tmp.matrix); });
      pillarRef.current.count = geometry.pillars.length;
      pillarRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [geometry]);

  // Fixed buffer size — instancedMesh allocates its WebGL buffer at mount and
  // cannot grow. Map switches recompute geometry but keep the same mesh alive,
  // so we need headroom for the largest overpass set any map could have.
  const MAX_TILES = 2000;
  const MAX_PILLARS = 500;

  if (geometry.tiles.length === 0) return null;

  return (
    <group>
      <instancedMesh ref={deckRef} args={[null as any, null as any, MAX_TILES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={theme.border} transparent opacity={0.7} />
      </instancedMesh>
      <instancedMesh ref={edgeRef} args={[null as any, null as any, MAX_TILES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={theme.highlight} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={pillarRef} args={[null as any, null as any, MAX_PILLARS]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.8, 1, 8]} />
        <meshBasicMaterial color={theme.border} transparent opacity={0.7} />
      </instancedMesh>
    </group>
  );
});

/**
 * Semi-transparent ghost of the overpass being drawn in DRAW_ROADS.
 * Recomputes live as the trail, HEIGHT, or RAMP_LENGTH change.
 */
export const OverpassPreview = React.memo(({ trail, height, width, rampLength, rampLengthStart, rampLengthEnd, pillarSpacing = 12, roads }: {
  trail: THREE.Vector3[][];
  height: number;
  width: number;
  rampLength: number;
  rampLengthStart?: number;
  rampLengthEnd?: number;
  pillarSpacing?: number;
  roads: any[];
}) => {
  const theme = useContext(ThemeContext);
  const geometry = useMemo(() => {
    const tiles: DeckTile[] = [];
    const pillars: OverpassPillar[] = [];
    (trail || []).forEach(path => {
      if (!path || path.length < 2) return;
      const pts = path.map(p => ({ x: p.x, z: p.z }));
      const g = buildOverpassGeometry(pts, { height, width, rampLength, rampLengthStart, rampLengthEnd, pillarSpacing }, roads || []);
      tiles.push(...g.tiles);
      pillars.push(...g.pillars);
    });
    return { tiles, pillars };
  }, [trail, height, width, rampLength, rampLengthStart, rampLengthEnd, pillarSpacing, roads]);

  if (geometry.tiles.length === 0) return null;

  return (
    <group>
      {geometry.tiles.map((t, i) => (
        <mesh key={`t${i}`} position={[t.x, t.y, t.z]} rotation={new THREE.Euler(0, t.yaw, t.pitch, 'YZX')}>
          <boxGeometry args={[t.length, DECK_THICKNESS, width]} />
          <meshBasicMaterial color={theme.highlight} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
      {geometry.pillars.map((p, i) => (
        <mesh key={`p${i}`} position={[p.x, p.height / 2, p.z]}>
          <cylinderGeometry args={[0.5, 0.8, p.height, 8]} />
          <meshBasicMaterial color={theme.highlight} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
});
