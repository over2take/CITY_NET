const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'city.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    npcs TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
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
    injuries TEXT DEFAULT '{}'
  )`);
  db.run(`ALTER TABLE locations ADD COLUMN injuries TEXT DEFAULT '{}'`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS battle_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    designation TEXT NOT NULL,
    image_url TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS districts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT NOT NULL
  )`, () => {
    // Migration: Extract existing districts from locations table and insert them into districts table
    db.all('SELECT DISTINCT district_name, district_color FROM locations WHERE district_name IS NOT NULL AND district_name != ""', (err, rows) => {
      if (err) return;
      if (rows && rows.length > 0) {
        const stmt = db.prepare('INSERT OR IGNORE INTO districts (name, color) VALUES (?, ?)');
        rows.forEach(r => {
          stmt.run([r.district_name, r.district_color]);
        });
        stmt.finalize();
      }
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`, () => {
    // Seed default admin if empty
    db.get('SELECT COUNT(*) as count FROM admin', (err, row) => {
      const bcrypt = require('bcrypt');
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'cyberpunk_password';
      
      bcrypt.hash(adminPass, 10, (err, hash) => {
        if (!err) {
          if (row && row.count === 0) {
            db.run('INSERT INTO admin (username, password) VALUES (?, ?)', [adminUser, hash]);
            console.log(`[SYSTEM] Initial admin user '${adminUser}' created.`);
          } else {
            // Update the existing admin user to match .env
            db.run('UPDATE admin SET username = ?, password = ? WHERE id = (SELECT MIN(id) FROM admin)', [adminUser, hash]);
            console.log(`[SYSTEM] Admin credentials synchronized with environment.`);
          }
        }
      });
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS roads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x1 REAL NOT NULL,
    z1 REAL NOT NULL,
    x2 REAL NOT NULL,
    z2 REAL NOT NULL,
    width REAL DEFAULT 4
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    total INTEGER NOT NULL,
    results TEXT NOT NULL,
    color TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS action_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fake_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    isActive INTEGER DEFAULT 1
  )`, () => {
    db.run("ALTER TABLE fake_users ADD COLUMN isActive INTEGER DEFAULT 1", (err) => {});
  });

  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Add column if it doesn't exist (locations table used for player character data)
  db.run(`ALTER TABLE locations ADD COLUMN notifications_enabled INTEGER DEFAULT 1`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN rotation REAL DEFAULT 0`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN rotation_x REAL DEFAULT 0`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN rotation_z REAL DEFAULT 0`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN classification TEXT`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN polyCount INTEGER DEFAULT 5`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN battle_map_id INTEGER`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN floor_index INTEGER`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN hp_current INTEGER`, (err) => {});
  db.run(`ALTER TABLE locations ADD COLUMN hp_max INTEGER`, (err) => {});
  db.run(`ALTER TABLE locations ADD COLUMN hp_temp INTEGER`, (err) => {});
  db.run(`ALTER TABLE locations ADD COLUMN map_scale_multiplier REAL DEFAULT 5`, (err) => {});

  db.run(`ALTER TABLE locations ADD COLUMN melee_ac INTEGER`, (err) => {});
  db.run(`ALTER TABLE locations ADD COLUMN ranged_ac INTEGER`, (err) => {});

  db.run(`ALTER TABLE dice_rolls ADD COLUMN historyString TEXT`, (err) => {});

  db.run(`CREATE TABLE IF NOT EXISTS saved_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    locations_data TEXT,
    districts_data TEXT,
    roads_data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS structure_prefabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classification TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS battle_map_defaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    floor_index INTEGER NOT NULL,
    rhombus_id INTEGER,
    rhombus_owner TEXT,
    x REAL NOT NULL,
    z REAL NOT NULL,
    is_enemy INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS player_banks (
    username TEXT PRIMARY KEY,
    balance REAL DEFAULT 0.00,
    debt REAL DEFAULT 0.00,
    first_pay_done INTEGER DEFAULT 0,
    high_roller_done INTEGER DEFAULT 0
  )`);
  // Migrate existing rows that predate the first_pay_done column
  db.run(`ALTER TABLE player_banks ADD COLUMN first_pay_done INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE player_banks ADD COLUMN high_roller_done INTEGER DEFAULT 0`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS water_bodies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    points_json TEXT NOT NULL,
    map_scale_multiplier TEXT DEFAULT '[1]'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS player_accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    security_question TEXT,
    security_answer_hash TEXT,
    temp_password INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`ALTER TABLE player_accounts ADD COLUMN status TEXT DEFAULT 'pending'`, () => {});
});

module.exports = db;
