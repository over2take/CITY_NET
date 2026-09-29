// The one-time start of per-system token health (tokens/vitals.js).
//
// Before this, a token had one set of health, defense and injuries, shown whatever system ran.
// Now each system keeps its own, swapped in and out when the system changes. So that nothing
// looks different the day this ships, each token's current values are saved under every
// system it could be shown in:
//   - a player's token: every system that player has a sheet in,
//   - an enemy or friendly token: every system any sheet exists in,
//   - and, for both, the system running now.
// Switching to any of those then shows exactly what switching showed before.
//
// It only adds rows to `token_vitals`; no token is changed, so there is nothing to lose and no
// database copy is needed for it. One transaction, and a marker so it runs once.

const { DEFAULT_SYSTEM } = require('../sheets/templates');
const { FIELDS, SHAPES_SQL } = require('../tokens/vitals');

const MARKER = 'migration_token_vitals';

const q = (db, method, sql, params = []) => new Promise((resolve, reject) => {
  db[method](sql, params, function (err, rows) { if (err) reject(err); else resolve(method === 'run' ? this : rows); });
});

const migrateTokenVitals = async (db, { log = console } = {}) => {
  if (await q(db, 'get', 'SELECT value FROM global_settings WHERE key = ?', [MARKER])) return { ran: false };

  const active = await q(db, 'get', `SELECT value FROM global_settings WHERE key = 'game_system'`);
  const activeSystem = active && active.value ? active.value : DEFAULT_SYSTEM;
  const sheets = await q(db, 'all', 'SELECT DISTINCT username, system, is_npc FROM character_sheets');
  const everySystem = new Set(sheets.map((s) => s.system));
  const playerSystems = new Map();
  for (const s of sheets) {
    if (s.is_npc) continue;
    if (!playerSystems.has(s.username)) playerSystems.set(s.username, new Set());
    playerSystems.get(s.username).add(s.system);
  }
  const tokens = await q(db, 'all', `SELECT id, shape, owner, ${FIELDS.join(', ')} FROM locations WHERE shape IN (${SHAPES_SQL})`);

  let saved = 0;
  await q(db, 'run', 'BEGIN IMMEDIATE');
  try {
    for (const t of tokens) {
      const systems = new Set(t.shape === 'rhombus' && t.owner ? (playerSystems.get(t.owner) || []) : everySystem);
      systems.add(activeSystem);
      for (const system of systems) {
        const res = await q(db, 'run',
          `INSERT OR IGNORE INTO token_vitals (location_id, system, ${FIELDS.join(', ')}) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')})`,
          [t.id, system, ...FIELDS.map((f) => t[f])]);
        saved += res.changes;
      }
    }
    await q(db, 'run', 'INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)', [MARKER, new Date().toISOString()]);
    await q(db, 'run', 'COMMIT');
  } catch (err) {
    await q(db, 'run', 'ROLLBACK').catch(() => {});
    throw err;
  }
  if (tokens.length) log.log(`[tokens] Saved ${tokens.length} token(s) health under ${saved} system entries.`);
  return { ran: true, tokens: tokens.length, saved };
};

module.exports = { migrateTokenVitals, MARKER };
