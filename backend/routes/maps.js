const express = require('express');
const { authenticate } = require('../middleware/auth');

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  // --- Saved Maps ---
  router.get('/', (req, res) => {
    db.all('SELECT id, name, timestamp FROM saved_maps ORDER BY timestamp DESC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/save', authenticate, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Map name required' });

    db.serialize(() => {
      db.all("SELECT * FROM locations WHERE shape != 'rhombus' OR shape IS NULL", (err1, locations) => {
        if (err1) return res.status(500).json({ error: err1.message });
        db.all('SELECT * FROM districts', (err2, districts) => {
          if (err2) return res.status(500).json({ error: err2.message });
          db.all('SELECT * FROM roads', (err3, roads) => {
            if (err3) return res.status(500).json({ error: err3.message });

            const sql = `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(name) DO UPDATE SET
                           locations_data=excluded.locations_data,
                           districts_data=excluded.districts_data,
                           roads_data=excluded.roads_data,
                           timestamp=CURRENT_TIMESTAMP`;
            db.run(sql, [name, JSON.stringify(locations), JSON.stringify(districts), JSON.stringify(roads)], function(err) {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: 'Map saved successfully' });
            });
          });
        });
      });
    });
  });

  router.post('/load/:name', authenticate, (req, res) => {
    db.get('SELECT * FROM saved_maps WHERE name = ?', [req.params.name], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Map not found' });

      const locations = JSON.parse(row.locations_data || '[]');
      const districts = JSON.parse(row.districts_data || '[]');
      const roads = JSON.parse(row.roads_data || '[]');

      db.all("SELECT * FROM locations WHERE shape = 'rhombus'", (errR, activeRhombuses) => {
        db.serialize(() => {
          db.run('DELETE FROM locations');
          db.run('DELETE FROM districts');
          db.run('DELETE FROM roads');

          if (locations.length > 0) {
            const stmtL = db.prepare(`INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, hp_current, hp_max, hp_temp, map_scale_multiplier)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            locations.forEach(l => {
              stmtL.run([l.id, l.name, l.description, l.npcs, l.x, l.y, l.z, l.width, l.height, l.depth, l.shape, l.color, l.district_name, l.district_color, l.parent_id, l.is_target, l.isFavorite, l.isDanger, l.owner, l.notifications_enabled, l.rotation, l.rotation_x, l.rotation_z, l.classification, l.polyCount, l.battle_map_id, l.floor_index, l.hp_current !== undefined ? l.hp_current : null, l.hp_max !== undefined ? l.hp_max : null, l.hp_temp !== undefined ? l.hp_temp : null, l.map_scale_multiplier !== undefined ? l.map_scale_multiplier : 5]);
            });
            stmtL.finalize();
          }

          if (districts.length > 0) {
            const stmtD = db.prepare(`INSERT INTO districts (id, name, color) VALUES (?, ?, ?)`);
            districts.forEach(d => stmtD.run([d.id, d.name, d.color]));
            stmtD.finalize();
          }

          if (roads.length > 0) {
            const stmtR = db.prepare(`INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)`);
            roads.forEach(r => stmtR.run([r.id, r.x1, r.z1, r.x2, r.z2, r.width]));
            stmtR.finalize();
          }

          db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM locations) WHERE name="locations"');
          db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM districts) WHERE name="districts"');
          db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM roads) WHERE name="roads"');

          if (activeRhombuses && activeRhombuses.length > 0) {
            const stmtRh = db.prepare(`INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, hp_current, hp_max, hp_temp, map_scale_multiplier)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            activeRhombuses.forEach(r => {
              stmtRh.run([r.name, r.description, r.npcs, r.x, r.y, r.z, r.width, r.height, r.depth, r.shape, r.color, r.district_name, r.district_color, r.parent_id, r.is_target, r.isFavorite, r.isDanger, r.owner, r.notifications_enabled, r.rotation, r.rotation_x, r.rotation_z, r.classification, r.polyCount, r.battle_map_id, r.floor_index, r.hp_current !== undefined ? r.hp_current : null, r.hp_max !== undefined ? r.hp_max : null, r.hp_temp !== undefined ? r.hp_temp : null, r.map_scale_multiplier !== undefined ? r.map_scale_multiplier : 5]);
            });
            stmtRh.finalize();
          }

          db.run('SELECT 1', () => {
            emitUpdate();
            res.json({ message: 'Map loaded successfully' });
          });
        });
      });
    });
  });

  router.post('/clear', authenticate, (req, res) => {
    db.all("SELECT * FROM locations WHERE shape = 'rhombus'", (errR, activeRhombuses) => {
      db.serialize(() => {
        db.run('DELETE FROM locations');
        db.run('DELETE FROM districts');
        db.run('DELETE FROM roads');
        db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="locations"');
        db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="districts"');
        db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="roads"');

        if (activeRhombuses && activeRhombuses.length > 0) {
          const stmtR = db.prepare(`INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, hp_current, hp_max, hp_temp, map_scale_multiplier)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          activeRhombuses.forEach(r => {
            stmtR.run([r.name, r.description, r.npcs, r.x, r.y, r.z, r.width, r.height, r.depth, r.shape, r.color, r.district_name, r.district_color, r.parent_id, r.is_target, r.isFavorite, r.isDanger, r.owner, r.notifications_enabled, r.rotation, r.rotation_x, r.rotation_z, r.classification, r.polyCount, r.battle_map_id, r.floor_index, r.hp_current !== undefined ? r.hp_current : null, r.hp_max !== undefined ? r.hp_max : null, r.hp_temp !== undefined ? r.hp_temp : null, r.map_scale_multiplier !== undefined ? r.map_scale_multiplier : 5]);
          });
          stmtR.finalize();
        }

        db.run('SELECT 1', () => {
          emitUpdate();
          res.json({ message: 'Map cleared completely' });
        });
      });
    });
  });

  router.delete('/:id', authenticate, (req, res) => {
    db.run('DELETE FROM saved_maps WHERE id = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Map deleted' });
    });
  });

  return router;
};
