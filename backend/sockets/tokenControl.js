// Who may move a token.
//
// Until now this was one expression repeated in two socket handlers: an admin, or the
// player whose name is in `owner`. That covers a player moving their own rhombus and a GM
// moving anything, and leaves no way to let a player move a friendly NPC the GM wants
// them shifting around the map.
//
// So a token can carry a grant. It grants MOVEMENT and nothing else: the NPC is still the
// GM's to speak for, roll for and edit. Three rules, in this order:
//
//   1. An admin can always move anything. The grant adds movers, it never removes any -
//      sharing an NPC does not hand it over.
//   2. The owner can move their own token, exactly as before.
//   3. A friendly NPC can name players who may move it, or open itself to everyone.
//
// Friendly NPCs only, and that is enforced here rather than in the caller. `owner` on an
// NPC is already whoever placed it, not a sentinel, so it could not be reused for this -
// hence a column of its own.

/** The token shapes a grant can apply to. Enemies stay with the GM. */
const GRANTABLE_SHAPES = ['friendly_rhombus'];

/** Nobody named, nobody let in. Also what a token with no column at all means. */
const NO_CONTROL = { all: false, users: [] };

/**
 * Read the stored grant.
 *
 * Defensive because the column is free-form JSON on rows that get imported, restored from
 * a backup, and hand-edited. Anything unreadable means "nobody", which is the safe way to
 * fail: a malformed grant must never open a token up.
 */
const parse = (raw) => {
  if (raw === null || raw === undefined || raw === '') return { ...NO_CONTROL };
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { ...NO_CONTROL };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...NO_CONTROL };
  const users = Array.isArray(value.users)
    ? value.users.filter((u) => typeof u === 'string' && u.trim() !== '').map((u) => u.trim())
    : [];
  return { all: value.all === true, users };
};

/** Back to the column, normalized so what is stored is what `parse` would have read. */
const serialize = (grant) => {
  const g = parse(grant);
  // Nothing granted is stored as nothing, so the common case leaves no JSON behind.
  if (!g.all && g.users.length === 0) return null;
  return JSON.stringify({ all: g.all, users: [...new Set(g.users)] });
};

/** Whether a grant on this row would mean anything at all. */
const isGrantable = (row) => GRANTABLE_SHAPES.includes(row && row.shape);

/**
 * Whether `userName` may move this token.
 *
 * `isAdmin` first and unconditionally: an admin never loses control of anything, whatever
 * the grant says and whatever shape the token is.
 */
const canMove = (row, { isAdmin, userName } = {}) => {
  if (isAdmin) return true;
  if (!row) return false;
  if (userName && row.owner && userName === row.owner) return true;
  if (!isGrantable(row)) return false;
  const grant = parse(row.controllers);
  if (grant.all) return true;
  return Boolean(userName) && grant.users.includes(userName);
};

/** For the UI: who this token is currently shared with, in a shape the client can render. */
const describe = (row) => {
  if (!isGrantable(row)) return { grantable: false, all: false, users: [] };
  return { grantable: true, ...parse(row.controllers) };
};

module.exports = { canMove, parse, serialize, describe, isGrantable, GRANTABLE_SHAPES };
