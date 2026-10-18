const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate, optionalAuthenticate, requireMainAdmin } = require('../middleware/auth');
const { LIMITS, rejectFormat, uploadErrors } = require('../middleware/uploadConstraints');
const store = require('../systemBuilder/store');
const { previewPublish } = require('../systemBuilder/publishPreview');
const { buildCustomTemplate } = require('../sheets/pdfTemplate');
const runtime = require('../systemBuilder/runtime');
const { checkDefinition } = require('../systemBuilder/definition');
const { previewDerived } = require('../systemBuilder/derived');
const { effectiveSheet, starterSheet, fieldsOf } = require('../systemBuilder/sheet');
const { npcSheetOf, LIMITS: NPC_LIMITS } = require('../systemBuilder/npc');
const { rollTier } = require('../systemBuilder/tierRolls');
const { tryHealth } = require('../systemBuilder/tryHealth');
const { tryRest } = require('../systemBuilder/tryRest');
const { exampleList, exampleDefinition, exampleKind, KINDS } = require('../systemBuilder/examples');
const { checkTableConditions, saveTableConditions } = require('../systemBuilder/tableConditions');
const { isBuiltIn } = require('../sheets/templates');
const { houseRuleKey } = require('../systemBuilder/houseRules');

/** The global_settings key that says the builder's first-time tour has been seen. */
const TOUR_SEEN = 'builder_tour_seen';
/** The builder pages with a map, so a FORMS / GRAPH choice (Phase 5: STATS & RULES only). */
const MAP_PAGES = ['rules'];
const VIEW_KEY = (page) => `builder_view_${page}`;

/** What a currency's or condition's icon may be uploaded as (decided with the user, 2026-10-01). */
const ICON_EXT = new Set(['.png', '.webp', '.svg']);

// Custom game systems: the builder's storage (see systemBuilder/store.js).
//
// Main admin only, reading included. Building systems is the GM's (decided with the user,
// 2026-09-29), and a draft can hold the GM's unannounced rules. Granted editors pass
// `authenticate` but not `requireMainAdmin`.

module.exports = (db, io = null) => {
  const router = express.Router();
  // On every route rather than router.use, so the route walk in gm_route_auth.test.js sees them.
  const gm = [authenticate, requireMainAdmin];

  /**
   * An icon upload: a small PNG, WebP or SVG stored under its content hash in `folder`, so the same
   * picture twice is one file, answered with its address. /uploads serves it with the sandbox
   * headers (middleware/uploadHeaders.js), and the windows only ever draw it through <img>, which
   * is what makes SVG safe to take, as with battle maps. In memory: an icon is capped small, and
   * hashing a buffer is simplest (as building photos).
   */
  const iconUpload = (folder, maxBytes) => {
    const dir = path.join(__dirname, '../uploads', folder);
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes },
      // Recorded so a refusal for size can name the file - multer aborts before any handler.
      fileFilter: (req, file, cb) => { req.uploadFilename = file.originalname; cb(null, true); },
    });
    const store = (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No icon was sent' });
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      // The extension decides how it is served back: the type follows the name on disk.
      if (!ICON_EXT.has(ext)) return rejectFormat(res, { file: req.file, allowed: [...ICON_EXT], maxBytes });
      const filename = crypto.createHash('sha256').update(req.file.buffer).digest('hex') + ext;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const filepath = path.join(dir, filename);
        if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, req.file.buffer);
      } catch (e) {
        return res.status(500).json({ error: 'Could not store the icon.' });
      }
      return res.json({ icon: `/uploads/${folder}/${filename}` });
    };
    return [upload.single('icon'), uploadErrors({ allowed: [...ICON_EXT], maxBytes }), store];
  };

  /** The status a store error carries, or 500. */
  const answer = (res, err, body) => {
    if (!err) return res.json(body);
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.problems ? { problems: err.problems } : {}) });
    console.error('[systems]', err.message);
    return res.status(500).json({ error: 'Could not reach the systems store' });
  };

  router.get('/', gm, (req, res) => store.listSystems(db, (err, systems) => answer(res, err, systems)));

  // Upload an icon for a currency (3c2c2), which a currency's `icon` then names (currencies.js),
  // or for a condition (4e1a), which a condition's `icon` names (conditions.js).
  router.post('/currency-icons', gm, ...iconUpload('currency_icons', LIMITS.currency_icon));
  router.post('/condition-icons', gm, ...iconUpload('condition_icons', LIMITS.condition_icon));

  // The built-in examples (4d1) and genre starters (4d3, ?kind=starter): what the library lists,
  // and one whole, to read. Copying either is POST / with `example`.
  router.get('/examples', gm, (req, res) => {
    const kind = req.query.kind === undefined ? 'example' : req.query.kind;
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Examples or starters only' });
    res.json(exampleList(kind));
  });
  router.get('/examples/:id', gm, (req, res) => {
    const definition = exampleDefinition(req.params.id);
    if (!definition) return res.status(404).json({ error: 'No such example' });
    res.json({ id: req.params.id, kind: exampleKind(req.params.id), definition });
  });

  /** A new system: blank from a name, a whole definition, or a copy of an example under a new name. */
  router.post('/', gm, (req, res) => {
    const { name, definition, example } = req.body || {};
    if (example === undefined) return store.createSystem(db, { name, definition }, (err, made) => answer(res, err, made));
    const copy = exampleDefinition(example);
    if (!copy) return res.status(404).json({ error: 'No such example' });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'A system needs a name' });
    store.createSystem(db, { definition: { ...copy, name: name.trim() } }, (err, made) => answer(res, err, made));
  });

  // Whether the builder's first-time tour has been seen (4i; approved mockup
  // docs/mockups/builder-help.html, 2026-10-13): kept here, so a new browser doesn't show it again,
  // and one setting, as only the main admin builds. Seen when finished or skipped; START THE TOUR
  // plays it again without asking. Before /:id, which would read "tour" as a system.
  router.get('/tour', gm, (req, res) => {
    db.get('SELECT value FROM global_settings WHERE key = ?', [TOUR_SEEN], (err, row) => {
      if (err) return answer(res, err);
      return res.json({ seen: !!row && row.value === '1' });
    });
  });
  router.put('/tour', gm, (req, res) => {
    const { seen } = req.body || {};
    if (typeof seen !== 'boolean') return res.status(400).json({ error: 'Seen is true or false' });
    const done = (err) => (err ? answer(res, err) : res.json({ seen }));
    if (seen) db.run(`INSERT INTO global_settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, [TOUR_SEEN], done);
    else db.run('DELETE FROM global_settings WHERE key = ?', [TOUR_SEEN], done);
  });

  // FORMS or GRAPH, per builder page that has a map (Phase 5; approved mockup
  // docs/mockups/builder-graph.html, 2026-10-17): remembered here like the tour, one setting per
  // page as only the main admin builds. FORMS until GRAPH is picked. Before /:id, as /tour is.
  router.get('/view', gm, (req, res) => {
    const keys = MAP_PAGES.map((p) => VIEW_KEY(p));
    db.all(`SELECT key, value FROM global_settings WHERE key IN (${keys.map(() => '?').join(', ')})`, keys, (err, rows) => {
      if (err) return answer(res, err);
      const set = new Map((rows || []).map((r) => [r.key, r.value]));
      return res.json({ views: Object.fromEntries(MAP_PAGES.map((p) => [p, set.get(VIEW_KEY(p)) === 'graph' ? 'graph' : 'forms'])) });
    });
  });
  router.put('/view', gm, (req, res) => {
    const { page, view } = req.body || {};
    if (!MAP_PAGES.includes(page)) return res.status(400).json({ error: 'That page has no map' });
    if (view !== 'forms' && view !== 'graph') return res.status(400).json({ error: 'The view is forms or graph' });
    db.run('INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [VIEW_KEY(page), view],
      (err) => (err ? answer(res, err) : res.json({ page, view })));
  });

  router.get('/:id', gm, (req, res) => store.getSystem(db, req.params.id, (err, sys) => answer(res, err, sys)));

  /**
   * The table's house rules for a published system (4j2b; approved mockup
   * docs/mockups/optional-rules.html, 2026-10-14): the GM or a granted editor switches them, as with
   * the built-in games' house rules, from TTRPG_SYSTEM. { rules: { magic: true, ... } }, any number
   * at once, kept in global_settings; the running game takes them at once, and every browser drawing
   * the system fetches it again. Answers the rules, each with whether it is on.
   */
  router.put('/:id/house-rules', authenticate, (req, res) => {
    const known = new Set(runtime.houseRulesIn(req.params.id).map((r) => r.id));
    if (!known.size) return res.status(404).json({ error: 'That system has no house rules running' });
    const asked = req.body && req.body.rules;
    if (!asked || typeof asked !== 'object' || Array.isArray(asked) || !Object.keys(asked).length) {
      return res.status(400).json({ error: 'Say which house rules are on' });
    }
    for (const [rule, on] of Object.entries(asked)) {
      if (!known.has(rule)) return res.status(400).json({ error: `"${rule}" is not one of this system's house rules` });
      if (typeof on !== 'boolean') return res.status(400).json({ error: `Say on or off for ${rule}` });
    }
    const pairs = Object.entries(asked);
    // One statement, so the table's choices change together or not at all.
    db.run(`INSERT INTO global_settings (key, value) VALUES ${pairs.map(() => '(?, ?)').join(', ')}
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`, pairs.flatMap(([rule, on]) => [houseRuleKey(req.params.id, rule), on ? '1' : '0']), (err) => {
      if (err) return answer(res, err);
      return runtime.refresh(db, req.params.id, () => {
        if (io) io.emit('customSystemChanged', { id: req.params.id });
        res.json({ house_rules: runtime.houseRulesIn(req.params.id) });
      });
    });
  });

  /**
   * What PUBLISH would change (4h1b; approved mockup docs/mockups/version-preview.html): the draft
   * against the published version, for every character playing it, or on the SAMPLE values when
   * nobody does (systemBuilder/publishPreview.js). Writes nothing. `problems` is how many the draft
   * still has, which PUBLISH refuses.
   */
  router.get('/:id/publish-preview', gm, (req, res) => {
    store.getSystem(db, req.params.id, (err, sys) => {
      if (err) return answer(res, err);
      db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, [], (e2, row) => {
        if (e2) return answer(res, e2);
        previewPublish(db, { system: sys.id, version: sys.version, before: sys.published, after: sys.draft, running: !!row && row.value === sys.id })
          .then((preview) => answer(res, null, { ...preview, problems: sys.problems.length }), (e3) => answer(res, e3));
      });
    });
  });

  router.put('/:id/draft', gm, (req, res) => {
    const { definition } = req.body || {};
    store.saveDraft(db, req.params.id, definition, (err, saved) => answer(res, err, saved));
  });

  // Publishing and deleting change what the game can run, so the running copy is reloaded.
  // Every browser drawing it fetches the new version (customSystemChanged).
  router.post('/:id/publish', gm, (req, res) => {
    store.publishSystem(db, req.params.id, (err, done) => {
      if (err) return answer(res, err);
      runtime.refresh(db, req.params.id, () => {
        if (io) io.emit('customSystemChanged', { id: req.params.id });
        answer(res, null, done);
      });
    });
  });

  /**
   * Set one currency's icon, or clear it with `icon: null` (store.setCurrencyIcon): in the draft
   * and the running copy alike, so the game shows it at once. Every browser is told the system
   * changed, so it fetches the system again rather than keep drawing the old icon.
   */
  router.put('/:id/currencies/:currency/icon', gm, (req, res) => {
    const icon = req.body && Object.prototype.hasOwnProperty.call(req.body, 'icon') ? req.body.icon : undefined;
    store.setCurrencyIcon(db, req.params.id, req.params.currency, icon, (err, done) => {
      if (err) return answer(res, err);
      runtime.refresh(db, req.params.id, () => {
        if (io) io.emit('customSystemChanged', { id: req.params.id });
        answer(res, null, done);
      });
    });
  });

  /**
   * Rename a system (store.renameSystem): at once, in the draft and the running copy alike, and
   * every browser fetches it again. A name another system has is refused with 409.
   */
  router.put('/:id/name', gm, (req, res) => {
    store.renameSystem(db, req.params.id, req.body && req.body.name, (err, done) => {
      if (err) return answer(res, err);
      runtime.refresh(db, req.params.id, () => {
        if (io) io.emit('customSystemChanged', { id: req.params.id });
        answer(res, null, done);
      });
    });
  });

  // A new, unpublished system from this one's draft (store.duplicateSystem). Nothing running
  // changes, so nothing is reloaded.
  router.post('/:id/duplicate', gm, (req, res) => {
    store.duplicateSystem(db, req.params.id, (err, made) => answer(res, err, made));
  });

  // ─── Sharing as files (systemBuilder/citysys.js) ────────────────────────────

  // A published system as a .citysys file to download.
  router.get('/:id/export', gm, (req, res) => {
    store.exportSystem(db, req.params.id, (err, file) => {
      if (err) return answer(res, err);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.text);
    });
  });

  /**
   * The builder's live values (4b2b): a draft's derived values worked out from its sample character,
   * leaving out what can't be worked out yet, with the formulas' problems. Changes nothing.
   */
  router.post('/preview-values', gm, (req, res) => {
    const definition = req.body && req.body.definition;
    const checked = checkDefinition(definition);
    if (checked.fatal) return res.status(400).json({ error: checked.fatal });
    const samples = definition.samples && typeof definition.samples === 'object' && !Array.isArray(definition.samples) ? definition.samples : {};
    res.json(previewDerived({ lookups: definition.lookups, derived: definition.derived }, samples));
  });

  /**
   * The builder's TRY IT (4c1): a made-up character's health under a draft's model, on a pretend
   * token: an action applied through the game's own rules, and the HEALTH folder's views of it,
   * for its owner and for everyone else. Changes nothing.
   */
  router.post('/try-health', gm, (req, res) => {
    const { definition, token, sheet, action } = req.body || {};
    const checked = checkDefinition(definition);
    if (checked.fatal) return res.status(400).json({ error: checked.fatal });
    res.json(tryHealth(definition, { token, sheet, action }));
  });

  /**
   * A draft's rest on a made-up character (4f6a): TRY IT's CALL A REST, rolled, and the RESTS page's
   * ON THE SAMPLE, not. Through the game's own rules; changes nothing.
   */
  router.post('/try-rest', gm, (req, res) => {
    const { definition, rest, sheet, token, conditions, roll } = req.body || {};
    const checked = checkDefinition(definition);
    if (checked.fatal) return res.status(400).json({ error: checked.fatal });
    const tried = tryRest(definition, { rest, sheet, token, conditions, roll: roll === true });
    if (!tried.ok) return res.status(400).json({ error: tried.error });
    res.json(tried);
  });

  /**
   * The builder's NPCS page, TRY IT (4b4a2): one of a draft's tiers worked out and rolled for a
   * level, each box with its value and dice, or what is wrong with it. Changes nothing.
   */
  router.post('/try-tier', gm, (req, res) => {
    const { definition, tier: tierId, level } = req.body || {};
    const checked = checkDefinition(definition);
    if (checked.fatal) return res.status(400).json({ error: checked.fatal });
    const tier = (definition.npc && Array.isArray(definition.npc.tiers) ? definition.npc.tiers : [])
      .find((t) => t && typeof t === 'object' && t.id === tierId);
    if (!tier) return res.status(404).json({ error: 'No such tier' });
    const fields = new Map(fieldsOf(npcSheetOf(definition)).filter((f) => f && typeof f.id === 'string').map((f) => [f.id, f]));
    res.json(rollTier(tier, level, fields, NPC_LIMITS));
  });

  /**
   * The builder's CHARACTER SHEET page (4b3): the sheet a draft is drawn with as it stands (its own
   * or the starter, without the parts it turned off) and the starter sheet CUSTOMIZE copies.
   * Changes nothing.
   */
  router.post('/preview-sheet', gm, (req, res) => {
    const definition = req.body && req.body.definition;
    const checked = checkDefinition(definition);
    if (checked.fatal) return res.status(400).json({ error: checked.fatal });
    res.json({ sheet: effectiveSheet(definition), starter: starterSheet(definition) });
  });

  /**
   * The blank form a draft would give players (4h2b), for the builder's CHARACTER SHEET page to
   * download before publishing: the same form IMPORT hands out once it is published. Changes nothing.
   */
  router.post('/form.pdf', gm, async (req, res) => {
    const definition = req.body && req.body.definition;
    const checked = checkDefinition(definition);
    if (checked.fatal) return res.status(400).json({ error: checked.fatal });
    try {
      const pdf = await buildCustomTemplate(definition);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="citynet-draft-form.pdf"');
      res.send(pdf);
    } catch (e) {
      console.error('[systems] form', e.message);
      res.status(500).json({ error: 'Could not build the form' });
    }
  });
  // What installing a file would do, changing nothing. The file arrives as text so its size is
  // checked before it is parsed.
  router.post('/install/preview', gm, (req, res) => {
    store.previewInstall(db, req.body && req.body.file, (err, preview) => answer(res, err, preview));
  });

  // `replaceChanges: true` only after the GM was warned that changes made here would go.
  router.post('/install', gm, (req, res) => {
    const { file, mode, replaceChanges } = req.body || {};
    store.installSystem(db, { text: file, mode, replaceChanges }, (err, installed) => {
      if (err) return res.status(err.status || 500).json({
        error: err.status ? err.message : 'Could not reach the systems store',
        ...(err.problems ? { problems: err.problems } : {}),
        ...(err.installed ? { installed: err.installed } : {}),
        ...(err.changed ? { changed: true } : {}),
      });
      // An update or a system brought back may be one a browser already has: it fetches it again.
      runtime.refresh(db, installed.id, () => {
        if (io) io.emit('customSystemChanged', { id: installed.id });
        answer(res, null, installed);
      });
    });
  });

  router.delete('/:id', gm, (req, res) => {
    store.deleteSystem(db, req.params.id, (err) => {
      if (err) return answer(res, err);
      runtime.refresh(db, req.params.id, () => answer(res, null, { deleted: true }));
    });
  });

  /**
   * What a published system's sheet is drawn from. Public: every player draws their own sheet.
   * Layout and words only - never the formulas, lookups or rule names (systemBuilder/runtime.js).
   */
  router.get('/render/:id', (req, res) => {
    const render = runtime.render(req.params.id);
    if (!render) return res.status(404).json({ error: 'No such published system' });
    res.json(render);
  });

  /**
   * The conditions a system offers for tokens (4e2a; runtime.conditionsIn): a published custom
   * system's own, or the standard set under a built-in one. Public, as the token list is: everyone
   * sees a token's conditions by name, icon and description. Their modifiers go only to the GM and
   * a granted editor here; a token's owner sees them in its HEALTH folder.
   */
  /**
   * A built-in game's own conditions (4e2c1; tableConditions.js), the whole set replaced: names,
   * labels, icons and descriptions beside the standard ones. A custom system's are its own
   * definition's, edited in the builder. Every screen is told, so token windows and the map ask
   * for the game's list again.
   */
  router.put('/table-conditions/:system', gm, (req, res) => {
    const { system } = req.params;
    if (!isBuiltIn(system)) return res.status(400).json({ error: 'A custom system\'s conditions are edited in the builder' });
    const entries = req.body && req.body.conditions;
    const problems = checkTableConditions(entries);
    if (problems.length) return res.status(400).json({ error: `${problems[0].where}: ${problems[0].message}`, problems });
    saveTableConditions(db, system, entries, (err) => {
      if (err) return answer(res, err);
      if (io) io.emit('conditionsChanged', { system });
      res.json({ conditions: runtime.conditionsIn(system) });
    });
  });

  router.get('/conditions/:system', optionalAuthenticate, (req, res) => {
    const all = runtime.conditionsIn(req.params.system);
    res.json(req.user ? all : all.map(({ modifiers, ...c }) => ({ ...c, modifiers: [] })));
  });

  return router;
};
