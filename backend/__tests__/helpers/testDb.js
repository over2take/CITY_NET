const sqlite3 = require('sqlite3').verbose();

/**
 * Creates an in-memory SQLite DB with the schema needed for custom-structure tests.
 * Returns a promise that resolves with the db instance once all tables are ready.
 */
function makeTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
    });

    db.serialize(() => {
      db.run(`CREATE TABLE locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        npcs TEXT,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        z REAL NOT NULL DEFAULT 0,
        width REAL DEFAULT 1,
        height REAL DEFAULT 1,
        depth REAL DEFAULT 1,
        shape TEXT DEFAULT 'box',
        color TEXT DEFAULT '#00ff00',
        district_name TEXT,
        district_color TEXT,
        parent_id INTEGER,
        is_target INTEGER DEFAULT 0,
        isFavorite INTEGER DEFAULT 0,
        isDanger INTEGER DEFAULT 0,
        owner TEXT,
        notifications_enabled INTEGER DEFAULT 0,
        rotation REAL DEFAULT 0,
        rotation_x REAL DEFAULT 0,
        rotation_z REAL DEFAULT 0,
        classification TEXT,
        polyCount INTEGER DEFAULT 5,
        battle_map_id INTEGER,
        floor_index INTEGER,
        hp_current INTEGER,
        hp_max INTEGER,
        hp_temp INTEGER,
        map_scale_multiplier REAL DEFAULT 5,
        melee_ac INTEGER,
        ranged_ac INTEGER,
        injuries TEXT DEFAULT '{}',
        is_global INTEGER DEFAULT 0
      )`);

      db.run(`CREATE TABLE districts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL
      )`);

      db.run(`CREATE TABLE roads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        x1 REAL, z1 REAL, x2 REAL, z2 REAL, width REAL
      )`);

      db.run(`CREATE TABLE overpasses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        points TEXT NOT NULL,
        height REAL NOT NULL,
        width REAL NOT NULL,
        ramp_length REAL NOT NULL,
        pillar_spacing REAL DEFAULT 12
      )`);

      db.run(`CREATE TABLE saved_maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        locations_data TEXT,
        districts_data TEXT,
        roads_data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE custom_structure_library (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT, npcs TEXT,
        x REAL, y REAL, z REAL,
        width REAL, height REAL, depth REAL,
        shape TEXT, color TEXT,
        district_name TEXT, district_color TEXT, parent_id INTEGER,
        isFavorite INTEGER DEFAULT 0, isDanger INTEGER DEFAULT 0,
        rotation REAL DEFAULT 0, rotation_x REAL DEFAULT 0, rotation_z REAL DEFAULT 0,
        classification TEXT, polyCount INTEGER DEFAULT 5,
        hp_current INTEGER, hp_max INTEGER, hp_temp INTEGER,
        map_scale_multiplier REAL DEFAULT 5,
        melee_ac INTEGER, ranged_ac INTEGER,
        injuries TEXT DEFAULT '{}',
        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE water_bodies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        points_json TEXT NOT NULL,
        map_scale_multiplier TEXT DEFAULT '[1]'
      )`);

      db.run(`CREATE TABLE action_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE admin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
      )`);

      db.run(`CREATE TABLE sqlite_sequence (name TEXT, seq INTEGER)`, () => {
        // ignore error — it may already exist
        resolve(db);
      });
    });
  });
}

/** Promisified db.get */
const get = (db, sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));

/** Promisified db.all */
const all = (db, sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));

/** Promisified db.run */
const run = (db, sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

module.exports = { makeTestDb, get, all, run };
