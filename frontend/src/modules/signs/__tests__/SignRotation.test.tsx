import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../../../components/AdminPanel';

/**
 * Signs originally persisted yaw only, so one pitched flat to serve as a ground
 * label sprang back upright on reload. These cover the UI half of the fix.
 */

const LAY_FLAT = -Math.PI / 2;

/** Stands in for the THREE.Mesh the gizmo hands back. */
const makeSignMesh = () => ({
  position: { x: 4, y: 5, z: 6 },
  rotation: { x: 0, y: 0, z: 0 },
  geometry: {
    computeBoundingBox: vi.fn(),
    boundingBox: { max: { y: 1 }, min: { y: -1 } },
  },
});

const makeSign = (over: any = {}) => ({
  id: 7,
  text: 'DOCKS',
  x: 0, y: 0, z: 0,
  rotation_x: 0, rotation_y: 0, rotation_z: 0,
  font_size: 1,
  font_family: 'monospace',
  image_url: null,
  use_tv_filter: 0,
  filter_intensity: 1,
  lines: null,
  ...over,
});

const signProps = (over: any = {}): any => ({
  socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
  token: 'admintoken',
  view: 'signs',
  setView: vi.fn(),
  locations: [],
  roads: [],
  signs: [makeSign()],
  fetchSigns: vi.fn(),
  remoteFonts: [],
  setRemoteFonts: vi.fn(),
  isPlacingSign: false,
  setIsPlacingSign: vi.fn(),
  pendingSignPos: null,
  setPendingSignPos: vi.fn(),
  selectedSignId: 7,
  setSelectedSignId: vi.fn(),
  signTransformMode: 'rotate',
  setSignTransformMode: vi.fn(),
  signTransformActive: false,
  setSignTransformActive: vi.fn(),
  handleUpdateSign: vi.fn(),
  controlsRef: { current: null },
  signMesh: null,
  isAdmin: true,
  ...over,
});

const sliderValue = (label: RegExp) => {
  const node = screen.getByText(label).parentElement!;
  return parseFloat(node.querySelector('input[type="range"]')!.getAttribute('value')!);
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 7 }) } as Response),
  ));
});

describe('sign rotation controls', () => {
  it('exposes a slider for every axis, not just yaw', () => {
    render(<AdminPanel {...signProps()} />);
    expect(screen.getByText(/ROTATION_X/)).toBeInTheDocument();
    expect(screen.getByText(/ROTATION_Y/)).toBeInTheDocument();
    expect(screen.getByText(/ROTATION_Z/)).toBeInTheDocument();
  });

  it('loads an existing pitch into the form', () => {
    render(<AdminPanel {...signProps({ signs: [makeSign({ rotation_x: LAY_FLAT })] })} />);
    expect(sliderValue(/ROTATION_X/)).toBeCloseTo(LAY_FLAT, 2);
  });

  it('treats a legacy sign with null rotation as zero', () => {
    // Rows created before the columns existed come back null; a null would leave
    // the slider uncontrolled.
    render(<AdminPanel {...signProps({ signs: [makeSign({ rotation_x: null, rotation_z: null })] })} />);
    expect(sliderValue(/ROTATION_X/)).toBe(0);
    expect(sliderValue(/ROTATION_Z/)).toBe(0);
  });

  it('LAY_FLAT pitches the sign face-up for use as a label', async () => {
    render(<AdminPanel {...signProps()} />);
    await userEvent.click(screen.getByText('LAY_FLAT'));
    expect(sliderValue(/ROTATION_X/)).toBeCloseTo(LAY_FLAT, 2);
  });

  it('LAY_FLAT drives the live mesh so the change is visible before saving', async () => {
    const signMesh = makeSignMesh();
    render(<AdminPanel {...signProps({ signMesh })} />);
    await userEvent.click(screen.getByText('LAY_FLAT'));
    expect(signMesh.rotation.x).toBeCloseTo(LAY_FLAT);
    expect(signMesh.rotation.z).toBe(0);
  });

  it('STAND_UP returns a flattened sign to upright', async () => {
    const signMesh = makeSignMesh();
    render(<AdminPanel {...signProps({ signs: [makeSign({ rotation_x: LAY_FLAT })], signMesh })} />);
    await userEvent.click(screen.getByText('STAND_UP'));
    expect(sliderValue(/ROTATION_X/)).toBe(0);
    expect(signMesh.rotation.x).toBe(0);
  });
});

describe('sign rotation saving', () => {
  const patchBody = () => {
    const call = (fetch as any).mock.calls.find(
      ([, opts]: any[]) => opts?.method === 'PATCH',
    );
    return call ? JSON.parse(call[1].body) : null;
  };

  it('sends all three axes, not just yaw', async () => {
    const signMesh = makeSignMesh();
    signMesh.rotation.x = LAY_FLAT;
    signMesh.rotation.y = 1.25;
    signMesh.rotation.z = -0.5;

    render(<AdminPanel {...signProps({ signMesh })} />);
    await userEvent.click(screen.getByText('SAVE CHANGES'));

    const body = patchBody();
    expect(body).not.toBeNull();
    expect(body.rotation_x).toBeCloseTo(LAY_FLAT);
    expect(body.rotation_y).toBeCloseTo(1.25);
    expect(body.rotation_z).toBeCloseTo(-0.5);
  });

  it('saves the pitch set by LAY_FLAT', async () => {
    const signMesh = makeSignMesh();
    render(<AdminPanel {...signProps({ signMesh })} />);
    await userEvent.click(screen.getByText('LAY_FLAT'));
    await userEvent.click(screen.getByText('SAVE CHANGES'));
    expect(patchBody().rotation_x).toBeCloseTo(LAY_FLAT);
  });
});
