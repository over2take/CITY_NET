const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const elevatedUsers = new Set();

// Who a token belongs to, decided in one place.
//
// Three kinds of token are signed with the same secret: the GM's (routes/admin.js, role
// 'admin'), a player's (routes/player.js, role 'player'), and a granted editor's (sockets,
// isTemporary). A valid signature therefore says only that the server issued the token, not
// that its holder is the GM - and the checks used to stop there. A player's own login token
// passed `authenticate` and every "not temporary" test, which opened the GM's routes and admin
// socket events to any signed-in player. These say what each check actually means.

/** The GM's own login. Only admin login signs role 'admin'. */
const isMainAdmin = (v) => !!v && v.role === 'admin' && !v.isTemporary;

/** A player the GM has granted editing rights, while the grant still stands. */
const isGrantedEditor = (v) => !!v && !!v.isTemporary && elevatedUsers.has(v.username);

/** The GM or a granted editor: who the GM-facing routes are for. */
const canEdit = (v) => isMainAdmin(v) || isGrantedEditor(v);

/** A player's own login (not a password-reset token). */
const isPlayer = (v) => !!v && v.role === 'player' && !v.isTemporary;

/** The verified payload of an `Authorization: Bearer` header, or null. */
const verifyHeader = (header) => {
  try { return jwt.verify(String(header).split(' ')[1], SECRET); } catch { return null; }
};

/** GM-facing routes: the GM or a granted editor. */
const authenticate = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Access denied' });
  const verified = verifyHeader(header);
  if (!verified) return res.status(400).json({ error: 'Invalid token' });
  if (canEdit(verified)) {
    req.user = verified;
    return next();
  }
  if (verified.isTemporary) return res.status(401).json({ error: 'Temporary access revoked' });
  return res.status(403).json({ error: 'GM only' });
};

/**
 * The few routes a player calls about themselves (their own sheet, their portrait): a
 * player's login, or anyone `authenticate` accepts.
 */
const authenticatePlayer = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Access denied' });
  const verified = verifyHeader(header);
  if (!verified) return res.status(400).json({ error: 'Invalid token' });
  if (canEdit(verified) || isPlayer(verified)) {
    req.user = verified;
    return next();
  }
  if (verified.isTemporary) return res.status(401).json({ error: 'Temporary access revoked' });
  return res.status(403).json({ error: 'Not allowed' });
};

/**
 * Public routes that show the GM more: `req.user` is set only for someone `authenticate`
 * would accept. Anyone else, players included, is treated as anonymous.
 */
const optionalAuthenticate = (req, res, next) => {
  const header = req.headers['authorization'];
  const verified = header ? verifyHeader(header) : null;
  req.user = canEdit(verified) ? verified : null;
  next();
};

module.exports = {
  authenticate, authenticatePlayer, optionalAuthenticate, elevatedUsers,
  isMainAdmin, isGrantedEditor, canEdit, isPlayer,
};
