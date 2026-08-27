import { useState, useEffect, useCallback } from 'react';
import type * as THREE from 'three';

/**
 * Placing, selecting and repositioning signs.
 *
 * Six pieces of state that only make sense together, previously loose among the sixty-odd
 * App keeps. Placement waits for a click on the ground; selection drives which sign the
 * gizmo attaches to; the transform mode and its active flag belong to that gizmo; and the
 * mesh is what the gizmo hands back so its final position can be saved.
 *
 * Fetching signs is deliberately not here. That lives in useMapData beside the five other
 * map resources it is loaded with, and a sign is not special enough among them to be
 * pulled out on its own — doing so would leave `fetchAll` reaching across two hooks to do
 * one job.
 */
export function useSignEditing({ token, fetchSigns }: {
  token: string | null;
  fetchSigns: () => void;
}) {
  const [isPlacingSign, setIsPlacingSign] = useState(false);
  const [pendingSignPos, setPendingSignPos] = useState<{ x: number; z: number } | null>(null);
  const [selectedSignId, setSelectedSignId] = useState<number | null>(null);
  const [signMesh, setSignMesh] = useState<THREE.Mesh | null>(null);
  const [signTransformMode, setSignTransformMode] = useState<'translate' | 'rotate'>('translate');
  const [signTransformActive, setSignTransformActive] = useState(false);

  // Drop the gizmo when the selection moves. Leaving it armed pointed it at the sign that
  // was just deselected, and the next drag moved the wrong one.
  useEffect(() => { setSignTransformActive(false); }, [selectedSignId]);

  /** Turn a click on the ground into the spot the new sign will go. */
  const placeAt = useCallback((point: { x: number; z: number }) => {
    setPendingSignPos({ x: point.x, z: point.z });
    setIsPlacingSign(false);
  }, []);

  /**
   * Write the gizmo's final position and rotation back to the sign.
   *
   * The mesh is centred on its own height while the sign's stored y is its base, so the
   * half-height comes off on the way out. All three rotation axes are sent: a sign pitched
   * flat to act as a ground label used to lose that and spring upright on the next load.
   */
  const saveFromGizmo = useCallback(() => {
    if (!signMesh || !selectedSignId) return;
    signMesh.geometry.computeBoundingBox();
    const bb = signMesh.geometry.boundingBox;
    const halfH = bb ? (bb.max.y - bb.min.y) / 2 : 0;
    const { x, z } = signMesh.position;
    const y = signMesh.position.y - halfH;
    const { x: rotX, y: rotY, z: rotZ } = signMesh.rotation;

    fetch(`/api/signs/${selectedSignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ x, y, z, rotation_x: rotX, rotation_y: rotY, rotation_z: rotZ }),
    }).then(r => { if (!r.ok) console.error('Sign save failed:', r.status); fetchSigns(); });

    setSignTransformActive(false);
    setSelectedSignId(null);
    setSignMesh(null);
  }, [signMesh, selectedSignId, token, fetchSigns]);

  return {
    isPlacingSign, setIsPlacingSign,
    pendingSignPos, setPendingSignPos,
    selectedSignId, setSelectedSignId,
    signMesh, setSignMesh,
    signTransformMode, setSignTransformMode,
    signTransformActive, setSignTransformActive,
    placeAt,
    saveFromGizmo,
  };
}
