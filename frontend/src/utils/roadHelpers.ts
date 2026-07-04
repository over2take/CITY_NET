import * as THREE from 'three';

export interface RoadSegment {
  x1: number; z1: number;
  x2: number; z2: number;
  width?: number;
  [key: string]: any;
}

/**
 * Chain individual road segments into continuous polylines by walking shared
 * endpoints. Cars can then travel whole streets instead of fading at every
 * consolidated segment. Junctions (3+ ways) and dead ends break chains.
 */
export const chainRoadPolylines = (
  segments: RoadSegment[],
  tol = 0.5
): Array<{ points: { x: number; z: number }[]; width: number }> => {
  const key = (x: number, z: number) => `${Math.round(x / tol)},${Math.round(z / tol)}`;
  const nodeMap = new Map<string, Array<{ seg: number; end: 0 | 1 }>>();
  segments.forEach((s, i) => {
    const k0 = key(s.x1, s.z1), k1 = key(s.x2, s.z2);
    if (!nodeMap.has(k0)) nodeMap.set(k0, []);
    if (!nodeMap.has(k1)) nodeMap.set(k1, []);
    nodeMap.get(k0)!.push({ seg: i, end: 0 });
    nodeMap.get(k1)!.push({ seg: i, end: 1 });
  });

  const visited = new Set<number>();
  const routes: Array<{ points: { x: number; z: number }[]; width: number }> = [];

  // Follow the chain from segment `segIdx` leaving through endpoint `exitEnd`.
  const walk = (segIdx: number, exitEnd: 0 | 1): { x: number; z: number }[] => {
    const pts: { x: number; z: number }[] = [];
    let cur = segIdx, exit = exitEnd;
    for (;;) {
      const s = segments[cur];
      const px = exit === 1 ? s.x2 : s.x1;
      const pz = exit === 1 ? s.z2 : s.z1;
      pts.push({ x: px, z: pz });
      const conns = (nodeMap.get(key(px, pz)) || []).filter(c => c.seg !== cur && !visited.has(c.seg));
      const degree = (nodeMap.get(key(px, pz)) || []).length;
      if (degree !== 2 || conns.length !== 1) break; // junction, dead end, or already consumed
      cur = conns[0].seg;
      visited.add(cur);
      exit = conns[0].end === 0 ? 1 : 0; // entered via one end, leave via the other
    }
    return pts;
  };

  segments.forEach((s, i) => {
    if (visited.has(i)) return;
    visited.add(i);
    const backward = walk(i, 0).reverse();
    const forward = walk(i, 1);
    routes.push({ points: [...backward, ...forward], width: s.width ?? 4 });
  });

  return routes.filter(r => r.points.length >= 2);
};

export const consolidateRoads = (newSegments: RoadSegment[], existingRoads: RoadSegment[], snapDist = 6): RoadSegment[] => {
  const points: THREE.Vector3[] = [];
  newSegments.forEach(s => { points.push(new THREE.Vector3(s.x1, 0, s.z1), new THREE.Vector3(s.x2, 0, s.z2)); });

  // Snap to existing nodes OR project onto existing segments
  points.forEach(p => {
    let bestDist = snapDist;
    let snapTarget: THREE.Vector3 | null = null;

    for (const r of existingRoads) {
      const p1 = new THREE.Vector3(r.x1, 0, r.z1);
      const p2 = new THREE.Vector3(r.x2, 0, r.z2);

      const d1 = p.distanceTo(p1);
      const d2 = p.distanceTo(p2);
      if (d1 < bestDist) { bestDist = d1; snapTarget = p1; }
      if (d2 < bestDist) { bestDist = d2; snapTarget = p2; }

      const line = new THREE.Line3(p1, p2);
      const closest = new THREE.Vector3();
      line.closestPointToPoint(p, true, closest);
      const dLine = p.distanceTo(closest);
      if (dLine < bestDist) { bestDist = dLine; snapTarget = closest; }
    }
    if (snapTarget) p.copy(snapTarget);
  });

  // Snap new points to each other
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[i].distanceTo(points[j]) < snapDist) points[j].copy(points[i]);
    }
  }

  return newSegments.map((s, i) => ({
    ...s,
    x1: points[i * 2].x, z1: points[i * 2].z,
    x2: points[i * 2 + 1].x, z2: points[i * 2 + 1].z,
  })).filter(s => new THREE.Vector3(s.x1, 0, s.z1).distanceTo(new THREE.Vector3(s.x2, 0, s.z2)) > 0.5);
};
