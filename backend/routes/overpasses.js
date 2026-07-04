const express = require('express');
const { authenticate } = require('../middleware/auth');

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM overpasses ORDER BY id ASC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/', authenticate, (req, res) => {
    const { points, height, width, ramp_length, ramp_length_start, ramp_length_end, pillar_spacing } = req.body;
    if (!points || height == null || width == null || ramp_length == null) {
      return res.status(400).json({ error: 'points, height, width, and ramp_length are required' });
    }
    const pointsJson = typeof points === 'string' ? points : JSON.stringify(points);
    db.run(
      `INSERT INTO overpasses (points, height, width, ramp_length, ramp_length_start, ramp_length_end, pillar_spacing) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [pointsJson, height, width, ramp_length, ramp_length_start ?? null, ramp_length_end ?? null, pillar_spacing ?? 12],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        recordAction('overpass_create', { id: this.lastID });
        emitUpdate();
        res.json({ id: this.lastID, message: 'Overpass created' });
      }
    );
  });

  router.delete('/:id', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM overpasses WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Overpass not found' });
      db.run('DELETE FROM overpasses WHERE id = ?', [id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        recordAction('overpass_delete', { id, data: row });
        emitUpdate();
        res.json({ message: 'Overpass deleted' });
      });
    });
  });

  return router;
};
