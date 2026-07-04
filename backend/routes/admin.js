const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');

const SECRET = process.env.JWT_SECRET;
let currentController = 'GM';

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(400).json({ error: 'User not found' });
      const validPass = await bcrypt.compare(password, user.password);
      if (!validPass) return res.status(400).json({ error: 'Invalid password' });
      const token = jwt.sign({ id: user.id, username: user.username, role: 'admin', isTemporary: false }, SECRET);
      res.json({ token });
    });
  });

  router.get('/settings', (req, res) => {
    db.all('SELECT * FROM global_settings', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/settings', authenticate, (req, res) => {
    const { key, value } = req.body;
    db.run('INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?', [key, value, value], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('settingsUpdated');
      res.json({ message: 'Settings updated' });
    });
  });

  router.get('/control', (req, res) => {
    res.json({ controller: currentController });
  });

  router.post('/control', authenticate, (req, res) => {
    const { controller } = req.body;
    currentController = controller;
    res.json({ message: 'Control updated', controller: currentController });
  });

  router.post('/undo', authenticate, (req, res) => {
    db.get('SELECT * FROM action_history ORDER BY timestamp DESC LIMIT 1', [], (err, action) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!action) return res.status(400).json({ error: 'No history to undo' });

      const payload = JSON.parse(action.payload);
      const finishUndo = () => {
        db.run('DELETE FROM action_history WHERE id = ?', [action.id], (err) => {
          if (err) console.error('Failed to remove action from history:', err.message);
          emitUpdate();
          res.json({ message: 'Undo successful', type: action.type });
        });
      };

      db.serialize(() => {
        if (action.type === 'location_create') {
          const placeholders = payload.ids.map(() => '?').join(',');
          db.run(`DELETE FROM locations WHERE id IN (${placeholders})`, payload.ids, finishUndo);
        } else if (action.type === 'location_delete') {
          const stmt = db.prepare(`INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount, map_scale_multiplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          payload.data.forEach(loc => {
            stmt.run([loc.id, loc.name, loc.description, loc.npcs, loc.x, loc.y, loc.z, loc.width, loc.height, loc.depth, loc.shape, loc.color, loc.district_name, loc.district_color, loc.parent_id, loc.isFavorite, loc.isDanger, loc.owner, loc.rotation, loc.rotation_x, loc.rotation_z, loc.classification, loc.polyCount, loc.map_scale_multiplier]);
          });
          stmt.finalize(finishUndo);
        } else if (action.type === 'location_update') {
          const d = payload.old_data;
          const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=?, map_scale_multiplier=? WHERE id=?`;
          db.run(sql, [d.name, d.description, d.npcs, d.x, d.y, d.z, d.width, d.height, d.depth, d.shape, d.color, d.district_name, d.district_color, d.parent_id, d.isFavorite, d.isDanger, d.owner, d.rotation, d.rotation_x, d.rotation_z, d.classification, d.polyCount, d.map_scale_multiplier, payload.id], finishUndo);
        } else if (action.type === 'location_update_batch') {
          db.serialize(() => {
            payload.data.forEach(item => {
              const d = item.old_data;
              const keys = Object.keys(d);
              const fields = keys.map(k => `${k}=?`).join(',');
              const params = [...keys.map(k => d[k]), item.id];
              db.run(`UPDATE locations SET ${fields} WHERE id=?`, params);
            });
          });
          setTimeout(finishUndo, 100);
        } else if (action.type === 'road_create') {
          const placeholders = payload.ids.map(() => '?').join(',');
          db.run(`DELETE FROM roads WHERE id IN (${placeholders})`, payload.ids, finishUndo);
        } else if (action.type === 'road_delete_all') {
          const stmt = db.prepare(`INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)`);
          payload.data.forEach(r => stmt.run([r.id, r.x1, r.z1, r.x2, r.z2, r.width]));
          stmt.finalize(finishUndo);
        } else if (action.type === 'water_create') {
          const placeholders = payload.ids.map(() => '?').join(',');
          db.run(`DELETE FROM water_bodies WHERE id IN (${placeholders})`, payload.ids, finishUndo);
        } else if (action.type === 'overpass_create') {
          db.run(`DELETE FROM overpasses WHERE id = ?`, [payload.id], finishUndo);
        } else if (action.type === 'overpass_delete') {
          const o = payload.data;
          db.run(
            `INSERT INTO overpasses (id, points, height, width, ramp_length, ramp_length_start, ramp_length_end, pillar_spacing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [o.id, o.points, o.height, o.width, o.ramp_length, o.ramp_length_start ?? null, o.ramp_length_end ?? null, o.pillar_spacing ?? 12],
            finishUndo
          );
        } else if (action.type === 'sign_create') {
          db.run(`DELETE FROM signs WHERE id = ?`, [payload.id], finishUndo);
        } else if (action.type === 'sign_delete') {
          const s = payload.data;
          db.run(
            `INSERT INTO signs (id, text, x, y, z, rotation_y, font_size, image_url, use_tv_filter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [s.id, s.text, s.x, s.y, s.z, s.rotation_y, s.font_size, s.image_url, s.use_tv_filter],
            finishUndo
          );
        } else if (action.type === 'sign_update') {
          const d = payload.old_data;
          db.run(
            `UPDATE signs SET text=?, x=?, y=?, z=?, rotation_y=?, font_size=?, image_url=?, use_tv_filter=? WHERE id=?`,
            [d.text, d.x, d.y, d.z, d.rotation_y, d.font_size, d.image_url, d.use_tv_filter, payload.id],
            finishUndo
          );
        } else {
          res.status(400).json({ error: 'Unknown action type' });
        }
      });
    });
  });

  // --- Districts ---
  router.get('/districts', (req, res) => {
    db.all('SELECT * FROM districts', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/districts', authenticate, (req, res) => {
    const { name, color } = req.body;
    if (!name || !color) return res.status(400).json({ error: 'Name and color required' });
    db.run('INSERT INTO districts (name, color) VALUES (?, ?)', [name, color], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      emitUpdate();
      res.json({ id: this.lastID, name, color });
    });
  });

  router.delete('/districts/:name', authenticate, (req, res) => {
    const name = req.params.name;
    db.run('DELETE FROM districts WHERE name = ?', [name], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run('UPDATE locations SET district_name = NULL, district_color = NULL WHERE district_name = ?', [name], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ message: 'Deleted' });
      });
    });
  });

  // --- Water ---
  router.get('/water', (req, res) => {
    db.all('SELECT * FROM water_bodies', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map(r => {
        try { r.points = JSON.parse(r.points_json); } catch (e) { r.points = []; }
        return r;
      }));
    });
  });

  router.post('/water', authenticate, (req, res) => {
    const { points } = req.body;
    if (!points || !Array.isArray(points)) return res.status(400).json({ error: 'Invalid points array' });
    db.run('INSERT INTO water_bodies (points_json) VALUES (?)', [JSON.stringify(points)], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const newId = this.lastID;
      db.run('INSERT INTO action_history (type, payload) VALUES (?, ?)', ['water_create', JSON.stringify({ ids: [newId] })], () => {});
      emitUpdate();
      res.json({ id: newId, message: 'Water body saved' });
    });
  });

  router.delete('/water/:id', authenticate, (req, res) => {
    db.run('DELETE FROM water_bodies WHERE id = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      emitUpdate();
      res.json({ message: 'Water body deleted' });
    });
  });

  router.delete('/water', authenticate, (req, res) => {
    db.run('DELETE FROM water_bodies', function(err) {
      if (err) return res.status(500).json({ error: err.message });
      emitUpdate();
      res.json({ message: 'All water purged' });
    });
  });

  // --- Chat ---
  router.post('/chat/purge', authenticate, (req, res) => {
    db.run('DELETE FROM chat_logs', (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run('DELETE FROM private_messages', (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        io.emit('chatHistory', []);
        io.emit('purgePrivateMessages');
        res.json({ message: 'Chat history purged' });
      });
    });
  });

  return router;
};
