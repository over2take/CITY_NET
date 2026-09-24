// Putting whole location rows back: a saved map being loaded, a delete being undone.
//
// Both used to list the columns they restored by hand, and both lists had fallen behind
// the table. Loading a saved map dropped every building's type and buy-back rate, its AC,
// whether it had a sidewalk or signage and whether it was hidden; undoing a delete dropped
// the same and more. Every column added to `locations` since those lists were written was
// silently lost the first time either ran.
//
// So the columns come from the table itself. A row carries whatever it was saved with; the
// insert writes every key that is still a column and lets the table's own defaults fill the
// rest - which is exactly right for an old snapshot saved before a column existed.

/** The table's columns, asked of SQLite rather than written down here. */
const columnsOf = (db, table, cb) => {
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err) return cb(err);
    cb(null, (rows || []).map((r) => r.name));
  });
};

/**
 * Queue the inserts for location rows, every column they have, with no lookup of its own.
 *
 * Synchronous on purpose: it only queues statements, so a caller inside `db.serialize`
 * keeps its order - a map load resets the id sequence after the rows go in, and an insert
 * that landed after that reset would leave the sequence behind the ids.
 *
 * `orIgnore` keeps a row whose id is already taken rather than failing the batch, which is
 * what a map load wants: live player tokens are never cleared, and a snapshot that happens
 * to hold the same id must not overwrite one.
 */
const queueInserts = (db, columns, rows, { orIgnore = false } = {}) => {
  const known = new Set(columns);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const keys = Object.keys(row).filter((k) => known.has(k) && row[k] !== undefined);
    if (!keys.length) continue;
    db.run(
      `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO locations (${keys.join(', ')})
       VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => row[k]),
      // One bad row is reported and skipped rather than taking the rest down with it,
      // which is how the hand-written inserts behaved. A callback is also what keeps a
      // failure from surfacing as an unhandled 'error' event on the database.
      (err) => { if (err) console.warn(`Could not restore location ${row.id}:`, err.message); },
    );
  }
};

/** Look the columns up, insert the rows, then call back once they are all in. */
const insertLocations = (db, rows, opts = {}, cb = () => {}) => {
  columnsOf(db, 'locations', (err, columns) => {
    if (err) return cb(err);
    db.serialize(() => {
      queueInserts(db, columns, rows, opts);
      db.run('SELECT 1', (e) => cb(e || null));
    });
  });
};

module.exports = { columnsOf, queueInserts, insertLocations };
