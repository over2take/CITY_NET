const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const elevatedUsers = new Set();

const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const verified = jwt.verify(token.split(' ')[1], SECRET);
    if (verified.isTemporary && !elevatedUsers.has(verified.username)) {
      return res.status(401).json({ error: 'Temporary access revoked' });
    }
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

const optionalAuthenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const verified = jwt.verify(token.split(' ')[1], SECRET);
    req.user = (verified.isTemporary && !elevatedUsers.has(verified.username)) ? null : verified;
  } catch (err) {
    req.user = null;
  }
  next();
};

module.exports = { authenticate, optionalAuthenticate, elevatedUsers };
