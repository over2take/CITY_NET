import type { Rng, SectionType } from './types';

/**
 * Zone types are encoded as a single number so the building generators can
 * treat them as a continuum:
 *   < 0      industrial
 *   0 – 0.25 slums
 *   0.25–0.7 urban
 *   > 0.7    corporate
 */
export const ZONE = {
  INDUSTRIAL: -0.1,
  SLUMS: 0.1,
  URBAN: 0.5,
  CORPO: 0.9,
} as const;

/** Where the slum and industrial wedges sit, in radians from city centre. */
export interface SectorLayout {
  slumAngle: number;
  industrialAngle: number;
}

/**
 * Pick the angular position of the slum and industrial districts.
 * Industrial is offset 117°–180° from slums so the two don't overlap.
 */
export function createSectorLayout(rng: Rng): SectorLayout {
  const slumAngle = rng() * Math.PI * 2;
  const industrialAngle = slumAngle + Math.PI * (0.65 + rng() * 0.35);
  return { slumAngle, industrialAngle };
}

/** Distance from centre, normalized to 0 (core) … 1 (edge). */
export function normalizedDistance(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  maxRadius: number
): number {
  const dist = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
  return Math.min(1.0, dist / maxRadius);
}

/**
 * Parks cluster near the core (up to 20%) and taper to zero at the slum
 * boundary — the outskirts get no green space.
 */
export function parkProbability(normDist: number): number {
  if (normDist > 0.8) return 0.0;
  return 0.20 * (1.0 - normDist / 0.8);
}

/** Smallest absolute angle between two headings. */
function angleBetween(a: number, b: number): number {
  let diff = Math.abs(a - b);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff;
}

/**
 * Decide what a block becomes.
 *
 * Fixed presets return their zone directly. MIXED builds a concentric-ring
 * city: a corporate core, an urban middle, and slums / industry pushed to the
 * outskirts inside their own angular wedges.
 *
 * Always consumes at least one rng draw so the sequence stays stable across
 * section types.
 */
export function assignZoneType(
  blockX: number,
  blockZ: number,
  centerX: number,
  centerZ: number,
  normDist: number,
  sectionType: SectionType,
  sectors: SectorLayout,
  rng: Rng
): number {
  // One draw is always consumed, whatever the section type, so the random
  // sequence stays aligned. The value is discarded — every path below assigns
  // a zone outright.
  rng();

  if (sectionType !== 'MIXED') {
    if (sectionType === 'CORPO') return ZONE.CORPO;
    if (sectionType === 'URBAN') return ZONE.URBAN;
    if (sectionType === 'SLUMS') return ZONE.SLUMS;
    return ZONE.INDUSTRIAL;
  }

  let zoneTypeVal: number;
  const blockAngle = Math.atan2(blockZ - centerZ, blockX - centerX);
  const isInSlumSector = angleBetween(blockAngle, sectors.slumAngle) < (Math.PI * 5) / 12; // ~150° wedge
  const isInIndustrialSector = angleBetween(blockAngle, sectors.industrialAngle) < Math.PI / 3; // ~120° wedge

  if (normDist < 0.30) {
    // CORE: corporate downtown
    zoneTypeVal = rng() < 0.88 ? ZONE.CORPO : ZONE.URBAN;
  } else if (normDist < 0.55) {
    // INNER RING: corporate fading into urban (80% → 20% across the band)
    const t = (normDist - 0.30) / 0.25;
    const corpoChance = 0.80 - t * 0.60;
    zoneTypeVal = rng() < corpoChance ? ZONE.CORPO : ZONE.URBAN;
  } else if (normDist < 0.75) {
    // MIDDLE RING: urban, with slums and industry bleeding in from their wedges
    const t = (normDist - 0.55) / 0.20;
    if (isInSlumSector && rng() < t * 0.45) {
      zoneTypeVal = ZONE.SLUMS;
    } else if (isInIndustrialSector && rng() < t * 0.30) {
      zoneTypeVal = ZONE.INDUSTRIAL;
    } else {
      zoneTypeVal = ZONE.URBAN;
    }
  } else {
    // OUTER EDGE: slums and industry dominate inside their wedges
    if (isInIndustrialSector && rng() < 0.70) {
      zoneTypeVal = ZONE.INDUSTRIAL;
    } else if (isInSlumSector && rng() < 0.65) {
      zoneTypeVal = ZONE.SLUMS;
    } else if (rng() < 0.35) {
      // Spillover outside the main wedges
      zoneTypeVal = rng() < 0.5 ? ZONE.SLUMS : ZONE.INDUSTRIAL;
    } else {
      zoneTypeVal = ZONE.URBAN;
    }
  }

  return zoneTypeVal;
}

/** Name prefix applied to every structure generated in a zone. */
export function zonePrefixFor(zoneTypeVal: number): string {
  if (zoneTypeVal < 0) return 'INDUSTRIAL';
  if (zoneTypeVal <= 0.25) return 'SLUMS';
  if (zoneTypeVal > 0.7) return 'CORPO';
  return 'URBAN';
}

/**
 * Long thin plots produce unconvincing slab buildings, so every zone except
 * slums gets its aspect ratio clamped. Slums keep their sprawl.
 */
export function clampPlotAspect(
  bw: number,
  bd: number,
  zoneTypeVal: number
): { bw: number; bd: number } {
  const isSlum = zoneTypeVal <= 0.25 && zoneTypeVal >= 0;
  if (isSlum) return { bw, bd };
  const maxRatio = 1.3;
  if (bw > bd * maxRatio) return { bw: bd * maxRatio, bd };
  if (bd > bw * maxRatio) return { bw, bd: bw * maxRatio };
  return { bw, bd };
}

/** How much taller the very centre builds than the outskirts. */
export const HEIGHT_GRADIENT_PEAK = 1.25;
export const HEIGHT_GRADIENT_EDGE = 0.75;

/**
 * Height multiplier for a plot at normalised distance `normDist` from the centre.
 *
 * Zone already varies with distance, so there is a coarse taper: CORPO towers near the
 * middle, slums at the rim. But zone changes in steps, so the skyline came out as three
 * or four flat plateaus with hard seams between them. This blends *within* a zone, so
 * height falls off smoothly and a downtown reads as a peak rather than a mesa.
 *
 * Deliberately gentle. The zone bands are doing the heavy lifting; this only softens
 * their edges, and a strong multiplier would fight them.
 */
export function heightScaleFor(normDist: number): number {
  const t = Math.min(1, Math.max(0, normDist));
  return HEIGHT_GRADIENT_PEAK + (HEIGHT_GRADIENT_EDGE - HEIGHT_GRADIENT_PEAK) * t;
}

/**
 * Fraction of its plot a zone builds on, the rest left as setback.
 *
 * Dense coverage reads as an old city that grew to its lot lines; generous setbacks
 * read as modern and corporate, with plazas and forecourts. Every zone previously
 * filled its plot the same way, which is part of why districts differed only in what
 * they built rather than how they sat on the ground.
 *
 * Keyed off the same `zoneTypeVal` bands `fillPlot` uses, so the two agree about what
 * a plot is.
 */
export const LOT_COVERAGE = {
  MARKETS: 0.95,
  LANDMARK: 0.70,
  CORPO: 0.72,
  URBAN: 0.85,
  SLUMS: 0.95,
  INDUSTRIAL: 0.80,
  DEFAULT: 0.85,
} as const;

export function lotCoverageFor(zoneTypeVal: number): number {
  if (zoneTypeVal === 2.0) return LOT_COVERAGE.MARKETS;
  if (zoneTypeVal >= 1.5 && zoneTypeVal < 2.0) return LOT_COVERAGE.LANDMARK;
  if (zoneTypeVal > 0.8 && zoneTypeVal < 1.5) return LOT_COVERAGE.CORPO;
  if (zoneTypeVal > 0.3 && zoneTypeVal < 0.8) return LOT_COVERAGE.URBAN;
  if (zoneTypeVal <= 0.25 && zoneTypeVal >= 0) return LOT_COVERAGE.SLUMS;
  if (zoneTypeVal < 0) return LOT_COVERAGE.INDUSTRIAL;
  return LOT_COVERAGE.DEFAULT;
}
