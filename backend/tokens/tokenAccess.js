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
//   5. A player the GM gave control of a friendly NPC (sockets/tokenControl.js) changes its health
//      and injuries too, as an owner does their own (4b5b1, asked for by the user 2026-10-07);
//      never the rest of the token. Being named in the grant needs a name, so this is a signed-in
//      player's under Secure Mode; without it the server can't tell who sent a request.

const { verifyHeader, canEdit, isPlayer } = require('../middleware/auth');
const tokenControl = require('../sockets/tokenControl');

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

/** Does the GM's grant hand this friendly NPC (a locations row with `controllers`) to `player`? */
const controls = (row, player) => {
  if (!row || !player || !tokenControl.isGrantable(row)) return false;
  const grant = tokenControl.parse(row.controllers);
  return grant.all || grant.users.includes(player);
};

/** May `caller` change this token's health and injuries: as the whole token, or as its controller. */
const mayChangeHealth = (row, caller, secure = secureMode()) =>
  mayChangeToken(row, caller, secure) || controls(row, caller.player);

/** Why `caller` may not make this change to the whole token, or null when they may. */
const updateProblem = (row, body, caller, secure = secureMode()) => {
  if (!mayChangeToken(row, caller, secure)) return 'You can only change your own token';
  if (caller.editor) return null;
  if (body.owner !== undefined && (body.owner || null) !== (row.owner || null)) return 'Only the GM changes whose token it is';
  if (body.shape !== undefined && body.shape !== row.shape) return 'Only the GM changes what kind of token it is';
  return null;
};

module.exports = { callerOf, mayChangeToken, mayChangeHealth, controls, updateProblem };
