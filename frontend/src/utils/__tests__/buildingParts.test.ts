/**
 * A building's parts in its own frame, for the info window's turning preview.
 *
 * The preview draws the building alone, centered and fitted to a small box, so the numbers
 * that matter are where each part sits relative to the building, how big the whole thing
 * is, and that a turned building's parts are turned with it.
 */

import { describe, it, expect } from 'vitest';
import { buildingParts } from '../buildingParts';

const box = (over: Record<string, unknown> = {}) => ({
  id: 1, shape: 'box', x: 10, y: 0, z: 5, width: 2, height: 4, depth: 2, ...over,
});

describe('one part', () => {
  it('sits over the origin, standing on it', () => {
    const b = buildingParts(box());
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0].position[0]).toBeCloseTo(0);
    expect(b.parts[0].position[1]).toBeCloseTo(2); // half its height up
    expect(b.parts[0].position[2]).toBeCloseTo(0);
    expect(b.parts[0].scale).toEqual([2, 4, 2]);
  });

  it('knows its middle and its longest side, for fitting it to a view', () => {
    const b = buildingParts(box());
    expect(b.center[1]).toBeCloseTo(2);
    expect(b.size).toBeCloseTo(4);
  });

  it('never reports a size of zero, which would divide by nothing', () => {
    expect(buildingParts(box({ width: 0, height: 0, depth: 0 })).size).toBeGreaterThan(0);
  });

  it('keeps its shape and detail, defaulting where the row has none', () => {
    expect(buildingParts(box({ shape: 'cylinder', polyCount: 8 })).parts[0]).toMatchObject({ shape: 'cylinder', polyCount: 8 });
    expect(buildingParts(box({ shape: undefined, polyCount: undefined })).parts[0]).toMatchObject({ shape: 'box', polyCount: 5 });
  });
});

describe('several parts', () => {
  const root = box({ id: 1, x: 0, z: 0 });
  const wing = box({ id: 2, x: 4, z: 0, width: 2, height: 2 });

  it('places each relative to the whole, so the building keeps its layout', () => {
    const b = buildingParts(root, [wing]);
    const [r, w] = b.parts;
    // Four apart in the world, four apart here.
    expect(w.position[0] - r.position[0]).toBeCloseTo(4);
    expect(b.parts.map((p) => p.key)).toEqual(['1', '2']);
  });

  it('measures across every part, not just the root', () => {
    // Root spans x -1..1, the wing 3..5: six wide.
    expect(buildingParts(root, [wing]).size).toBeCloseTo(6);
  });

  it('turns the parts into the root\'s frame when the building is rotated', () => {
    // Rotated a quarter turn, the wing that lies along +x in the world lies along the
    // building's own z axis - so the preview, which turns the whole thing itself, draws
    // it the same way round the city does.
    const turned = buildingParts({ ...root, rotation: Math.PI / 2 }, [{ ...wing, rotation: Math.PI / 2 }]);
    const [r, w] = turned.parts;
    expect(Math.abs(w.position[2] - r.position[2])).toBeCloseTo(4);
    expect(Math.abs(w.position[0] - r.position[0])).toBeCloseTo(0);
    // And the wing is not turned again relative to the root.
    expect(w.rotation[1]).toBeCloseTo(0);
  });
});
