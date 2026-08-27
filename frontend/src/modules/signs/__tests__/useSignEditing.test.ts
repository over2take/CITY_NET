/**
 * The state behind placing and repositioning a sign.
 *
 * Two things here are worth pinning rather than the plain setters: the gizmo disarms when
 * the selection moves, and saving converts the mesh's centre back to the sign's base. Both
 * were loose in App before and neither was covered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSignEditing } from '../hooks/useSignEditing';

/** A stand-in for the THREE.Mesh the gizmo hands back. */
const meshAt = (x: number, y: number, z: number, rot = { x: 0, y: 0, z: 0 }) => ({
  position: { x, y, z },
  rotation: rot,
  geometry: {
    computeBoundingBox: vi.fn(),
    boundingBox: { min: { y: -1 }, max: { y: 1 } },   // two units tall, so half is 1
  },
}) as never;

let fetchSigns: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSigns = vi.fn();
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const setup = () => renderHook(() => useSignEditing({ token: 't', fetchSigns }));

describe('placing a sign', () => {
  it('takes the point clicked and stops waiting for another', () => {
    const { result } = setup();
    act(() => { result.current.setIsPlacingSign(true); });
    act(() => { result.current.placeAt({ x: 4, z: -2 }); });

    expect(result.current.pendingSignPos).toEqual({ x: 4, z: -2 });
    expect(result.current.isPlacingSign).toBe(false);
  });
});

describe('the gizmo disarms when the selection moves', () => {
  it('drops the active flag when a different sign is selected', () => {
    // Left armed, it pointed at the sign just deselected and the next drag moved the
    // wrong one.
    const { result } = setup();
    act(() => { result.current.setSelectedSignId(1); });
    act(() => { result.current.setSignTransformActive(true); });
    act(() => { result.current.setSelectedSignId(2); });

    expect(result.current.signTransformActive).toBe(false);
  });

  it('drops it when the selection is cleared', () => {
    const { result } = setup();
    act(() => { result.current.setSelectedSignId(1); });
    act(() => { result.current.setSignTransformActive(true); });
    act(() => { result.current.setSelectedSignId(null); });

    expect(result.current.signTransformActive).toBe(false);
  });
});

describe('saving what the gizmo moved', () => {
  const save = (mesh: unknown) => {
    const { result } = setup();
    act(() => { result.current.setSelectedSignId(7); });
    act(() => { result.current.setSignMesh(mesh as never); });
    act(() => { result.current.saveFromGizmo(); });
    return result;
  };

  it('converts the mesh centre back to the sign base', () => {
    // The mesh is centred on its own height; the stored y is the bottom edge. A sign
    // whose centre sits at 5 with a half-height of 1 has its base at 4.
    save(meshAt(3, 5, -6));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ x: 3, y: 4, z: -6 });
  });

  it('sends all three rotation axes', () => {
    // A sign pitched flat as a ground label used to lose that and spring upright on load.
    save(meshAt(0, 1, 0, { x: -Math.PI / 2, y: 0.5, z: 0.25 }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.rotation_x).toBeCloseTo(-Math.PI / 2);
    expect(body.rotation_y).toBeCloseTo(0.5);
    expect(body.rotation_z).toBeCloseTo(0.25);
  });

  it('patches the selected sign, and reloads afterwards', async () => {
    save(meshAt(0, 1, 0));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/signs/7');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    await vi.waitFor(() => expect(fetchSigns).toHaveBeenCalled());
  });

  it('lets go of the sign once it is saved', () => {
    // Otherwise the gizmo stays on a sign the server has already been told about.
    const result = save(meshAt(0, 1, 0));
    expect(result.current.selectedSignId).toBeNull();
    expect(result.current.signMesh).toBeNull();
    expect(result.current.signTransformActive).toBe(false);
  });

  it('does nothing without a mesh or without a selection', () => {
    const { result } = setup();
    act(() => { result.current.saveFromGizmo(); });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => { result.current.setSignMesh(meshAt(0, 1, 0)); });
    act(() => { result.current.saveFromGizmo(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
