// What the GM knows about a building and the players do not.
//
// Kept in its own table, `location_gm_notes`, rather than as a column on `locations`.
// Every player downloads every location row - GET /api/locations is public and selects
// l.* - so a column there would reach every browser however carefully the window hid it.
// Nothing here is ever joined into that query; the only way in is a route that checks
// for the main admin.
//
// Keyed by location id, and ids are not forever. Deleting one building leaves its notes
// where they are, because the delete can be undone and the building comes back under the
// same id - new buildings never reuse it, since ids only count upward. The two places ids
// do wind back are a map being cleared or loaded, and those are where notes are dealt
// with: pruned on a clear, and on a load replaced by the notes the saved map carried.

/** The longest note kept. A page of prose, not a dumping ground for a campaign bible. */
const MAX_LENGTH = 20000;

/** One building's notes, or '' when there are none. */
const get = (db, locationId, cb) => {
  db.get(
    'SELECT notes FROM location_gm_notes WHERE location_id = ?',
    [locationId],
    (err, row) => (err ? cb(err) : cb(null, row ? row.notes : '')),
  );
};

/**
 * Replace one building's notes.
 *
 * Empty text removes the row rather than storing an empty one, so "has notes" is simply
 * "has a row" and a cleared note leaves nothing behind.
 */
const set = (db, locationId, notes, cb) => {
  const text = String(notes == null ? '' : notes);
  if (!text.trim()) {
    return db.run('DELETE FROM location_gm_notes WHERE location_id = ?', [locationId], (err) => cb(err || null));
  }
  db.run(
    `INSERT INTO location_gm_notes (location_id, notes, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(location_id) DO UPDATE SET notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
    [locationId, text],
    (err) => cb(err || null),
  );
};

/**
 * Drop notes whose building no longer exists.
 *
 * Run after anything that deletes buildings in bulk. Cheaper than finding every delete
 * path and teaching each one about this table, and it cannot miss one.
 */
const pruneOrphans = (db, cb = () => {}) => {
  db.run(
    'DELETE FROM location_gm_notes WHERE location_id NOT IN (SELECT id FROM locations)',
    (err) => cb(err || null),
  );
};

/** Every note, for a saved map to carry. */
const all = (db, cb) => {
  db.all('SELECT location_id, notes FROM location_gm_notes', (err, rows) => cb(err, rows || []));
};

/**
 * Put back the notes a saved map carried, replacing whatever was there.
 *
 * Only for buildings that exist once the map is in, so a note for a building the map no
 * longer has is not resurrected onto some later building with the same id.
 */
const replaceAll = (db, rows, cb = () => {}) => {
  db.serialize(() => {
    db.run('DELETE FROM location_gm_notes');
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO location_gm_notes (location_id, notes)
       SELECT ?, ? WHERE EXISTS (SELECT 1 FROM locations WHERE id = ?)`,
    );
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || r.location_id == null || !String(r.notes || '').trim()) continue;
      stmt.run([r.location_id, String(r.notes), r.location_id]);
    }
    stmt.finalize((err) => cb(err || null));
  });
};

module.exports = { MAX_LENGTH, get, set, pruneOrphans, all, replaceAll };
