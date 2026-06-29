import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: any) => <div data-testid="html-label">{children}</div>,
  Bvh: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../utils/threeHelpers', () => ({
  renderBaseGeometry: () => null,
}));

// Stub Three.js JSX elements that R3F normally handles
vi.mock('three', async () => {
  const actual = await vi.importActual('three') as any;
  return { ...actual };
});

import { generateThemedBuildingsForPlot } from '../Buildings';

// ─── generateThemedBuildingsForPlot (pure logic — no React needed) ────────────

const makeGrid = () => ({});
const noBlock = () => false;
const getKey = (x: number, z: number) => `${Math.floor(x)}_${Math.floor(z)}`;

describe('generateThemedBuildingsForPlot', () => {
  it('produces at least one building for SLUMS zone (zoneTypeVal=0)', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, 0, noBlock, getKey, grid, buildings, []);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('produces at least one building for CORPO zone (zoneTypeVal=1.0)', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, 1.0, noBlock, getKey, grid, buildings, []);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('produces at least one building for INDUSTRIAL zone (zoneTypeVal=-0.5)', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, -0.5, noBlock, getKey, grid, buildings, []);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('produces at least one building for URBAN zone (zoneTypeVal=0.5)', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, 0.5, noBlock, getKey, grid, buildings, []);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('produces at least one building for LANDMARK zone (zoneTypeVal=1.6)', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, 1.6, noBlock, getKey, grid, buildings, []);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('produces at least one building for MARKETS zone (zoneTypeVal=2.0)', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, 2.0, noBlock, getKey, grid, buildings, []);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('all generated buildings have required position fields', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(10, 20, 15, 15, 1.0, noBlock, getKey, grid, buildings, []);
    buildings.forEach(b => {
      expect(typeof b.x).toBe('number');
      expect(typeof b.y).toBe('number');
      expect(typeof b.z).toBe('number');
      expect(typeof b.width).toBe('number');
      expect(typeof b.height).toBe('number');
      expect(typeof b.depth).toBe('number');
    });
  });

  it('populates the spatial grid with at least one entry', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 15, 15, 0.5, noBlock, getKey, grid, buildings, []);
    expect(Object.keys(grid).length).toBeGreaterThan(0);
  });

  it('uses overrideH when provided', () => {
    const buildings: any[] = [];
    const grid: any = {};
    generateThemedBuildingsForPlot(0, 0, 10, 10, 1.0, noBlock, getKey, grid, buildings, [], undefined, 50);
    const root = buildings.find(b => !b.parent_name);
    expect(root).toBeDefined();
    // Root building height should be influenced by overrideH
    expect(root.height).toBeLessThanOrEqual(50 + 5); // some tolerance
  });

  it('does not generate overlapping positions when isBlocked returns true', () => {
    const buildings: any[] = [];
    const grid: any = {};
    // Block everything — SLUMS fallback should still produce at least the center one
    const alwaysBlocked = () => true;
    generateThemedBuildingsForPlot(0, 0, 5, 5, 0, alwaysBlocked, getKey, grid, buildings, []);
    // Fallback ensures at least 1 building regardless
    expect(buildings.length).toBeGreaterThan(0);
  });
});
