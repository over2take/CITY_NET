const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'city.db');
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
    owner TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`, () => {
    // Seed default admin if empty
    db.get('SELECT COUNT(*) as count FROM admin', (err, row) => {
      if (row && row.count === 0) {
        const bcrypt = require('bcrypt');
        bcrypt.hash('cyberpunk_password', 10, (err, hash) => {
          if (!err) {
            db.run('INSERT INTO admin (username, password) VALUES (?, ?)', ['admin', hash]);
            console.log('[SYSTEM] Default admin user created.');
          }
        });
      }
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

  // Add column if it doesn't exist (locations table used for player character data)
  db.run(`ALTER TABLE locations ADD COLUMN notifications_enabled INTEGER DEFAULT 1`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN rotation REAL DEFAULT 0`, (err) => {
    // Ignore error if column already exists
  });

  db.run(`ALTER TABLE locations ADD COLUMN classification TEXT`, (err) => {
    // Ignore error if column already exists
  });
});

module.exports = db;
