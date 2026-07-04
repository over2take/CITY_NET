import * as THREE from 'three';

export interface RoadSegment {
  x1: number; z1: number;
  x2: number; z2: number;
  width?: number;
  [key: string]: any;
}

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
