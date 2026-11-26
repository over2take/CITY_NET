// Hits waiting under APPLY DAMAGE CONFIRM (8b6b1; approved mockup docs/mockups/waiting-hits.html, answered 2026-11-25). A hit
// that reaches its target is kept on it, worked out when made (its resistances then, answer 3), with what it would take, until
// someone APPLYs or DISMISSes it, or APPLY ALL takes every one, oldest first (answer 2). Kept in the database through a reload
// or a disconnect; a token deleted takes its own with it (db.js, a trigger). The GM may APPLY or DISMISS on any token, a
// player on their own character and the NPCs they control (tokens/tokenAccess.js mayChangeHealth). The one who made a hit
// sees how many of theirs wait; anyone else nothing. The log says each APPLY and DISMISS (answer 2 A), players reading an
// NPC's as HIT TOTALS ON NPCS allows.

const tokenAccess = require('./tokenAccess');

/** Where a kept hit waits, said in its log line in place of "NOT APPLIED: APPLY DAMAGE IS CONFIRM" (answer 1 A). */
const WAITING = 'WAITING ON ITS HEALTH';

/** A hit's words without its target's name, as its row on HEALTH says them: "RESISTS FIRE: 6 → 3 · WOULD TAKE 7 OF 10". */
const rowWords = (targetName, words) => {
  const head = `${String(targetName).toUpperCase()} · `;
  const said = String(words).startsWith(head) ? String(words).slice(head.length) : String(words);
  return said.split(' · ').filter((w) => w !== WAITING).join(' · ');
};

/** Keeps a hit on its target. `hit`: { location_id, system, target_name, taken, rolled, from_name, what, words, players, totals_hidden, by_user }. */
const keepHit = (db, hit, cb) => db.run(
  `INSERT INTO waiting_hits (location_id, system, target_name, taken, rolled, from_name, what, words, players, totals_hidden, by_user)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [hit.location_id, hit.system, hit.target_name, hit.taken, hit.rolled, hit.from_name, hit.what, hit.words, hit.players ?? null, hit.totals_hidden ? 1 : 0, hit.by_user ?? null],
  function kept(err) { cb(err || null, err ? null : this.lastID); },
);

/**
 * The hits waiting on a token, oldest first: a player's character's on any copy of their token (each battle map's), as its
 * health is one; an NPC's on that token alone. Only those of the game being played.
 */
const hitsOn = (db, row, system, cb) => {
  const player = row.shape === 'rhombus' && !!row.owner;
  const [sql, params] = player
    ? [`SELECT w.* FROM waiting_hits w JOIN locations l ON l.id = w.location_id
        WHERE l.shape = 'rhombus' AND l.owner = ? AND w.system = ? ORDER BY w.id`, [row.owner, system]]
    : ['SELECT * FROM waiting_hits WHERE location_id = ? AND system = ? ORDER BY id', [row.id, system]];
  db.all(sql, params, (err, rows) => cb(err ? [] : rows || []));
};

/** Whether `caller` ({ editor, player }) may APPLY or DISMISS a token's waiting hits. Never anyone unnamed, whatever the mode. */
const mayApply = (row, caller) => !!caller.editor || (!!caller.player && tokenAccess.mayChangeHealth(row, caller, true));

/**
 * A token's hits as one viewer may see them. To whoever may apply them: each, oldest first, with who made it, with what, and
 * what it would take, the players' words where they were told less (the GM's to the GM). To the one who made some of them,
 * how many of theirs wait. To anyone else, nothing.
 */
const shownTo = (hits, { may, editor, user }) => (may
  ? {
    may: true,
    // The players' words wherever they were told less, even none at all (an NPC's numbers kept to the GM): never the GM's.
    // What it would take, for APPLY's button (8b6b2): to the GM, and to a player where its numbers aren't kept from them.
    hits: hits.map((h) => ({ id: h.id, from: h.from_name, what: h.what, words: editor || h.players === null || h.players === undefined ? h.words : h.players, taken: editor || !h.totals_hidden ? h.taken : null, at: h.created_at })),
  }
  : { may: false, hits: [], mine: user ? hits.filter((h) => h.by_user === user).length : 0 });

/** The log's line for an APPLY: "APPLIED BY GM · BOG GHOUL TAKES 7 OF 10 (from KES · Flame Tongue)"; players without the numbers where they were kept from them. */
const appliedWords = (hit, who) => {
  const target = String(hit.target_name).toUpperCase();
  const from = `(from ${String(hit.from_name).toUpperCase()} · ${hit.what})`;
  const took = `${target} TAKES ${hit.taken}${hit.taken !== hit.rolled ? ` OF ${hit.rolled}` : ''}`;
  const words = `APPLIED BY ${String(who).toUpperCase()} · ${took} ${from}`;
  return hit.totals_hidden ? { words, players: `APPLIED BY ${String(who).toUpperCase()} · ${target} ${from}` } : { words };
};

/** The log's line for a DISMISS: "DISMISSED BY MIRA · Claws on MIRA". */
const dismissedWords = (hit, who) => ({ words: `DISMISSED BY ${String(who).toUpperCase()} · ${hit.what} on ${String(hit.target_name).toUpperCase()}` });

module.exports = { WAITING, rowWords, keepHit, hitsOn, mayApply, shownTo, appliedWords, dismissedWords };
