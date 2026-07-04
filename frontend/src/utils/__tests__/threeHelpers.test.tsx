import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderBaseGeometry } from '../threeHelpers';

// R3F geometry JSX is just React.createElement('geometryName', { args: [...] }).
// Inspect the element directly — no rendering or WebGL context needed.
const getGeo = (shape: string, polyCount?: number) => {
  const el = renderBaseGeometry(shape, polyCount) as React.ReactElement<{ args: number[] }>;
  return { type: el.type as string, args: el.props.args };
};

describe('renderBaseGeometry', () => {
  it('none → tiny boxGeometry so object is invisible', () => {
    const { type, args } = getGeo('none');
    expect(type).toBe('boxGeometry');
    args.forEach(v => expect(v).toBeLessThanOrEqual(0.001));
  });

  it('box (default) → unit boxGeometry 1×1×1', () => {
    const { type, args } = getGeo('box');
    expect(type).toBe('boxGeometry');
    expect(args).toEqual([1, 1, 1]);
  });

  it('unknown shape falls back to boxGeometry 1×1×1', () => {
    const { type, args } = getGeo('nonexistent_shape');
    expect(type).toBe('boxGeometry');
    expect(args).toEqual([1, 1, 1]);
  });

  it('cylinder → cylinderGeometry with polyCount radial segments', () => {
    const { type, args } = getGeo('cylinder', 12);
    expect(type).toBe('cylinderGeometry');
    expect(args[3]).toBe(12); // args: [radiusTop, radiusBottom, height, radialSegments]
  });

  it('cylinder enforces minimum 3 segments', () => {
    const { type, args } = getGeo('cylinder', 1);
    expect(type).toBe('cylinderGeometry');
    expect(args[3]).toBe(3);
  });

  it('sphere → sphereGeometry with polyCount on both segment axes', () => {
    const { type, args } = getGeo('sphere', 16);
    expect(type).toBe('sphereGeometry');
    expect(args[1]).toBe(16);
    expect(args[2]).toBe(16);
  });

  it('sphere enforces minimum 3 segments on both axes', () => {
    const { type, args } = getGeo('sphere', 0);
    expect(type).toBe('sphereGeometry');
    expect(args[1]).toBe(3);
    expect(args[2]).toBe(3);
  });

  it('rhombus → octahedronGeometry (polyCount ignored)', () => {
    const { type } = getGeo('rhombus', 99);
    expect(type).toBe('octahedronGeometry');
  });

  it('pyramid → coneGeometry with polyCount radial segments', () => {
    const { type, args } = getGeo('pyramid', 8);
    expect(type).toBe('coneGeometry');
    expect(args[2]).toBe(8);
  });

  it('pyramid enforces minimum 3 segments', () => {
    const { type, args } = getGeo('pyramid', 2);
    expect(type).toBe('coneGeometry');
    expect(args[2]).toBe(3);
  });

  it('polyCount defaults to 5 when omitted', () => {
    const { args } = getGeo('cylinder');
    expect(args[3]).toBe(5);
  });
});
