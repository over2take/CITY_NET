// ATTACK AS (8b6a; approved mockup docs/mockups/waiting-hits.html, sections 1 and 2, answered 2026-11-25): who an attack is
// made as, and the hits waiting for each character's damage.
//
// The scene is the target's: its battle map and floor, or the city map. An NPC is attacked with only from there, by the GM
// or a player who controls it, and never the target itself. No range or line of sight is asked: that stays the table's call.
//
// A HIT waits for its own character's DAMAGE: the roller's own sheet ('self') or an NPC's, by the token it is rolled for. So a
// GM running several NPCs sends each one's damage to that one's target, never another's.

const NPC_SHAPES = ['enemy_rhombus', 'friendly_rhombus'];

/** Two tokens in one scene: the same battle map and floor, or both on the city map. */
const sameScene = (a, b) => {
  const mapA = a.battle_map_id ?? null;
  const mapB = b.battle_map_id ?? null;
  if (mapA !== mapB) return false;
  return mapA === null || (a.floor_index ?? null) === (b.floor_index ?? null);
};

/**
 * Why `token` can't be attacked as against `target`, or null when it can. `isGm` the GM (any NPC in the scene), `controls`
 * whether the asker controls that token (TOKEN CONTROL).
 */
const attackAsProblem = ({ token, target, isGm, controls }) => {
  if (!token || !NPC_SHAPES.includes(token.shape)) return 'Not an NPC';
  if (!target) return 'No target';
  if (token.id === target.id) return 'Not the target itself';
  if (!isGm && !controls) return 'Not one you may attack with';
  if (!sameScene(token, target)) return "Not in the target's scene";
  return null;
};

/** Whose a HIT or a DAMAGE is: an NPC's, by its token, or the roller's own character's. */
const characterKey = (tokenId) => (tokenId === null || tokenId === undefined ? 'self' : `npc:${tokenId}`);

/**
 * The hits waiting, per socket, per character: socket id -> character -> { targetId, until }. One per character, so a new
 * hit by one replaces only that one's; `take` hands back a hit still in time and lets it go either way.
 */
const createHitsWaiting = () => {
  const bySocket = new Map();
  return {
    set(socketId, key, hit) {
      if (!bySocket.has(socketId)) bySocket.set(socketId, new Map());
      bySocket.get(socketId).set(key, hit);
    },
    letGo(socketId, key) {
      const mine = bySocket.get(socketId);
      if (!mine) return;
      mine.delete(key);
      if (mine.size === 0) bySocket.delete(socketId);
    },
    take(socketId, key, now = Date.now()) {
      const hit = bySocket.get(socketId)?.get(key);
      if (!hit) return null;
      this.letGo(socketId, key);
      return hit.until < now ? null : hit;
    },
    drop(socketId) { bySocket.delete(socketId); },
    has(socketId, key) { return !!bySocket.get(socketId)?.has(key); },
  };
};

module.exports = { NPC_SHAPES, sameScene, attackAsProblem, characterKey, createHitsWaiting };
