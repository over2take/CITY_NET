// Published custom systems, held in memory for the running game.
//
// The game asks about a system many times a second - which fields are public, which live on
// the token, how to recompute derived values on a save - through sheets/templates.js. Those
// answers for a custom system come from here: each PUBLISHED definition (never a draft) is
// compiled once, on load and whenever it is published or deleted, into the same shape the
// built-in templates have. templates.js asks through a hook rather than requiring this file,
// which would make a circle (templates -> here -> the engine -> rules -> templates).
//
// Also the render copy the browser draws a sheet from: layout and words, never formulas.

const { compileSystem } = require('./derived');
const { effectiveSheet, fieldsOf } = require('./sheet');
const templates = require('../sheets/templates');

/** id -> { name, definition, meta, render } */
const loaded = new Map();

const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** The server-side meta the built-in templates carry, worked out from a definition. */
const metaOf = (definition) => {
  const sheet = effectiveSheet(definition);
  const fields = fieldsOf(sheet);
  const compiled = compileSystem({ lookups: definition.lookups, derived: definition.derived ?? [] });
  const linkedFields = {};
  const maxPairs = {};
  for (const f of fields) {
    if (f.source) linkedFields[f.id] = f.source;
    if (f.maxField) maxPairs[f.maxField] = f.id;
  }
  return {
    name: definition.name,
    custom: true,
    publicFields: fields.filter((f) => f.visibility === 'public' && f.sensitivity !== 'combat').map((f) => f.id),
    combatFields: fields.filter((f) => f.sensitivity === 'combat').map((f) => f.id),
    linkedFields,
    maxPairs,
    // Derived values on every save, as the built-in recompute functions do. A published
    // definition compiles (publishing refuses one with problems); should one not, nothing is
    // recomputed rather than a save failing.
    recompute: compiled.ok ? (data) => compiled.system.apply(data) : () => [],
  };
};

/** What the browser draws a sheet from: no formulas, lookups or rule names. */
const renderOf = (id, definition) => ({
  id,
  name: definition.name,
  words: definition.words || {},
  parts: definition.parts || {},
  derived: (Array.isArray(definition.derived) ? definition.derived : []).map((d) => d.id),
  sheet: effectiveSheet(definition),
});

const put = (id, publishedText) => {
  const definition = parse(publishedText);
  if (!definition) { loaded.delete(id); return; }
  loaded.set(id, { name: definition.name, definition, meta: metaOf(definition), render: renderOf(id, definition) });
};

/** Load every published system. cb(err, count). */
const load = (db, cb = () => {}) => {
  db.all('SELECT id, published FROM custom_systems WHERE published IS NOT NULL', [], (err, rows) => {
    if (err) { console.error('[systems] Could not load custom systems:', err.message); return cb(err); }
    loaded.clear();
    for (const r of rows) put(r.id, r.published);
    cb(null, loaded.size);
  });
};

/** Reload one system after it is published or deleted. cb(err). */
const refresh = (db, id, cb = () => {}) => {
  db.get('SELECT published FROM custom_systems WHERE id = ?', [id], (err, row) => {
    if (err) return cb(err);
    if (row && row.published) put(id, row.published); else loaded.delete(id);
    cb(null);
  });
};

const meta = (id) => (loaded.has(id) ? loaded.get(id).meta : null);
const render = (id) => (loaded.has(id) ? loaded.get(id).render : null);
/** Every published system, for the picker. */
const list = () => [...loaded.entries()].map(([id, s]) => ({ id, name: s.name, custom: true }))
  .sort((a, b) => a.name.localeCompare(b.name));

templates.setCustomMeta(meta);

module.exports = { load, refresh, meta, render, list, metaOf, renderOf };
