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

  db.run(`CREATE TABLE IF NOT EXISTS overpasses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    points TEXT NOT NULL,
    height REAL NOT NULL,
    width REAL NOT NULL,
    ramp_length REAL NOT NULL,
    pillar_spacing REAL DEFAULT 12
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
  db.run(`ALTER TABLE locations ADD COLUMN is_global INTEGER DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE locations ADD COLUMN has_sidewalk INTEGER DEFAULT 1`, (err) => {});
  db.run(`ALTER TABLE locations ADD COLUMN has_signage INTEGER DEFAULT 1`, (err) => {});

  db.run(`ALTER TABLE custom_structure_library ADD COLUMN melee_ac INTEGER`, (err) => {});
  db.run(`ALTER TABLE custom_structure_library ADD COLUMN ranged_ac INTEGER`, (err) => {});

  db.run(`CREATE TABLE IF NOT EXISTS custom_structure_library (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    npcs TEXT,
    x REAL,
    y REAL,
    z REAL,
    width REAL,
    height REAL,
    depth REAL,
    shape TEXT,
    color TEXT,
    district_name TEXT,
    district_color TEXT,
    parent_id INTEGER,
    isFavorite INTEGER DEFAULT 0,
    isDanger INTEGER DEFAULT 0,
    rotation REAL DEFAULT 0,
    rotation_x REAL DEFAULT 0,
    rotation_z REAL DEFAULT 0,
    classification TEXT,
    polyCount INTEGER DEFAULT 5,
    hp_current INTEGER,
    hp_max INTEGER,
    hp_temp INTEGER,
    map_scale_multiplier REAL DEFAULT 5,
    melee_ac INTEGER,
    ranged_ac INTEGER,
    injuries TEXT DEFAULT '{}',
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE dice_rolls ADD COLUMN historyString TEXT`, (err) => {});

  db.run(`CREATE TABLE IF NOT EXISTS saved_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    locations_data TEXT,
    districts_data TEXT,
    roads_data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE saved_maps ADD COLUMN overpasses_data TEXT`, () => {});
  db.run(`ALTER TABLE saved_maps ADD COLUMN water_bodies_data TEXT`, () => {});
  db.run(`ALTER TABLE saved_maps ADD COLUMN signs_data TEXT`, () => {});
  db.run(`ALTER TABLE overpasses ADD COLUMN ramp_length_start REAL`, () => {});
  db.run(`ALTER TABLE overpasses ADD COLUMN ramp_length_end REAL`, () => {});

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
  db.run(`ALTER TABLE player_accounts ADD COLUMN theme TEXT`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS music_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(parent_id) REFERENCES music_items(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS signs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL,
    rotation_y REAL DEFAULT 0,
    font_size REAL DEFAULT 1.0,
    font_family TEXT DEFAULT 'monospace',
    image_url TEXT,
    use_tv_filter INTEGER DEFAULT 0
  )`);
  db.run(`ALTER TABLE signs ADD COLUMN font_family TEXT DEFAULT 'monospace'`, () => {});
  db.run(`ALTER TABLE signs ADD COLUMN lines TEXT`, () => {});
  db.run(`ALTER TABLE signs ADD COLUMN filter_intensity REAL DEFAULT 1.0`, () => {});

  // Character sheets: one sheet per player PER SYSTEM (switching game systems
  // never destroys sheets - the old system's rows stay dormant until switched back)
  db.run(`CREATE TABLE IF NOT EXISTS character_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    system TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    portrait_url TEXT,
    is_npc INTEGER DEFAULT 0,
    npc_label TEXT,
    folder TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // One sheet per player per system - but NPC sheets (is_npc=1) are exempt,
  // the admin owns many of them
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_sheet
          ON character_sheets(username, system) WHERE is_npc = 0`);

  // NPC sheets attach to rhombus tokens via links so one sheet can back many tokens
  db.run(`CREATE TABLE IF NOT EXISTS npc_sheet_links (
    location_id INTEGER NOT NULL UNIQUE,
    sheet_id INTEGER NOT NULL,
    FOREIGN KEY(sheet_id) REFERENCES character_sheets(id) ON DELETE CASCADE
  )`);

  // NPC links ride along in map snapshots (location ids are preserved on load)
  db.run(`ALTER TABLE saved_maps ADD COLUMN npc_links_data TEXT`, () => {});

  // Migration: CP:R's name field was stored as 'handle'; it is now 'name'
  // (uniform across systems — the sheet is the source of truth for player
  // identity, see backend/sheets/identity.js). Copy handle → name once.
  db.all(`SELECT id, data FROM character_sheets WHERE system = 'cyberpunk_red'`, (err, rows) => {
    if (err || !rows) return;
    rows.forEach((row) => {
      let data;
      try { data = JSON.parse(row.data || '{}'); } catch { return; }
      if (data.handle !== undefined && (data.name === undefined || data.name === '')) {
        data.name = data.handle;
        delete data.handle;
        db.run(`UPDATE character_sheets SET data = ? WHERE id = ?`, [JSON.stringify(data), row.id]);
      }
    });
  });
});

module.exports = db;
