import * as THREE from 'three';

// The tray's dice (6c4b2a; approved mockup docs/mockups/builder-dice.html, version 6): a solid of
// any number of faces, every one a face it can land on. A coin for 2; the usual solids for 4, 6,
// 8, 12 and 20; kites meeting at two points for any other even number; a long prism lying on a
// side for an odd one. Each face is where its middle is and which way it points, from the die's
// centre, so the tray can print on it and land the die with it up. Math only: nothing drawn here.

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A face of a die: its middle, and the way it points, out of the die. */
export interface FaceSpot { center: THREE.Vector3; normal: THREE.Vector3 }

export interface DieShape {
  geometry: THREE.BufferGeometry;
  /** Every face it can land on, face 0 the one the tray lands up. */
  faces: FaceSpot[];
  /** How wide the words printed on a face are. */
  label: number;
  /** Lands with face 0 down, as a d4 does, the number that came up on the three faces it shows. */
  down?: boolean;
  /** The ball the die fits in, for the walls and the other dice. */
  radius: number;
}

/** The middle of the points, and the way their plane faces, out from the die's centre. */
const faceOf = (pts: THREE.Vector3[]): FaceSpot => {
  const center = pts.reduce((s, p) => s.add(p), V(0, 0, 0)).multiplyScalar(1 / pts.length);
  const normal = V(0, 0, 0).subVectors(pts[1], pts[0]).cross(V(0, 0, 0).subVectors(pts[2], pts[0])).normalize();
  if (normal.dot(center) < 0) normal.negate();
  return { center, normal };
};

/** Each triangle wound to face outward, so the lights fall on its front. */
const outward = (tris: THREE.Vector3[]) => (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
  const n = V(0, 0, 0).subVectors(b, a).cross(V(0, 0, 0).subVectors(c, a));
  if (n.dot(V(0, 0, 0).add(a).add(b).add(c)) < 0) tris.push(a, c, b); else tris.push(a, b, c);
};

const built = (tris: THREE.Vector3[]) => {
  const g = new THREE.BufferGeometry().setFromPoints(tris);
  g.computeVertexNormals();
  return g;
};

/**
 * The faces of a solid, its triangles grouped by which way they face (a d12's pentagons are three
 * triangles each). Exported so a test can count a shape's flat faces from its triangles alone.
 */
export const facesFrom = (geometry: THREE.BufferGeometry): FaceSpot[] => {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute('position');
  const groups: { normal: THREE.Vector3; sum: THREE.Vector3; n: number }[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const f = faceOf([0, 1, 2].map((j) => V(p.getX(i + j), p.getY(i + j), p.getZ(i + j))));
    const same = groups.find((x) => x.normal.dot(f.normal) > 0.9999);
    if (same) { same.sum.add(f.center); same.n += 1; } else groups.push({ normal: f.normal, sum: f.center.clone(), n: 1 });
  }
  return groups.map((x) => ({ normal: x.normal, center: x.sum.multiplyScalar(1 / x.n) }));
};

/**
 * Kites meeting at two points (a trapezohedron), k a side: 2k faces, each flat, every one alike.
 * A d10 has k = 5; a d14 7; a d100 50. Many kites make a tall die, so it is squashed to at most
 * 1.2 r high, which keeps every kite flat.
 */
const trapezohedron = (k: number, r: number) => {
  const c = Math.cos(Math.PI / k);
  const z0 = 0.105 * r;
  const h0 = (z0 * (1 + c)) / (1 - c);
  const squash = Math.min(1, (1.2 * r) / h0);
  const z = z0 * squash;
  const h = h0 * squash;
  const ring = Array.from({ length: 2 * k }, (_, i) => V(Math.cos((i * Math.PI) / k) * r, i % 2 ? -z : z, Math.sin((i * Math.PI) / k) * r));
  const T = V(0, h, 0);
  const B = V(0, -h, 0);
  const at = (i: number) => ring[i % (2 * k)];
  const tris: THREE.Vector3[] = [];
  const faces: FaceSpot[] = [];
  const tri = outward(tris);
  for (let j = 0; j < k; j += 1) {
    const [a, b, cc] = [at(2 * j), at(2 * j + 1), at(2 * j + 2)];
    tri(T, a, b); tri(T, b, cc); faces.push(faceOf([T, a, b, cc]));
    const [d, e, f] = [at(2 * j + 1), at(2 * j + 2), at(2 * j + 3)];
    tri(B, d, e); tri(B, e, f); faces.push(faceOf([B, d, e, f]));
  }
  return { geometry: built(tris), faces, label: Math.min(0.56 * r, (2.8 * r) / k) };
};

/** A long prism of k sides lying on one: an odd-sized die (a d3, d5, d13), never landing on an end. */
const prism = (k: number, r: number) => {
  const len = 2.3 * r;
  const ring = Array.from({ length: k }, (_, i) => [Math.cos((2 * Math.PI * i) / k) * r, Math.sin((2 * Math.PI * i) / k) * r]);
  const tris: THREE.Vector3[] = [];
  const faces: FaceSpot[] = [];
  const tri = outward(tris);
  const L = V(-len / 2, 0, 0);
  const R = V(len / 2, 0, 0);
  for (let i = 0; i < k; i += 1) {
    const [y1, z1] = ring[i];
    const [y2, z2] = ring[(i + 1) % k];
    const a = V(-len / 2, y1, z1); const b = V(len / 2, y1, z1); const c = V(len / 2, y2, z2); const d = V(-len / 2, y2, z2);
    tri(a, b, c); tri(a, c, d); faces.push(faceOf([a, b, c, d]));
    tri(L, a, d); tri(R, c, b);
  }
  return { geometry: built(tris), faces, label: Math.min(0.9, 1.7 * r * Math.sin(Math.PI / k)) };
};

/** A coin: two faces. */
const coin = (r: number) => ({
  geometry: new THREE.CylinderGeometry(r, r, 0.2, 40),
  faces: [{ normal: V(0, 1, 0), center: V(0, 0.1, 0) }, { normal: V(0, -1, 0), center: V(0, -0.1, 0) }],
  label: 1.2 * r,
});

/** The most faces a die is drawn with; the server keeps a die's size to it too (utils/diceThrow.js). */
export const MOST_FACES = 1000;

const solid = (geometry: THREE.BufferGeometry, label: number, more: Partial<DieShape> = {}) => ({ geometry, faces: facesFrom(geometry), label, ...more });

/** A die of `n` faces (kept to 2 to MOST_FACES), in the tray's units: about 2 across. */
export const shapeOf = (n: number): DieShape => {
  const size = Math.max(2, Math.min(MOST_FACES, Math.round(n) || 6));
  const made = size === 2 ? coin(0.8)
    : size === 4 ? solid(new THREE.TetrahedronGeometry(1.15), 0.62, { down: true })
    : size === 6 ? {
      geometry: new THREE.BoxGeometry(1.1, 1.1, 1.1),
      faces: [V(0, 1, 0), V(0, -1, 0), V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)].map((x) => ({ normal: x, center: x.clone().multiplyScalar(0.55) })),
      label: 0.8,
    }
    : size === 8 ? solid(new THREE.OctahedronGeometry(0.95), 0.66)
    : size === 12 ? solid(new THREE.DodecahedronGeometry(0.95), 0.58)
    : size === 20 ? solid(new THREE.IcosahedronGeometry(0.95), 0.5)
    : size % 2 === 0 ? trapezohedron(size / 2, Math.min(1.15, 0.85 + size / 400))
    : prism(size, Math.min(0.8, 0.45 + size / 60));
  made.geometry.computeBoundingSphere();
  return { ...made, radius: made.geometry.boundingSphere!.radius };
};

/** How a label lies on a face: flat on it, its own up along the face. The tray prints with this. */
export const labelTurn = (normal: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal);

/**
 * The words on each of a shape's faces: what came up on face 0, the die's other faces round the
 * rest, in order. A die that lands face down (a d4) prints what came up on every face but face 0.
 */
export const faceTexts = (texts: string[], top: number, shape: Pick<DieShape, 'faces' | 'down'>): string[] => {
  const up = texts[top] ?? '';
  if (shape.down) return shape.faces.map((_, k) => (k === 0 ? '' : up));
  const others = texts.filter((_, k) => k !== top);
  return shape.faces.map((_, k) => (k === 0 ? up : others.length ? others[(k - 1) % others.length] : ''));
};

/**
 * The turn a die rests at: face 0 up (down for a d4) and its words square to the camera, which
 * looks from +z, give or take `yaw` (a small turn so a row of dice doesn't look stamped out).
 */
export const restingTurn = (shape: Pick<DieShape, 'faces' | 'down'>, yaw = 0) => {
  const top = shape.faces[0];
  const align = new THREE.Quaternion().setFromUnitVectors(top.normal, V(0, shape.down ? -1 : 1, 0));
  const textUp = V(0, 1, 0).applyQuaternion(labelTurn(top.normal)).applyQuaternion(align);
  const turn = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI - Math.atan2(textUp.x, textUp.z) + yaw);
  return turn.multiply(align);
};

/** How high a die's middle rests above the floor: face 0's distance from it. */
export const restingHeight = (shape: Pick<DieShape, 'faces'>) => shape.faces[0].normal.dot(shape.faces[0].center);
