const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
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

  const portraitsDir = path.join(__dirname, '../uploads/portraits');
  if (!fs.existsSync(portraitsDir)) fs.mkdirSync(portraitsDir, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

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

  // --- NPC library (admin-only) ---

  // List all NPC sheets for the current game system, grouped by folder
  router.get('/npcs', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all(
        `SELECT id, npc_label, folder, portrait_url, updated_at
         FROM character_sheets WHERE is_npc = 1 AND system = ?
         ORDER BY folder, npc_label`,
        [system],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(rows);
        }
      );
    });
  });

  // Get full NPC sheet data (for editing)
  router.get('/npcs/:id', authenticate, requireAdmin, (req, res) => {
    db.get(
      `SELECT * FROM character_sheets WHERE id = ? AND is_npc = 1`,
      [req.params.id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'NPC not found' });
        res.json({ ...row, data: JSON.parse(row.data || '{}') });
      }
    );
  });

  // Create a new NPC sheet
  router.post('/npcs', authenticate, requireAdmin, (req, res) => {
    const { npc_label, folder, data } = req.body;
    if (!npc_label) return res.status(400).json({ error: 'npc_label required' });
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        `INSERT INTO character_sheets (username, system, data, is_npc, npc_label, folder)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [req.user.username, system, JSON.stringify(data || {}), npc_label, folder || null],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ id: this.lastID, npc_label, folder: folder || null, system });
        }
      );
    });
  });

  // Patch NPC sheet data / metadata
  router.put('/npcs/:id', authenticate, requireAdmin, (req, res) => {
    db.get(`SELECT id, data FROM character_sheets WHERE id = ? AND is_npc = 1`, [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'NPC not found' });
      const { fields, npc_label, folder } = req.body;
      const data = fields
        ? JSON.stringify({ ...JSON.parse(row.data || '{}'), ...fields })
        : row.data;
      const sets = ['data = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const params = [data];
      if (npc_label !== undefined) { sets.push('npc_label = ?'); params.push(npc_label); }
      if (folder !== undefined) { sets.push('folder = ?'); params.push(folder || null); }
      params.push(req.params.id);
      db.run(`UPDATE character_sheets SET ${sets.join(', ')} WHERE id = ?`, params, (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ message: 'NPC updated' });
      });
    });
  });

  // Delete NPC sheet (cascades to npc_sheet_links)
  router.delete('/npcs/:id', authenticate, requireAdmin, (req, res) => {
    db.run(`DELETE FROM character_sheets WHERE id = ? AND is_npc = 1`, [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'NPC not found' });
      res.json({ message: 'NPC deleted' });
    });
  });

  // Attach NPC sheet to a token (location)
  router.post('/npcs/:id/link', authenticate, requireAdmin, (req, res) => {
    const { location_id } = req.body;
    if (!location_id) return res.status(400).json({ error: 'location_id required' });
    db.get(`SELECT id FROM character_sheets WHERE id = ? AND is_npc = 1`, [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'NPC not found' });
      db.run(
        `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)
         ON CONFLICT(location_id) DO UPDATE SET sheet_id = excluded.sheet_id`,
        [location_id, req.params.id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          io.emit('npcLinkChanged', { location_id, sheet_id: Number(req.params.id) });
          res.json({ message: 'Linked' });
        }
      );
    });
  });

  // Detach NPC sheet from a token
  router.delete('/npcs/:id/link/:location_id', authenticate, requireAdmin, (req, res) => {
    db.run(
      `DELETE FROM npc_sheet_links WHERE sheet_id = ? AND location_id = ?`,
      [req.params.id, req.params.location_id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('npcLinkChanged', { location_id: Number(req.params.location_id), sheet_id: null });
        res.json({ message: 'Unlinked' });
      }
    );
  });

  // Portrait upload — player uploads their own portrait; admin can upload
  // for any username via ?username= query param.
  router.post('/portrait', authenticate, upload.single('portrait'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'portrait file required' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (!allowed.includes(ext)) return res.status(400).json({ error: 'Unsupported image format' });

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const filename = hash + ext;
    const filepath = path.join(portraitsDir, filename);
    if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, req.file.buffer);
    const portrait_url = '/uploads/portraits/' + filename;

    // Determine whose sheet to update
    const u = req.user;
    const isAdmin = u && (u.role === 'admin' || u.isTemporary);
    const targetUsername = isAdmin && req.query.username ? req.query.username : u.username;
    if (!targetUsername) return res.status(400).json({ error: 'Cannot determine target username' });

    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        `UPDATE character_sheets SET portrait_url = ? WHERE username = ? AND system = ? AND is_npc = 0`,
        [portrait_url, targetUsername, system],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          io.emit('sheetUpdated', { username: targetUsername });
          res.json({ portrait_url });
        }
      );
    });
  });

  return router;
};
