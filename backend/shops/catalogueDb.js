// Uploaded catalogues, between SQLite and the in-memory store.
//
// Kept apart from catalogueStore on purpose. That one holds plain objects and requires
// nothing, which is what lets `priceOf` stay synchronous, `planSale` stay pure, and the
// whole lot be imported from a frontend test. This is the only piece that knows there is a
// database, and it is the only piece a frontend test must never reach.

const store = require('./catalogueStore');

/** Rows out of the table, as the store wants them: catalogue -> entries. */
const shape = (rows) => {
  const out = {};
  for (const row of rows || []) {
    let fields = {};
    try {
      const parsed = JSON.parse(row.fields || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fields = parsed;
    } catch {
      // A row somebody edited in the database by hand. Better to sell it with no sheet
      // fields than to drop it and leave a GM wondering where their gun went.
      fields = {};
    }
    (out[row.catalogue] ||= []).push({
      id: row.id,
      name: row.name,
      price: Number(row.price) || 0,
      fields,
    });
  }
  return out;
};

/** Everything uploaded for one system, straight from the table. */
const read = (db, system, cb) => {
  db.all(
    'SELECT catalogue, id, name, price, fields FROM shop_catalogues WHERE system = ?',
    [system],
    (err, rows) => (err ? cb(err) : cb(null, shape(rows))),
  );
};

/**
 * Load the running system's catalogues into memory.
 *
 * Called at boot and whenever something changes them. A failure leaves the store holding
 * nothing uploaded, which is the safe way to be wrong: shops still work, they just do not
 * carry what the GM added.
 *
 * It still records WHICH system failed to load, rather than clearing back to the default.
 * The default is CWN, and a Cyberpunk RED game whose read failed would otherwise start
 * selling the CWN book.
 */
const refresh = (db, system, cb = () => {}) => {
  read(db, system, (err, catalogues) => {
    if (err) { store.load(system, {}); return cb(err); }
    store.load(system, catalogues);
    cb(null, catalogues);
  });
};

/**
 * Replace one catalogue's uploaded items.
 *
 * Wholesale for that catalogue, because "here is my weapon list" is how a GM thinks about
 * it and re-uploading is how a line gets removed. Other catalogues, other systems and
 * every built-in table are untouched.
 *
 * Done in a transaction: a half-written catalogue would be worse than a failed upload,
 * since the GM would have no way of telling which half took.
 */
const replaceCatalogue = (db, system, catalogue, entries, cb) => {
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return cb(beginErr);

      db.run(
        'DELETE FROM shop_catalogues WHERE system = ? AND catalogue = ?',
        [system, catalogue],
        (delErr) => {
          if (delErr) return db.run('ROLLBACK', () => cb(delErr));

          const stmt = db.prepare(
            `INSERT INTO shop_catalogues (system, catalogue, id, name, price, fields)
             VALUES (?, ?, ?, ?, ?, ?)`,
          );
          let failed = null;
          for (const entry of entries || []) {
            if (!entry || !entry.id) continue;
            stmt.run(
              system, catalogue, entry.id, String(entry.name || ''),
              Number(entry.price) || 0, JSON.stringify(entry.fields || {}),
              (runErr) => { if (runErr && !failed) failed = runErr; },
            );
          }
          stmt.finalize((finErr) => {
            const problem = failed || finErr;
            if (problem) return db.run('ROLLBACK', () => cb(problem));
            db.run('COMMIT', (commitErr) => cb(commitErr || null));
          });
        },
      );
    });
  });
};

/** Forget one catalogue entirely, returning it to whatever the app ships with. */
const clearCatalogue = (db, system, catalogue, cb) =>
  db.run(
    'DELETE FROM shop_catalogues WHERE system = ? AND catalogue = ?',
    [system, catalogue],
    (err) => cb(err || null),
  );

module.exports = { read, refresh, replaceCatalogue, clearCatalogue, shape };
