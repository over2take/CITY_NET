// Custom game systems, stored.
//
// One row per system in `custom_systems`. Each keeps two copies of its definition: the
// **draft**, which the builder edits and saves as often as it likes, and the **published**
// copy, which is what a game runs. A draft can hold problems (a system half-built is normal);
// publishing refuses until it has none, so tinkering never breaks a game mid-session.
//
// Ids are `sys_` plus random hex and never change. The built-in systems' ids
// (cities_without_number, cyberpunk_red...) never start with `sys_`, so the two can never
// collide, and the active system - `game_system` in global_settings - can name either.
//
// Deleting hides a system rather than removing it: it leaves every list and can no longer be
// run, but reinstalling its file (citysys.js) brings it back under the same id, and with it
// every character, bank and token health played in it. A definition is a few KB; what was
// played in it was never removed by a delete anyway.

const crypto = require('crypto');
const { checkDefinition, blankDefinition } = require('./definition');
const citysys = require('./citysys');

const PREFIX = 'sys_';

const newId = () => PREFIX + crypto.randomBytes(8).toString('hex');
const isCustomId = (id) => typeof id === 'string' && /^sys_[0-9a-f]{16}$/.test(id);

const parse = (text) => {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
};

/** A stored error: `status` is what a route answers with. */
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });

/** Every system, newest change first, without their definitions. */
const listSystems = (db, cb) => {
  db.all(
    `SELECT id, name, version, draft, published, updated_at, published_at
     FROM custom_systems WHERE deleted_at IS NULL ORDER BY updated_at DESC, name`,
    [],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, rows.map((r) => ({
        id: r.id,
        name: r.name,
        version: r.version,
        updatedAt: r.updated_at,
        publishedAt: r.published_at,
        published: r.published != null,
        // Compared as stored text: the draft is written exactly as publishing copies it.
        unpublishedChanges: r.published == null || r.draft !== r.published,
      })));
    },
  );
};

/** One system: both copies of its definition, and the draft's current problems. */
const getSystem = (db, id, cb) => {
  if (!isCustomId(id)) return cb(fail(404, 'No such system'));
  db.get('SELECT * FROM custom_systems WHERE id = ? AND deleted_at IS NULL', [id], (err, row) => {
    if (err) return cb(err);
    if (!row) return cb(fail(404, 'No such system'));
    const draft = parse(row.draft);
    const checked = checkDefinition(draft);
    cb(null, {
      id: row.id,
      name: row.name,
      version: row.version,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
      draft,
      published: parse(row.published),
      problems: checked.fatal ? [{ where: 'definition', message: checked.fatal }] : checked.problems,
    });
  });
};

/**
 * Create a system from a name, or from a whole definition (an import, a copy). Refused only
 * when the definition cannot be stored at all; its ordinary problems come back with it.
 */
const createSystem = (db, { name, definition } = {}, cb) => {
  const def = definition === undefined ? blankDefinition(name) : definition;
  const checked = checkDefinition(def);
  if (checked.fatal) return cb(fail(400, checked.fatal));
  if (typeof def.name !== 'string' || !def.name.trim()) return cb(fail(400, 'A system needs a name'));
  const id = newId();
  // A system made here is its own origin: shared as a file, every copy keeps it.
  db.run(
    `INSERT INTO custom_systems (id, name, draft, version, origin, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, def.name.trim(), JSON.stringify(def), id],
    (err) => (err ? cb(err) : cb(null, { id, problems: checked.problems })),
  );
};

/** Replace a system's draft. Stored even with problems, which come back to show. */
const saveDraft = (db, id, definition, cb) => {
  if (!isCustomId(id)) return cb(fail(404, 'No such system'));
  const checked = checkDefinition(definition);
  if (checked.fatal) return cb(fail(400, checked.fatal));
  const name = typeof definition.name === 'string' && definition.name.trim() ? definition.name.trim() : null;
  db.run(
    `UPDATE custom_systems SET draft = ?, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`,
    [JSON.stringify(definition), name, id],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 0) return cb(fail(404, 'No such system'));
      cb(null, { problems: checked.problems });
    },
  );
};

/** Make the draft the version a game runs. Refused, with the list, while it has problems. */
const publishSystem = (db, id, cb) => {
  getSystem(db, id, (err, sys) => {
    if (err) return cb(err);
    if (sys.problems.length) return cb(fail(409, 'Fix these before publishing', { problems: sys.problems }));
    const text = JSON.stringify(sys.draft);
    db.run(
      `UPDATE custom_systems SET published = ?, version = version + 1, published_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [text, id],
      (err2) => (err2 ? cb(err2) : cb(null, { version: sys.version + 1 })),
    );
  });
};

/**
 * Delete a system: hidden, not removed. Refused while it is the one the game runs. Reinstalling
 * its file brings it back (installSystem).
 */
const deleteSystem = (db, id, cb) => {
  if (!isCustomId(id)) return cb(fail(404, 'No such system'));
  db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, [], (err, row) => {
    if (err) return cb(err);
    if (row && row.value === id) return cb(fail(409, 'This is the system the game is running. Switch to another first.'));
    db.run('UPDATE custom_systems SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [id], function (err2) {
      if (err2) return cb(err2);
      if (this.changes === 0) return cb(fail(404, 'No such system'));
      cb(null);
    });
  });
};

// ─── Sharing as files ───────────────────────────────────────────────────────

/** A published system as a file: { fileName, text }. A draft is not shared. */
const exportSystem = (db, id, cb) => {
  if (!isCustomId(id)) return cb(fail(404, 'No such system'));
  db.get('SELECT published, version, origin FROM custom_systems WHERE id = ? AND deleted_at IS NULL', [id], (err, row) => {
    if (err) return cb(err);
    if (!row) return cb(fail(404, 'No such system'));
    const definition = parse(row.published);
    if (!definition) return cb(fail(409, 'Publish the system before sharing it'));
    const file = citysys.buildFile({ definition, version: row.version, origin: row.origin || id });
    cb(null, { fileName: citysys.fileNameFor(definition.name), text: JSON.stringify(file, null, 2) });
  });
};

/**
 * Has this copy changed since it was installed? A system made here has no record of what was
 * installed, so it never matches and always counts as changed: a file must never overwrite
 * someone's own work.
 */
const editedSinceInstall = (row) => citysys.hashOf(row.draft) !== row.source_hash
  || (row.published != null && citysys.hashOf(row.published) !== row.source_hash);

/** The systems here with a file's origin: the ones in use, and the most recently deleted. */
const matchesFor = (db, origin, cb) => {
  db.all(
    `SELECT id, name, version, draft, published, source_hash, deleted_at FROM custom_systems
     WHERE origin = ? ORDER BY updated_at DESC`,
    [origin],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, {
        installed: rows.filter((r) => r.deleted_at == null),
        deleted: rows.find((r) => r.deleted_at != null) || null,
      });
    },
  );
};

/**
 * What installing a file would do, changing nothing: its cover, what is inside, its problems,
 * the copies already here, and whether it would bring a deleted system back.
 */
const previewInstall = (db, text, cb) => {
  const read = citysys.readFile(text);
  if (read.fatal) return cb(fail(400, read.fatal));
  const { manifest, definition } = read.file;
  matchesFor(db, manifest.origin, (err, found) => {
    if (err) return cb(err);
    cb(null, {
      manifest,
      name: definition.name,
      inside: citysys.summarize(definition),
      problems: read.problems,
      installed: found.installed.map((r) => ({ id: r.id, name: r.name, version: r.version, edited: editedSinceInstall(r) })),
      // Bringing a deleted system back puts the file's definition in it. `replacesChanges` warns
      // when the deleted copy held changes made here that the file does not have.
      restores: !found.installed.length && found.deleted ? {
        id: found.deleted.id,
        name: found.deleted.name,
        replacesChanges: found.deleted.draft !== JSON.stringify(definition) && editedSinceInstall(found.deleted),
      } : null,
    });
  });
};

/**
 * Install a file.
 *   new        a system not here yet; one deleted here comes back under its old id
 *   update     replace the copy already here, when it has not been changed since installing
 *   keep_both  a second copy beside it, with a new id and a new origin of its own
 * Published straight away when the file has no problems; otherwise kept as a draft to fix.
 * Never a merge. Resolves { id, published, restored?, problems }.
 */
const installSystem = (db, text, mode, cb) => {
  if (!['new', 'update', 'keep_both'].includes(mode)) return cb(fail(400, 'Install as new, update or keep both'));
  const read = citysys.readFile(text);
  if (read.fatal) return cb(fail(400, read.fatal));
  const { manifest, definition } = read.file;
  const stored = JSON.stringify(definition);
  const hash = citysys.hashOf(stored);
  const name = definition.name.trim();
  const publishable = read.problems.length === 0;
  const done = (id, extra) => (err) => (err ? cb(err) : cb(null, { id, published: publishable, problems: read.problems, ...extra }));

  const insert = (id, origin, extra) => db.run(
    `INSERT INTO custom_systems (id, name, draft, published, version, origin, source_hash, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${publishable ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
    [id, name, stored, publishable ? stored : null, publishable ? 1 : 0, origin, hash],
    done(id, extra),
  );
  // The row keeps its id, so everything played in it is still its own.
  const replace = (row, extra) => db.run(
    `UPDATE custom_systems SET name = ?, draft = ?, source_hash = ?, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
     ${publishable ? ', published = ?, version = version + 1, published_at = CURRENT_TIMESTAMP' : ''}
     WHERE id = ?`,
    publishable ? [name, stored, hash, stored, row.id] : [name, stored, hash, row.id],
    done(row.id, extra),
  );

  matchesFor(db, manifest.origin, (err, found) => {
    if (err) return cb(err);
    const here = found.installed[0];
    if (mode === 'keep_both') {
      const id = newId();
      return insert(id, id);
    }
    if (mode === 'update') {
      if (!here) return cb(fail(404, 'This system is not installed here; install it as new'));
      if (editedSinceInstall(here)) return cb(fail(409, 'This system has been changed here since it was installed. Keep both instead.'));
      if (!publishable) return cb(fail(409, 'The file has problems; install it as a second copy to fix them', { problems: read.problems }));
      return replace(here);
    }
    if (here) return cb(fail(409, 'Already installed. Update it or keep both.', { installed: found.installed.map((r) => ({ id: r.id, name: r.name })) }));
    if (found.deleted) return replace(found.deleted, { restored: true });
    return insert(newId(), manifest.origin);
  });
};

module.exports = {
  PREFIX, isCustomId, listSystems, getSystem, createSystem, saveDraft, publishSystem, deleteSystem,
  exportSystem, previewInstall, installSystem,
};
