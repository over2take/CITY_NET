import React, { useMemo, useContext, useEffect } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '../theme/themes';
import { chainRoadPolylines } from '../utils/roadHelpers';

const SIDEWALK_WIDTH = 1.5;
const SIDEWALK_Y = 0.02;
const SEAM_SPACING = 3; // world units between pavement slab seams

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
  fill: THREE.ShapeGeometry;
  lines: THREE.BufferGeometry;
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

// Neon curb detail: outer + inner edge outlines, slab-seam ticks across the
// walkway, and diagonal seams at the four corners. Built as one LineSegments
// geometry per sidewalk in the same local XY space as the ring fill.
const curbLinesGeometry = (w: number, d: number, sw: number): THREE.BufferGeometry => {
  const pts: number[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) => pts.push(x1, y1, 0, x2, y2, 0);
  const hwI = w / 2, hdI = d / 2;
  const hwO = hwI + sw, hdO = hdI + sw;

  // outer edge loop
  seg(-hwO, -hdO,  hwO, -hdO); seg( hwO, -hdO,  hwO,  hdO);
  seg( hwO,  hdO, -hwO,  hdO); seg(-hwO,  hdO, -hwO, -hdO);
  // inner edge loop (against the building footprint)
  seg(-hwI, -hdI,  hwI, -hdI); seg( hwI, -hdI,  hwI,  hdI);
  seg( hwI,  hdI, -hwI,  hdI); seg(-hwI,  hdI, -hwI, -hdI);
  // slab seams across the top/bottom runs
  for (let x = -hwI + SEAM_SPACING / 2; x < hwI; x += SEAM_SPACING) {
    seg(x,  hdI, x,  hdO);
    seg(x, -hdI, x, -hdO);
  }
  // slab seams across the left/right runs
  for (let y = -hdI + SEAM_SPACING / 2; y < hdI; y += SEAM_SPACING) {
    seg( hwI, y,  hwO, y);
    seg(-hwI, y, -hwO, y);
  }
  // diagonal corner seams
  seg( hwI,  hdI,  hwO,  hdO); seg(-hwI,  hdI, -hwO,  hdO);
  seg( hwI, -hdI,  hwO, -hdO); seg(-hwI, -hdI, -hwO, -hdO);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
};

// Two real flanking strips per street — quad ribbons between the road edge and
// the outer curb on each side, mitered through bends. Nothing renders under the
// road itself, so the transparent road surface stays clean.
const buildFlankRibbons = (
  chains: Array<{ points: { x: number; z: number }[]; width: number }>,
  sw: number,
  miterLimit = 3
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];

  chains.forEach(chain => {
    const cps = chain.points;
    if (cps.length < 2) return;
    const halfRoad = chain.width / 2;

    const dirs: { x: number; z: number }[] = [];
    for (let i = 0; i < cps.length - 1; i++) {
      const dx = cps[i + 1].x - cps[i].x;
      const dz = cps[i + 1].z - cps[i].z;
      const len = Math.hypot(dx, dz) || 1;
      dirs.push({ x: dx / len, z: dz / len });
    }

    for (const side of [1, -1]) {
      const base = positions.length / 3;
      for (let i = 0; i < cps.length; i++) {
        const dPrev = dirs[Math.max(0, i - 1)];
        const dNext = dirs[Math.min(dirs.length - 1, i)];
        let mx = dPrev.x + dNext.x, mz = dPrev.z + dNext.z;
        const mLen = Math.hypot(mx, mz);
        if (mLen < 1e-6) { mx = dNext.x; mz = dNext.z; } else { mx /= mLen; mz /= mLen; }
        const nx = -mz * side, nz = mx * side;
        const cosHalf = mx * dNext.x + mz * dNext.z;
        const miter = Math.min(miterLimit, 1 / Math.max(0.2, Math.abs(cosHalf)));
        positions.push(cps[i].x + nx * halfRoad * miter, 0, cps[i].z + nz * halfRoad * miter);
        positions.push(cps[i].x + nx * (halfRoad + sw) * miter, 0, cps[i].z + nz * (halfRoad + sw) * miter);
      }
      for (let i = 0; i < cps.length - 1; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
};

// Curb edge lines flanking a road: for each chained street, offset the
// centerline by ±(roadHalf) and ±(roadHalf + sw) using the same miter math as
// the ribbon, giving inner and outer curb outlines that follow bends.
const buildRoadCurbLines = (
  chains: Array<{ points: { x: number; z: number }[]; width: number }>,
  sw: number,
  miterLimit = 3
): THREE.BufferGeometry => {
  const pts: number[] = [];

  chains.forEach(chain => {
    const cps = chain.points;
    if (cps.length < 2) return;
    const halfRoad = chain.width / 2;

    const dirs: { x: number; z: number }[] = [];
    for (let i = 0; i < cps.length - 1; i++) {
      const dx = cps[i + 1].x - cps[i].x;
      const dz = cps[i + 1].z - cps[i].z;
      const len = Math.hypot(dx, dz) || 1;
      dirs.push({ x: dx / len, z: dz / len });
    }

    // offset polylines at the four curb lines
    const offsets = [halfRoad, halfRoad + sw, -halfRoad, -(halfRoad + sw)];
    const lines: number[][][] = offsets.map(() => []);

    for (let i = 0; i < cps.length; i++) {
      const dPrev = dirs[Math.max(0, i - 1)];
      const dNext = dirs[Math.min(dirs.length - 1, i)];
      let mx = dPrev.x + dNext.x, mz = dPrev.z + dNext.z;
      const mLen = Math.hypot(mx, mz);
      if (mLen < 1e-6) { mx = dNext.x; mz = dNext.z; } else { mx /= mLen; mz /= mLen; }
      const nx = -mz, nz = mx;
      const cosHalf = mx * dNext.x + mz * dNext.z;
      const miter = Math.min(miterLimit, 1 / Math.max(0.2, Math.abs(cosHalf)));
      offsets.forEach((off, oi) => {
        lines[oi].push([cps[i].x + nx * off * miter, cps[i].z + nz * off * miter]);
      });
    }

    lines.forEach(line => {
      for (let i = 0; i < line.length - 1; i++) {
        pts.push(line[i][0], 0, line[i][1], line[i + 1][0], 0, line[i + 1][1]);
      }
    });

    // Slab-seam ticks: walk each segment by arclength and drop a perpendicular
    // tick across both flanking strips every SEAM_SPACING units
    for (let i = 0; i < cps.length - 1; i++) {
      const segLen = Math.hypot(cps[i + 1].x - cps[i].x, cps[i + 1].z - cps[i].z);
      const d = dirs[i];
      const nx = -d.z, nz = d.x;
      for (let t = SEAM_SPACING / 2; t < segLen; t += SEAM_SPACING) {
        const px = cps[i].x + d.x * t;
        const pz = cps[i].z + d.z * t;
        pts.push(
          px + nx * halfRoad, 0, pz + nz * halfRoad,
          px + nx * (halfRoad + sw), 0, pz + nz * (halfRoad + sw),
        );
        pts.push(
          px - nx * halfRoad, 0, pz - nz * halfRoad,
          px - nx * (halfRoad + sw), 0, pz - nz * (halfRoad + sw),
        );
      }
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
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

export const Sidewalks = React.memo(({ locations, roads = [] }: { locations: SidewalkLocation[]; roads?: any[] }) => {
  const theme = useContext(ThemeContext);

  // Road-flanking sidewalks: a ribbon slightly wider than the road, rendered
  // just below it (road base sits at y=0.05) so the road covers the middle and
  // only the two flanking strips show. Curb lines trace both edges.
  const roadWalk = useMemo(() => {
    if (!roads?.length) return null;
    const chains = chainRoadPolylines(roads);
    return {
      fill: buildFlankRibbons(chains, SIDEWALK_WIDTH),
      curbs: buildRoadCurbLines(chains, SIDEWALK_WIDTH),
    };
  }, [roads]);

  useEffect(() => () => {
    if (roadWalk) { roadWalk.fill.dispose(); roadWalk.curbs.dispose(); }
  }, [roadWalk]);

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
      .map(loc => {
        const b = compoundBounds(loc, childrenByParent.get(loc.id) ?? []);
        return {
          id: loc.id,
          ...b,
          rotation: loc.rotation ?? 0,
          fill: ringGeometry(b.w, b.d, SIDEWALK_WIDTH),
          lines: curbLinesGeometry(b.w, b.d, SIDEWALK_WIDTH),
        };
      });
  }, [locations]);

  if (!roadWalk) return null;

  return (
    <group>
      {roadWalk && (
        <group>
          <mesh geometry={roadWalk.fill} position={[0, 0.03, 0]} raycast={() => null} frustumCulled={false}>
            <meshBasicMaterial color={theme.border} transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <lineSegments geometry={roadWalk.curbs} position={[0, 0.035, 0]} raycast={() => null} frustumCulled={false}>
            <lineBasicMaterial color={theme.primary} transparent opacity={0.55} depthWrite={false} />
          </lineSegments>
        </group>
      )}
    </group>
  );
});
