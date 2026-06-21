require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5000;
if (!process.env.JWT_SECRET) {
  console.error("CRITICAL ERROR: JWT_SECRET environment variable is not set!");
  console.error("Please create a .env file and set JWT_SECRET to a secure random string.");
  process.exit(1);
}
const SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Emit helper
const emitUpdate = (payload = {}) => io.emit('dataUpdated', payload);

const elevatedUsers = new Set();

const recordAction = (type, payload) => {
  db.run('INSERT INTO action_history (type, payload) VALUES (?, ?)', [type, JSON.stringify(payload)], (err) => {
    if (err) console.error('Failed to record action:', err.message);
    // Optional: limit history size
    db.run('DELETE FROM action_history WHERE id NOT IN (SELECT id FROM action_history ORDER BY timestamp DESC LIMIT 50)');
  });
};

const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const verified = jwt.verify(token.split(' ')[1], SECRET);
    if (verified.isTemporary && !elevatedUsers.has(verified.username)) {
      return res.status(401).json({ error: 'Temporary access revoked' });
    }
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

const optionalAuthenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const verified = jwt.verify(token.split(' ')[1], SECRET);
    if (verified.isTemporary && !elevatedUsers.has(verified.username)) {
      req.user = null; // Treat as unauthenticated if temporary access is revoked
    } else {
      req.user = verified;
    }
  } catch (err) {
    req.user = null; // Proceed as unauthenticated if token is invalid, or you could return error here. We'll proceed as unauth.
  }
  next();
};

// Routes
app.get('/api/locations', (req, res) => {
  db.all('SELECT * FROM locations', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/locations', optionalAuthenticate, (req, res) => {
  const locations = Array.isArray(req.body) ? req.body : [req.body];
  
  // Security check: If unauthenticated, ONLY allow creating Rhombuses.
  if (!req.user) {
    const hasInvalidShape = locations.some(loc => loc.shape !== 'rhombus');
    if (hasInvalidShape) {
      return res.status(401).json({ error: 'Access denied: Unauthenticated users can only create rhombuses.' });
    }
  }

  const sql = `INSERT INTO locations (name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
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
        loc.name || '', 
        loc.description || '', 
        loc.npcs || '', 
        loc.x, loc.y, loc.z, 
        loc.width || 1, loc.height || 1, loc.depth || 1, 
        loc.shape || 'box',
        loc.color !== undefined ? loc.color : '#00ff00',
        loc.district_name || null,
        loc.district_color || null,
        loc.parent_id || null,
        loc.isFavorite ? 1 : 0,
        loc.isDanger ? 1 : 0,
        loc.owner || null,
        loc.rotation || 0
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
      console.error('POST Error: All insertions failed:', errors);
      return res.status(500).json({ error: 'All insertions failed', details: errors });
    }
    if (results.length > 0) {
      recordAction('location_create', { ids: results.map(r => r.id) });
      // Trigger appearing animation for new Rhombuses
      results.forEach(loc => {
          if (loc.shape === 'rhombus') {
              io.emit('rhombusAppearing', { id: loc.id, owner: loc.owner });
          }
      });
    }
    const isRhombusOnly = results.length > 0 && results.every(r => r.shape === 'rhombus');
    emitUpdate({ isRhombusOnly });
      res.json({ 
        message: `Processed ${results.length} locations`, 
        data: results,
        errors: errors.length > 0 ? errors : undefined 
      });
    });
  });
});

app.post('/api/locations/batch-delete', authenticate, (req, res) => {
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

app.delete('/api/locations/:id', authenticate, (req, res) => {
  db.get('SELECT * FROM locations WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });

    db.run('DELETE FROM locations WHERE id = ?', req.params.id, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      recordAction('location_delete', { data: [row] });
      emitUpdate();
      res.json({ message: 'Deleted' });
    });
  });
});

app.put('/api/locations/:id', authenticate, (req, res) => {
  const { name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner, rotation } = req.body;
  
  if (name === undefined || x === undefined || y === undefined || z === undefined) {
    console.error('PUT Error: Missing required fields in body:', req.body);
    return res.status(400).json({ error: 'Missing required fields (name, x, y, z)' });
  }

  db.get('SELECT * FROM locations WHERE id = ?', [req.params.id], (err, oldRow) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=? WHERE id=?`;
    const params = [name, description, npcs, x, y, z, width, height, depth, shape || 'box', color, district_name || null, district_color || null, parent_id || null, isFavorite ? 1 : 0, isDanger ? 1 : 0, owner || null, rotation || 0, req.params.id];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error(`Database error during update for ID ${req.params.id}:`, err.message);
        return res.status(500).json({ error: err.message });
      }
      if (oldRow) {
        recordAction('location_update', { id: req.params.id, old_data: oldRow });
      }
      emitUpdate();
      res.json({ id: req.params.id, ...req.body });
    });
  });
});

app.post('/api/locations/join', authenticate, (req, res) => {
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

      const sql = `UPDATE locations SET parent_id = ? WHERE id IN (${placeholders})`;
      db.run(sql, [rootId, ...childrenIds], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        recordAction('location_update_batch', { data: rows.map(r => ({ id: r.id, old_data: { parent_id: r.parent_id } })) });
        emitUpdate();
        res.json({ message: 'Structures joined', rootId });
      });
    });
  }).catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/districts', (req, res) => {
  db.all('SELECT * FROM districts', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/districts', authenticate, (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'Name and color required' });
  db.run('INSERT INTO districts (name, color) VALUES (?, ?)', [name, color], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    emitUpdate();
    res.json({ id: this.lastID, name, color });
  });
});

app.delete('/api/districts/:name', authenticate, (req, res) => {
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

app.post('/api/locations/batch-district', authenticate, (req, res) => {
  const { ids, district_name, district_color } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Invalid data' });

  // First, remove this district from all locations to sync it properly
  db.run('UPDATE locations SET district_name = NULL, district_color = NULL WHERE district_name = ?', [district_name], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (ids.length === 0) {
      emitUpdate();
      return res.json({ message: 'District cleared' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `UPDATE locations SET district_name = ?, district_color = ? WHERE id IN (${placeholders})`;
    db.run(sql, [district_name, district_color, ...ids], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      emitUpdate();
      res.json({ message: 'District updated' });
    });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'User not found' });
    
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, username: user.username }, SECRET);
    res.json({ token });
  });
});

app.post('/api/undo', authenticate, (req, res) => {
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
        const stmt = db.prepare(`INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, isFavorite, isDanger, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        payload.data.forEach(loc => {
          stmt.run([loc.id, loc.name, loc.description, loc.npcs, loc.x, loc.y, loc.z, loc.width, loc.height, loc.depth, loc.shape, loc.color, loc.district_name, loc.district_color, loc.parent_id, loc.isFavorite, loc.isDanger, loc.owner]);
        });
        stmt.finalize(finishUndo);
      } else if (action.type === 'location_update') {
        const d = payload.old_data;
        const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=? WHERE id=?`;
        db.run(sql, [d.name, d.description, d.npcs, d.x, d.y, d.z, d.width, d.height, d.depth, d.shape, d.color, d.district_name, d.district_color, d.parent_id, d.isFavorite, d.isDanger, d.owner, payload.id], finishUndo);
      } else if (action.type === 'location_update_batch') {
        const stmt = db.prepare('UPDATE locations SET district_name=?, district_color=?, parent_id=? WHERE id=?');
        payload.data.forEach(item => {
          const d = item.old_data;
          stmt.run([
            d.district_name !== undefined ? d.district_name : undefined,
            d.district_color !== undefined ? d.district_color : undefined,
            d.parent_id !== undefined ? d.parent_id : undefined,
            item.id
          ]);
        });
        // Actually, the fields might vary. Let's make it more robust.
        db.serialize(() => {
          payload.data.forEach(item => {
            const d = item.old_data;
            const keys = Object.keys(d);
            const fields = keys.map(k => `${k}=?`).join(',');
            const params = [...keys.map(k => d[k]), item.id];
            db.run(`UPDATE locations SET ${fields} WHERE id=?`, params);
          });
        });
        setTimeout(finishUndo, 100); // Small delay to ensure DB processed serialize queue
      } else if (action.type === 'road_create') {
        const placeholders = payload.ids.map(() => '?').join(',');
        db.run(`DELETE FROM roads WHERE id IN (${placeholders})`, payload.ids, finishUndo);
      } else if (action.type === 'road_delete_all') {
        const stmt = db.prepare(`INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)`);
        payload.data.forEach(r => {
          stmt.run([r.id, r.x1, r.z1, r.x2, r.z2, r.width]);
        });
        stmt.finalize(finishUndo);
      } else {
        res.status(400).json({ error: 'Unknown action type' });
      }
    });
  });
});

// Turn-taking state
let currentController = 'GM'; 

app.get('/api/control', (req, res) => {
  res.json({ controller: currentController });
});

// Roads Routes
app.get('/api/roads', (req, res) => {
  db.all('SELECT * FROM roads', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/roads', authenticate, (req, res) => {
  const roads = Array.isArray(req.body) ? req.body : [req.body];
  const sql = `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?)`;
  
  db.serialize(() => {
    const ids = [];
    const stmt = db.prepare(sql);
    roads.forEach(r => stmt.run([r.x1, r.z1, r.x2, r.z2, r.width || 4], function(err) {
        if (!err) ids.push(this.lastID);
    }));
    stmt.finalize(() => {
      if (ids.length > 0) {
        recordAction('road_create', { ids });
      }
      emitUpdate();
      res.json({ message: `Stored ${roads.length} road segments` });
    });
  });
});

app.delete('/api/roads', authenticate, (req, res) => {
  db.all('SELECT * FROM roads', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.run('DELETE FROM roads', [], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      recordAction('road_delete_all', { data: rows });
      emitUpdate();
      res.json({ message: 'Roads cleared' });
    });
  });
});

// --- MAP MANAGER ROUTES ---
app.get('/api/maps', (req, res) => {
  db.all('SELECT id, name, timestamp FROM saved_maps ORDER BY timestamp DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/maps/save', authenticate, (req, res) => {
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

app.post('/api/maps/load/:name', authenticate, (req, res) => {
  const { name } = req.params;
  db.get('SELECT * FROM saved_maps WHERE name = ?', [name], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Map not found' });

    const locations = JSON.parse(row.locations_data || '[]');
    const districts = JSON.parse(row.districts_data || '[]');
    const roads = JSON.parse(row.roads_data || '[]');

    db.serialize(() => {
      db.run("DELETE FROM locations WHERE shape != 'rhombus' OR shape IS NULL");
      db.run('DELETE FROM districts');
      db.run('DELETE FROM roads');

      if (locations.length > 0) {
        const stmtL = db.prepare(`INSERT INTO locations (id, name, description, npcs, x, y, z, width, height, depth, shape, color, district_name, district_color, parent_id, is_target, isFavorite, isDanger, owner, notifications_enabled, rotation, classification, polyCount) 
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        locations.forEach(l => {
          stmtL.run([l.id, l.name, l.description, l.npcs, l.x, l.y, l.z, l.width, l.height, l.depth, l.shape, l.color, l.district_name, l.district_color, l.parent_id, l.is_target, l.isFavorite, l.isDanger, l.owner, l.notifications_enabled, l.rotation, l.classification, l.polyCount]);
        });
        stmtL.finalize();
      }

      if (districts.length > 0) {
        const stmtD = db.prepare(`INSERT INTO districts (id, name, color) VALUES (?, ?, ?)`);
        districts.forEach(d => {
          stmtD.run([d.id, d.name, d.color]);
        });
        stmtD.finalize();
      }

      if (roads.length > 0) {
        const stmtR = db.prepare(`INSERT INTO roads (id, x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?, ?)`);
        roads.forEach(r => {
          stmtR.run([r.id, r.x1, r.z1, r.x2, r.z2, r.width]);
        });
        stmtR.finalize();
      }

      db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM locations) WHERE name="locations"');
      db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM districts) WHERE name="districts"');
      db.run('UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM roads) WHERE name="roads"', (err) => {
        emitUpdate();
        res.json({ message: 'Map loaded successfully' });
      });
    });
  });
});

app.post('/api/maps/clear', authenticate, (req, res) => {
  db.serialize(() => {
    db.run("DELETE FROM locations WHERE shape != 'rhombus' OR shape IS NULL");
    db.run('DELETE FROM districts');
    db.run('DELETE FROM roads');

    db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="districts"');
    db.run('UPDATE sqlite_sequence SET seq = 0 WHERE name="roads"', (err) => {
      emitUpdate();
      res.json({ message: 'Map cleared completely' });
    });
  });
});

app.delete('/api/maps/:id', authenticate, (req, res) => {
  db.run('DELETE FROM saved_maps WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Map deleted' });
  });
});

app.post('/api/control', authenticate, (req, res) => {
  const { controller } = req.body;
  currentController = controller;
  res.json({ message: 'Control updated', controller: currentController });
});

// Socket.io tracking
const userSockets = new Map(); // socket.id -> userName

let activeNPCs = [];
db.all('SELECT username, isActive FROM fake_users', (err, rows) => {
  if (err) {
    console.error("Error loading fake_users:", err.message);
  } else if (rows) {
    activeNPCs = rows.map(r => ({ userName: r.username, isActive: r.isActive === 1 }));
    console.log("Loaded NPCs from DB:", activeNPCs);
    if (typeof broadcastActiveUsers === 'function') {
      broadcastActiveUsers();
    }
  }
});

const broadcastActiveUsers = () => {
  // Map to unique users by name, preserving admin status
  const userMap = new Map();
  userSockets.forEach((info) => {
    // Add isTemporaryAdmin flag
    const displayInfo = { ...info, isTemporaryAdmin: elevatedUsers.has(info.userName) };
    userMap.set(info.userName, displayInfo);
  });
  
  activeNPCs.forEach(npc => {
    userMap.set(npc.userName, { userName: npc.userName, isAdmin: false, isTemporaryAdmin: false, isNPC: true, isActive: npc.isActive });
  });

  const activeUsers = Array.from(userMap.values());
  io.emit('activeUsersUpdated', activeUsers);
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('identify', (data) => {
    let info = typeof data === 'string' ? { userName: data, isAdmin: false } : data;
    
    // SECURITY FIX: Verify JWT if client claims to be admin
    if (info.isAdmin && info.token) {
        try {
            const verified = jwt.verify(info.token, SECRET);
            // Token is valid, keep isAdmin = true. Don't mark as temp if it's the real admin.
            if (verified.isTemporary) {
                info.isAdmin = false;
                // If they are a temporary admin, broadcastActiveUsers will add the isTemporaryAdmin flag.
            }
        } catch (err) {
            console.warn(`User ${info.userName} claimed admin but provided invalid token.`);
            info.isAdmin = false;
        }
    } else {
        info.isAdmin = false; // Force false if no token provided
    }
    // Remove token from info before broadcasting
    delete info.token;

    console.log(`User identified: ${info.userName} (Admin: ${info.isAdmin})`);
    userSockets.set(socket.id, info);
    broadcastActiveUsers();
    
    // Send chat history from DB to newly connected user
    db.all('SELECT * FROM chat_logs ORDER BY timestamp DESC LIMIT 50', (err, rows) => {
      if (!err) {
        socket.emit('chatHistory', rows.reverse().map(r => ({
          ...r,
          timestamp: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })));
      }
    });

    // Check for user's existing rhombus to trigger appearing animation
    db.get('SELECT id FROM locations WHERE shape = "rhombus" AND owner = ?', [info.userName], (err, row) => {
      if (row) {
        console.log(`Broadcasting rhombusAppearing for ID: ${row.id}, Owner: ${info.userName}`);
        io.emit('rhombusAppearing', { id: row.id, owner: info.userName });
      }
    });
  });

  socket.on('sendMessage', (data) => {
    // data: { sender, text }
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO chat_logs (sender, text, timestamp) VALUES (?, ?, ?)', [data.sender, data.text, timestamp], function(err) {
      if (!err) {
        io.emit('receiveMessage', { 
            id: this.lastID, 
            ...data, 
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
      }
    });
  });

  socket.on('grantElevatedAccess', (data) => {
    // data: { adminToken, targetUser }
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        // Only true admins can grant access
        elevatedUsers.add(data.targetUser);
        const tempToken = jwt.sign({ username: data.targetUser, isTemporary: true }, SECRET, { expiresIn: '12h' });
        console.log(`Admin ${verified.username} granted temporary access to ${data.targetUser}`);
        io.emit('accessGranted', { targetUser: data.targetUser, token: tempToken });
        broadcastActiveUsers();
      }
    } catch (err) {
      console.warn('Unauthorized attempt to grant access:', err.message);
    }
  });

  socket.on('revokeElevatedAccess', (data) => {
    // data: { adminToken, targetUser }
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        elevatedUsers.delete(data.targetUser);
        console.log(`Admin ${verified.username} revoked temporary access from ${data.targetUser}`);
        io.emit('accessRevoked', { targetUser: data.targetUser });
        broadcastActiveUsers();
      }
    } catch (err) {
      console.warn('Unauthorized attempt to revoke access:', err.message);
    }
  });

  socket.on('surrenderAccess', (data) => {
    try {
      const verified = jwt.verify(data.token, SECRET);
      if (verified && verified.isTemporary) {
        elevatedUsers.delete(verified.username);
        console.log(`User ${verified.username} surrendered temporary access`);
        io.emit('accessRevoked', { targetUser: verified.username });
        broadcastActiveUsers();
      }
    } catch (err) {}
  });

  socket.on('createNPC', (data) => {
    // data: { adminToken, npcName }
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        db.run('INSERT INTO fake_users (username, isActive) VALUES (?, 1)', [data.npcName], function(err) {
          if (!err) {
            activeNPCs.push({ userName: data.npcName, isActive: true });
            console.log(`Admin ${verified.username} created NPC: ${data.npcName}`);
            broadcastActiveUsers();
          }
        });
      }
    } catch (err) {
      console.warn('Unauthorized attempt to create NPC:', err.message);
    }
  });

  socket.on('toggleNPCStatus', (data) => {
    // data: { adminToken, npcName, isActive }
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        db.run('UPDATE fake_users SET isActive = ? WHERE username = ?', [data.isActive ? 1 : 0, data.npcName], function(err) {
          if (!err) {
            const npc = activeNPCs.find(n => n.userName === data.npcName);
            if (npc) {
              npc.isActive = data.isActive;
              broadcastActiveUsers();
            }
          }
        });
      }
    } catch (err) {
      console.warn('Unauthorized attempt to toggle NPC:', err.message);
    }
  });

  socket.on('deleteNPC', (data) => {
    // data: { adminToken, npcName }
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        db.run('DELETE FROM fake_users WHERE username = ?', [data.npcName], function(err) {
          if (!err) {
            activeNPCs = activeNPCs.filter(n => n.userName !== data.npcName);
            broadcastActiveUsers();
          }
        });
      }
    } catch (err) {
      console.warn('Unauthorized attempt to create NPC:', err.message);
    }
  });

  socket.on('sendPrivateMessage', (data) => {
    // data: { sender, recipient, text }
    db.run('INSERT INTO private_messages (sender, recipient, text) VALUES (?, ?, ?)', [data.sender, data.recipient, data.text], function(err) {
      if (!err) {
        db.get('SELECT * FROM private_messages WHERE id = ?', [this.lastID], (err, row) => {
          if (row) {
            const formattedMsg = {
              ...row,
              timestamp: new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            
            // SECURITY: Only emit to sender, recipient, or Primary Admins
            const targetSockets = new Set();
            const involvesNPC = activeNPCs.includes(data.sender) || activeNPCs.includes(data.recipient);
            
            userSockets.forEach((info, socketId) => {
              if (info.userName === data.sender || info.userName === data.recipient) {
                targetSockets.add(socketId);
              }
              if (involvesNPC && info.isAdmin) {
                targetSockets.add(socketId);
              }
            });

            targetSockets.forEach(id => io.to(id).emit('receivePrivateMessage', formattedMsg));
          }
        });
      }
    });
  });

  socket.on('getPrivateHistory', (data) => {
    // data: { user1, user2 }
    db.all(`SELECT * FROM private_messages 
            WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?) 
            ORDER BY timestamp DESC LIMIT 50`, 
            [data.user1, data.user2, data.user2, data.user1], (err, rows) => {
      if (!err) {
        socket.emit('privateHistory', {
          targetUser: data.user2,
          history: rows.reverse().map(r => ({
            ...r,
            timestamp: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }))
        });
      }
    });
  });

  socket.on('updateNotifications', (data) => {
    // data: { userName, enabled }
    db.run('UPDATE locations SET notifications_enabled = ? WHERE owner = ? AND shape = "rhombus"', [data.enabled ? 1 : 0, data.userName]);
  });

  socket.on('requestEditing', (data) => {
    io.emit('editingRequested', data);
  });

  socket.on('approveEditing', (data) => {
    // data: { userId, location }
    elevatedUsers.add(data.userId);
    const tempToken = jwt.sign({ username: data.userId, isTemporary: true }, SECRET, { expiresIn: '12h' });
    io.emit('accessGranted', { targetUser: data.userId, token: tempToken, forEditing: true });

    io.emit('editingStarted', data);
    io.emit('editingApproved', data);
  });

  socket.on('denyEditing', (data) => {
    // data: { userId }
    io.emit('editingDenied', data);
  });

  socket.on('revokeEditing', (data) => {
    // data: { userId }
    io.emit('editingStopped');
    io.emit('editingRevoked', data);
  });

  socket.on('editingFinished', () => {
    io.emit('editingStopped');
  });

  socket.on('requestRhombusPurge', (data) => {
    // data: { id, owner }
    console.log(`Cinematic Purge Requested for ID: ${data.id}`);
    io.emit('rhombusFading', { id: data.id, owner: data.owner });
    
    // Delay the actual deletion to allow the animation to play
    setTimeout(() => {
        // SECURITY FIX: Enforce shape = 'rhombus' to prevent arbitrary building deletion
        db.run('DELETE FROM locations WHERE id = ? AND shape = "rhombus"', [data.id], function(err) {
            if (!err && this.changes > 0) {
                recordAction('location_delete', { data: [{ id: data.id }] });
                emitUpdate({ isRhombusOnly: true });
            }
        });
    }, 3000); // 3 second animation window
  });

  socket.on('moveRhombus', (data) => {
    // data: { id, x, z }
    const info = userSockets.get(socket.id);
    if (!info) return;

    db.get('SELECT owner FROM locations WHERE id = ?', [data.id], (err, row) => {
      if (err || !row) return;
      if (info.isAdmin || info.userName === row.owner) {
        db.run('UPDATE locations SET x = ?, z = ? WHERE id = ?', [data.x, data.z, data.id], function(updateErr) {
          if (!updateErr) {
            emitUpdate({ isRhombusOnly: true });
          }
        });
      }
    });
  });

  socket.on('disconnect', () => {
    const info = userSockets.get(socket.id);
    if (info) {
      const { userName } = info;
      console.log('User disconnected:', socket.id, 'Username:', userName);
      // Check for user's rhombus to trigger fading animation
      db.get('SELECT id FROM locations WHERE shape = "rhombus" AND owner = ?', [userName], (err, row) => {
        if (row) {
          console.log(`Broadcasting rhombusFading for ID: ${row.id}, Owner: ${userName}`);
          io.emit('rhombusFading', { id: row.id, owner: userName });
        }
      });
      
      userSockets.delete(socket.id);
      broadcastActiveUsers();
    }
  });
});

app.post('/api/chat/purge', authenticate, (req, res) => {
  db.run('DELETE FROM chat_logs', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM private_messages', (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      io.emit('chatHistory', []); // Clear all clients instantly
      io.emit('purgePrivateMessages'); // Tell clients to clear PMs
      res.json({ message: 'Chat history purged' });
    });
  });
});

const path = require('path');
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
// Fallback for SPA routing - using app.use catches all unmatched routes safely
app.use((req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});


