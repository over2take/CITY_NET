import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { seeded, diceOfRoll, floorSeen, wallsFor, trayCamera, throwDice, throwLength, poseAt, printedOn, scaleFor, MOST_DICE, TRAY_ASPECT, type DieSpec } from '../trayThrow';

/**
 * A throw in the tray (6c4b2a; mockup builder-dice, decision 9): the server's dice tumbled in from
 * its seed and landed on the faces that came up, the same on every screen, never past the edges of
 * the tray as it is shown (the old tray's walls were wider than the picture, and dice left it).
 */

const d = (sides: number, top: number, more: Partial<DieSpec> = {}): DieSpec => ({ key: String(sides), sides, texts: Array.from({ length: sides }, (_, i) => String(i + 1)), top, danger: false, ...more });
const HANDFUL = [d(20, 19), d(6, 4), d(6, 0), d(8, 2), d(4, 3), d(10, 9), d(12, 5), d(13, 12), d(2, 1), d(100, 41)];
const up = new THREE.Vector3(0, 1, 0);

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
  // The walls the throw keeps its dice to, at the size this handful is drawn.
  const walls = wallsFor(camera, thrown.dice[0].scale);

  it('is the same from the same seed, on any screen, and another from another', () => {
    const again = throwDice(HANDFUL, 20261022, trayCamera());
    expect(again.dice.map((x) => x.path)).toEqual(thrown.dice.map((x) => x.path));
    expect(throwDice(HANDFUL, 7, camera).dice.map((x) => x.path)).not.toEqual(thrown.dice.map((x) => x.path));
  });

  /** The path from the step a die is first wholly inside the walls; every die gets there. */
  const once = (die: (typeof thrown.dice)[number]) => {
    const r = die.shape.radius * die.scale;
    const from = die.path.findIndex((p) => walls.every((w) => w.nx * p.x + w.nz * p.z <= w.c - r + 1e-9));
    expect(from, `d${die.spec.sides}`).toBeGreaterThanOrEqual(0);
    return die.path.slice(from);
  };

  it("throws every die in from beyond the tray's left edge, across the floor", () => {
    for (const die of thrown.dice) {
      const start = new THREE.Vector3(die.path[0].x, die.path[0].y, die.path[0].z).project(camera);
      const end = die.path[die.path.length - 1];
      expect(start.x, `d${die.spec.sides}`).toBeLessThan(-0.6);
      expect(end.x - die.path[0].x, `d${die.spec.sides}`).toBeGreaterThan(3 * die.scale);
    }
  });

  it('keeps every die wholly inside the tray as shown, once it is in', () => {
    for (const die of thrown.dice) {
      const r = die.shape.radius * die.scale;
      for (const p of once(die)) for (const w of walls) expect(w.nx * p.x + w.nz * p.z, `d${die.spec.sides}`).toBeLessThanOrEqual(w.c - r + 1e-6);
    }
  });

  it('keeps every die in the picture once it is in, its foot and its top, edge to edge', () => {
    // The camera looks down at a slant: a die by the back wall shows its top highest, one by the
    // front its foot lowest. Both, a die's width either side, stay on the screen, to a pixel.
    for (const seed of [1, 20261022, 99]) {
      for (const die of throwDice(HANDFUL, seed, camera).dice) {
        const r = die.shape.radius * die.scale;
        const inFrom = die.path.findIndex((p) => [[p.x - r, 0, p.z], [p.x + r, 0, p.z], [p.x, 0, p.z + r], [p.x, 1.7 * die.scale, p.z - r]]
          .every(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(camera); return Math.abs(v.x) <= 1.002 && Math.abs(v.y) <= 1.002; }));
        expect(inFrom, `d${die.spec.sides} seed ${seed}`).toBeGreaterThanOrEqual(0);
        for (const p of die.path.slice(inFrom)) {
          for (const [x, y, z] of [[p.x - r, 0, p.z], [p.x + r, 0, p.z], [p.x, 0, p.z + r], [p.x, 1.7 * die.scale, p.z - r]]) {
            const v = new THREE.Vector3(x, y, z).project(camera);
            expect(Math.abs(v.x), `d${die.spec.sides} seed ${seed}`).toBeLessThanOrEqual(1.002);
            expect(Math.abs(v.y), `d${die.spec.sides} seed ${seed}`).toBeLessThanOrEqual(1.002);
          }
        }
      }
    }
  });

  it('tumbles over and over on the way in, turning faster than it would just rolling', () => {
    for (const die of thrown.dice) {
      // How far it turns, as the tray draws it, against how far a die rolling that way would.
      let turned = 0;
      for (let s = 0; s < throwLength(thrown); s += 0.02) turned += poseAt(die, s).quaternion.angleTo(poseAt(die, s + 0.02).quaternion);
      const rolling = die.path[die.path.length - 1].went / (die.shape.radius * die.scale);
      expect(turned, `d${die.spec.sides}`).toBeGreaterThan(2 * Math.PI);
      expect(turned / rolling, `d${die.spec.sides}`).toBeGreaterThan(2);
    }
  });

  it('moves every die smoothly, step to step, never jumping into place', () => {
    for (const seed of [1, 20261022, 99]) {
      for (const die of throwDice(HANDFUL, seed, camera).dice) {
        for (let k = 1; k < die.path.length; k += 1) {
          const a = die.path[k - 1]; const b = die.path[k];
          expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), `d${die.spec.sides} seed ${seed} step ${k}`).toBeLessThan(0.4);
        }
      }
    }
  });

  it('spreads the dice over the tray rather than piling them in a corner', () => {
    // Measured as they are seen: how much of the picture's width and height the dice cover.
    for (const seed of [1, 20261022, 99]) {
      const seen = throwDice(HANDFUL, seed, camera).dice.map((die) => { const p = die.path[die.path.length - 1]; return new THREE.Vector3(p.x, p.y, p.z).project(camera); });
      expect(Math.max(...seen.map((v) => v.x)) - Math.min(...seen.map((v) => v.x)), `seed ${seed}`).toBeGreaterThan(1);
      expect(Math.max(...seen.map((v) => v.y)) - Math.min(...seen.map((v) => v.y)), `seed ${seed}`).toBeGreaterThan(0.8);
    }
  });

  it('lands every die on the floor, at rest, with what came up on top', () => {
    for (const die of thrown.dice) {
      const end = poseAt(die, throwLength(thrown) + 1);
      expect(end.position.y, `d${die.spec.sides}`).toBeCloseTo(die.shape.faces[0].normal.dot(die.shape.faces[0].center) * die.scale, 6);
      expect(end.quaternion.angleTo(die.final), `d${die.spec.sides}`).toBeLessThan(1e-6);
      const facing = die.shape.faces[0].normal.clone().applyQuaternion(end.quaternion);
      expect(facing.dot(up), `d${die.spec.sides}`).toBeCloseTo(die.shape.down ? -1 : 1, 6);
      // ...and printed on that face, the face the server rolled.
      expect(printedOn(die)[die.shape.down ? 1 : 0], `d${die.spec.sides}`).toBe(die.spec.texts[die.spec.top]);
    }
  });

  it('comes to rest with the dice apart, after a moment', () => {
    const ends = thrown.dice.map((die) => ({ p: die.path[die.path.length - 1], r: die.shape.radius * die.scale }));
    for (let i = 0; i < ends.length; i += 1) for (let j = i + 1; j < ends.length; j += 1) {
      const gap = Math.hypot(ends[i].p.x - ends[j].p.x, ends[i].p.z - ends[j].p.z);
      expect(gap, `${i} ${j}`).toBeGreaterThanOrEqual(ends[i].r + ends[j].r - 0.05);
    }
    expect(throwLength(thrown)).toBeGreaterThan(0.6);
    expect(throwLength(thrown)).toBeLessThanOrEqual(4);
  });

  it('tumbles on the way: a die mid-throw is elsewhere and turned another way', () => {
    const die = thrown.dice[0];
    const mid = poseAt(die, 0.1);
    const end = poseAt(die, throwLength(thrown));
    expect(mid.position.distanceTo(end.position)).toBeGreaterThan(0.5);
    expect(mid.quaternion.angleTo(end.quaternion)).toBeGreaterThan(0.3);
  });

  it('draws a handful smaller, and a tray\'s worth still inside', () => {
    expect(scaleFor(3, 60)).toBe(1);
    expect(scaleFor(40, 60)).toBeLessThan(scaleFor(10, 60));
    expect(scaleFor(1000, 60)).toBe(0.45);
    const lots = throwDice(Array.from({ length: MOST_DICE }, (_, i) => d(6, i % 6)), 5, camera);
    for (const die of lots.dice) {
      const p = die.path[die.path.length - 1];
      for (const w of wallsFor(camera, die.scale)) expect(w.nx * p.x + w.nz * p.z).toBeLessThanOrEqual(w.c - die.shape.radius * die.scale + 1e-6);
    }
  });
});
