const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');

const report = (name, success, info = '') => {
  if (success) console.log(`\x1b[32m[SYSTEM_CHECK] PASS:\x1b[0m ${name}`);
  else console.error(`\x1b[31m[SYSTEM_CHECK] FAIL:\x1b[0m ${name} ${info}`);
};

module.exports = function runSanityChecks() {
  // Run against an isolated in-memory DB so tests never touch city.db.
  const testDb = new sqlite3.Database(':memory:');

  testDb.serialize(() => {
    testDb.run(`CREATE TABLE locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      description TEXT, npcs TEXT, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
      width REAL DEFAULT 1, height REAL DEFAULT 1, depth REAL DEFAULT 1,
      shape TEXT DEFAULT 'box', color TEXT DEFAULT '#00ff00',
      district_name TEXT, district_color TEXT, parent_id INTEGER,
      isFavorite INTEGER DEFAULT 0, isDanger INTEGER DEFAULT 0, owner TEXT,
      rotation REAL DEFAULT 0, rotation_x REAL DEFAULT 0, rotation_z REAL DEFAULT 0,
      classification TEXT, polyCount INTEGER DEFAULT 5,
      battle_map_id INTEGER, floor_index INTEGER,
      hp_current INTEGER, hp_max INTEGER, hp_temp INTEGER,
      map_scale_multiplier REAL DEFAULT 5
    )`);
    testDb.run(`CREATE TABLE player_banks (
      username TEXT PRIMARY KEY, balance REAL DEFAULT 0.00, debt REAL DEFAULT 0.00
    )`);
    testDb.run(`CREATE TABLE battle_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL,
      designation TEXT NOT NULL, image_url TEXT NOT NULL, order_index INTEGER NOT NULL
    )`);

    // Test 1: map_scale_multiplier persistence
    testDb.run('INSERT INTO locations (name, x, y, z, map_scale_multiplier) VALUES (?, ?, ?, ?, ?)', ['__test__', 0, 0, 0, '[999]'], function(err) {
      if (err) return report('map_scale_multiplier persistence', false, 'Insert failed: ' + err.message);
      testDb.get('SELECT map_scale_multiplier FROM locations WHERE id = ?', [this.lastID], (err2, row) => {
        report('map_scale_multiplier persistence', !err2 && row && row.map_scale_multiplier === '[999]', err2 ? err2.message : `Received: ${row?.map_scale_multiplier}`);
      });
    });

    // Test 2: hit points persistence
    testDb.run('INSERT INTO locations (name, x, y, z, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, ?, ?, ?)', ['__test__', 0, 0, 0, 50, 100, 15], function(err) {
      if (err) return report('hit points persistence', false, 'Insert failed: ' + err.message);
      testDb.get('SELECT hp_current, hp_max, hp_temp FROM locations WHERE id = ?', [this.lastID], (err2, row) => {
        report('hit points persistence (hp_current, hp_max, hp_temp)', !err2 && row && row.hp_current === 50 && row.hp_max === 100 && row.hp_temp === 15, err2 ? err2.message : `Received: ${JSON.stringify(row)}`);
      });
    });

    // Test 3: banking math & COALESCE
    testDb.run('INSERT INTO player_banks (username, balance, debt) VALUES (?, ?, ?)', ['__test__', 5000.5, 125.25], function(err) {
      if (err) return report('player banking persistence', false, 'Insert failed: ' + err.message);
      testDb.run('UPDATE player_banks SET balance = COALESCE(balance, 0) + ? WHERE username = ?', [200.25, '__test__'], (updateErr) => {
        if (updateErr) return report('player banking math & persistence (COALESCE)', false, 'Update failed: ' + updateErr.message);
        testDb.get('SELECT balance, debt FROM player_banks WHERE username = ?', ['__test__'], (err2, row) => {
          report('player banking math & persistence (COALESCE)', !err2 && row && row.balance === 5200.75 && row.debt === 125.25, err2 ? err2.message : `Received balance: ${row?.balance}`);
        });
      });
    });

    // Test 4: battle_maps persistence
    testDb.run('INSERT INTO battle_maps (location_id, designation, image_url, order_index) VALUES (?, ?, ?, ?)', [99999, 'TestLevel', 'http://test.com', 0], function(err) {
      if (err) return report('battle_maps persistence', false, 'Insert failed: ' + err.message);
      testDb.get('SELECT designation, image_url FROM battle_maps WHERE id = ?', [this.lastID], (err2, row) => {
        report('battle_maps persistence (designation, image_url)', !err2 && row && row.designation === 'TestLevel' && row.image_url === 'http://test.com', err2 ? err2.message : `Received: ${JSON.stringify(row)}`);
      });
    });

    // Test 5: JWT payload constraints (no DB)
    try {
      const testToken = jwt.sign({ id: 999, username: 'testadmin', role: 'admin', isTemporary: false }, process.env.JWT_SECRET);
      const decoded = jwt.verify(testToken, process.env.JWT_SECRET);
      const success = decoded && decoded.role === 'admin' && decoded.isTemporary === false;
      report('admin login JWT payload constraints', success, success ? '' : 'Token missing required role or isTemporary flags');
    } catch (e) {
      report('admin login JWT payload constraints', false, 'JWT error: ' + e.message);
    }

    // Test 6: Measurement formatting (no DB)
    const formatMeasurementPayload = (data, userName, socketId) => ({
      owner: userName ? userName : socketId,
      start: data.start, end: data.end, color: data.color || '#00ff00',
      battle_map_id: data.battle_map_id || null,
      floor_index: data.floor_index !== undefined ? data.floor_index : null,
      map_scale_multiplier: data.map_scale_multiplier || 5,
      view: data.view, locationId: data.locationId, isFinal: data.isFinal
    });
    const formatted = formatMeasurementPayload({ start: { x: 0, z: 0 }, end: { x: 10, z: 10 }, isFinal: true, map_scale_multiplier: 5 }, 'tester', 'socket123');
    report('measurement relay constraints (isFinal, formatting)', formatted.owner === 'tester' && formatted.isFinal === true && formatted.color === '#00ff00');

    // Test 7: Health preserved during generic PUT update
    testDb.run('INSERT INTO locations (name, x, y, z, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, ?, ?, ?)', ['__test__', 0, 0, 0, 42, 100, 5], function(err) {
      if (err) return report('preserve health during location PUT update', false, 'Insert failed: ' + err.message);
      const testId = this.lastID;
      const sql = `UPDATE locations SET name=?, description=?, npcs=?, x=?, y=?, z=?, width=?, height=?, depth=?, shape=?, color=?, district_name=?, district_color=?, parent_id=?, isFavorite=?, isDanger=?, owner=?, rotation=?, rotation_x=?, rotation_z=?, classification=?, polyCount=?, battle_map_id=?, floor_index=?, map_scale_multiplier=? WHERE id=?`;
      testDb.run(sql, ['__test__', '', '', 10, 0, 10, 3.75, 3.75, 3.75, 'box', '#ffffff', null, null, null, 0, 0, null, 0, 0, 0, null, 5, null, null, 5, testId], function(updateErr) {
        if (updateErr) return report('preserve health during location PUT update', false, 'Update failed: ' + updateErr.message);
        testDb.get('SELECT hp_current, hp_max, hp_temp FROM locations WHERE id = ?', [testId], (err3, row3) => {
          report('preserve health during location PUT update', !err3 && row3 && row3.hp_current === 42 && row3.hp_max === 100 && row3.hp_temp === 5, err3 ? err3.message : `Received: ${JSON.stringify(row3)}`);
        });
      });
    });

    // Test 8: Health preserved during cinematic purge
    testDb.run('INSERT INTO locations (name, x, y, z, shape, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['__test__', 0, 0, 0, 'rhombus', 88, 100, 0], function(err) {
      if (err) return report('preserve health during cinematic purge', false, 'Insert failed: ' + err.message);
      const testId = this.lastID;
      testDb.run('UPDATE locations SET battle_map_id = -1, floor_index = -1 WHERE id = ? AND shape = "rhombus"', [testId], function(updateErr) {
        if (updateErr || this.changes === 0) return report('preserve health during cinematic purge', false, 'Purge update failed or row not found');
        testDb.get('SELECT hp_current, battle_map_id FROM locations WHERE id = ?', [testId], (err3, row3) => {
          report('preserve health during cinematic purge', !err3 && row3 && row3.hp_current === 88 && row3.battle_map_id === -1, err3 ? err3.message : `Row state: ${JSON.stringify(row3)}`);
          testDb.close();
        });
      });
    });
  });
};
