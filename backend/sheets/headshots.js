// Stock headshot pools for NPC tokens (art by PaMuDA). Mirrors
// frontend/src/headshots.ts — keep the two in sync when adding art.

const ENEMY_HEADSHOTS = [
  '1.png','2.png','14.png','16.png','17.png','21.png','22.png','29.png',
  '30.png','35.png','36.png','46.png','61.png','85.png','86.png','101.png',
].map(f => `/npc-headshots/${f}`);

const FRIENDLY_HEADSHOTS = [
  '3.png','4.png','6.png','7.png','9.png','10.png','26.png','27.png',
  '37.png','38.png','49.png','50.png','52.png','63.png','64.png','65.png',
  '67.png','69.png',
].map(f => `/friendly-headshots/${f}`);

const ALL_HEADSHOTS = [...ENEMY_HEADSHOTS, ...FRIENDLY_HEADSHOTS];

/** Pool matching a token shape; both pools when the shape is unknown. */
function headshotsForShape(shape) {
  if (shape === 'enemy_rhombus') return ENEMY_HEADSHOTS;
  if (shape === 'friendly_rhombus') return FRIENDLY_HEADSHOTS;
  return ALL_HEADSHOTS;
}

/** Random stock headshot for a token shape. */
function randomHeadshot(shape) {
  const pool = headshotsForShape(shape);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** True when url is one of the bundled stock headshots (for route validation). */
function isStockHeadshot(url) {
  return ALL_HEADSHOTS.includes(url);
}

module.exports = { ENEMY_HEADSHOTS, FRIENDLY_HEADSHOTS, ALL_HEADSHOTS, headshotsForShape, randomHeadshot, isStockHeadshot };
