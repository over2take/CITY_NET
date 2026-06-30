const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM locations', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/', optionalAuthenticate, async (req, res) => {
    const locations = Array.isArray(req.body) ? req.body : [req.body];

    if (!req.user) {
      const hasInvalidShape = locations.some(loc => loc.shape !== 'rhombus');
      if (hasInvalidShape) {
        return res.status(401).json({ error: 'Access denied: Unauthenticated users can only create rhombuses.' });
      }
    }

    for (let loc of locations) {
      if (loc.shape === 'rhombus' && loc.owner) {
        const inherited = await new Promise(resolve => {
          db.get('SELECT hp_current, hp_max, hp_temp FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id IS NULL LIMIT 1', [loc.owner], (err, row) => resolve(row));
        });
        if (inherited) {
          loc.hp_current = inherited.hp_current;
          loc.hp_max = inherited.hp_max;
          loc.hp_temp = inherited.hp_temp;
        }
      }
    }

    const sql = `INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, hp_current, hp_max, hp_temp, map_scale_multiplier)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.serialize(() => {
      const results = [];
      const errors = [];
      const stmt = db.prepare(sql);

      locations.forEach((loc, index) => {
        if (loc.x === undefined || loc.y === undefined || loc.z === undefined) {
          errors.push(`Location at index ${index} missing coordinates`);
          return;
        }
        stmt.run([
          loc.name, loc.description || null, loc.npcs || null, loc.x, loc.y, loc.z,
          loc.width || 1, loc.height || 1, loc.depth || 1, loc.shape || 'box',
          loc.color || '#00ff00', loc.district_name || null, loc.district_color || null,
          loc.parent_id || null, loc.isFavorite ? 1 : 0, loc.isDanger ? 1 : 0, loc.owner || null,
          loc.rotation || 0, loc.rotation_x || 0, loc.rotation_z || 0, loc.classification || null, loc.polyCount || 5,
          loc.battle_map_id || null, loc.floor_index !== undefined ? loc.floor_index : null,
          loc.hp_current !== undefined ? loc.hp_current : null,
          loc.hp_max !== undefined ? loc.hp_max : null,
          loc.hp_temp !== undefined ? loc.hp_temp : null,
          loc.map_scale_multiplier !== undefined ? loc.map_scale_multiplier : 5
        ], function(err) {
          if (err) {
            console.error(`Database error during insert at index ${index}:`, err.message);
            errors.push(`Index ${index}: ${err.message}`);
          } else {
            results.push({ id: this.lastID, ...loc });
          }
        });
      });

      stmt.finalize(() => {
        if (errors.length > 0 && results.length === 0) {
          return res.status(500).json({ error: 'All insertions failed', details: errors });
        }
        if (results.length > 0) {
          recordAction('location_create', { ids: results.map(r => r.id) });
          results.forEach(loc => {
            if (loc.shape === 'rhombus') io.emit('rhombusAppearing', { id: loc.id, owner: loc.owner });
          });
        }
        const isRhombusOnly = results.length > 0 && results.every(r => r.shape === 'rhombus');
        emitUpdate({ isRhombusOnly });
        res.json({ message: `Processed ${results.length} locations`, data: results, errors: errors.length > 0 ? errors : undefined });
      });
    });
  });

  router.post('/batch-delete', authenticate, (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid IDs provided' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.all(`SELECT * FROM locations WHERE id IN (${placeholders})`, ids, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(`DELETE FROM locations WHERE id IN (${placeholders})`, ids, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        recordAction('location_delete', { data: rows });
        emitUpdate();
        res.json({ message: 'Batch deleted' });
      });
    });
  });

  router.post('/batch-district', authenticate, (req, res) => {
    const { ids, district_name, district_color } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Invalid data' });

    db.run('UPDATE locations SET district_name = NULL, district_color = NULL WHERE district_name = ?', [district_name], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      if (ids.length === 0) {
        emitUpdate();
        return res.json({ message: 'District cleared' });
      }
      const placeholders = ids.map(() => '?').join(',');
      db.run(`UPDATE locations SET district_name = ?, district_color = ? WHERE id IN (${placeholders})`, [district_name, district_color, ...ids], function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ message: 'District updated' });
      });
    });
  });

  router.post('/join', authenticate, (req, res) => {
    const { ids, classification } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length < 1) return res.status(400).json({ error: 'Need at least 1 ID to join/classify' });

    const rootId = ids[0];
    const childrenIds = ids.slice(1);

    const updateRoot = new Promise((resolve, reject) => {
      if (classification !== undefined) {
        db.run(`UPDATE locations SET classification = ? WHERE id = ?`, [classification, rootId], function(err) {
          if (err) return reject(err);
          resolve();
        });
      } else {
        resolve();
      }
    });

    updateRoot.then(() => {
      if (childrenIds.length === 0) {
        emitUpdate();
        return res.json({ message: 'Structure classified', rootId });
      }
      const placeholders = childrenIds.map(() => '?').join(',');
      db.all(`SELECT id, parent_id FROM locations WHERE id IN (${placeholders})`, childrenIds, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`UPDATE locations SET parent_id = ? WHERE id IN (${placeholders})`, [rootId, ...childrenIds], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          recordAction('location_update_batch', { data: rows.map(r => ({ id: r.id, old_data: { parent_id: r.parent_id } })) });
          emitUpdate();
          res.json({ message: 'Structures joined', rootId });
        });
      });
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  router.put('/:id', optionalAuthenticate, (req, res) => {
    const { name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, map_scale_multiplier } = req.body;

    console.log(`[DEBUG] PUT /api/locations/${req.params.id} map_scale_multiplier:`, map_scale_multiplier);
    if (name === undefined || x === undefined || y === undefined || z === undefined) {
      return res.status(400).json({ error: 'Missing required fields (name, x, y, z)' });
    }

    db.get('SELECT * FROM locations WHERE id = ?', [req.params.id], (err, oldRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!oldRow) return res.status(404).json({ error: 'Location not found' });

      if (!req.user && (oldRow.shape !== 'rhombus' || (shape && shape !== 'rhombus'))) {
        return res.status(401).json({ error: 'Access denied: Unauthenticated users can only update rhombuses.' });
      }

      const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=?, battle_map_id=?, floor_index=?, map_scale_multiplier=? WHERE id=?`;
      const params = [name, description, npcs, x, y, z, width, height, depth, shape || 'box', color, district_name || null, district_color || null, parent_id || null, isFavorite ? 1 : 0, isDanger ? 1 : 0, owner || null, rotation || 0, rotation_x || 0, rotation_z || 0, classification || null, polyCount || 5, battle_map_id || null, floor_index !== undefined ? floor_index : null, map_scale_multiplier !== undefined ? map_scale_multiplier : oldRow.map_scale_multiplier, req.params.id];

      db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        recordAction('location_update', { id: req.params.id, old_data: oldRow });
        emitUpdate();
        res.json({ id: req.params.id, ...req.body });
      });
    });
  });

  router.put('/:id/health', optionalAuthenticate, (req, res) => {
    const { id } = req.params;
    const { hp_current, hp_max, hp_temp, action, amount } = req.body;

    db.get('SELECT shape, owner, hp_current, hp_max, hp_temp FROM locations WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Location not found' });

      if (!req.user && row.shape !== 'rhombus') {
        return res.status(401).json({ error: 'Access denied: Unauthenticated users can only update rhombuses.' });
      }

      let newCurrent = hp_current !== undefined ? hp_current : row.hp_current;
      let newMax = hp_max !== undefined ? hp_max : row.hp_max;
      let newTemp = hp_temp !== undefined ? hp_temp : row.hp_temp;

      if (newCurrent === null) newCurrent = 0;
      if (newMax === null) newMax = 0;
      if (newTemp === null) newTemp = 0;

      if (action === 'set_max' && (row.hp_current === null || row.hp_current === 0)) {
        newCurrent = newMax;
      }

      if (action === 'damage' && amount > 0) {
        let remainingDamage = amount;
        if (newTemp > 0) {
          if (newTemp >= remainingDamage) { newTemp -= remainingDamage; remainingDamage = 0; }
          else { remainingDamage -= newTemp; newTemp = 0; }
        }
        if (remainingDamage > 0 && newCurrent !== null) newCurrent = Math.max(0, newCurrent - remainingDamage);
      } else if (action === 'heal' && amount > 0 && newCurrent !== null && newMax !== null) {
        newCurrent = Math.min(newMax, newCurrent + amount);
      }

      if (row.shape === 'rhombus' && row.owner) {
        db.run('UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE shape = "rhombus" AND owner = ?', [newCurrent, newMax, newTemp, row.owner], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          res.json({ id, hp_current: newCurrent, hp_max: newMax, hp_temp: newTemp });
        });
      } else {
        db.run('UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE id = ?', [newCurrent, newMax, newTemp, id], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          res.json({ id, hp_current: newCurrent, hp_max: newMax, hp_temp: newTemp });
        });
      }
    });
  });

  router.put('/:id/injuries', optionalAuthenticate, (req, res) => {
    const { id } = req.params;
    const { injuries } = req.body;
    if (typeof injuries !== 'object') return res.status(400).json({ error: 'injuries must be an object' });
    const json = JSON.stringify(injuries);
    db.get('SELECT shape, owner FROM locations WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (!req.user && row.shape !== 'rhombus') return res.status(401).json({ error: 'Access denied' });
      const query = row.shape === 'rhombus' && row.owner
        ? ['UPDATE locations SET injuries = ? WHERE shape = "rhombus" AND owner = ?', [json, row.owner]]
        : ['UPDATE locations SET injuries = ? WHERE id = ?', [json, id]];
      db.run(query[0], query[1], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ id, injuries });
      });
    });
  });

  router.delete('/:id', authenticate, (req, res) => {
    db.get('SELECT * FROM locations WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Not found' });

      db.all('SELECT image_url FROM battle_maps WHERE location_id = ?', [req.params.id], (errMaps, mapRows) => {
        if (mapRows && mapRows.length > 0) {
          mapRows.forEach(map => {
            const filePath = path.join(__dirname, '../..', map.image_url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          });
        }
        db.run('DELETE FROM battle_maps WHERE location_id = ?', [req.params.id], (errDelMaps) => {
          if (errDelMaps) console.error('Error deleting battle maps:', errDelMaps.message);
          db.run('DELETE FROM locations WHERE id = ?', req.params.id, (errDelLoc) => {
            if (errDelLoc) return res.status(500).json({ error: errDelLoc.message });
            recordAction('location_delete', { data: [row] });
            emitUpdate();
            res.json({ message: 'Deleted' });
          });
        });
      });
    });
  });

  return router;
};
