import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { shapeOf, facesFrom, faceTexts, restingTurn, restingHeight, labelTurn, MOST_FACES } from '../diceShapes';

/**
 * The tray's dice (6c4b2a; mockup builder-dice version 6): a solid for any number of faces, each a
 * face it can land on, face 0 the one that lands up, its words printed square to the camera.
 */

const SIZES = [...Array.from({ length: 119 }, (_, i) => i + 2), 200, 999, 1000];
const up = new THREE.Vector3(0, 1, 0);

describe('a die of any size', () => {
  it('has as many faces to land on as its size, every one pointing out of the die and no two alike', () => {
    for (const n of SIZES) {
      const { faces } = shapeOf(n);
      expect(faces, `d${n}`).toHaveLength(n);
      for (const f of faces) {
        expect(f.normal.length(), `d${n}`).toBeCloseTo(1, 6);
        expect(f.normal.dot(f.center), `d${n}`).toBeGreaterThan(0);
      }
      let closest = -1;
      for (let i = 0; i < faces.length; i += 1) for (let j = i + 1; j < faces.length; j += 1) closest = Math.max(closest, faces[i].normal.dot(faces[j].normal));
      expect(closest, `d${n}`).toBeLessThan(0.99999);
    }
  });

  it('is the usual solid for 4, 6, 8, 12 and 20, a coin for 2, kites for any other even size and a prism for an odd one', () => {
    expect(shapeOf(2).geometry.type).toBe('CylinderGeometry');
    expect([4, 6, 8, 12, 20].map((n) => shapeOf(n).geometry.type)).toEqual(['TetrahedronGeometry', 'BoxGeometry', 'OctahedronGeometry', 'DodecahedronGeometry', 'IcosahedronGeometry']);
    // Its flat faces, counted from its triangles alone: every kite flat, and a prism's two ends besides.
    for (const n of [10, 14, 16, 24, 100]) expect(facesFrom(shapeOf(n).geometry), `d${n}`).toHaveLength(n);
    for (const n of [3, 5, 7, 13, 99]) expect(facesFrom(shapeOf(n).geometry), `d${n}`).toHaveLength(n + 2);
  });

  it('is kept to 2 to the most faces there are, a size that is no number a d6', () => {
    expect(shapeOf(1).faces).toHaveLength(2);
    expect(shapeOf(5000).faces).toHaveLength(MOST_FACES);
    expect(shapeOf(Number.NaN).faces).toHaveLength(6);
  });

  it('fits a ball about 2 across, however many faces it has', () => {
    for (const n of SIZES) {
      expect(shapeOf(n).radius, `d${n}`).toBeGreaterThan(0.6);
      expect(shapeOf(n).radius, `d${n}`).toBeLessThan(1.6);
    }
  });
});

describe('a die landed', () => {
  it('rests with face 0 up, a d4 with it down, its middle at face 0\'s height off the floor', () => {
    for (const n of SIZES) {
      const shape = shapeOf(n);
      const turned = shape.faces[0].normal.clone().applyQuaternion(restingTurn(shape, 0.3));
      expect(turned.dot(up), `d${n}`).toBeCloseTo(shape.down ? -1 : 1, 6);
      expect(restingHeight(shape), `d${n}`).toBeGreaterThan(0);
    }
    expect(shapeOf(4).down).toBe(true);
    expect(SIZES.filter((n) => shapeOf(n).down)).toEqual([4]);
  });

  it('turns face 0\'s words to read from the front, where the camera is', () => {
    for (const n of [2, 6, 8, 10, 12, 13, 20, 100]) {
      const shape = shapeOf(n);
      const top = shape.faces[0];
      // The words' own up, as printed on face 0 and turned with the die, points away from the camera.
      const wordsUp = new THREE.Vector3(0, 1, 0).applyQuaternion(labelTurn(top.normal)).applyQuaternion(restingTurn(shape));
      expect(wordsUp.z, `d${n}`).toBeLessThan(-0.99);
    }
  });

  it('prints what came up on face 0 and the die\'s other faces round the rest; a d4 prints it on the three it shows', () => {
    const d6 = shapeOf(6);
    const printed = faceTexts(['1', '2', '3', '4', '5', '6'], 4, d6);
    expect(printed[0]).toBe('5');
    expect([...printed].sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(faceTexts(['1', '2', '3', '4'], 2, shapeOf(4))).toEqual(['', '3', '3', '3']);
    // Words for a die of more faces than it has words for are printed again round it.
    expect(faceTexts(['+1', '0', '-1'], 2, d6)).toEqual(['-1', '+1', '0', '+1', '0', '+1']);
    expect(faceTexts(['·'], 0, shapeOf(2))).toEqual(['·', '']);
  });
});
