require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  console.error('CRITICAL ERROR: JWT_SECRET environment variable is not set!');
  console.error('Please create a .env file and set JWT_SECRET to a secure random string.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5000;

// Shared helpers
const emitUpdate = (payload = {}) => io.emit('dataUpdated', payload);
const recordAction = (type, payload) => {
  db.run('INSERT INTO action_history (type, payload) VALUES (?, ?)', [type, JSON.stringify(payload)], (err) => {
    if (err) console.error('Failed to record action:', err.message);
    db.run('DELETE FROM action_history WHERE id NOT IN (SELECT id FROM action_history ORDER BY timestamp DESC LIMIT 50)');
  });
};

const { elevatedUsers } = require('./middleware/auth');
const helpers = { emitUpdate, recordAction };

// Middleware
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json({ limit: '2mb' }));

// Routes
app.use('/api/locations', require('./routes/locations')(db, io, helpers));
app.use('/api/locations/:id/battle_maps', require('./routes/battle_maps')(db, io, helpers));
app.use('/api/maps', require('./routes/maps')(db, io, helpers));
const adminRouter = require('./routes/admin')(db, io, helpers);
app.use('/api', adminRouter);

// Static frontend
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.use((req, res) => res.sendFile(path.join(frontendDist, 'index.html')));

// Sockets
require('./sockets')(io, db, { elevatedUsers, ...helpers });

// Startup sanity checks
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);

  const formatMeasurementPayload = (data, userName, socketId) => ({
    owner: userName ? userName : socketId,
    start: data.start, end: data.end, color: data.color || '#00ff00',
    battle_map_id: data.battle_map_id || null,
    floor_index: data.floor_index !== undefined ? data.floor_index : null,
    map_scale_multiplier: data.map_scale_multiplier || 5,
    view: data.view, locationId: data.locationId, isFinal: data.isFinal
  });

  const report = (name, success, info = '') => {
    if (success) console.log(`\x1b[32m[SYSTEM_CHECK] PASS:\x1b[0m ${name}`);
    else console.error(`\x1b[31m[SYSTEM_CHECK] FAIL:\x1b[0m ${name} ${info}`);
  };

  // Test 1: map_scale_multiplier persistence
  db.run('INSERT INTO locations (name, x, y, z, map_scale_multiplier) VALUES (?, ?, ?, ?, ?)', ['StartupTest', 0, 0, 0, '[999]'], function(err) {
    if (!err) {
      const testId = this.lastID;
      db.get('SELECT map_scale_multiplier FROM locations WHERE id = ?', [testId], (err2, row) => {
        report('map_scale_multiplier persistence', !err2 && row && row.map_scale_multiplier === '[999]', err2 ? err2.message : `Received: ${row?.map_scale_multiplier}`);
        db.run('DELETE FROM locations WHERE id = ?', [testId]);
      });
    } else report('map_scale_multiplier persistence', false, 'Insert failed: ' + err.message);
  });

  // Test 2: hit points persistence
  db.run('INSERT INTO locations (name, x, y, z, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, ?, ?, ?)', ['StartupTestHP', 0, 0, 0, 50, 100, 15], function(err) {
    if (!err) {
      const testId = this.lastID;
      db.get('SELECT hp_current, hp_max, hp_temp FROM locations WHERE id = ?', [testId], (err2, row) => {
        report('hit points persistence (hp_current, hp_max, hp_temp)', !err2 && row && row.hp_current === 50 && row.hp_max === 100 && row.hp_temp === 15, err2 ? err2.message : `Received: ${JSON.stringify(row)}`);
        db.run('DELETE FROM locations WHERE id = ?', [testId]);
      });
    } else report('hit points persistence', false, 'Insert failed: ' + err.message);
  });

  // Test 3: user banking persistence & payment math
  db.run('INSERT INTO player_banks (username, balance, debt) VALUES (?, ?, ?)', ['StartupTestUser', 5000.5, 125.25], function(err) {
    if (!err) {
      db.run('UPDATE player_banks SET balance = COALESCE(balance, 0) + ? WHERE username = ?', [200.25, 'StartupTestUser'], (updateErr) => {
        if (!updateErr) {
          db.get('SELECT balance, debt FROM player_banks WHERE username = ?', ['StartupTestUser'], (err2, row) => {
            report('player banking math & persistence (COALESCE)', !err2 && row && row.balance === 5200.75 && row.debt === 125.25, err2 ? err2.message : `Received balance: ${row?.balance}`);
            db.run('DELETE FROM player_banks WHERE username = ?', ['StartupTestUser']);
          });
        } else {
          report('player banking math & persistence (COALESCE)', false, 'Update math failed: ' + updateErr.message);
          db.run('DELETE FROM player_banks WHERE username = ?', ['StartupTestUser']);
        }
      });
    } else report('player banking persistence', false, 'Insert failed: ' + err.message);
  });

  // Test 4: battle_maps persistence
  db.run('INSERT INTO battle_maps (location_id, designation, image_url, order_index) VALUES (?, ?, ?, ?)', [99999, 'TestLevel', 'http://test.com', 0], function(err) {
    if (!err) {
      const testId = this.lastID;
      db.get('SELECT designation, image_url FROM battle_maps WHERE id = ?', [testId], (err2, row) => {
        report('battle_maps persistence (designation, image_url)', !err2 && row && row.designation === 'TestLevel' && row.image_url === 'http://test.com', err2 ? err2.message : `Received: ${JSON.stringify(row)}`);
        db.run('DELETE FROM battle_maps WHERE id = ?', [testId]);
      });
    } else report('battle_maps persistence', false, 'Insert failed: ' + err.message);
  });

  // Test 5: Admin Login JWT generation
  try {
    const testToken = jwt.sign({ id: 999, username: 'testadmin', role: 'admin', isTemporary: false }, process.env.JWT_SECRET);
    const decoded = jwt.verify(testToken, process.env.JWT_SECRET);
    const success = decoded && decoded.role === 'admin' && decoded.isTemporary === false;
    report('admin login JWT payload constraints', success, success ? '' : 'Token missing required role or isTemporary flags');
  } catch (e) {
    report('admin login JWT payload constraints', false, 'JWT verification threw an error: ' + e.message);
  }

  // Test 6: Measurement formatting
  const mockMeasurement = { start: { x: 0, z: 0 }, end: { x: 10, z: 10 }, isFinal: true, map_scale_multiplier: 5 };
  const formatted = formatMeasurementPayload(mockMeasurement, 'tester', 'socket123');
  report('measurement relay constraints (isFinal, formatting)', formatted.owner === 'tester' && formatted.isFinal === true && formatted.color === '#00ff00');

  // Test 7: Preserve health during PUT update
  db.run('INSERT INTO locations (name, x, y, z, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, ?, ?, ?)', ['HealthPutTest', 0, 0, 0, 42, 100, 5], function(err) {
    if (!err) {
      const testId = this.lastID;
      const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=?, battle_map_id=?, floor_index=?, map_scale_multiplier=? WHERE id=?`;
      db.run(sql, ['HealthPutTest', '', '', 10, 0, 10, 3.75, 3.75, 3.75, 'box', '#ffffff', null, null, null, 0, 0, null, 0, 0, 0, null, 5, null, null, 5, testId], function(updateErr) {
        if (!updateErr) {
          db.get('SELECT hp_current, hp_max, hp_temp FROM locations WHERE id = ?', [testId], (err3, row3) => {
            report('preserve health during location PUT update', !err3 && row3 && row3.hp_current === 42 && row3.hp_max === 100 && row3.hp_temp === 5, err3 ? err3.message : `Received: ${JSON.stringify(row3)}`);
            db.run('DELETE FROM locations WHERE id = ?', [testId]);
          });
        } else {
          report('preserve health during location PUT update', false, 'Update failed: ' + updateErr.message);
          db.run('DELETE FROM locations WHERE id = ?', [testId]);
        }
      });
    } else report('preserve health during location PUT update', false, 'Insert failed: ' + err.message);
  });

  // Test 8: Preserve health during cinematic purge
  db.run('INSERT INTO locations (name, x, y, z, shape, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['PurgeTest', 0, 0, 0, 'rhombus', 88, 100, 0], function(err) {
    if (!err) {
      const testId = this.lastID;
      db.run('UPDATE locations SET battle_map_id = -1, floor_index = -1 WHERE id = ? AND shape = "rhombus"', [testId], function(updateErr) {
        if (!updateErr && this.changes > 0) {
          db.get('SELECT hp_current, battle_map_id FROM locations WHERE id = ?', [testId], (err3, row3) => {
            report('preserve health during cinematic purge', !err3 && row3 && row3.hp_current === 88 && row3.battle_map_id === -1, err3 ? err3.message : `Row state: ${JSON.stringify(row3)}`);
            db.run('DELETE FROM locations WHERE id = ?', [testId]);
          });
        } else {
          report('preserve health during cinematic purge', false, 'Purge update failed or row not found');
          db.run('DELETE FROM locations WHERE id = ?', [testId]);
        }
      });
    } else report('preserve health during cinematic purge', false, 'Insert failed: ' + err.message);
  });
});
