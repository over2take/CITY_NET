// Who may change a token through the HTTP routes: its health, its injuries, or the token itself
// (4b5a; moved into Phase 4 by the user 2026-10-07).
//
// optionalAuthenticate gives these routes the GM and granted editors and treats everyone else as
// anonymous, and the routes then let anyone change any PLAYER token: its HP, its injuries, its
// whole row, owner included. Enemies and NPCs were the GM's, but one player could knock another
// down to 0 HP with a request of their own. The windows sent no player identity either, so the
// server could not have told them apart.
//
// The rule, in one place:
//   1. The GM and granted editors may change any token.
//   2. A player, by their own login token, may change only their own player token.
//   3. With no identity at all: refused under Secure Mode, where everyone has an account. Without
//      it there are no accounts and names are trusted, so a player token may be changed as before.
//   4. Nobody but the GM and editors changes whose a token is or what kind of token it is.
// Later (4b5b), a player the GM gave a friendly NPC changes its health too: that is rule 2's place.

const { verifyHeader, canEdit, isPlayer } = require('../middleware/auth');

/** Who is asking, from the request's Authorization header. */
const callerOf = (req) => {
  const header = req.headers && req.headers.authorization;
  const verified = header ? verifyHeader(header) : null;
  if (canEdit(verified)) return { editor: true, player: null };
  if (isPlayer(verified) && typeof verified.username === 'string') return { editor: false, player: verified.username };
  return { editor: false, player: null };
};

const secureMode = () => process.env.SECURE_MODE === 'true';

/** May `caller` change this token (a locations row)? */
const mayChangeToken = (row, caller, secure = secureMode()) => {
  if (!row) return false;
  if (caller.editor) return true;
  if (row.shape !== 'rhombus') return false;
  if (caller.player) return !!row.owner && row.owner === caller.player;
  return !secure;
};

/** Why `caller` may not make this change to the whole token, or null when they may. */
const updateProblem = (row, body, caller, secure = secureMode()) => {
  if (!mayChangeToken(row, caller, secure)) return 'You can only change your own token';
  if (caller.editor) return null;
  if (body.owner !== undefined && (body.owner || null) !== (row.owner || null)) return 'Only the GM changes whose token it is';
  if (body.shape !== undefined && body.shape !== row.shape) return 'Only the GM changes what kind of token it is';
  return null;
};

module.exports = { callerOf, mayChangeToken, updateProblem };
