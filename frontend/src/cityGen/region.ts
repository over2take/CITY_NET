import { pointInPolygon, type Polygon } from './water';
import { isTokenShape } from '../utils/mapExportBounds';
import { isUserDefinedName } from '../utils/locationHelpers';
import type { Bounds } from './types';

/**
 * What a regenerate would clear from a region.
 *
 * Kept out of the panel so the rule is stated once and can be tested directly rather
 * than through a rendered component. It is advisory — the server decides what actually
 * goes — but it has to apply the same rules, or the count shown is a different number
 * from the one that happens.
 */

/** Only the fields the test reads, so callers need not build a full Location. */
export interface RegionCandidate {
  name?: string | null;
  x: number;
  z: number;
  shape?: string;
  battle_map_id?: number | null;
}

export interface RegionCounts {
  /** Generated structures that would be removed. */
  removed: number;
  /** GM-named structures that survive and become obstacles for the new city. */
  kept: number;
}

/** Region test, preferring a drawn polygon over its bounding box. */
export function makeRegionTest(
  bounds: Bounds,
  polygon?: { x: number; z: number }[] | null,
): (x: number, z: number) => boolean {
  if (polygon && polygon.length >= 3) {
    const poly: Polygon = { points: polygon };
    return (x, z) => pointInPolygon(poly, x, z);
  }
  const minX = Math.min(bounds.min.x, bounds.max.x);
  const maxX = Math.max(bounds.min.x, bounds.max.x);
  const minZ = Math.min(bounds.min.z, bounds.max.z);
  const maxZ = Math.max(bounds.min.z, bounds.max.z);
  return (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

export function countGeneratedInRegion(
  locations: RegionCandidate[],
  bounds: Bounds,
  polygon?: { x: number; z: number }[] | null,
): RegionCounts {
  const inside = makeRegionTest(bounds, polygon);

  let removed = 0;
  let kept = 0;
  for (const l of locations ?? []) {
    // Battle map content and tokens are never map generation output.
    if (l.battle_map_id != null) continue;
    if (isTokenShape(l.shape ?? '')) continue;
    if (!inside(l.x, l.z)) continue;
    if (isUserDefinedName(l.name ?? '')) kept++;
    else removed++;
  }
  return { removed, kept };
}
