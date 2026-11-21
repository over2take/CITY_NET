// Uploaded catalogues, between SQLite and the in-memory store.
//
// Kept apart from catalogueStore on purpose. That one holds plain objects and requires
// nothing, which is what lets `priceOf` stay synchronous, `planSale` stay pure, and the
// whole lot be imported from a frontend test. This is the only piece that knows there is a
// database, and it is the only piece a frontend test must never reach.

const store = require('./catalogueStore');
const { againstItems } = require('./ownItems');

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

/** Rows written a statement when a catalogue is saved (8n3). */
const INSERT_BATCH = 100;

const q = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (err) => (err ? reject(err) : resolve()));
});

/**
 * Replace the uploaded items of every catalogue in one file: { catalogue: entries }.
 *
 * Wholesale for each catalogue named, because "here is my weapon list" is how a GM thinks
 * about it and re-uploading is how a line gets removed. Catalogues the file does not name,
 * other systems and every built-in table are untouched.
 *
 * One transaction for the whole file, its statements one after another. A half-written file
 * would be worse than a failed upload, since the GM would have no way of telling which half
 * took. It was once a transaction per catalogue, all begun at once on the one connection:
 * every catalogue after the first was refused, and the file was reported as failed after the
 * first had been saved (found 2026-10-02).
 */
const replaceCatalogues = (db, system, sections, cb) => {
  const write = async () => {
    await q(db, 'BEGIN IMMEDIATE');
    try {
      for (const [catalogue, entries] of Object.entries(sections || {})) {
        await q(db, 'DELETE FROM shop_catalogues WHERE system = ? AND catalogue = ?', [system, catalogue]);
        // A hundred rows a statement (8n3): the shop stress test found a 1500-line file took one round trip a row, its
        // save as slow as the database's answers times 1500. Six values a row keeps each well under SQLite's 999.
        const rows = (entries || []).filter((entry) => entry && entry.id);
        for (let at = 0; at < rows.length; at += INSERT_BATCH) {
          const batch = rows.slice(at, at + INSERT_BATCH);
          await q(db,
            `INSERT INTO shop_catalogues (system, catalogue, id, name, price, fields)
             VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
            batch.flatMap((entry) => [system, catalogue, entry.id, String(entry.name || ''),
              Number(entry.price) || 0, JSON.stringify(entry.fields || {})]));
        }
      }
      await q(db, 'COMMIT');
    } catch (err) {
      await q(db, 'ROLLBACK').catch(() => {});
      throw err;
    }
  };
  write().then(() => cb(null), cb);
};

/** Forget one catalogue entirely, returning it to whatever the app ships with. */
const clearCatalogue = (db, system, catalogue, cb) =>
  db.run(
    'DELETE FROM shop_catalogues WHERE system = ? AND catalogue = ?',
    [system, catalogue],
    (err) => cb(err || null),
  );

/**
 * A system's catalogue lines that are now exactly one of its items taken out of the file (8a7a4b; decided 2026-11-21, mockup
 * types-in-shops.html, question 12): called when the system is published, so a line ADD NEW LINES TO ITEMS made an item, or
 * any line the GM's items now match in name, price and every column, isn't kept twice. Lines naming an item kept out of the
 * shops stay: turned back on, it is sold from them again. cb(err, how many were taken out).
 */
const dropItemCopies = (db, system, definition, cb) => {
  read(db, system, (err, sections) => {
    if (err) return cb(err);
    const { copies } = againstItems(sections, definition);
    if (!copies.length) return cb(null, 0);
    const drop = async () => {
      await q(db, 'BEGIN IMMEDIATE');
      try {
        for (const { catalogue, id } of copies) await q(db, 'DELETE FROM shop_catalogues WHERE system = ? AND catalogue = ? AND id = ?', [system, catalogue, id]);
        await q(db, 'COMMIT');
      } catch (e) {
        await q(db, 'ROLLBACK').catch(() => {});
        throw e;
      }
    };
    drop().then(() => cb(null, copies.length), cb);
  });
};

module.exports = { read, refresh, replaceCatalogues, clearCatalogue, shape, dropItemCopies };
