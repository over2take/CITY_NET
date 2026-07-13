const express = require('express');
const { authenticate } = require('../middleware/auth');
const { TEMPLATES, DEFAULT_SYSTEM, isValidSystem, getLinkedFields } = require('../sheets/templates');

// Admin-facing character sheet routes. Player self-service (open/edit own
// sheet, quick-sheet lookups) goes through socket events, matching how the
// bank works - players in non-secure mode have no REST token.
//
// authenticate alone is not enough here: secure-mode player tokens also pass
// it. Full-sheet access is admin (or elevated temporary admin) only.
const requireAdmin = (req, res, next) => {
  const u = req.user;
  const isAdmin = u && (u.role === 'admin' || u.isTemporary);
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
};

module.exports = (db, io) => {
  const router = express.Router();

  const getGameSystem = (cb) => {
    db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (err, row) => {
      cb(err, row ? row.value : DEFAULT_SYSTEM);
    });
  };

  // --- Game system setting ---

  // Public: every client needs to know the active system to pick a template
  router.get('/system', (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ system, systems: Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name })) });
    });
  });

  router.put('/system', authenticate, requireAdmin, (req, res) => {
    const { system } = req.body;
    if (!isValidSystem(system)) return res.status(400).json({ error: 'Unknown game system' });
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [system],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('gameSystemChanged', { system });
        res.json({ message: 'Game system updated', system });
      }
    );
  });

  // --- Admin sheet access ---

  // List all sheets (players and NPCs, every system) for the admin panel
  router.get('/', authenticate, requireAdmin, (req, res) => {
    db.all(
      `SELECT id, username, system, is_npc, npc_label, folder, portrait_url, updated_at
       FROM character_sheets ORDER BY is_npc, username`,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      }
    );
  });

  // Full sheet for one player on the active system (admin view/edit)
  router.get('/user/:username', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT * FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
        [req.params.username, system],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (!row) return res.status(404).json({ error: 'No sheet for this player on the active system' });
          res.json({ ...row, data: JSON.parse(row.data || '{}') });
        }
      );
    });
  });

  // Admin per-field patch of any player's active-system sheet
  router.put('/user/:username', authenticate, requireAdmin, (req, res) => {
    const { fields } = req.body; // { fieldId: value, ... }
    if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'fields object required' });
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
        [req.params.username, system],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (!row) return res.status(404).json({ error: 'No sheet for this player on the active system' });
          // Linked fields (token HP, cash) live in other systems and are
          // edited through their own windows - never stored in sheet JSON.
          const linked = getLinkedFields(system);
          const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => !linked[k]));
          const data = { ...JSON.parse(row.data || '{}'), ...patch };
          db.run(
            `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [JSON.stringify(data), row.id],
            (err3) => {
              if (err3) return res.status(500).json({ error: err3.message });
              io.emit('sheetUpdated', { username: req.params.username, system });
              res.json({ message: 'Sheet updated' });
            }
          );
        }
      );
    });
  });

  return router;
};
