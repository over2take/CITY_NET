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
// Nothing in the running game reads these yet: loading a published system into the game is
// a later piece (2d). This is storage and its rules only.

const crypto = require('crypto');
const { checkDefinition, blankDefinition } = require('./definition');

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
     FROM custom_systems ORDER BY updated_at DESC, name`,
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
  db.get('SELECT * FROM custom_systems WHERE id = ?', [id], (err, row) => {
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
  db.run(
    `INSERT INTO custom_systems (id, name, draft, version, created_at, updated_at)
     VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, def.name.trim(), JSON.stringify(def)],
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
    `UPDATE custom_systems SET draft = ?, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
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

/** Delete a system. Refused while it is the one the game runs. */
const deleteSystem = (db, id, cb) => {
  if (!isCustomId(id)) return cb(fail(404, 'No such system'));
  db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, [], (err, row) => {
    if (err) return cb(err);
    if (row && row.value === id) return cb(fail(409, 'This is the system the game is running. Switch to another first.'));
    db.run('DELETE FROM custom_systems WHERE id = ?', [id], function (err2) {
      if (err2) return cb(err2);
      if (this.changes === 0) return cb(fail(404, 'No such system'));
      cb(null);
    });
  });
};

module.exports = {
  PREFIX, isCustomId, listSystems, getSystem, createSystem, saveDraft, publishSystem, deleteSystem,
};
