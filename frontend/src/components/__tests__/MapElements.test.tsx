import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as THREE from 'three';

const mockDomElement = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: new THREE.Vector3(), updateMatrixWorld: vi.fn() },
    gl: { domElement: mockDomElement },
    controls: { enabled: true, moveTo: vi.fn(), getTarget: vi.fn((v: any) => v), target: new THREE.Vector3(), update: vi.fn(), minPolarAngle: 0, maxPolarAngle: Math.PI },
  }),
}));

vi.mock('@react-three/drei', () => ({
  Line: ({ points }: any) => <line data-testid="road-line" />,
}));

vi.mock('three', async () => {
  const actual = await vi.importActual('three') as any;
  return { ...actual };
});

import { Roads, WaterBody, WaterBodies, GhostTraffic, DistrictInteractions } from '../MapElements';
import { getClosestPointOnRoads } from '../../utils/roadHelpers';

const makeRoad = (overrides = {}): any => ({
  id: 1, x1: 0, z1: 0, x2: 10, z2: 0, width: 2, color: '#00ff00',
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

// ─── Roads ────────────────────────────────────────────────────────────────────

describe('Roads', () => {
  it('renders the instanced mesh container', () => {
    // Roads uses instanced mesh which requires a real WebGL context;
    // verify the component mounts without crashing at the JSX level.
    // The useEffect guard bails when refs lack Three.js API methods (jsdom).
    const { container } = render(<Roads roads={[]} />);
    expect(container).toBeDefined();
  });
});

// ─── WaterBody ────────────────────────────────────────────────────────────────

describe('WaterBody', () => {
  it('renders without crashing', () => {
    const body = { id: 1, trail: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }], color: '#0044ff' };
    expect(() => render(<WaterBody body={body} />)).not.toThrow();
  });
});

// ─── WaterBodies ──────────────────────────────────────────────────────────────

describe('WaterBodies', () => {
  it('renders without crashing with empty array', () => {
    expect(() => render(<WaterBodies waterBodies={[]} />)).not.toThrow();
  });

  it('renders without crashing with water bodies', () => {
    const bodies = [{ id: 1, trail: [{ x: 0, z: 0 }, { x: 5, z: 0 }], color: '#0044ff' }];
    expect(() => render(<WaterBodies waterBodies={bodies} />)).not.toThrow();
  });
});

// ─── GhostTraffic ─────────────────────────────────────────────────────────────

describe('GhostTraffic', () => {
  it('renders without crashing with empty roads', () => {
    expect(() => render(<GhostTraffic roads={[]} />)).not.toThrow();
  });

  it('renders without crashing with roads', () => {
    expect(() => render(<GhostTraffic roads={[makeRoad(), makeRoad({ id: 2, x2: 20 })]} />)).not.toThrow();
  });
});

// ─── DistrictInteractions ─────────────────────────────────────────────────────

describe('DistrictInteractions', () => {
  const baseProps = {
    view: 'list',
    locations: [],
    onSelectionChange: vi.fn(),
    roadTrail: [],
    setRoadTrail: vi.fn(),
    waterTrail: [],
    setWaterTrail: vi.fn(),
    onWaterDrawEnd: vi.fn(),
    roadDrawMode: 'freehand',
    snapToGrid: false,
    drawingRoadWidth: 2,
    isBatchSelecting: false,
    setSelectedIds: vi.fn(),
    rhombusState: { active: false, color: '#00ff00', name: '', description: '', hp_max: 0 },
    setRhombusState: vi.fn(),
    userName: 'GHOST',
    refreshLocations: vi.fn(),
    token: '',
  };

  it('renders without crashing in list view', () => {
    expect(() => render(<DistrictInteractions {...baseProps} />)).not.toThrow();
  });

  it('renders without crashing in draw_roads view', () => {
    expect(() => render(<DistrictInteractions {...baseProps} view="draw_roads" />)).not.toThrow();
  });

  it('renders without crashing in draw_water view', () => {
    expect(() => render(<DistrictInteractions {...baseProps} view="draw_water" />)).not.toThrow();
  });
});

// ─── getClosestPointOnRoads ───────────────────────────────────────────────────

describe('getClosestPointOnRoads', () => {
  it('returns input coords when no roads', () => {
    const result = getClosestPointOnRoads(5, 10, []);
    expect(result).toEqual({ x: 5, z: 10 });
  });

  it('snaps to the closest road within maxSnapDistance', () => {
    const road = makeRoad({ x1: 0, z1: 0, x2: 20, z2: 0 });
    const result = getClosestPointOnRoads(10, 3, [road], 15);
    expect(result.z).toBeCloseTo(0, 1);
    expect(result.x).toBeCloseTo(10, 1);
  });

  it('returns input coords when all roads are beyond maxSnapDistance', () => {
    const road = makeRoad({ x1: 100, z1: 100, x2: 200, z2: 100 });
    const result = getClosestPointOnRoads(5, 5, [road], 10);
    expect(result).toEqual({ x: 5, z: 5 });
  });

  it('handles multiple roads and picks the closest', () => {
    const roads = [
      makeRoad({ id: 1, x1: 0, z1: 0, x2: 20, z2: 0 }),
      makeRoad({ id: 2, x1: 0, z1: 50, x2: 20, z2: 50 }),
    ];
    const result = getClosestPointOnRoads(10, 2, roads, 15);
    // Should snap to the first road (z=0) not the second (z=50)
    expect(result.z).toBeCloseTo(0, 1);
  });
});
