const express = require('express');
const { authenticate } = require('../middleware/auth');

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM roads', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/', authenticate, (req, res) => {
    const roads = Array.isArray(req.body) ? req.body : [req.body];
    const sql = `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (?, ?, ?, ?, ?)`;
    db.serialize(() => {
      const ids = [];
      const stmt = db.prepare(sql);
      roads.forEach(r => stmt.run([r.x1, r.z1, r.x2, r.z2, r.width || 4], function(err) {
        if (!err) ids.push(this.lastID);
      }));
      stmt.finalize(() => {
        if (ids.length > 0) recordAction('road_create', { ids });
        emitUpdate();
        res.json({ message: `Stored ${roads.length} road segments` });
      });
    });
  });

  router.delete('/:id', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM roads WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Road segment not found' });
      db.run('DELETE FROM roads WHERE id = ?', [id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        recordAction('road_delete_segment', { id, data: row });
        emitUpdate();
        res.json({ message: 'Road segment deleted' });
      });
    });
  });

  router.delete('/', authenticate, (req, res) => {
    db.all('SELECT * FROM roads', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run('DELETE FROM roads', [], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        recordAction('road_delete_all', { data: rows });
        emitUpdate();
        res.json({ message: 'Roads cleared' });
      });
    });
  });

  return router;
};
