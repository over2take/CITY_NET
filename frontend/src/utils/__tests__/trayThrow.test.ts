import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { seeded, diceOfRoll, floorSeen, wallsFor, trayCamera, throwDice, throwLength, poseAt, printedOn, scaleFor, MOST_DICE, TRAY_ASPECT, type DieSpec, type ThrownDie } from '../trayThrow';
import { labelTurn } from '../diceShapes';

/**
 * A throw in the tray (6c4b2a; mockup builder-dice, decision 9): the server's dice tumbled in from
 * its seed and landed on the faces that came up, the same on every screen, never past the edges of
 * the tray as it is shown (the old tray's walls were wider than the picture, and dice left it).
 */

const d = (sides: number, top: number, more: Partial<DieSpec> = {}): DieSpec => ({ key: String(sides), sides, texts: Array.from({ length: sides }, (_, i) => String(i + 1)), top, danger: false, ...more });
const HANDFUL = [d(20, 19), d(6, 4), d(6, 0), d(8, 2), d(4, 3), d(10, 9), d(12, 5), d(13, 12), d(2, 1), d(100, 41)];

describe('a throw\'s own numbers', () => {
  it('are the same from the same seed, and between 0 and 1', () => {
    const a = seeded(42); const b = seeded(42); const c = seeded(43);
    const as = Array.from({ length: 50 }, a);
    expect(Array.from({ length: 50 }, b)).toEqual(as);
    expect(Array.from({ length: 50 }, c)).not.toEqual(as);
    for (const x of as) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe('the dice a roll throws', () => {
  it('are the server\'s throw, die by die: its size, every face\'s words, the face that came up, its color', () => {
    const specs = diceOfRoll({ results: { 6: [5, 2], Bad: ['✕'] }, throw: { seed: 1, dice: [
      { key: '6', sides: 6, landed: [4, 1] },
      { key: 'Bad', sides: 2, landed: [1], faces: [{ text: '·' }, { text: '✕', s: ['miss'] }], color: 'danger' },
    ] } });
    expect(specs.map((s) => [s.key, s.sides, s.top, s.texts[s.top], s.danger])).toEqual([['6', 6, 4, '5', false], ['6', 6, 1, '2', false], ['Bad', 2, 1, '✕', true]]);
    expect(specs[2].faces).toEqual([{ text: '·' }, { text: '✕', s: ['miss'] }]);
  });

  it('from a server with no throw, are its results read as plain dice landing on what they show', () => {
    expect(diceOfRoll({ results: { 20: [17], Hunger: [3] }, diceSides: { Hunger: 10 } }).map((s) => [s.key, s.sides, s.top])).toEqual([['20', 20, 16], ['Hunger', 10, 2]]);
    expect(diceOfRoll({ results: { 8: [12] } })[0].top).toBe(7);
    expect(diceOfRoll({})).toEqual([]);
  });

  it('are at most a tray\'s worth', () => {
    expect(diceOfRoll({ results: { 6: Array(100).fill(3) } })).toHaveLength(MOST_DICE);
  });
});

describe('the tray as the camera sees it', () => {
  const camera = trayCamera();

  it('has the picture\'s own corners for its corners, at the height asked', () => {
    const { corners } = floorSeen(camera, 0.6);
    const seen = corners.map((p) => new THREE.Vector3(p.x, 0.6, p.z).project(camera));
    expect(seen.map((v) => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000])).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  });

  it('has a wall along each edge, the middle inside them all', () => {
    const { corners, walls, mid } = floorSeen(camera, 0.6);
    walls.forEach((w, i) => {
      for (const p of [corners[i], corners[(i + 1) % 4]]) expect(w.nx * p.x + w.nz * p.z - w.c).toBeCloseTo(0, 4);
      expect(w.nx * mid.x + w.nz * mid.z).toBeLessThan(w.c);
    });
  });

  it('is one shape on every screen', () => {
    expect(camera.aspect).toBe(TRAY_ASPECT);
  });
});

describe('a throw', () => {
  const camera = trayCamera();
  const thrown = throwDice(HANDFUL, 20261022, camera);
  const up = new THREE.Vector3(0, 1, 0);

  /** A die's corners where `p` puts them: the shape it is drawn as, at the size it is drawn. */
  const cornersAt = (die: ThrownDie, p: ThrownDie['path'][number]) => {
    const pos = die.shape.geometry.getAttribute('position');
    const q = new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw);
    return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).multiplyScalar(die.scale).applyQuaternion(q).add(new THREE.Vector3(p.x, p.y, p.z)));
  };
  /** Every twelfth step of a die's path (a tenth of a second), and its last. */
  const sampled = (die: ThrownDie) => [...die.path.filter((_, k) => k % 12 === 0), die.path[die.path.length - 1]];
  const onScreen = (v: THREE.Vector3, slack = 1.03) => { const s = v.clone().project(camera); return Math.abs(s.x) <= slack && Math.abs(s.y) <= slack; };

  it('is the same from the same seed, on any screen, and another from another', () => {
    const again = throwDice(HANDFUL, 20261022, trayCamera());
    expect(again.dice.map((x) => x.path)).toEqual(thrown.dice.map((x) => x.path));
    expect(again.dice.map((x) => [x.up, x.twist])).toEqual(thrown.dice.map((x) => [x.up, x.twist]));
    expect(throwDice(HANDFUL, 7, camera).dice.map((x) => x.path)).not.toEqual(thrown.dice.map((x) => x.path));
  });

  it('starts no two dice touching, each in its own lane, so none fly apart as they start', () => {
    for (const seed of [1, 20261022, 99]) {
      const starts = throwDice(HANDFUL, seed, camera).dice.map((die) => ({ p: die.path[0], r: die.shape.radius * die.scale }));
      for (let i = 0; i < starts.length; i += 1) for (let j = i + 1; j < starts.length; j += 1) {
        const a = starts[i].p; const b = starts[j].p;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), `seed ${seed}: ${i} and ${j}`).toBeGreaterThan(starts[i].r + starts[j].r - 0.3);
      }
    }
  });

  it('ends with nearly every die at rest, so the total is revealed as the dice stop', () => {
    let moving = 0; let count = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const die of throwDice(HANDFUL, seed, camera).dice) {
        count += 1;
        const n = die.path.length; const a = die.path[Math.max(0, n - 31)]; const b = die.path[n - 1];
        if (Math.hypot(b.x - a.x, b.z - a.z) > 0.06) moving += 1;
      }
    }
    // The felt grips harder late in a throw: without it, a prism or a coin is often still going.
    expect(moving / count).toBeLessThanOrEqual(0.005);
  }, 60000);

  it('keeps every corner of every die inside the walls, the whole way', () => {
    const walls = wallsFor(camera, thrown.dice[0].scale);
    for (const die of thrown.dice) {
      for (const p of sampled(die)) {
        for (const v of cornersAt(die, p)) for (const w of walls) expect(w.nx * v.x + w.nz * v.z, `d${die.spec.sides}`).toBeLessThanOrEqual(w.c + 0.06);
      }
    }
  });

  it('throws every die in from above the left of the tray, and keeps it in the picture once it has landed', () => {
    for (const seed of [1, 20261022, 99]) {
      for (const die of throwDice(HANDFUL, seed, camera).dice) {
        const start = new THREE.Vector3(die.path[0].x, die.path[0].y, die.path[0].z);
        expect(start.y, `d${die.spec.sides} seed ${seed}`).toBeGreaterThan(2);
        expect(start.clone().project(camera).x, `d${die.spec.sides} seed ${seed}`).toBeLessThan(0);
        // From its first touch of the floor: on the way in it may fly above the picture's top.
        const points = sampled(die);
        const landed = points.findIndex((p) => Math.min(...cornersAt(die, p).map((v) => v.y)) < 0.05);
        expect(landed, `d${die.spec.sides} seed ${seed}`).toBeGreaterThanOrEqual(0);
        for (const p of points.slice(landed)) for (const v of cornersAt(die, p)) expect(onScreen(v), `d${die.spec.sides} seed ${seed}`).toBe(true);
      }
    }
  });

  it("lands nearly every die flat on the floor, the face it landed on up (a d4's down), and none on its rim or end", () => {
    // As real dice do, now and then one comes to rest leaning on another or on top of one; never
    // standing on a coin's rim or a prism's end, which shows no number, and never in the floor.
    let off = 0; let leaning = 0; let count = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const die of throwDice(HANDFUL, seed, camera).dice) {
        count += 1;
        const lowest = Math.min(...cornersAt(die, die.path[die.path.length - 1]).map((v) => v.y));
        expect(lowest, `d${die.spec.sides} seed ${seed}`).toBeGreaterThan(-0.06);
        if (lowest > 0.05) off += 1;
        const facing = die.shape.faces[die.up].normal.clone().applyQuaternion(poseAt(die, 1e6).quaternion).dot(up) * (die.shape.down ? -1 : 1);
        expect(facing, `d${die.spec.sides} seed ${seed}`).toBeGreaterThan(0.75);
        if (facing < 0.9) leaning += 1;
      }
    }
    expect(off / count).toBeLessThanOrEqual(0.02);
    expect(leaning / count).toBeLessThanOrEqual(0.03);
  }, 60000);

  it('prints what the server rolled on the face that landed on top, its words read from the camera', () => {
    for (const die of thrown.dice) {
      const printed = printedOn(die);
      if (die.shape.down) {
        printed.forEach((t, k) => expect(t, `d4 face ${k}`).toBe(k === die.up ? '' : die.spec.texts[die.spec.top]));
        continue;
      }
      expect(printed[die.up], `d${die.spec.sides}`).toBe(die.spec.texts[die.spec.top]);
      // The words' own up, turned on the face and with the die, points away from the camera.
      const words = labelTurn(die.shape.faces[die.up].normal).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), die.twist));
      const wordsUp = new THREE.Vector3(0, 1, 0).applyQuaternion(words).applyQuaternion(poseAt(die, 1e6).quaternion);
      expect(wordsUp.z, `d${die.spec.sides}`).toBeLessThan(-0.85);
    }
  });

  it('tumbles on the way, and never jumps', () => {
    for (const die of thrown.dice) {
      let turned = 0;
      for (let k = 1; k < die.path.length; k += 1) {
        const a = die.path[k - 1]; const b = die.path[k];
        turned += new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw).angleTo(new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw));
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), `d${die.spec.sides} step ${k}`).toBeLessThan(0.4);
      }
      expect(turned, `d${die.spec.sides}`).toBeGreaterThan(Math.PI);
    }
  });

  it('spreads the dice over the tray rather than piling them in a corner', () => {
    // Measured as they are seen: how much of the picture's width and height the dice cover.
    for (const seed of [1, 20261022, 99]) {
      const seen = throwDice(HANDFUL, seed, camera).dice.map((die) => { const p = die.path[die.path.length - 1]; return new THREE.Vector3(p.x, p.y, p.z).project(camera); });
      expect(Math.max(...seen.map((v) => v.x)) - Math.min(...seen.map((v) => v.x)), `seed ${seed}`).toBeGreaterThan(0.75);
      expect(Math.max(...seen.map((v) => v.y)) - Math.min(...seen.map((v) => v.y)), `seed ${seed}`).toBeGreaterThan(0.6);
    }
  });

  it('settles in a few seconds, worked out quickly enough to draw', () => {
    const started = performance.now();
    const t = throwDice(HANDFUL, 5, camera);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(throwLength(t)).toBeGreaterThan(1);
    expect(throwLength(t)).toBeLessThanOrEqual(6);
    // Big dice are thrown as stand-ins of fewer faces: eight d100s took 16 seconds as themselves.
    const big = performance.now();
    throwDice(Array.from({ length: 8 }, (_, i) => d(100, i)), 5, camera);
    expect(performance.now() - big).toBeLessThan(3000);
  }, 30000);

  it('draws a handful smaller, and a tray\'s worth still inside', () => {
    expect(scaleFor(3, 60)).toBe(1);
    expect(scaleFor(40, 60)).toBeLessThan(scaleFor(10, 60));
    expect(scaleFor(1000, 60)).toBe(0.45);
    const lots = throwDice(Array.from({ length: MOST_DICE }, (_, i) => d(6, i % 6)), 5, camera);
    const walls = wallsFor(camera, lots.dice[0].scale);
    for (const die of lots.dice) {
      for (const v of cornersAt(die, die.path[die.path.length - 1])) for (const w of walls) expect(w.nx * v.x + w.nz * v.z).toBeLessThanOrEqual(w.c + 0.06);
    }
  });
});
