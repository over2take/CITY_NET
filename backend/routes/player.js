const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');

const SECURE_MODE = process.env.SECURE_MODE === 'true';
const SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

let _io = null;

module.exports = (db, io) => {
  _io = io;
  const router = express.Router();

  // Returns whether Secure Mode is enabled — always public so the frontend knows which login to show
  router.get('/secure-mode', (req, res) => {
    res.json({ enabled: SECURE_MODE });
  });

  // All routes below are only active when SECURE_MODE=true
  const requireSecureMode = (req, res, next) => {
    if (!SECURE_MODE) return res.status(404).json({ error: 'Secure Mode is not enabled' });
    next();
  };

  // Register a new player account
  router.post('/register', requireSecureMode, async (req, res) => {
    const { username, password, security_question, security_answer } = req.body;
    if (!username || !password || !security_question || !security_answer)
      return res.status(400).json({ error: 'All fields are required' });

    const existing = await new Promise(resolve =>
      db.get('SELECT username FROM player_accounts WHERE username = ?', [username], (_, row) => resolve(row))
    );
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const security_answer_hash = await bcrypt.hash(security_answer.toLowerCase().trim(), SALT_ROUNDS);

    db.run(
      'INSERT INTO player_accounts (username, password_hash, security_question, security_answer_hash, status) VALUES (?, ?, ?, ?, ?)',
      [username, password_hash, security_question, security_answer_hash, 'pending'],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (_io) _io.emit('registrationPending', { username });
        res.json({ message: 'Account pending admin approval' });
      }
    );
  });

  // Player login — returns a player JWT
  router.post('/login', requireSecureMode, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    db.get('SELECT * FROM player_accounts WHERE username = ?', [username], async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(401).json({ error: 'Invalid username or password' });

      const match = await bcrypt.compare(password, row.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid username or password' });
      if (row.status === 'pending') return res.status(403).json({ error: 'Account pending admin approval' });

      const playerToken = jwt.sign(
        { username: row.username, role: 'player', tempPassword: !!row.temp_password },
        SECRET,
        { expiresIn: '7d' }
      );
      res.json({ playerToken, tempPassword: !!row.temp_password });
    });
  });

  // Forgot password — verify security answer, return a reset token
  router.post('/forgot', requireSecureMode, async (req, res) => {
    const { username, security_answer } = req.body;
    if (!username || !security_answer) return res.status(400).json({ error: 'Username and security answer required' });

    db.get('SELECT * FROM player_accounts WHERE username = ?', [username], async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Account not found' });

      const match = await bcrypt.compare(security_answer.toLowerCase().trim(), row.security_answer_hash);
      if (!match) return res.status(401).json({ error: 'Incorrect security answer' });

      const resetToken = jwt.sign({ username: row.username, role: 'player_reset' }, SECRET, { expiresIn: '15m' });
      res.json({ resetToken });
    });
  });

  // Reset password — requires a valid player JWT (login or reset token)
  router.post('/reset-password', requireSecureMode, async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!['player', 'player_reset'].includes(decoded.role))
      return res.status(403).json({ error: 'Access denied' });

    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.run(
      'UPDATE player_accounts SET password_hash = ?, temp_password = 0 WHERE username = ?',
      [password_hash, decoded.username],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Password updated' });
      }
    );
  });

  // ── Admin: list all player accounts ────────────────────────────────────────
  router.get('/admin/players', authenticate, (req, res) => {
    db.all('SELECT username, temp_password, status, created_at FROM player_accounts ORDER BY created_at ASC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // Admin: list pending registrations
  router.get('/admin/players/pending', authenticate, (req, res) => {
    db.all("SELECT username, created_at FROM player_accounts WHERE status = 'pending' ORDER BY created_at ASC", (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // Admin: approve a pending registration
  router.post('/admin/players/:username/approve', authenticate, (req, res) => {
    db.run("UPDATE player_accounts SET status = 'approved' WHERE username = ? AND status = 'pending'", [req.params.username], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Pending account not found' });
      if (_io) _io.emit('registrationUpdated', { username: req.params.username, action: 'approved' });
      res.json({ message: 'Account approved' });
    });
  });

  // Admin: deny — deletes the row so the username is freed
  router.delete('/admin/players/:username/deny', authenticate, (req, res) => {
    db.run("DELETE FROM player_accounts WHERE username = ? AND status = 'pending'", [req.params.username], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Pending account not found' });
      if (_io) _io.emit('registrationUpdated', { username: req.params.username, action: 'denied' });
      res.json({ message: 'Account denied and removed' });
    });
  });

  // Admin: reset a player's password to a random temp password
  router.post('/admin/players/:username/reset', authenticate, async (req, res) => {
    const { username } = req.params;
    const tempPass = Math.random().toString(36).slice(2, 10).toUpperCase();
    const password_hash = await bcrypt.hash(tempPass, SALT_ROUNDS);

    db.run(
      'UPDATE player_accounts SET password_hash = ?, temp_password = 1 WHERE username = ?',
      [password_hash, username],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Player not found' });
        res.json({ tempPassword: tempPass });
      }
    );
  });

  return router;
};
