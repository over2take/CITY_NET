const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate, requireMainAdmin } = require('../middleware/auth');
const { LIMITS, rejectFormat, uploadErrors } = require('../middleware/uploadConstraints');
const store = require('../systemBuilder/store');
const runtime = require('../systemBuilder/runtime');

/** What a currency's icon may be uploaded as (decided with the user, 2026-10-01). */
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

  // In memory: an icon is capped small, and hashing a buffer is simplest (as building photos).
  const iconsDir = path.join(__dirname, '../uploads/currency_icons');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.currency_icon },
    // Recorded so a refusal for size can name the file - multer aborts before any handler.
    fileFilter: (req, file, cb) => { req.uploadFilename = file.originalname; cb(null, true); },
  });
  const iconUploadErrors = uploadErrors({ allowed: [...ICON_EXT], maxBytes: LIMITS.currency_icon });

  /** The status a store error carries, or 500. */
  const answer = (res, err, body) => {
    if (!err) return res.json(body);
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.problems ? { problems: err.problems } : {}) });
    console.error('[systems]', err.message);
    return res.status(500).json({ error: 'Could not reach the systems store' });
  };

  router.get('/', gm, (req, res) => store.listSystems(db, (err, systems) => answer(res, err, systems)));

  /**
   * Upload an icon for a currency (3c2c2): a small PNG, WebP or SVG, stored under its content
   * hash, so the same picture twice is one file. Answers with its address, which a currency's
   * `icon` then names (currencies.js). /uploads serves it with the sandbox headers
   * (middleware/uploadHeaders.js), and the windows only ever draw it through <img>, which is what
   * makes SVG safe to take, as with battle maps.
   */
  router.post('/currency-icons', gm, upload.single('icon'), iconUploadErrors, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No icon was sent' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    // The extension decides how it is served back: the type follows the name on disk.
    if (!ICON_EXT.has(ext)) return rejectFormat(res, { file: req.file, allowed: [...ICON_EXT], maxBytes: LIMITS.currency_icon });
    const filename = crypto.createHash('sha256').update(req.file.buffer).digest('hex') + ext;
    try {
      fs.mkdirSync(iconsDir, { recursive: true });
      const filepath = path.join(iconsDir, filename);
      if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, req.file.buffer);
    } catch (e) {
      return res.status(500).json({ error: 'Could not store the icon.' });
    }
    res.json({ icon: `/uploads/currency_icons/${filename}` });
  });

  router.post('/', gm, (req, res) => {
    const { name, definition } = req.body || {};
    store.createSystem(db, { name, definition }, (err, made) => answer(res, err, made));
  });

  router.get('/:id', gm, (req, res) => store.getSystem(db, req.params.id, (err, sys) => answer(res, err, sys)));

  router.put('/:id/draft', gm, (req, res) => {
    const { definition } = req.body || {};
    store.saveDraft(db, req.params.id, definition, (err, saved) => answer(res, err, saved));
  });

  // Publishing and deleting change what the game can run, so the running copy is reloaded.
  router.post('/:id/publish', gm, (req, res) => {
    store.publishSystem(db, req.params.id, (err, done) => {
      if (err) return answer(res, err);
      runtime.refresh(db, req.params.id, () => answer(res, null, done));
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

  // What installing a file would do, changing nothing. The file arrives as text so its size is
  // checked before it is parsed.
  router.post('/install/preview', gm, (req, res) => {
    store.previewInstall(db, req.body && req.body.file, (err, preview) => answer(res, err, preview));
  });

  router.post('/install', gm, (req, res) => {
    const { file, mode } = req.body || {};
    store.installSystem(db, file, mode, (err, installed) => {
      if (err) return res.status(err.status || 500).json({
        error: err.status ? err.message : 'Could not reach the systems store',
        ...(err.problems ? { problems: err.problems } : {}),
        ...(err.installed ? { installed: err.installed } : {}),
      });
      runtime.refresh(db, installed.id, () => answer(res, null, installed));
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

  return router;
};
