import * as THREE from 'three';

// Where the middle of the screen meets the ground, for things made "here": a pasted structure, a new token, an NPC placed
// from the library. Moved out of AdminPanel so the NPC library can place at the same spot.

/** As much of the camera controls as this reads. */
export interface ViewControls {
  _camera?: THREE.Camera;
  camera?: THREE.Camera;
  getTarget?: (out: THREE.Vector3) => void;
}

/** The ground point under the middle of the view, { tx, tz }; 0, 0 with no controls. */
export const viewCenterOf = (controls: ViewControls | null | undefined): { tx: number; tz: number } => {
  let tx = 0;
  let tz = 0;
  if (controls) {
    const camera = controls._camera || controls.camera;
    if (camera) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(0, 0), camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      rc.ray.intersectPlane(plane, target);
      tx = target.x;
      tz = target.z;
    } else if (controls.getTarget) {
      const t = new THREE.Vector3();
      controls.getTarget(t);
      tx = t.x;
      tz = t.z;
    }
  }
  return { tx, tz };
};
