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
const { npcSheetOf, tiersOf } = require('./npc');
const { ownWords } = require('./definition');
const { partOn, PARTS } = require('./parts');
const { buildingOn, buildingName, catalogueCurrency, ownBuildings } = require('./buildings');
const { currenciesOf } = require('./currencies');
const templates = require('../sheets/templates');
const npcTiers = require('../sheets/npcTiers');

/** id -> { name, definition, meta, render } */
const loaded = new Map();

const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** The server-side meta the built-in templates carry, worked out from a definition. */
const metaOf = (definition) => {
  const fields = fieldsOf(effectiveSheet(definition));
  // The NPC layout's fields too: the server keeps one set of rules per system, and an NPC's
  // HP lives on its token just as a player's does (npc.js holds the two layouts to agreeing).
  const both = [...fields, ...fieldsOf(npcSheetOf(definition))];
  const compiled = compileSystem({ lookups: definition.lookups, derived: definition.derived ?? [] });
  const linkedFields = {};
  const maxPairs = {};
  for (const f of both) {
    if (f.source) linkedFields[f.id] = f.source;
    if (f.maxField) maxPairs[f.maxField] = f.id;
  }
  return {
    name: definition.name,
    custom: true,
    // Only the character sheet's: an NPC's sheet is never shown to players (sheets/npcPrivacy.js).
    publicFields: fields.filter((f) => f.visibility === 'public' && f.sensitivity !== 'combat').map((f) => f.id),
    combatFields: [...new Set(both.filter((f) => f.sensitivity === 'combat').map((f) => f.id))],
    // Values the owner sees and only the GM changes (sheet.js EDIT).
    gmFields: fields.filter((f) => f.edit === 'gm').map((f) => f.id),
    linkedFields,
    maxPairs,
    // Derived values on every save, as the built-in recompute functions do. A published
    // definition compiles (publishing refuses one with problems); should one not, nothing is
    // recomputed rather than a save failing.
    recompute: compiled.ok ? (data) => compiled.system.apply(data) : () => [],
  };
};

/**
 * GENERATE_SHEET's tiers for a system, in the shape sheets/npcTiers.js gives the built-in
 * ones: the options to offer, and a builder for the sheet values, token HP and defense. The
 * values are run through the system's derived values, so a generated NPC's sheet is
 * consistent before anybody edits it. Null when the system defines no tiers.
 */
const tiersFor = (definition, recompute) => {
  const tiers = tiersWhenOn(definition);
  if (!tiers.length) return null;
  return {
    options: tiers.map((t) => ({ id: t.id, label: t.label })),
    build: (tierId) => {
      const tier = tiers.find((t) => t.id === tierId) || tiers[0];
      const data = { ...(tier.values || {}) };
      recompute(data);
      const defense = tier.defense ?? null;
      return { tierId: tier.id, data, hp: tier.hp ?? null, dv: { melee: defense, ranged: defense } };
    },
  };
};

/**
 * A system's NPC tiers, or none while it has NPC tiers turned off (3b6c): GENERATE_SHEET then
 * makes an untiered sheet, and the browser, sent no tiers, offers no picker. The tiers stay in
 * the definition for when the part is turned back on.
 */
const tiersWhenOn = (definition) => (partOn(definition, 'npc_tiers') ? tiersOf(definition) : []);

/** What the browser draws a sheet from: no formulas, lookups or rule names. */
const renderOf = (id, definition) => ({
  id,
  name: definition.name,
  // The terms this system renamed, every form filled in. A term it left alone is absent, so
  // each place keeps the text it shows today.
  words: ownWords(definition),
  parts: definition.parts || {},
  // The building types and catalogues it renamed or turned off (buildings.js).
  buildings: ownBuildings(definition),
  // Its own money (currencies.js): empty for a system with the app's single money.
  currencies: currenciesOf(definition),
  derived: (Array.isArray(definition.derived) ? definition.derived : []).map((d) => d.id),
  sheet: effectiveSheet(definition),
  npc: {
    // Null when NPCs use the character sheet.
    sheet: definition.npc && definition.npc.sheet ? npcSheetOf(definition) : null,
    tiers: tiersWhenOn(definition).map((t) => ({ id: t.id, label: t.label })),
  },
});

const put = (id, publishedText, version) => {
  const definition = parse(publishedText);
  if (!definition) { loaded.delete(id); return; }
  const meta = metaOf(definition);
  loaded.set(id, {
    name: definition.name, version: version || 0, definition, meta,
    render: renderOf(id, definition), tiers: tiersFor(definition, meta.recompute),
  });
};

/** Load every published system. cb(err, count). */
const load = (db, cb = () => {}) => {
  db.all('SELECT id, published, version FROM custom_systems WHERE published IS NOT NULL AND deleted_at IS NULL', [], (err, rows) => {
    if (err) { console.error('[systems] Could not load custom systems:', err.message); return cb(err); }
    loaded.clear();
    for (const r of rows) put(r.id, r.published, r.version);
    cb(null, loaded.size);
  });
};

/** Reload one system after it is published or deleted. cb(err). */
const refresh = (db, id, cb = () => {}) => {
  db.get('SELECT published, version FROM custom_systems WHERE id = ? AND deleted_at IS NULL', [id], (err, row) => {
    if (err) return cb(err);
    if (row && row.published) put(id, row.published, row.version); else loaded.delete(id);
    cb(null);
  });
};

const meta = (id) => (loaded.has(id) ? loaded.get(id).meta : null);
const render = (id) => (loaded.has(id) ? loaded.get(id).render : null);
/** Every published system, for the picker, with the version that is running. */
const list = () => [...loaded.entries()].map(([id, s]) => ({ id, name: s.name, custom: true, version: s.version }))
  .sort((a, b) => a.name.localeCompare(b.name));

const tiers = (id) => (loaded.has(id) ? loaded.get(id).tiers : null);

/**
 * What the app calls `term` in `form` while `system` runs, for text the server writes (chat
 * lines, the dice log). A published custom system's own word, when it renamed the term;
 * otherwise `builtIn`, the text that place has always shown.
 */
const wordIn = (system, term, form, builtIn) => {
  const render = loaded.has(system) ? loaded.get(system).render : null;
  const word = render && render.words[term] ? render.words[term][form] : undefined;
  return typeof word === 'string' && word ? word : builtIn;
};

/**
 * Whether `part` of the app (parts.js PARTS: the bank, shops, vehicles...) is on while
 * `system` runs. Only a published custom system can turn one off; a built-in system, a draft and
 * an unknown id always answer on, so every place keeps today's own rule for whether it shows (CWN
 * alone has cyberware, and so on). Off only ever hides: nothing a part holds is deleted, so
 * turning it back on brings all of it back.
 */
const partIn = (system, part) => {
  if (!PARTS.includes(part)) throw new Error(`Not a part of the app: ${part}`);
  return loaded.has(system) ? partOn(loaded.get(system).definition, part) : true;
};

/**
 * Whether `system` has a building type (`kind` 'types') or shop catalogue ('catalogues'). Only a
 * published custom system can turn one off; every built-in system has all of them.
 */
const buildingIn = (system, kind, id) => (loaded.has(system) ? buildingOn(loaded.get(system).definition, kind, id) : true);

/** A published custom system's own name for a building type or catalogue, or null: the app's name stands. */
const buildingNameIn = (system, kind, id) => (loaded.has(system) ? buildingName(loaded.get(system).definition, kind, id) : null);

/**
 * A published custom system's currencies (currencies.js), the first the main one; empty for a
 * built-in system or one that defines none, which keep the app's single money.
 */
const currenciesIn = (system) => (loaded.has(system) ? currenciesOf(loaded.get(system).definition) : []);

/**
 * The currency a shop catalogue is priced in under `system` (buildings.js catalogueCurrency), as
 * currencies.js shapes it; null for a built-in system or one with no currencies of its own.
 */
const catalogueCurrencyIn = (system, catalogue) => {
  if (!loaded.has(system)) return null;
  const id = catalogueCurrency(loaded.get(system).definition, catalogue);
  return id ? currenciesIn(system).find((c) => c.id === id) || null : null;
};

/** A published system's health model (its core.health), or null: built-in systems have none here. */
const health = (id) => {
  const definition = loaded.has(id) ? loaded.get(id).definition : null;
  // With token health off a system has no health at all: the 'none' model, which takes no
  // damage and shows nothing (3b6d). Its own model stays in the definition for when it returns.
  if (definition && !partOn(definition, 'token_health')) return { model: 'none' };
  const core = definition && definition.core && typeof definition.core === 'object' ? definition.core : null;
  return core && core.health && typeof core.health === 'object' ? core.health : null;
};

templates.setCustomMeta(meta);
npcTiers.setCustomTiers(tiers);

module.exports = { load, refresh, meta, render, list, tiers, health, wordIn, partIn, buildingIn, buildingNameIn, currenciesIn, catalogueCurrencyIn, metaOf, renderOf };
