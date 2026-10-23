const express = require('express');
const { authenticatePlayer } = require('../middleware/auth');
const { accountOf, settingsOf, problemWith, saveSettings } = require('../accounts/settings');

// The signed-in person's own things (6c4b3a): for now, their settings. Anyone signed in, player or
// GM, reads and changes only their own; there is no way to name someone else's.

module.exports = (db) => {
  const router = express.Router();

  const account = (req, res) => {
    const who = accountOf(req.user);
    if (!who) res.status(403).json({ error: 'Sign in to keep settings' });
    return who;
  };

  router.get('/settings', authenticatePlayer, async (req, res) => {
    const who = account(req, res);
    if (!who) return;
    try { res.json(await settingsOf(db, who)); } catch { res.status(500).json({ error: 'Could not read your settings' }); }
  });

  router.put('/settings', authenticatePlayer, async (req, res) => {
    const who = account(req, res);
    if (!who) return;
    const problem = problemWith(req.body);
    if (problem) return res.status(400).json({ error: problem });
    try {
      await saveSettings(db, who, req.body);
      res.json(await settingsOf(db, who));
    } catch { res.status(500).json({ error: 'Could not save your settings' }); }
  });

  return router;
};
