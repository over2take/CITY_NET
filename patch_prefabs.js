const fs = require('fs');
let code = fs.readFileSync('backend/server.js', 'utf8');

const joinOld = `      const placeholders = childrenIds.map(() => '?').join(',');
      db.all(\`SELECT id, parent_id FROM locations WHERE id IN (\${placeholders})\`, childrenIds, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
  
        const sql = \`UPDATE locations SET parent_id = ? WHERE id IN (\${placeholders})\`;
        db.run(sql, [rootId, ...childrenIds], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          recordAction('location_update_batch', { data: rows.map(r => ({ id: r.id, old_data: { parent_id: r.parent_id } })) });
          emitUpdate();
          res.json({ message: 'Structures joined', rootId });
        });
      });`;

const joinNew = `      const placeholders = childrenIds.map(() => '?').join(',');
      db.all(\`SELECT id, parent_id FROM locations WHERE id IN (\${placeholders})\`, childrenIds, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
  
        const savePrefabAndFinish = (msg) => {
          if (!classification) {
            emitUpdate();
            return res.json({ message: msg, rootId });
          }
          
          const allIds = [rootId, ...childrenIds];
          const allPlaceholders = allIds.map(() => '?').join(',');
          db.all(\`SELECT * FROM locations WHERE id IN (\${allPlaceholders})\`, allIds, (err, allRows) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const root = allRows.find(r => r.id === rootId);
            const children = allRows.filter(r => r.id !== rootId);
            
            const prefabData = {
              name: root.name,
              shape: root.shape,
              width: root.width,
              height: root.height,
              depth: root.depth,
              color: root.color,
              polyCount: root.polyCount || 5,
              children: children.map(c => ({
                shape: c.shape,
                color: c.color,
                polyCount: c.polyCount || 5,
                x_offset: c.x - root.x,
                y_offset: c.y - root.y,
                z_offset: c.z - root.z,
                width: c.width,
                height: c.height,
                depth: c.depth,
                rotation_x: c.rotation_x || 0,
                rotation: c.rotation || 0,
                rotation_z: c.rotation_z || 0
              }))
            };
            
            db.run(\`INSERT INTO structure_prefabs (classification, data) VALUES (?, ?)\`, [classification, JSON.stringify(prefabData)], (err) => {
              if (err) console.error('Failed to save prefab:', err);
              emitUpdate();
              res.json({ message: msg, rootId });
            });
          });
        };

        const sql = \`UPDATE locations SET parent_id = ? WHERE id IN (\${placeholders})\`;
        db.run(sql, [rootId, ...childrenIds], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          recordAction('location_update_batch', { data: rows.map(r => ({ id: r.id, old_data: { parent_id: r.parent_id } })) });
          savePrefabAndFinish('Structures joined');
        });
      });`;

code = code.replace(joinOld, joinNew);

if (!code.includes('app.get(\'/api/prefabs\'')) {
    const routesNew = `  app.get('/api/prefabs', (req, res) => {
    db.all('SELECT * FROM structure_prefabs ORDER BY id DESC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.delete('/api/prefabs/:id', authenticate, (req, res) => {
    db.run('DELETE FROM structure_prefabs WHERE id = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });

  app.get('/api/districts', (req, res) => {`;
    code = code.replace("  app.get('/api/districts', (req, res) => {", routesNew);
}

fs.writeFileSync('backend/server.js', code);
console.log('Patched prefabs logic in backend/server.js');
