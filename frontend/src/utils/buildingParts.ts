import * as THREE from 'three';

// A building's parts, placed relative to the building rather than the world.
//
// The same arithmetic Buildings.tsx does to draw a structure in the city - the root and
// every child part, each offset from the group's centre and turned into the root's frame -
// pulled out so something else can draw the building on its own. The info window's preview
// spins it in a box a couple of hundred pixels wide, so it also needs to know how big the
// whole thing is in order to fit it.

interface PartRow {
  id?: number;
  shape?: string;
  polyCount?: number;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  rotation?: number; rotation_x?: number; rotation_z?: number;
}

export interface LocalPart {
  key: string;
  shape: string;
  polyCount: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface LocalBuilding {
  parts: LocalPart[];
  /** Where the middle of the whole building sits, in the same frame as the parts. */
  center: [number, number, number];
  /** The longest side of the whole building, for fitting it to a view. Never zero. */
  size: number;
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** The root and its children, in the root's own frame, centred for a preview. */
export const buildingParts = (root: PartRow, children: PartRow[] = []): LocalBuilding => {
  const all = [root, ...children].filter(Boolean);

  // The group's origin: centred on the footprint, standing on the lowest part. The same
  // point Buildings.tsx puts the group at, so the parts come out where the city draws them.
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let minY = Infinity;
  for (const p of all) {
    minX = Math.min(minX, num(p.x) - num(p.width, 1) / 2); maxX = Math.max(maxX, num(p.x) + num(p.width, 1) / 2);
    minZ = Math.min(minZ, num(p.z) - num(p.depth, 1) / 2); maxZ = Math.max(maxZ, num(p.z) + num(p.depth, 1) / 2);
    minY = Math.min(minY, num(p.y));
  }
  const origin = new THREE.Vector3((minX + maxX) / 2, minY, (minZ + maxZ) / 2);

  const rootQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(num(root.rotation_x), num(root.rotation), num(root.rotation_z), 'YXZ'),
  );
  const rootInv = rootQuat.clone().invert();

  const box = new THREE.Box3();
  const parts: LocalPart[] = all.map((p, i) => {
    const offset = new THREE.Vector3(num(p.x), num(p.y) + num(p.height, 1) / 2, num(p.z))
      .sub(origin)
      .applyQuaternion(rootInv);
    const partQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(num(p.rotation_x), num(p.rotation), num(p.rotation_z), 'YXZ'),
    );
    const local = new THREE.Euler().setFromQuaternion(rootInv.clone().multiply(partQuat), 'YXZ');
    const scale: [number, number, number] = [num(p.width, 1), num(p.height, 1), num(p.depth, 1)];

    // Each part's own box, turned, so a tilted wing still counts its full reach.
    const partBox = new THREE.Box3(
      new THREE.Vector3(-scale[0] / 2, -scale[1] / 2, -scale[2] / 2),
      new THREE.Vector3(scale[0] / 2, scale[1] / 2, scale[2] / 2),
    ).applyMatrix4(new THREE.Matrix4().compose(offset, new THREE.Quaternion().setFromEuler(local), new THREE.Vector3(1, 1, 1)));
    box.union(partBox);

    return {
      key: String(p.id ?? i),
      shape: p.shape || 'box',
      polyCount: num(p.polyCount, 5) || 5,
      position: [offset.x, offset.y, offset.z],
      rotation: [local.x, local.y, local.z],
      scale,
    };
  });

  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  return {
    parts,
    center: [c.x, c.y, c.z],
    size: Math.max(s.x, s.y, s.z) || 1,
  };
};
