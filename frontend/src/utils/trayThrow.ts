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

/** The tray's camera, looking down at the floor at a slant from in front. */
export const trayCamera = (aspect = TRAY_ASPECT) => {
  const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 100);
  camera.position.set(0, 11, 7.5);
  camera.lookAt(0, 0, 0.3);
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
  /** What the die rolls about on its way, and how far it went: it turns one radian a radius. */
  axis: THREE.Vector3;
  path: { x: number; y: number; z: number; went: number }[];
}
export interface Throw { dice: ThrownDie[]; steps: number }

/** How much smaller dice are drawn when many share the tray, so a handful still fits on the floor. */
export const scaleFor = (count: number, floorArea: number) => Math.max(0.45, Math.min(1, Math.sqrt((floorArea * 0.22) / Math.max(1, count) / (Math.PI * 1.1 * 1.1))));

/**
 * The whole throw: each die tossed in from the left with its own speed and spin from the seed,
 * bouncing on the floor, off the walls and off each other until it rests, face up as it came.
 */
export const throwDice = (specs: DieSpec[], seed: number, camera: THREE.PerspectiveCamera): Throw => {
  const rand = seeded(seed);
  const floor = floorSeen(camera, 0.6);
  const xs = floor.corners.map((p) => p.x);
  const zs = floor.corners.map((p) => p.z);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  const scale = scaleFor(specs.length, area);
  const bodies = specs.map((spec, i) => {
    const shape = shapeOf(spec.sides);
    const r = shape.radius * scale;
    const rest = restingHeight(shape) * scale;
    // In at the left wall, spread across its height, moving right and in toward the middle.
    const left = Math.min(...xs) + r * 1.2;
    const z = floor.mid.z + (Math.max(...zs) - Math.min(...zs)) * 0.7 * (((i + 0.5) / specs.length) - 0.5) + (rand() - 0.5) * 0.6;
    const speed = 9 + rand() * 6;
    let vx = 0.8 + rand() * 0.4;
    let vz = (floor.mid.z - z) * 0.08 + (rand() - 0.5) * 0.8;
    const len = Math.sqrt(vx * vx + vz * vz);
    vx = (vx / len) * speed; vz = (vz / len) * speed;
    const axis = new THREE.Vector3(vz, 0, -vx).normalize();
    return {
      spec, shape, r, rest, axis,
      final: restingTurn(shape, (rand() - 0.5) * 0.5),
      p: { x: left, y: rest + 1.5 + rand() * 1.5, z }, v: { x: vx, y: 1 + rand() * 2, z: vz },
      went: 0, still: false, path: [] as ThrownDie['path'],
    };
  });
  const keepIn = (b: (typeof bodies)[number]) => {
    for (const w of floor.walls) {
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
      if (b.p.y === b.rest && b.v.y === 0 && b.v.x * b.v.x + b.v.z * b.v.z < 0.04) { b.v.x = 0; b.v.z = 0; b.still = true; }
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
        const push = (near - d) / 2;
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
  // Anything still moving when time runs out stops on the floor where it is.
  for (const b of bodies) {
    const last = b.path[b.path.length - 1];
    if (last.y !== b.rest) b.path.push({ x: last.x, y: b.rest, z: last.z, went: last.went });
  }
  return {
    steps: Math.max(...bodies.map((b) => b.path.length), 1),
    dice: bodies.map((b) => ({ spec: b.spec, shape: b.shape, scale, final: b.final, axis: b.axis, path: b.path })),
  };
};

/** How long a throw takes to play, in seconds. */
export const throwLength = (t: Throw) => (t.steps - 1) * STEP;

/**
 * A die's place and turn `seconds` into the throw: rolled back from its resting turn by the
 * distance it has still to go, so it rolls as it moves and lands exactly face up.
 */
export const poseAt = (die: ThrownDie, seconds: number) => {
  const at = Math.max(0, Math.min(die.path.length - 1, Math.floor(seconds / STEP)));
  const p = die.path[at];
  const left = die.path[die.path.length - 1].went - p.went;
  const turn = new THREE.Quaternion().setFromAxisAngle(die.axis, -left / (die.shape.radius * die.scale)).multiply(die.final);
  return { position: new THREE.Vector3(p.x, p.y, p.z), quaternion: turn };
};

/** Each face's words for a thrown die, ready to print (diceShapes.faceTexts). */
export const printedOn = (die: ThrownDie) => faceTexts(die.spec.texts, die.spec.top, die.shape);
