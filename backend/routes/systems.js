const express = require('express');
const { authenticate, requireMainAdmin } = require('../middleware/auth');
const store = require('../systemBuilder/store');

// Custom game systems: the builder's storage (see systemBuilder/store.js).
//
// Main admin only, reading included. Building systems is the GM's (decided with the user,
// 2026-09-29), and a draft can hold the GM's unannounced rules. Granted editors pass
// `authenticate` but not `requireMainAdmin`.

module.exports = (db) => {
  const router = express.Router();
  // On every route rather than router.use, so the route walk in gm_route_auth.test.js sees them.
  const gm = [authenticate, requireMainAdmin];

  /** The status a store error carries, or 500. */
  const answer = (res, err, body) => {
    if (!err) return res.json(body);
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.problems ? { problems: err.problems } : {}) });
    console.error('[systems]', err.message);
    return res.status(500).json({ error: 'Could not reach the systems store' });
  };

  router.get('/', gm, (req, res) => store.listSystems(db, (err, systems) => answer(res, err, systems)));

  router.post('/', gm, (req, res) => {
    const { name, definition } = req.body || {};
    store.createSystem(db, { name, definition }, (err, made) => answer(res, err, made));
  });

  router.get('/:id', gm, (req, res) => store.getSystem(db, req.params.id, (err, sys) => answer(res, err, sys)));

  router.put('/:id/draft', gm, (req, res) => {
    const { definition } = req.body || {};
    store.saveDraft(db, req.params.id, definition, (err, saved) => answer(res, err, saved));
  });

  router.post('/:id/publish', gm, (req, res) => {
    store.publishSystem(db, req.params.id, (err, done) => answer(res, err, done));
  });

  router.delete('/:id', gm, (req, res) => {
    store.deleteSystem(db, req.params.id, (err) => answer(res, err, { deleted: true }));
  });

  return router;
};
