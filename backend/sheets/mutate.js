// One writer at a time, per sheet.
//
// A character sheet is a single JSON blob in one column, so changing one field means
// reading the whole thing, altering it, and writing the whole thing back. There are
// twenty-two places that do this. Between the read and the write is a callback gap, and
// nothing held anything across it — so two writers to the same sheet each built their new
// blob from the same starting point, and whichever wrote second silently discarded the
// other's change. No error, no conflict, no retry. The hit points come back.
//
// Two different players never collided: every query is scoped by username, so they are
// different rows. The collision is one sheet with two writers, which is an ordinary
// moment at a table — a GM applying damage while that player edits their gear, an
// automatic effect landing mid-edit, one person with the sheet open in two tabs.
//
// The fix is a queue per sheet id rather than a lock over all of them: writes to different
// sheets are genuinely independent and should not wait on each other, and during a fight
// they are happening constantly.
//
// Everything here is per-process, which is all it needs to be — one Node process owns the
// SQLite file. If this ever became more than one process, this would have to become a
// transaction with `BEGIN IMMEDIATE`, and the comment would need to move rather than the
// guarantee quietly weakening.

/** sheet id -> promise for the last queued write, so the next one can chain onto it. */
const chains = new Map();

/**
 * Read a sheet, change it, write it back, with nothing else touching it in between.
 *
 * `mutate` receives the parsed sheet and returns the version to store. Returning nothing
 * declines the write — useful for a caller that has to read the sheet to discover there
 * is nothing to do — and still releases the queue.
 *
 * `cb(err, data)` is called with what was stored, or with an error. A mutator that throws
 * is reported to its own caller and does not strand the writes queued behind it.
 */
function mutateSheet(db, sheetId, mutate, cb = () => {}) {
  const key = String(sheetId);

  const run = () => new Promise((settle) => {
    db.get('SELECT id, data FROM character_sheets WHERE id = ?', [sheetId], (err, row) => {
      if (err) { cb(err); return settle(); }
      if (!row) { cb(new Error(`No character sheet with id ${sheetId}`)); return settle(); }

      let next;
      try {
        next = mutate(JSON.parse(row.data || '{}'));
      } catch (e) {
        // The caller's problem, not the next writer's.
        cb(e);
        return settle();
      }

      if (next === undefined || next === null) { cb(null, null); return settle(); }

      db.run(
        'UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(next), row.id],
        (err2) => {
          cb(err2 || null, err2 ? undefined : next);
          settle();
        }
      );
    });
  });

  // Chain onto whatever is already queued for this sheet. The `catch` is what stops one
  // rejected link breaking every write behind it — `run` never rejects, but a future
  // change to it should not be able to deadlock a sheet.
  const previous = chains.get(key) || Promise.resolve();
  const mine = previous.then(run, run).catch(() => {});
  chains.set(key, mine);

  // Forget the sheet once its queue is empty, or this map grows one entry per sheet ever
  // written and never gives one back.
  mine.then(() => {
    if (chains.get(key) === mine) chains.delete(key);
  });

  return mine;
}

/**
 * The same, for the many call sites that know a player rather than a row id.
 *
 * The lookup happens outside the queue on purpose: a sheet's id never changes, so two
 * callers resolving the same player concurrently arrive at the same id and then queue
 * behind each other correctly. Locking the lookup as well would serialise reads that do
 * not need it.
 */
function mutateSheetForUser(db, { username, system }, mutate, cb = () => {}) {
  db.get(
    'SELECT id FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0',
    [username, system],
    (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(new Error(`No ${system} sheet for ${username}`));
      return mutateSheet(db, row.id, mutate, cb);
    }
  );
}

/**
 * Apply a handful of fields to a sheet, leaving the rest as it is.
 *
 * The overwhelmingly common shape: a caller loads a sheet, spreads it, sets one or two
 * keys and writes the whole thing back — which is what discards a concurrent edit to some
 * *other* field. Spreading over a fresh read instead means only the fields being patched
 * are contested, and everything else survives.
 *
 * `patch` may be an object or a function of the current sheet, for values that depend on
 * what is actually there rather than on what was read a moment ago.
 */
const patchSheet = (db, sheetId, patch, cb) =>
  mutateSheet(db, sheetId, (data) => ({
    ...data,
    ...(typeof patch === 'function' ? patch(data) : patch),
  }), cb);

/** Promise-shaped, for callers that would rather await than nest. */
const mutateSheetAsync = (db, sheetId, mutate) => new Promise((resolve, reject) => {
  mutateSheet(db, sheetId, mutate, (err, data) => (err ? reject(err) : resolve(data)));
});

/** Tests only: how many sheets currently have a write queued. */
const pendingSheets = () => chains.size;

module.exports = { mutateSheet, mutateSheetForUser, patchSheet, mutateSheetAsync, pendingSheets };
