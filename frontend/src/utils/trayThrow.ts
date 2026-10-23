import * as THREE from 'three';
import { shapeOf, faceTexts, restingTurn, restingHeight, type DieShape } from './diceShapes';

// A throw in the tray (6c4b2a; approved mockup docs/mockups/builder-dice.html, decision 9): the
// dice the server rolled (its `throw`, 6c4b1), tumbled in and landed on the faces that came up.
// The walls are the tray as the camera sees it, so a die stays wholly inside what is shown. The
// whole throw is worked out at once, in fixed steps from the server's seed, with nothing but
// + − × ÷ and square roots: every screen works out the same numbers and sees the same throw,
// whatever its frame rate. The tray plays it back by the clock (poseAt).

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
/** The longest a throw runs; a die still moving then stops where it is. */
const MOST_STEPS = 4 * 120;
const GRAVITY = 32;
const FLOOR_BOUNCE = 0.42;
const WALL_BOUNCE = 0.62;
/** Speed lost each step a die runs along the floor. */
const ROLLING_DRAG = 0.965;

/** A die thrown: its shape and spec, where it rests, and its path, one point a step. */
export interface ThrownDie {
  spec: DieSpec;
  shape: DieShape;
  scale: number;
  final: THREE.Quaternion;
  /** What the die tumbles about on its way, and how fast: `spin` radians a radius it goes. */
  axis: THREE.Vector3;
  spin: number;
  path: { x: number; y: number; z: number; went: number }[];
}
export interface Throw { dice: ThrownDie[]; steps: number }

/** How much smaller dice are drawn when many share the tray, so a handful still fits on the floor. */
export const scaleFor = (count: number, floorArea: number) => Math.max(0.45, Math.min(1, Math.sqrt((floorArea * 0.22) / Math.max(1, count) / (Math.PI * 1.1 * 1.1))));

/** How high a die's top stands, at full size: the walls keep that in the picture too. */
const TOPS = 1.7;
/** How far a die thrown at `v` goes before it rests: its time in the air, then its roll along the floor. */
const REACH = 1.31;
/** How much faster a die turns than it would just rolling: it tumbles, over and over, as dice do. */
const TUMBLE = 2.2;

/** The floor a die may rest on: from the back, its left and right at the back and at the front. */
interface Floor { back: number; front: number; backLeft: number; backRight: number; frontLeft: number; frontRight: number }

/** A place on that floor, `u` from its left to its right and `v` from its back to its front, each 0 to 1. */
const onFloor = (f: Floor, u: number, v: number) => {
  const left = f.backLeft + (f.frontLeft - f.backLeft) * v;
  const right = f.backRight + (f.frontRight - f.backRight) * v;
  return { x: left + (right - left) * u, z: f.back + (f.front - f.back) * v };
};

/**
 * Where each die comes to rest, spread over the floor: one to a cell of a grid as near square as
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
 * The whole throw: each die tossed in from the left wall toward a spot of its own on the floor,
 * with its speed and spin from the seed, bouncing on the floor, off the walls and off each other
 * until it rests, face up as it came. The walls keep a die wholly in the picture: its foot and its
 * top both, since the camera looks down at a slant and a die's top shows higher than its middle.
 */
export const throwDice = (specs: DieSpec[], seed: number, camera: THREE.PerspectiveCamera): Throw => {
  const rand = seeded(seed);
  const floor = floorSeen(camera, 0.6);
  const xs = floor.corners.map((p) => p.x);
  const zs = floor.corners.map((p) => p.z);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  const scale = scaleFor(specs.length, area);
  const walls = wallsFor(camera, scale);
  // The floor every wall leaves, less a die's width, for the dice to come to rest on.
  const [bl, br, tr, tl] = floorSeen(camera, TOPS * scale).corners;
  const [nbl, nbr, ntr, ntl] = floorSeen(camera, 0).corners;
  const margin = 1.25 * scale;
  const rests: Floor = {
    back: Math.max(tl.z, tr.z, ntl.z, ntr.z) + margin, front: Math.min(bl.z, br.z, nbl.z, nbr.z) - margin,
    backLeft: Math.max(tl.x, ntl.x) + margin, backRight: Math.min(tr.x, ntr.x) - margin,
    frontLeft: Math.max(bl.x, nbl.x) + margin, frontRight: Math.min(br.x, nbr.x) - margin,
  };
  const spots = spotsFor(specs.length, rests, rand);
  const bodies = specs.map((spec, i) => {
    const shape = shapeOf(spec.sides);
    const r = shape.radius * scale;
    const rest = restingHeight(shape) * scale;
    // Thrown in high from beyond the tray's left edge, level with its own spot give or take, at
    // that spot; the walls hold it once it is in.
    const spot = spots[i];
    const z = spot.z + (rand() - 0.5) * 2 * scale;
    const edge = nbl.x + ((ntl.x - nbl.x) * (z - nbl.z)) / (ntl.z - nbl.z);
    const x = edge - r - rand() * 1.5;
    const dx = spot.x - x; const dz = spot.z - z;
    const far = Math.sqrt(dx * dx + dz * dz);
    const speed = (far / REACH) * (0.95 + rand() * 0.1);
    const vx = (dx / far) * speed; const vz = (dz / far) * speed;
    const axis = new THREE.Vector3(vz, 0, -vx).normalize();
    return {
      spec, shape, r, rest, axis, spin: TUMBLE + rand(),
      final: restingTurn(shape, (rand() - 0.5) * 0.5),
      p: { x, y: rest + 3 + rand() * 2, z }, v: { x: vx, y: rand() * 1.5, z: vz },
      spot, speed, went: 0, still: false, inside: false, path: [] as ThrownDie['path'],
    };
  });
  const keepIn = (b: (typeof bodies)[number], always = false) => {
    if (!b.inside && !always) {
      b.inside = walls.every((w) => w.nx * b.p.x + w.nz * b.p.z <= w.c - b.r);
      if (!b.inside) return;
    }
    for (const w of walls) {
      const over = w.nx * b.p.x + w.nz * b.p.z - (w.c - b.r);
      if (over <= 0) continue;
      b.p.x -= over * w.nx; b.p.z -= over * w.nz;
      const into = b.v.x * w.nx + b.v.z * w.nz;
      if (into > 0) { b.v.x -= (1 + WALL_BOUNCE) * into * w.nx; b.v.z -= (1 + WALL_BOUNCE) * into * w.nz; }
    }
  };
  let steps = 0;
  for (; steps < MOST_STEPS; steps += 1) {
    for (const b of bodies) b.path.push({ x: b.p.x, y: b.p.y, z: b.p.z, went: b.went });
    if (bodies.every((b) => b.still)) break;
    for (const b of bodies) {
      if (b.still) continue;
      // Until it is in, a die keeps on at its spot: a knock on the way can't send it off elsewhere.
      if (!b.inside) {
        const dx = b.spot.x - b.p.x; const dz = b.spot.z - b.p.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        b.v.x = (dx / d) * b.speed; b.v.z = (dz / d) * b.speed;
      }
      b.v.y -= GRAVITY * STEP;
      const was = { x: b.p.x, z: b.p.z };
      b.p.x += b.v.x * STEP; b.p.y += b.v.y * STEP; b.p.z += b.v.z * STEP;
      if (b.p.y <= b.rest) {
        b.p.y = b.rest;
        b.v.y = b.v.y < -1.5 ? -b.v.y * FLOOR_BOUNCE : 0;
        b.v.x *= ROLLING_DRAG; b.v.z *= ROLLING_DRAG;
      }
      keepIn(b);
      const dx = b.p.x - was.x; const dz = b.p.z - was.z;
      b.went += Math.sqrt(dx * dx + dz * dz);
      if (b.inside && b.p.y === b.rest && b.v.y === 0 && b.v.x * b.v.x + b.v.z * b.v.z < 0.04) { b.v.x = 0; b.v.z = 0; b.still = true; }
    }
    // Dice knock each other apart; one at rest knocked hard enough moves again.
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i]; const b = bodies[j];
        const dx = b.p.x - a.p.x; const dz = b.p.z - a.p.z;
        const near = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= near * near || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d; const nz = dz / d;
        // Eased apart, a little a step, so two that meet part rather than jump.
        const push = Math.min((near - d) / 2, 0.06);
        a.p.x -= nx * push; a.p.z -= nz * push; b.p.x += nx * push; b.p.z += nz * push;
        keepIn(a); keepIn(b);
        const closing = (b.v.x - a.v.x) * nx + (b.v.z - a.v.z) * nz;
        if (closing < 0) {
          const j_ = (-(1 + 0.6) * closing) / 2;
          a.v.x -= j_ * nx; a.v.z -= j_ * nz; b.v.x += j_ * nx; b.v.z += j_ * nz;
          if (a.v.x * a.v.x + a.v.z * a.v.z > 0.25) a.still = false;
          if (b.v.x * b.v.x + b.v.z * b.v.z > 0.25) b.still = false;
        }
      }
    }
    // A knock from one die can nudge another past a wall it was already held to.
    for (const b of bodies) keepIn(b);
  }
  // Anything still moving when time runs out stops on the floor where it is, inside the tray.
  for (const b of bodies) {
    const last = b.path[b.path.length - 1];
    keepIn(b, true);
    if (last.y !== b.rest || last.x !== b.p.x || last.z !== b.p.z) b.path.push({ x: b.p.x, y: b.rest, z: b.p.z, went: last.went });
  }
  return {
    steps: Math.max(...bodies.map((b) => b.path.length), 1),
    dice: bodies.map((b) => ({ spec: b.spec, shape: b.shape, scale, final: b.final, axis: b.axis, spin: b.spin, path: b.path })),
  };
};

/** How long a throw takes to play, in seconds. */
export const throwLength = (t: Throw) => (t.steps - 1) * STEP;

/**
 * A die's place and turn `seconds` into the throw: turned back from its resting turn by the
 * distance it has still to go, so it tumbles as it moves and lands exactly face up.
 */
export const poseAt = (die: ThrownDie, seconds: number) => {
  const at = Math.max(0, Math.min(die.path.length - 1, Math.floor(seconds / STEP)));
  const p = die.path[at];
  const left = die.path[die.path.length - 1].went - p.went;
  const turn = new THREE.Quaternion().setFromAxisAngle(die.axis, (-left * die.spin) / (die.shape.radius * die.scale)).multiply(die.final);
  return { position: new THREE.Vector3(p.x, p.y, p.z), quaternion: turn };
};

/** Each face's words for a thrown die, ready to print (diceShapes.faceTexts). */
export const printedOn = (die: ThrownDie) => faceTexts(die.spec.texts, die.spec.top, die.shape);
