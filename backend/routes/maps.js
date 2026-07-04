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
            db.all('SELECT * FROM overpasses', (err4, overpasses) => {
              if (err4) return res.status(500).json({ error: err4.message });
              db.all('SELECT * FROM water_bodies', (err5, waterBodies) => {
                if (err5) return res.status(500).json({ error: err5.message });

                const sql = `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data, overpasses_data, water_bodies_data)
                             VALUES (?, ?, ?, ?, ?, ?)
                             ON CONFLICT(name) DO UPDATE SET
                               locations_data=excluded.locations_data,
                               districts_data=excluded.districts_data,
                               roads_data=excluded.roads_data,
                               overpasses_data=excluded.overpasses_data,
                               water_bodies_data=excluded.water_bodies_data,
                               timestamp=CURRENT_TIMESTAMP`;
                db.run(sql, [name, JSON.stringify(locations), JSON.stringify(districts), JSON.stringify(roads), JSON.stringify(overpasses), JSON.stringify(waterBodies)], function(err) {
                  if (err) return res.status(500).json({ error: err.message });
                  res.json({ message: 'Map saved successfully' });
                });
              });
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
      const overpasses = JSON.parse(row.overpasses_data || '[]');
      const waterBodies = JSON.parse(row.water_bodies_data || '[]');

      db.serialize(() => {
        // Delete all locations except player/enemy tokens
        db.run(`DELETE FROM locations WHERE shape IS NULL OR shape NOT IN ('rhombus', 'enemy_rhombus', 'friendly_rhombus')`);
        db.run('DELETE FROM districts');
        db.run('DELETE FROM roads');
        db.run('DELETE FROM overpasses');
        db.run('DELETE FROM water_bodies');

        if (locations.length > 0) {
          const stmtL = db.prepare(`INSERT OR IGNORE INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, hp_current, hp_max, hp_temp, map_scale_multiplier, is_global)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          locations.forEach(l => {
            stmtL.run([l.id, l.name, l.description, l.npcs, l.x, l.y, l.z, l.width, l.height, l.depth, l.shape, l.color, l.district_name, l.district_color, l.parent_id, l.is_target, l.isFavorite, l.isDanger, l.owner, l.notifications_enabled, l.rotation, l.rotation_x, l.rotation_z, l.classification, l.polyCount, l.battle_map_id, l.floor_index, l.hp_current !== undefined ? l.hp_current : null, l.hp_max !== undefined ? l.hp_max : null, l.hp_temp !== undefined ? l.hp_temp : null, l.map_scale_multiplier !== undefined ? l.map_scale_multiplier : 5, l.is_global || 0]);
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

        if (overpasses.length > 0) {
          const stmtO = db.prepare(`INSERT INTO overpasses (id, points, height, width, ramp_length, pillar_spacing) VALUES (?, ?, ?, ?, ?, ?)`);
          overpasses.forEach(o => stmtO.run([o.id, o.points, o.height, o.width, o.ramp_length, o.pillar_spacing]));
          stmtO.finalize();
        }

        db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM locations) WHERE name="locations"');
        db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM districts) WHERE name="districts"');
        db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM roads) WHERE name="roads"');
        db.run('UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM overpasses), 0) WHERE name="overpasses"');

        if (waterBodies.length > 0) {
          const stmtW = db.prepare(`INSERT INTO water_bodies (id, points_json, map_scale_multiplier) VALUES (?, ?, ?)`);
          waterBodies.forEach(w => stmtW.run([w.id, w.points_json, w.map_scale_multiplier]));
          stmtW.finalize();
        }
        db.run('UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM water_bodies), 0) WHERE name="water_bodies"');

        db.run('SELECT 1', () => {
          emitUpdate();
          res.json({ message: 'Map loaded successfully' });
        });
      });
    });
  });

  router.post('/clear', authenticate, (req, res) => {
    db.serialize(() => {
      // Preserve only player/enemy tokens
      db.run(`DELETE FROM locations WHERE shape IS NULL OR shape NOT IN ('rhombus', 'enemy_rhombus', 'friendly_rhombus')`);
      db.run('DELETE FROM districts');
      db.run('DELETE FROM roads');
      db.run('DELETE FROM overpasses');
      db.run('DELETE FROM water_bodies');
      db.run('UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM locations), 0) WHERE name="locations"');
      db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="districts"');
      db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="roads"');
      db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="overpasses"');
      db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="water_bodies"');

      db.run('SELECT 1', () => {
        emitUpdate();
        res.json({ message: 'Map cleared completely' });
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
