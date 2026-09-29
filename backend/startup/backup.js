// A copy of the whole database, taken before a migration changes real data.
//
// `VACUUM INTO` writes a complete, consistent copy while the database stays open, which a
// plain file copy of a live database cannot promise. It is only attempted when the disk has
// room: the copy is as large as the database, and running a disk out of space is exactly how
// a delete once took the whole server down (SQLITE_FULL, 1.14.3). With too little room the
// migration still has its own safety net - the tables it moves data out of are left as they
// were - and the log says plainly that no copy was made.

const fs = require('fs');
const path = require('path');

/** Room to leave free beyond the copy itself, so the copy never fills the disk. */
const HEADROOM = 50 * 1024 * 1024;

/** Free bytes on the disk holding `dir`, or null when the platform cannot say. */
const freeBytes = (dir) => {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
};

/** `city.db` → `city.db.before-<label>-2026-09-29T15-04-05.bak`, beside it. */
const backupPath = (dbPath, label, now = new Date()) => {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, '');
  return `${dbPath}.before-${label}-${stamp}.bak`;
};

/**
 * Copy the database at `dbPath` beside itself. cb(err, result) where result is
 * `{ path }` when a copy was made, or `{ skipped: reason }` when it was not (in-memory
 * database, not enough room). An error means the copy was attempted and failed.
 */
const backupDatabase = (db, dbPath, label, cb, { now, free = freeBytes } = {}) => {
  if (!dbPath || dbPath === ':memory:') return cb(null, { skipped: 'in-memory database' });
  let size;
  try { size = fs.statSync(dbPath).size; } catch (err) { return cb(null, { skipped: `cannot read ${dbPath}: ${err.message}` }); }
  const available = free(path.dirname(dbPath));
  if (available !== null && available < size + HEADROOM) {
    const mb = (n) => `${Math.round(n / (1024 * 1024))} MB`;
    return cb(null, { skipped: `not enough disk space for a copy (${mb(available)} free, ${mb(size + HEADROOM)} needed)` });
  }
  const target = backupPath(dbPath, label, now);
  db.run('VACUUM INTO ?', [target], (err) => (err ? cb(err) : cb(null, { path: target })));
};

module.exports = { backupDatabase, backupPath, freeBytes, HEADROOM };
