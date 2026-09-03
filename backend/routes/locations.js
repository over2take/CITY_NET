const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const identity = require('../sheets/identity');
const { mutateSheet, patchSheet } = require('../sheets/mutate');
const { DEFAULT_SYSTEM } = require('../sheets/templates');
const { BUILDING_TYPES, isValidType } = require('../buildingTypes');

const ZONE_TYPE_NAMES = new Set(['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'PARK', 'HOLOTREE_CANOPY', 'LANDMARK', 'MARKETS', 'CUSTOM']);
const isUserDefinedName = (name) => !!name && name.trim() !== '' && !ZONE_TYPE_NAMES.has(name.trim());

/** Player, enemy and friendly tokens. Map content is everything that is not one. */
const TOKEN_SHAPES = new Set(['rhombus', 'enemy_rhombus', 'friendly_rhombus']);

/** Ray casting on the XZ plane. Mirrors the generator's own test. */
const pointInPolygon = (points, x, z) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const straddles = (a.z > z) !== (b.z > z);
    if (straddles && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

/**
 * Is (x, z) inside the region the caller asked about?
 *
 * A polygon takes precedence when given, so a drawn boundary clears exactly the shape
 * that was drawn rather than its bounding box.
 */
const makeRegionTest = ({ bounds, polygon }) => {
  if (Array.isArray(polygon) && polygon.length >= 3) {
    return (x, z) => pointInPolygon(polygon, x, z);
  }
  if (!bounds || !bounds.min || !bounds.max) return null;
  const minX = Math.min(bounds.min.x, bounds.max.x);
  const maxX = Math.max(bounds.min.x, bounds.max.x);
  const minZ = Math.min(bounds.min.z, bounds.max.z);
  const maxZ = Math.max(bounds.min.z, bounds.max.z);
  return (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
};

const upsertLibrary = (db, loc) => {
  db.run(`INSERT INTO custom_structure_library
    (id, name, description, npcs, x, y, z, width, height, depth, shape, color,
     district_name, district_color, parent_id, isFavorite, isDanger, rotation,
     rotation_x, rotation_z, classification, polyCount, hp_current, hp_max, hp_temp,
     map_scale_multiplier, melee_ac, ranged_ac, injuries, saved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description, npcs=excluded.npcs,
      x=excluded.x, y=excluded.y, z=excluded.z, width=excluded.width,
      height=excluded.height, depth=excluded.depth, shape=excluded.shape,
      color=excluded.color, district_name=excluded.district_name,
      district_color=excluded.district_color, parent_id=excluded.parent_id,
      isFavorite=excluded.isFavorite, isDanger=excluded.isDanger,
      rotation=excluded.rotation, rotation_x=excluded.rotation_x,
      rotation_z=excluded.rotation_z, classification=excluded.classification,
      polyCount=excluded.polyCount, hp_current=excluded.hp_current,
      hp_max=excluded.hp_max, hp_temp=excluded.hp_temp,
      map_scale_multiplier=excluded.map_scale_multiplier,
      melee_ac=excluded.melee_ac, ranged_ac=excluded.ranged_ac,
      injuries=excluded.injuries, saved_at=CURRENT_TIMESTAMP`,
    [loc.id, loc.name, loc.description || null, loc.npcs || null,
     loc.x, loc.y, loc.z, loc.width, loc.height, loc.depth,
     loc.shape || 'box', loc.color || '#00ff00',
     loc.district_name || null, loc.district_color || null, loc.parent_id || null,
     loc.isFavorite ? 1 : 0, loc.isDanger ? 1 : 0,
     loc.rotation || 0, loc.rotation_x || 0, loc.rotation_z || 0,
     loc.classification || null, loc.polyCount || 5,
     loc.hp_current ?? null, loc.hp_max ?? null, loc.hp_temp ?? null,
     loc.map_scale_multiplier ?? 5,
     loc.melee_ac ?? null, loc.ranged_ac ?? null,
     loc.injuries || '{}'],
    (err) => { if (err) console.error('[library] upsert failed:', err.message); }
  );
};

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all(
      `SELECT l.*, COALESCE(npc_cs.portrait_url, CASE WHEN l.shape = 'rhombus' THEN player_cs.portrait_url END) AS portrait_url,
              npc_cs.data AS sheet_data
       FROM locations l
       LEFT JOIN npc_sheet_links nsl ON nsl.location_id = l.id
       LEFT JOIN character_sheets npc_cs ON npc_cs.id = nsl.sheet_id
       LEFT JOIN (
         SELECT username, portrait_url FROM character_sheets
         WHERE is_npc = 0 AND portrait_url IS NOT NULL
         GROUP BY username
       ) player_cs ON player_cs.username = l.owner`,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      }
    );
  });

  router.patch('/:id/toggle-hidden', authenticate, (req, res) => {
    db.get('SELECT is_hidden, parent_id FROM locations WHERE id = ?', [req.params.id], (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'Not found' });
      if (row.parent_id) return res.status(400).json({ error: 'Toggle hidden on root structures only' });
      const next = row.is_hidden ? 0 : 1;
      db.run('UPDATE locations SET is_hidden = ? WHERE id = ?', [next, req.params.id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        recordAction(req.params.id, next ? 'hidden' : 'revealed');
        res.json({ is_hidden: next });
      });
    });
  });

  /**
   * Shops are Cities Without Number only, for now.
   *
   * Gated on the server rather than only hidden in the client: a button nobody can see is
   * not a rule, and the point of starting with one system is that the others genuinely do
   * not have this yet. Widening it later means adding to this set.
   */
  const SHOP_SYSTEMS = new Set(['cities_without_number']);

  const withShopSystem = (res, next) => {
    db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const system = (row && row.value) || DEFAULT_SYSTEM;
      if (!SHOP_SYSTEMS.has(system)) {
        return res.status(409).json({ error: 'Building types are only available under Cities Without Number' });
      }
      next();
    });
  };

  /** The list the admin picker is built from, so the vocabulary has one owner. */
  router.get('/building-types', (req, res) =>
    withShopSystem(res, () => res.json(BUILDING_TYPES)));

  /**
   * What a building is for.
   *
   * Its own route rather than a field on the big PUT: that one demands name, x, y and z
   * and rewrites the whole row, which is a lot of blast radius for setting one label. It
   * also leaves building_type alone, so the two do not fight.
   */
  router.patch('/:id/building-type', authenticate, (req, res) => withShopSystem(res, () => {
    const { building_type } = req.body;
    // A value nobody recognises would put a SHOP button on a building that cannot sell
    // anything, so it is refused rather than stored and puzzled over later.
    if (!isValidType(building_type)) return res.status(400).json({ error: 'Unknown building type' });

    const next = building_type === '' || building_type === undefined ? null : building_type;
    db.get('SELECT id FROM locations WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Not found' });
      db.run('UPDATE locations SET building_type = ? WHERE id = ?', [next, req.params.id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ id: Number(req.params.id), building_type: next });
      });
    });
  }));

  // Custom structure library — structures saved via JOIN → CUSTOM classification
  router.get('/custom-library', authenticate, (req, res) => {
    db.all(`SELECT * FROM custom_structure_library WHERE classification = 'CUSTOM' OR parent_id IS NOT NULL ORDER BY saved_at DESC`, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const roots = rows.filter(r => !r.parent_id);
      const children = rows.filter(r => r.parent_id);
      const result = roots.map(root => ({
        ...root,
        parts: children.filter(c => c.parent_id === root.id),
      }));
      res.json(result);
    });
  });

  /**
   * Clear a previously generated city from a region, so it can be generated afresh.
   *
   * Generating over an occupied area otherwise infills around what is already there,
   * which is useful in its own right but not what regenerating means.
   *
   * What survives is the point. Anything a GM named or renamed is kept and becomes an
   * obstacle the new city builds around — losing hand-placed work is the one outcome
   * that cannot be undone by generating again. Tokens, water and signs are never map
   * generation output and are never touched.
   *
   * Done in one transaction with a single broadcast: a client deleting hundreds of
   * rows one at a time is slow, leaves the map half-cleared if it fails part way, and
   * floods every connected player with updates.
   */
  router.post('/purge-region', authenticate, (req, res) => {
    const inRegion = makeRegionTest(req.body || {});
    if (!inRegion) return res.status(400).json({ error: 'bounds or polygon required' });

    db.all('SELECT * FROM locations', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const doomed = [];
      let keptNamed = 0;

      for (const row of rows) {
        if (row.battle_map_id != null) continue;          // battle map content, not the world
        if (TOKEN_SHAPES.has(row.shape)) continue;         // tokens are never map content
        if (!inRegion(row.x, row.z)) continue;
        if (isUserDefinedName(row.name)) { keptNamed++; continue; }
        doomed.push(row);
      }

      // A root's parts sit at their own coordinates, so a child can fall outside the
      // region while its root is inside. Taking the children too avoids orphaning them.
      const doomedIds = new Set(doomed.map(r => r.id));
      for (const row of rows) {
        if (doomedIds.has(row.id)) continue;
        if (row.parent_id != null && doomedIds.has(row.parent_id)) {
          doomed.push(row);
          doomedIds.add(row.id);
        }
      }

      db.all('SELECT * FROM roads', [], (err2, roadRows) => {
        if (err2) return res.status(500).json({ error: err2.message });
        // A road counts as inside when its midpoint is: an approach running out of the
        // region should go with the city it served.
        const roads = roadRows.filter(r => inRegion((r.x1 + r.x2) / 2, (r.z1 + r.z2) / 2));

        db.all('SELECT * FROM overpasses', [], (err3, overpassRows) => {
          if (err3) return res.status(500).json({ error: err3.message });
          const overpasses = (overpassRows || []).filter(o => {
            let points;
            try { points = JSON.parse(o.points); } catch { return false; }
            if (!Array.isArray(points) || points.length === 0) return false;
            const mid = points[Math.floor(points.length / 2)];
            return mid && inRegion(mid.x, mid.z);
          });

          const ids = doomed.map(r => r.id);
          const roadIds = roads.map(r => r.id);
          const overpassIds = overpasses.map(o => o.id);

          const del = (table, list) => {
            if (list.length === 0) return;
            db.run(`DELETE FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`, list);
          };

          // Only water the generator made. A lake the GM drew is hand-placed work and
          // survives a regenerate exactly as a named structure does.
          db.all('SELECT * FROM water_bodies WHERE generated = 1', [], (err4, waterRows) => {
            if (err4) return res.status(500).json({ error: err4.message });
            const water = (waterRows || []).filter(w => {
              let points;
              try { points = JSON.parse(w.points_json); } catch { return false; }
              if (!Array.isArray(points) || points.length === 0) return false;
              // Its centroid decides, so a river trimmed at the region edge goes with
              // the city it belonged to.
              const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
              const cz = points.reduce((a, p) => a + p.z, 0) / points.length;
              return inRegion(cx, cz);
            });
            const waterIds = water.map(w => w.id);

            db.serialize(() => {
              db.run('BEGIN TRANSACTION');
              del('locations', ids);
              del('roads', roadIds);
              del('overpasses', overpassIds);
              del('water_bodies', waterIds);
              db.run('COMMIT', (err5) => {
                if (err5) return res.status(500).json({ error: err5.message });
                recordAction('region_purge', {
                  locations: doomed,
                  roads,
                  overpasses,
                  water,
                });
                emitUpdate();
                res.json({
                  locations: ids.length,
                  roads: roadIds.length,
                  overpasses: overpassIds.length,
                  water: waterIds.length,
                  keptNamed,
                });
              });
            });
          });
        });
      });
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

    const sql = `INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, hp_current, hp_max, hp_temp, map_scale_multiplier, has_signage)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
          loc.map_scale_multiplier !== undefined ? loc.map_scale_multiplier : 5,
          loc.has_signage !== undefined ? loc.has_signage : 1
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
          // Player tokens take their name/description from the owner's
          // character sheet (single source of truth)
          const owners = [...new Set(results.filter(r => r.shape === 'rhombus' && r.owner).map(r => r.owner))];
          if (owners.length > 0) {
            db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (eGs, rowGs) => {
              const system = rowGs ? rowGs.value : DEFAULT_SYSTEM;
              owners.forEach(o => identity.syncToken(db, system, o, (changed) => {
                if (changed) emitUpdate({ isRhombusOnly: true });
              }));
            });
          }
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

  /**
   * Put these buildings in this district.
   *
   * Additive. What replaced it - a wipe of the whole district followed by a re-insert of
   * whatever the client posted - meant the posted list WAS the district, so a stale or
   * mis-dragged selection silently unassigned buildings with nothing to undo from. Here the
   * posted ids are the only rows touched.
   *
   * A building belongs to one district, so assigning one that is already filed elsewhere
   * moves it rather than refusing: the UPDATE overwrites whatever it had.
   *
   * The color is read from the districts table rather than taken from the request, so the
   * copy on the building cannot drift from the district it names.
   */
  router.post('/assign-district', authenticate, (req, res) => {
    const { ids, district_name } = req.body;
    if (!Array.isArray(ids) || !district_name) return res.status(400).json({ error: 'Invalid data' });
    if (ids.length === 0) return res.json({ message: 'Nothing to assign', assigned: 0 });

    db.get('SELECT color FROM districts WHERE name = ?', [district_name], (err, district) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!district) return res.status(404).json({ error: 'District not found' });
      const placeholders = ids.map(() => '?').join(',');
      db.run(
        `UPDATE locations SET district_name = ?, district_color = ? WHERE id IN (${placeholders})`,
        [district_name, district.color, ...ids],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          res.json({ message: 'District updated', assigned: this.changes });
        }
      );
    });
  });

  /** Take these buildings out of whatever district they are in. */
  router.post('/unassign-district', authenticate, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Invalid data' });
    if (ids.length === 0) return res.json({ message: 'Nothing to unassign', unassigned: 0 });
    const placeholders = ids.map(() => '?').join(',');
    db.run(
      `UPDATE locations SET district_name = NULL, district_color = NULL WHERE id IN (${placeholders})`,
      ids,
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        emitUpdate();
        res.json({ message: 'Removed from district', unassigned: this.changes });
      }
    );
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

    const saveGroupToLibrary = () => {
      if (classification !== 'CUSTOM') return;
      db.get('SELECT * FROM locations WHERE id = ?', [rootId], (err, root) => {
        if (err || !root) return;
        root.classification = 'CUSTOM';
        if (!root.name) root.name = `CUSTOM_${rootId}`;
        upsertLibrary(db, root);
        db.all('SELECT * FROM locations WHERE parent_id = ?', [rootId], (err2, children) => {
          if (err2 || !children) return;
          children.forEach(child => upsertLibrary(db, child));
        });
      });
    };

    updateRoot.then(() => {
      if (childrenIds.length === 0) {
        saveGroupToLibrary();
        emitUpdate();
        return res.json({ message: 'Structure classified', rootId });
      }
      const placeholders = childrenIds.map(() => '?').join(',');
      db.all(`SELECT id, parent_id FROM locations WHERE id IN (${placeholders})`, childrenIds, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`UPDATE locations SET parent_id = ? WHERE id IN (${placeholders})`, [rootId, ...childrenIds], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          recordAction('location_update_batch', { data: rows.map(r => ({ id: r.id, old_data: { parent_id: r.parent_id } })) });
          saveGroupToLibrary();
          emitUpdate();
          res.json({ message: 'Structures joined', rootId });
        });
      });
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  router.put('/:id', optionalAuthenticate, (req, res) => {
    const { name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation, rotation_x, rotation_z, classification, polyCount, battle_map_id, floor_index, map_scale_multiplier, melee_ac, ranged_ac, has_sidewalk, has_signage } = req.body;

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

      const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=?, battle_map_id=?, floor_index=?, map_scale_multiplier=?, melee_ac=?, ranged_ac=?, has_sidewalk=?, has_signage=? WHERE id=?`;
      const meleAcVal = melee_ac !== undefined ? (melee_ac === '' || melee_ac === null ? null : parseInt(melee_ac, 10)) : oldRow.melee_ac;
      const rangedAcVal = ranged_ac !== undefined ? (ranged_ac === '' || ranged_ac === null ? null : parseInt(ranged_ac, 10)) : oldRow.ranged_ac;
      const hasSidewalkVal = has_sidewalk !== undefined ? (has_sidewalk ? 1 : 0) : (oldRow.has_sidewalk ?? 1);
      const hasSignageVal = has_signage !== undefined ? (has_signage ? 1 : 0) : (oldRow.has_signage ?? 1);
      const params = [name, description, npcs, x, y, z, width, height, depth, shape || 'box', color, district_name || null, district_color || null, parent_id || null, isFavorite ? 1 : 0, isDanger ? 1 : 0, owner || null, rotation || 0, rotation_x || 0, rotation_z || 0, classification || null, polyCount || 5, battle_map_id || null, floor_index !== undefined ? floor_index : null, map_scale_multiplier !== undefined ? map_scale_multiplier : oldRow.map_scale_multiplier, meleAcVal, rangedAcVal, hasSidewalkVal, hasSignageVal, req.params.id];

      db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        recordAction('location_update', { id: req.params.id, old_data: oldRow });
        emitUpdate();
        res.json({ id: req.params.id, ...req.body });
        // Mirror name/description to any linked NPC sheet so the sheet stays
        // in sync with the token label (enemy_rhombus / friendly_rhombus only).
        const nameChanged = name !== oldRow.name;
        const descChanged = description !== oldRow.description;
        if ((nameChanged || descChanged) && (oldRow.shape === 'enemy_rhombus' || oldRow.shape === 'friendly_rhombus')) {
          db.get(`SELECT sheet_id FROM npc_sheet_links WHERE location_id = ? LIMIT 1`, [req.params.id], (le, link) => {
            if (le || !link) return;
            db.get(`SELECT id FROM character_sheets WHERE id = ? AND is_npc = 1`, [link.sheet_id], (se, sheet) => {
              if (se || !sheet) return;
              patchSheet(db, sheet.id, {
                ...(nameChanged ? { name } : {}),
                ...(descChanged ? { description } : {}),
              });
            });
          });
        }
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

      // Resolve the CWN sheet behind this token (player rhombus by owner,
      // NPC by sheet link) - used by the stim_heal strain gate below.
      const resolveCwnSheet = (cb) => {
        db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (gErr, gRow) => {
          if (gErr || !gRow || gRow.value !== 'cities_without_number') return cb(null);
          if (row.shape === 'rhombus' && row.owner) {
            db.get(
              `SELECT id, username, data, is_npc FROM character_sheets WHERE username = ? AND system = 'cities_without_number' AND is_npc = 0`,
              [row.owner], (e, s) => cb(e ? null : s || null)
            );
          } else {
            db.get(
              `SELECT cs.id, cs.username, cs.data, cs.is_npc FROM npc_sheet_links l
               JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ?`,
              [id], (e, s) => cb(e ? null : s || null)
            );
          }
        });
      };

      const runHealth = (effAction) => {
      let newCurrent = hp_current !== undefined ? hp_current : row.hp_current;
      let newMax = hp_max !== undefined ? hp_max : row.hp_max;
      let newTemp = hp_temp !== undefined ? hp_temp : row.hp_temp;

      if (newCurrent === null) newCurrent = 0;
      if (newMax === null) newMax = 0;
      if (newTemp === null) newTemp = 0;

      if (effAction === 'set_max' && (row.hp_current === null || row.hp_current === 0)) {
        newCurrent = newMax;
      }

      // Always clamp current to max — current can never exceed max
      if (newMax > 0 && newCurrent > newMax) newCurrent = newMax;

      if (effAction === 'damage' && amount > 0) {
        let remainingDamage = amount;
        if (newTemp > 0) {
          if (newTemp >= remainingDamage) { newTemp -= remainingDamage; remainingDamage = 0; }
          else { remainingDamage -= newTemp; newTemp = 0; }
        }
        if (remainingDamage > 0 && newCurrent !== null) newCurrent = Math.max(0, newCurrent - remainingDamage);
      } else if (effAction === 'heal' && amount > 0 && newCurrent !== null && newMax !== null) {
        newCurrent = Math.min(newMax, newCurrent + amount);
      }

      if (row.shape === 'rhombus' && row.owner) {
        db.run('UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE shape = "rhombus" AND owner = ?', [newCurrent, newMax, newTemp, row.owner], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          // Character sheets mirror token HP - tell open sheets to re-fetch
          io.emit('sheetUpdated', { username: row.owner });
          // Back above 0 HP: no longer mortally wounded, death-save penalty resets
          if (newCurrent > 0) {
            db.all('SELECT id, data FROM character_sheets WHERE username = ? AND is_npc = 0', [row.owner], (err3, sheets) => {
              if (err3 || !sheets) return;
              sheets.forEach((s) => {
                try {
                  const data = JSON.parse(s.data || '{}');
                  // CP:R death-save penalty and CWN mortal-wound round count
                  // both reset above 0 HP. CWN's frail flag deliberately
                  // persists - it clears via care, not healing.
                  const needsClearing = Number(data.death_save_penalty) > 0 || Number(data.rounds_since_downed) > 0;
                  if (needsClearing) {
                    // Re-checked at write time: healing lands while the sheet is being
                    // written from several other directions, this being the moment
                    // somebody was on the floor.
                    mutateSheet(db, s.id, (d) => {
                      const pen = Number(d.death_save_penalty) > 0;
                      const rounds = Number(d.rounds_since_downed) > 0;
                      if (!pen && !rounds) return undefined;
                      return {
                        ...d,
                        ...(pen ? { death_save_penalty: 0 } : {}),
                        ...(rounds ? { rounds_since_downed: 0 } : {}),
                      };
                    });
                  }
                } catch (e) { /* bad JSON - leave it */ }
              });
            });
          }
          res.json({ id, hp_current: newCurrent, hp_max: newMax, hp_temp: newTemp });
        });
      } else {
        db.run('UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE id = ?', [newCurrent, newMax, newTemp, id], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          res.json({ id, hp_current: newCurrent, hp_max: newMax, hp_temp: newTemp });
        });
      }
      }; // runHealth

      // CWN stim heal: field healing costs +1 System Strain, and a character
      // whose strain is maxed gets NO stim benefit (the heal is refused).
      // Natural/rest healing stays on the plain 'heal' action, strain-free.
      if (action === 'stim_heal' && amount > 0) {
        resolveCwnSheet((sheet) => {
          if (!sheet) return runHealth('heal'); // no CWN sheet - plain heal
          const data = JSON.parse(sheet.data || '{}');
          const strain = Number(data.system_strain) || 0;
          const strainMax = Number(data.system_strain_max) || 0;
          if (strainMax > 0 && strain >= strainMax) {
            return res.status(409).json({ error: 'STRAIN MAXED — NO STIM BENEFIT' });
          }
          patchSheet(
            db,
            sheet.id,
            (d) => ({ system_strain: (Number(d.system_strain) || 0) + 1 }),
            () => {
              if (!sheet.is_npc) io.emit('sheetUpdated', { username: sheet.username });
              runHealth('heal');
            }
          );
        });
      } else {
        runHealth(action);
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
