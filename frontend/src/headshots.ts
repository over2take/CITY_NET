// Stock headshot pools for NPC tokens (art by PaMuDA). Served from
// frontend/public/. The backend mirrors these lists in
// backend/sheets/headshots.js for random assignment and URL validation —
// keep the two in sync when adding art.

export const ENEMY_HEADSHOTS = [
  '1.png','2.png','14.png','16.png','17.png','21.png','22.png','29.png',
  '30.png','35.png','36.png','46.png','61.png','85.png','86.png','101.png',
].map(f => `/npc-headshots/${f}`);

export const FRIENDLY_HEADSHOTS = [
  '3.png','4.png','6.png','7.png','9.png','10.png','26.png','27.png',
  '37.png','38.png','49.png','50.png','52.png','63.png','64.png','65.png',
  '67.png','69.png',
].map(f => `/friendly-headshots/${f}`);

export const ALL_HEADSHOTS = [...ENEMY_HEADSHOTS, ...FRIENDLY_HEADSHOTS];

/** Pool matching a token shape; both pools when the shape is unknown (e.g. NPC library). */
export function headshotsForShape(shape?: string | null): string[] {
  if (shape === 'enemy_rhombus') return ENEMY_HEADSHOTS;
  if (shape === 'friendly_rhombus') return FRIENDLY_HEADSHOTS;
  return ALL_HEADSHOTS;
}
