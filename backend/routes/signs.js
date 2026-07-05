const express = require('express');
const { authenticate } = require('../middleware/auth');

const safeLines = (lines) => {
  if (!lines) return null;
  try {
    const arr = typeof lines === 'string' ? JSON.parse(lines) : lines;
    if (!Array.isArray(arr)) return null;
    const clean = arr
      .filter(l => l && typeof l.text === 'string')
      .map(l => ({ text: String(l.text).slice(0, 120), font_size: Number(l.font_size) || 1.0 }));
    return clean.length ? JSON.stringify(clean) : null;
  } catch { return null; }
};

module.exports = (db, io, { emitUpdate, recordAction }) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    db.all('SELECT * FROM signs ORDER BY id ASC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/', authenticate, (req, res) => {
    const { text, x, y, z, rotation_y, font_size, font_family, image_url, use_tv_filter, lines, filter_intensity } = req.body;
    if (x == null || y == null || z == null) {
      return res.status(400).json({ error: 'x, y, z are required' });
    }
    if (!text && !image_url) {
      return res.status(400).json({ error: 'text or image_url is required' });
    }
    const safeText = text ? String(text).slice(0, 120) : '';
    const safeImageUrl = image_url && !String(image_url).match(/^(javascript:|data:)/i)
      ? String(image_url).slice(0, 500) : null;
    const safeFont = font_family ? String(font_family).slice(0, 100) : 'monospace';
    const linesJson = safeLines(lines);
    const safeIntensity = Math.min(2, Math.max(0, Number(filter_intensity ?? 1.0) || 0));
    db.run(
      `INSERT INTO signs (text, x, y, z, rotation_y, font_size, font_family, image_url, use_tv_filter, lines, filter_intensity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [safeText, x, y, z, rotation_y ?? 0, font_size ?? 1.0, safeFont, safeImageUrl, use_tv_filter ? 1 : 0, linesJson, safeIntensity],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const id = this.lastID;
        db.get('SELECT * FROM signs WHERE id = ?', [id], (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          recordAction('sign_create', { id });
          emitUpdate();
          res.json(row);
        });
      }
    );
  });

  router.patch('/:id', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM signs WHERE id = ?', [id], (err, old) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!old) return res.status(404).json({ error: 'Sign not found' });
      const { text, x, y, z, rotation_y, font_size, font_family, image_url, use_tv_filter, lines, filter_intensity } = req.body;
      const safeText = text !== undefined ? String(text).slice(0, 120) : old.text;
      const safeImageUrl = image_url !== undefined
        ? (image_url && !String(image_url).match(/^(javascript:|data:)/i) ? String(image_url).slice(0, 500) : null)
        : old.image_url;
      const safeFont = font_family !== undefined ? String(font_family).slice(0, 100) : (old.font_family ?? 'monospace');
      const linesJson = lines !== undefined ? safeLines(lines) : old.lines;
      const safeIntensity = filter_intensity !== undefined
        ? Math.min(2, Math.max(0, Number(filter_intensity) || 0))
        : (old.filter_intensity ?? 1.0);
      db.run(
        `UPDATE signs SET text=?, x=?, y=?, z=?, rotation_y=?, font_size=?, font_family=?, image_url=?, use_tv_filter=?, lines=?, filter_intensity=? WHERE id=?`,
        [safeText, x ?? old.x, y ?? old.y, z ?? old.z, rotation_y ?? old.rotation_y, font_size ?? old.font_size, safeFont, safeImageUrl, use_tv_filter !== undefined ? (use_tv_filter ? 1 : 0) : old.use_tv_filter, linesJson, safeIntensity, id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          recordAction('sign_update', { id, old_data: old });
          emitUpdate();
          res.json({ message: 'Sign updated' });
        }
      );
    });
  });

  router.delete('/:id', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM signs WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Sign not found' });
      db.run('DELETE FROM signs WHERE id = ?', [id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        recordAction('sign_delete', { id, data: row });
        emitUpdate();
        res.json({ message: 'Sign deleted' });
      });
    });
  });

  return router;
};
