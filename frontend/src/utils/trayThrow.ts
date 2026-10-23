import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { shapeOf, solidShapeOf, faceOrder, labelTurn, type DieShape } from './diceShapes';

// A throw in the tray (6c4b2; approved mockup docs/mockups/builder-dice.html, decision 9): the
// dice the server rolled (its `throw`, 6c4b1), thrown by real physics (cannon-es) and shown with
// the faces that came up on top. The walls are the tray as the camera sees it, so a die stays
// wholly inside what is shown. The whole throw is worked out at once, in fixed steps from the
// server's seed, before anything is drawn: every screen works out the same throw, whatever its
// frame rate, and the face that ends on top is printed with the server's result, so even a
// browser whose sums came out a hair apart shows the right face. The tray plays it back by the
// clock (poseAt).

/** A throw's own numbers, the same from the same seed on every screen. */
export const seeded = (seed: number) => {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
};

/** One face as the server sends it: its words, and its number and symbols on a system's own die. */
export interface ThrowFace { text: string; n?: number; s?: string[] }
/** A symbol's look as the server sends it. */
export interface ThrowSymbol { id: string; mark: string; drawn?: string[]; icon?: string }
/** One kind of dice in a throw, as utils/diceThrow.js sends it. */
export interface ThrowKind { key: string; sides: number; landed: number[]; faces?: ThrowFace[]; color?: 'danger' }
export interface RollThrow { seed: number; dice: ThrowKind[]; symbols?: ThrowSymbol[] }

/** A die to throw: its size, every face's words, the face that came up, and its kind's color. */
export interface DieSpec { key: string; sides: number; texts: string[]; faces?: ThrowFace[]; top: number; danger: boolean }

/** The most dice the tray throws at once; a bigger handful is still all in the log and the total. */
export const MOST_DICE = 40;

const numbered = (sides: number) => Array.from({ length: sides }, (_, i) => String(i + 1));

/**
 * The dice a roll throws. A roll from a server before 6c4b1 has no `throw`: its results are read
 * as plain dice, keyed by size, landing on the face they show.
 */
export const diceOfRoll = (roll: { results?: Record<string, unknown>; diceSides?: Record<string, number>; throw?: RollThrow }): DieSpec[] => {
  const kinds: ThrowKind[] = roll.throw?.dice ?? Object.entries(roll.results ?? {}).map(([key, v]) => {
    const values = Array.isArray(v) ? v : [v];
    const given = roll.diceSides?.[key];
    const sides = Number.isInteger(given) && (given as number) >= 2 ? (given as number) : parseInt(key, 10) >= 2 ? parseInt(key, 10) : 6;
    return { key, sides, landed: values.map((x) => Math.max(0, Math.min(sides - 1, (Math.round(Number(x)) || 1) - 1))) };
  });
  return kinds.flatMap((k) => {
    const texts = k.faces ? k.faces.map((f) => f.text) : numbered(k.sides);
    return k.landed.map((top) => ({ key: k.key, sides: k.sides, texts, ...(k.faces ? { faces: k.faces } : {}), top, danger: k.color === 'danger' }));
  }).slice(0, MOST_DICE);
};

const millionths = (x: number) => Math.round(x * 1e6) / 1e6;

/** A wall of the tray, in the floor's x and z: the side a die keeps to (n · p ≤ c), n pointing out. */
interface Wall { nx: number; nz: number; c: number }

/**
 * The floor as `camera` sees it, at the height of a die's middle (`y`): the four corners of the
 * picture, from the bottom left round, and the walls along its edges. With the camera looking down
 * at a slant it is wider at the back than at the front, so the walls are the picture's own edges.
 */
export const floorSeen = (camera: THREE.PerspectiveCamera, y: number) => {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const along = new THREE.Vector3(sx, sy, 0.5).unproject(camera).sub(camera.position);
    const t = (y - camera.position.y) / along.y;
    return { x: camera.position.x + along.x * t, z: camera.position.z + along.z * t };
  });
  const mid = { x: corners.reduce((s, p) => s + p.x, 0) / 4, z: corners.reduce((s, p) => s + p.z, 0) / 4 };
  const walls: Wall[] = corners.map((a, i) => {
    const b = corners[(i + 1) % 4];
    let nx = b.z - a.z;
    let nz = a.x - b.x;
    const len = Math.sqrt(nx * nx + nz * nz);
    nx /= len; nz /= len;
    if (nx * (mid.x - a.x) + nz * (mid.z - a.z) > 0) { nx = -nx; nz = -nz; }
    // Kept to millionths: the camera's sums go through tan, whose last digit a browser may round
    // its own way, and the throw must come out the same on every screen.
    return { nx: millionths(nx), nz: millionths(nz), c: millionths(nx * a.x + nz * a.z) };
  });
  return { corners: corners.map((p) => ({ x: millionths(p.x), z: millionths(p.z) })), walls, mid: { x: millionths(mid.x), z: millionths(mid.z) } };
};

/**
 * The tray's width over its height. Every screen throws in a tray this shape, whatever size it is
 * drawn at, so the walls, and with them the throw, are the same for everyone watching.
 */
export const TRAY_ASPECT = 5 / 4;

/** Where the tray's camera is and what it looks at: down at the floor at a slant, from in front. */
export const TRAY_VIEW = { fov: 34, position: [0, 11, 7.5] as const, target: [0, 0, 0.3] as const };

/** The tray's camera, as TRAY_VIEW says. */
export const trayCamera = (aspect = TRAY_ASPECT) => {
  const camera = new THREE.PerspectiveCamera(TRAY_VIEW.fov, aspect, 0.1, 100);
  camera.position.set(...TRAY_VIEW.position);
  camera.lookAt(...TRAY_VIEW.target);
  return camera;
};

/** The steps a throw is worked out in, a second's worth each 120. */
export const STEP = 1 / 120;
/** The longest a throw runs, inside the tray's five seconds a roll; a die still moving then is where it is. */
const MOST_STEPS = 4.5 * 120;
/** A die is still once it moves less than this, a step, for STILL_STEPS steps on end. */
const STILL_MOVE = 0.003;
const STILL_STEPS = 30;
/**
 * The settle: from SETTLE_FROM seconds, growing to full by SETTLE_FULL, each die's rolling and
 * sliding are damped harder, as the tray's felt stops a die. A prism would otherwise roll on like a
 * log, and a coin circle on its rim, past the tray's time. (Pulling dice flat made them climb onto
 * each other; a die still on its rim or end at the last is laid down: see laidFlat.)
 */
const SETTLE_FROM = 1.5;
const SETTLE_FULL = 2.6;
/** A die whose top face points less up than this (about 41° off) is on its rim or end, not leaning. */
const ON_ITS_EDGE = 0.75;
const GRAVITY = 40;
/** How far the solid walls stand inside the picture's edges. */
const WALL_INSET = 0.15;

/** One step of a die's path: where it is and how it is turned. */
export interface PathPoint { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }

/** A die thrown: its shape and spec, the size it is drawn at, and its path, one point a step. */
export interface ThrownDie {
  spec: DieSpec;
  shape: DieShape;
  scale: number;
  path: PathPoint[];
  /** The shape face it came to rest on top of (under, for a d4), which is printed with what came up. */
  up: number;
  /** How far that face's words are turned on it to read from the camera, in radians. */
  twist: number;
}
export interface Throw { dice: ThrownDie[]; steps: number }

/** How much smaller dice are drawn when many share the tray, so a handful still fits on the floor. */
export const scaleFor = (count: number, floorArea: number) => Math.max(0.45, Math.min(1, Math.sqrt((floorArea * 0.22) / Math.max(1, count) / (Math.PI * 1.1 * 1.1))));

/** How high a die's top stands, at full size: the walls keep that in the picture too. */
const TOPS = 1.7;

/** The floor a die may rest on: from the back, its left and right at the back and at the front. */
interface Floor { back: number; front: number; backLeft: number; backRight: number; frontLeft: number; frontRight: number }

/** A place on that floor, `u` from its left to its right and `v` from its back to its front, each 0 to 1. */
const onFloor = (f: Floor, u: number, v: number) => {
  const left = f.backLeft + (f.frontLeft - f.backLeft) * v;
  const right = f.backRight + (f.frontRight - f.backRight) * v;
  return { x: left + (right - left) * u, z: f.back + (f.front - f.back) * v };
};

/**
 * Where each die is thrown to, spread over the floor: one to a cell of a grid as near square as
 * the floor, the cells dealt out by the seed, each spot shaken within its cell. The floor is wider
 * at the back, as the camera sees it, and the cells widen with it.
 */
const spotsFor = (count: number, f: Floor, rand: () => number) => {
  const w = (f.backRight - f.backLeft + f.frontRight - f.frontLeft) / 2; const h = f.front - f.back;
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * w) / h)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cells = Array.from({ length: cols * rows }, (_, k) => k);
  for (let k = cells.length - 1; k > 0; k -= 1) { const j = Math.floor(rand() * (k + 1)); [cells[k], cells[j]] = [cells[j], cells[k]]; }
  return cells.slice(0, count).map((k) => onFloor(f,
    ((k % cols) + 0.5 + (rand() - 0.5) * 0.6) / cols,
    (Math.floor(k / cols) + 0.5 + (rand() - 0.5) * 0.6) / rows));
};

/**
 * The tray's walls for dice drawn at `scale`: the picture's edges at the floor and at a die's top,
 * so a die is held wholly in the picture, its foot and its top both.
 */
export const wallsFor = (camera: THREE.PerspectiveCamera, scale: number) => [...floorSeen(camera, 0).walls, ...floorSeen(camera, TOPS * scale).walls];

/**
 * A face's outline: of the points in its plane, only its outer corners, counter-clockwise seen from
 * outside (way out `n`). A point in its middle (a prism's end, drawn as a fan) or along an edge
 * is no corner, and a face with one would break the physics' sums.
 */
const outline = (ks: number[], n: THREE.Vector3, vertices: THREE.Vector3[]) => {
  const u = new THREE.Vector3().subVectors(vertices[ks[1]], vertices[ks[0]]).normalize();
  const w = new THREE.Vector3().crossVectors(n, u);
  const pts = ks.map((k) => ({ k, x: vertices[k].dot(u), y: vertices[k].dot(w) })).sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // Monotone chain: the lower edge, then the upper, each turning left only.
  const chain = (list: typeof pts) => {
    const out: typeof pts = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...chain(pts), ...chain([...pts].reverse())].map((p) => p.k);
};

/**
 * A die's solid for the physics: the corners of the shape the tray draws, its triangles that share
 * a plane joined into one face (a kite, a d12's pentagon), each face its corners in turn about its
 * middle, seen from outside. A coin is the physics' own cylinder. Fewer faces, quicker sums.
 */
const solidOf = (shape: DieShape, scale: number): CANNON.Shape => {
  if (shape.geometry.type === 'CylinderGeometry') {
    const { radiusTop, height } = (shape.geometry as THREE.CylinderGeometry).parameters;
    return new CANNON.Cylinder(radiusTop * scale, radiusTop * scale, height * scale, 12);
  }
  const g = shape.geometry.index ? shape.geometry.toNonIndexed() : shape.geometry;
  const p = g.getAttribute('position');
  const vertices: THREE.Vector3[] = [];
  const seen = new Map<string, number>();
  const at = (i: number) => {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).multiplyScalar(scale);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    let k = seen.get(key);
    if (k === undefined) { k = vertices.length; vertices.push(v); seen.set(key, k); }
    return k;
  };
  // Triangles grouped by the plane they lie in: its way out, and how far out it is.
  const planes: { n: THREE.Vector3; d: number; corners: Set<number> }[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const tri = [at(i), at(i + 1), at(i + 2)];
    if (new Set(tri).size < 3) continue;
    const [a, b, c] = tri.map((k) => vertices[k]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.dot(a) < 0) n.negate();
    const d = n.dot(a);
    let plane = planes.find((x) => x.n.dot(n) > 0.9999 && Math.abs(x.d - d) < 1e-3);
    if (!plane) { plane = { n, d, corners: new Set() }; planes.push(plane); }
    tri.forEach((k) => plane!.corners.add(k));
  }
  const faces = planes.map(({ n, corners }) => outline([...corners], n, vertices));
  return new CANNON.ConvexPolyhedron({ vertices: vertices.map((v) => new CANNON.Vec3(v.x, v.y, v.z)), faces });
};

/** The face of `shape`, turned by `q`, that points most nearly `down` or up. */
const faceUp = (shape: DieShape, q: THREE.Quaternion) => {
  let best = 0; let most = -Infinity;
  shape.faces.forEach((f, k) => {
    const y = f.normal.clone().applyQuaternion(q).y * (shape.down ? -1 : 1);
    if (y > most) { most = y; best = k; }
  });
  return best;
};

/**
 * How far the words on face `k` must turn about it to read from the camera, in front: their own
 * up pointing away from it, as near as the face lies.
 */
const twistFor = (shape: DieShape, k: number, q: THREE.Quaternion) => {
  const n = shape.faces[k].normal.clone().applyQuaternion(q);
  const wordsUp = new THREE.Vector3(0, 1, 0).applyQuaternion(labelTurn(shape.faces[k].normal)).applyQuaternion(q);
  const away = new THREE.Vector3(0, 0, -1).projectOnPlane(n);
  if (away.lengthSq() < 1e-6) return 0;
  away.normalize();
  return Math.atan2(new THREE.Vector3().crossVectors(wordsUp, away).dot(n), wordsUp.dot(away));
};

/**
 * A die's path turned through the settle to lie exactly flat on the drawn face nearest up at its
 * end, lowered or raised to the floor, and moved in from any wall lying flat would reach past. For
 * a big die thrown as its stand-in that is a degree or two; for a coin left on its rim or a prism
 * on its end, it falls over.
 */
const laidFlat = (shape: DieShape, scale: number, path: PathPoint[], walls: Wall[]): PathPoint[] => {
  const last = path[path.length - 1];
  const end = new THREE.Quaternion(last.qx, last.qy, last.qz, last.qw);
  const n = shape.faces[faceUp(shape, end)].normal.clone().applyQuaternion(end);
  const flat = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, shape.down ? -1 : 1, 0));
  const flatEnd = flat.clone().multiply(end);
  const pos = shape.geometry.getAttribute('position');
  const corners = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyQuaternion(flatEnd).multiplyScalar(scale));
  const lift = -Math.min(...corners.map((v) => v.y)) - last.y;
  let shiftX = 0; let shiftZ = 0;
  for (const w of walls) {
    const over = Math.max(...corners.map((v) => w.nx * (v.x + last.x + shiftX) + w.nz * (v.z + last.z + shiftZ))) - (w.c - WALL_INSET);
    if (over > 0) { shiftX -= w.nx * over; shiftZ -= w.nz * over; }
  }
  const from = Math.min(Math.round(SETTLE_FROM / STEP), path.length - 1);
  return path.map((p, k) => {
    if (k < from) return p;
    const w = path.length - 1 === from ? 1 : (k - from) / (path.length - 1 - from);
    const q = new THREE.Quaternion().slerp(flat, w).multiply(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw));
    return { x: p.x + shiftX * w, y: p.y + lift * w, z: p.z + shiftZ * w, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  });
};

/**
 * The whole throw, by real physics (cannon-es): each die tossed in high from the left with a
 * spin of its own toward a spot spread over the floor, tumbling, bouncing off the floor, the walls
 * and each other until all of them lie still. The walls keep a die wholly in the picture, its foot
 * and its top both. Whichever face a die comes to rest on top of is then printed with what the
 * server rolled, so the face that shows is the server's on every screen, however the dice fell.
 */
export const throwDice = (specs: DieSpec[], seed: number, camera: THREE.PerspectiveCamera): Throw => {
  const rand = seeded(seed);
  const floor = floorSeen(camera, 0.6);
  const xs = floor.corners.map((p) => p.x);
  const zs = floor.corners.map((p) => p.z);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  const scale = scaleFor(specs.length, area);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  (world.solver as CANNON.GSSolver).iterations = 12;
  const dieStuff = new CANNON.Material('die');
  const floorStuff = new CANNON.Material('floor');
  const wallStuff = new CANNON.Material('wall');
  world.addContactMaterial(new CANNON.ContactMaterial(dieStuff, floorStuff, { friction: 0.35, restitution: 0.35 }));
  world.addContactMaterial(new CANNON.ContactMaterial(dieStuff, wallStuff, { friction: 0.1, restitution: 0.55 }));
  // Slick against each other, so one landing on another slides off as real dice do.
  world.addContactMaterial(new CANNON.ContactMaterial(dieStuff, dieStuff, { friction: 0.04, restitution: 0.35 }));

  const ground = new CANNON.Body({ mass: 0, material: floorStuff, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  // Each wall a plane standing on the floor, facing in (n · p ≤ c is the inside), a little inside
  // the picture's edge: a die pressed against it by others sinks into it a hair, and stays in sight.
  const walls = wallsFor(camera, scale);
  for (const w of walls) {
    const wall = new CANNON.Body({ mass: 0, material: wallStuff, shape: new CANNON.Plane() });
    wall.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(-w.nx, 0, -w.nz));
    wall.position.set(w.nx * (w.c - WALL_INSET), 0, w.nz * (w.c - WALL_INSET));
    world.addBody(wall);
  }

  // Thrown to spots spread over the floor, a die's width in from every wall.
  const [bl, br, tr, tl] = floorSeen(camera, TOPS * scale).corners;
  const [nbl, nbr, ntr, ntl] = floorSeen(camera, 0).corners;
  const margin = 1.25 * scale;
  const rests: Floor = {
    back: Math.max(tl.z, tr.z, ntl.z, ntr.z) + margin, front: Math.min(bl.z, br.z, nbl.z, nbr.z) - margin,
    backLeft: Math.max(tl.x, ntl.x) + margin, backRight: Math.min(tr.x, ntr.x) - margin,
    frontLeft: Math.max(bl.x, nbl.x) + margin, frontRight: Math.min(br.x, nbr.x) - margin,
  };
  const spots = spotsFor(specs.length, rests, rand);
  // Each die's own lane down the left side, in the order of the spots they go to (so their paths
  // don't cross), and neighbours a die's width apart in or up: no two start touching.
  const lanes = spots.map((s, i) => ({ s, i })).sort((a, b) => a.s.z - b.s.z || a.i - b.i)
    .reduce((m, { i }, lane) => m.set(i, lane), new Map<number, number>());
  const apart = 2 * shapeOf(6).radius * scale;
  const dice = specs.map((spec, i) => {
    const shape = shapeOf(spec.sides);
    const solid = solidShapeOf(spec.sides);
    const body = new CANNON.Body({
      mass: 1, material: dieStuff, shape: solidOf(solid, scale),
      linearDamping: 0.05, angularDamping: 0.15,
    });
    // In high by the left wall, in its lane, any way up, spinning, and pushed at its spot hard
    // enough to land short of it and roll on.
    const spot = spots[i];
    const lane = lanes.get(i)!;
    const edge = onFloor(rests, 0, (lane + 0.5) / specs.length);
    let x = edge.x + (lane % 2) * apart; let z = edge.z;
    // Wholly inside every wall from the start, the drawn die's whole size allowed for.
    for (const w of walls) {
      const over = w.nx * x + w.nz * z - (w.c - WALL_INSET - shape.radius * scale);
      if (over > 0) { x -= w.nx * over; z -= w.nz * over; }
    }
    body.position.set(x, 3.2 * Math.max(scale, 0.7) + (lane % 3) * apart + rand() * 0.3 * scale, z);
    const axis = new CANNON.Vec3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
    axis.normalize();
    body.quaternion.setFromAxisAngle(axis, rand() * Math.PI * 2);
    const flight = 0.55 + rand() * 0.2;
    body.velocity.set(((spot.x - x) / flight) * 0.62, 1 + rand() * 2, ((spot.z - z) / flight) * 0.62);
    body.angularVelocity.set((rand() - 0.5) * 30, (rand() - 0.5) * 30, (rand() - 0.5) * 30);
    world.addBody(body);
    return { spec, shape, solid, body, path: [] as PathPoint[], stillFor: 0 };
  });

  const record = () => {
    for (const d of dice) {
      const { position: p, quaternion: q } = d.body;
      d.path.push({ x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    }
  };
  // Played until every die has lain still a moment (a quarter of a second), or time runs out.
  for (let steps = 0; steps < MOST_STEPS; steps += 1) {
    record();
    if (dice.every((d) => d.stillFor >= STILL_STEPS)) break;
    const settle = Math.max(0, Math.min(1, (steps * STEP - SETTLE_FROM) / (SETTLE_FULL - SETTLE_FROM)));
    if (settle > 0) {
      for (const d of dice) {
        d.body.angularDamping = 0.15 + 0.7 * settle;
        d.body.linearDamping = 0.05 + 0.55 * settle;
      }
    }
    world.step(STEP);
    for (const d of dice) {
      const last = d.path[d.path.length - 1]; const { position: p, quaternion: q } = d.body;
      const moved = Math.abs(p.x - last.x) + Math.abs(p.y - last.y) + Math.abs(p.z - last.z) + Math.abs(q.x - last.qx) + Math.abs(q.y - last.qy) + Math.abs(q.z - last.qz) + Math.abs(q.w - last.qw);
      d.stillFor = moved < STILL_MOVE ? d.stillFor + 1 : 0;
    }
  }
  return {
    steps: Math.max(...dice.map((d) => d.path.length), 1),
    dice: dice.map((d) => {
      // A die thrown as a stand-in, or left on its rim or end, is laid flat; one leaning on another
      // is left as it fell.
      const end = d.path[d.path.length - 1];
      const endTurn = new THREE.Quaternion(end.qx, end.qy, end.qz, end.qw);
      const tipped = d.shape.faces[faceUp(d.shape, endTurn)].normal.clone().applyQuaternion(endTurn).y * (d.shape.down ? -1 : 1) < ON_ITS_EDGE;
      const path = d.solid.faces.length === d.shape.faces.length && !tipped ? d.path : laidFlat(d.shape, scale, d.path, walls);
      const last = path[path.length - 1];
      const q = new THREE.Quaternion(last.qx, last.qy, last.qz, last.qw);
      const up = faceUp(d.shape, q);
      return { spec: d.spec, shape: d.shape, scale, path, up, twist: d.shape.down ? 0 : twistFor(d.shape, up, q) };
    }),
  };
};

/** How long a throw takes to play, in seconds. */
export const throwLength = (t: Throw) => (t.steps - 1) * STEP;

/** How long after a throw starts its total is revealed, in milliseconds: as its last die stops, and a breath after. */
export const revealAfter = (t: Throw) => Math.round(throwLength(t) * 1000) + 300;

/** A die's place and turn `seconds` into the throw. */
export const poseAt = (die: ThrownDie, seconds: number) => {
  const p = die.path[Math.max(0, Math.min(die.path.length - 1, Math.floor(seconds / STEP)))];
  return { position: new THREE.Vector3(p.x, p.y, p.z), quaternion: new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw) };
};

/** Which of the die's faces each shape face prints: what came up on the face that landed on top. */
export const printOrder = (die: ThrownDie) => faceOrder(die.spec.texts.length, die.spec.top, die.shape, die.up);

/** Each face's words for a thrown die, ready to print. */
export const printedOn = (die: ThrownDie) => printOrder(die).map((i) => (i < 0 ? '' : die.spec.texts[i] ?? ''));
