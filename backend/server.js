const express = require('express');
const cors = require('cors');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5000;
const SECRET = process.env.JWT_SECRET || 'cyberpunk_secret_key';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Emit helper
const emitUpdate = () => io.emit('dataUpdated');

const recordAction = (type, payload) => {
  db.run('INSERT INTO action_history (type, payload) VALUES (?, ?)', [type, JSON.stringify(payload)], (err) => {
    if (err) console.error('Failed to record action:', err.message);
    // Optional: limit history size
    db.run('DELETE FROM action_history WHERE id NOT IN (SELECT id FROM action_history ORDER BY timestamp DESC LIMIT 50)');
  });
};

// Auth Middleware
const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const verified = jwt.verify(token.split(' ')[1], SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// Routes
app.get('/api/locations', (req, res) => {
  db.all('SELECT * FROM locations', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/locations', (req, res) => {
  const locations = Array.isArray(req.body) ? req.body : [req.body];
  
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
    emitUpdate();
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

app.delete('/api/locations/:id', (req, res) => {
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

app.put('/api/locations/:id', (req, res) => {
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

app.post('/api/locations/batch-district', authenticate, (req, res) => {
  const { ids, district_name, district_color } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid data' });

  const placeholders = ids.map(() => '?').join(',');
  db.all(`SELECT id, district_name, district_color FROM locations WHERE id IN (${placeholders})`, ids, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const sql = `UPDATE locations SET district_name = ?, district_color = ? WHERE id IN (${placeholders})`;
    db.run(sql, [district_name, district_color, ...ids], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      recordAction('location_update_batch', { data: rows.map(r => ({ id: r.id, old_data: { district_name: r.district_name, district_color: r.district_color } })) });
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

app.post('/api/control', authenticate, (req, res) => {
  const { controller } = req.body;
  currentController = controller;
  res.json({ message: 'Control updated', controller: currentController });
});

// Socket.io tracking
const userSockets = new Map(); // socket.id -> userName

const broadcastActiveUsers = () => {
  // Map to unique users by name, preserving admin status
  const userMap = new Map();
  userSockets.forEach((info) => {
    userMap.set(info.userName, info);
  });
  const activeUsers = Array.from(userMap.values());
  io.emit('activeUsersUpdated', activeUsers);
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('identify', (data) => {
    const info = typeof data === 'string' ? { userName: data, isAdmin: false } : data;
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

  socket.on('updateNotifications', (data) => {
    // data: { userName, enabled }
    db.run('UPDATE locations SET notifications_enabled = ? WHERE owner = ? AND shape = "rhombus"', [data.enabled ? 1 : 0, data.userName]);
  });

  socket.on('requestEditing', (data) => {
    io.emit('editingRequested', data);
  });

  socket.on('approveEditing', (data) => {
    // data: { userId, location }
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
        db.run('DELETE FROM locations WHERE id = ?', [data.id], (err) => {
            if (!err) {
                recordAction('location_delete', { data: [{ id: data.id }] });
                emitUpdate();
            }
        });
    }, 3000); // 3 second animation window
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
    io.emit('chatHistory', []); // Clear all clients instantly
    res.json({ message: 'Chat history purged' });
  });
});

const path = require('path');
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
