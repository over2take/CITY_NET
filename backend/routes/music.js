const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');

const ALLOWED_MIME = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
  'audio/flac', 'audio/x-flac', 'audio/m4a', 'audio/x-m4a',
  'video/mp4',
]);

module.exports = (db, io) => {
  const router = express.Router();

  const uploadsDir = path.join(__dirname, '../uploads/music');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // GET /api/music/library — full tree
  router.get('/library', (req, res) => {
    db.all('SELECT * FROM music_items ORDER BY sort_order ASC, name ASC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // POST /api/music/folder — create folder (admin only)
  router.post('/folder', authenticate, (req, res) => {
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    db.run(
      'INSERT INTO music_items (type, name, parent_id) VALUES (?, ?, ?)',
      ['folder', name, parent_id ?? null],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('musicLibraryUpdated');
        res.json({ id: this.lastID, type: 'folder', name, parent_id: parent_id ?? null });
      }
    );
  });

  // DELETE /api/music/folder/:id — delete folder + all children (admin only)
  router.delete('/folder/:id', authenticate, (req, res) => {
    const id = parseInt(req.params.id, 10);

    // Collect all descendant IDs, then delete files from disk, then delete rows
    const collectIds = (rootId, cb) => {
      db.all('SELECT id, type, path FROM music_items WHERE parent_id = ?', [rootId], (err, children) => {
        if (err) return cb(err);
        let ids = [rootId];
        let pending = children.length;
        if (pending === 0) return cb(null, ids);
        children.forEach((child) => {
          ids.push(child.id);
          collectIds(child.id, (err2, childIds) => {
            if (err2) return cb(err2);
            ids = ids.concat(childIds);
            pending--;
            if (pending === 0) cb(null, ids);
          });
        });
      });
    };

    db.get('SELECT id, type, path FROM music_items WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'not found' });

      collectIds(id, (err2, allIds) => {
        if (err2) return res.status(500).json({ error: err2.message });

        // Delete files from disk
        db.all(`SELECT path FROM music_items WHERE id IN (${allIds.map(() => '?').join(',')}) AND type = 'file'`, allIds, (err3, files) => {
          if (!err3) {
            files.forEach((f) => {
              const abs = path.join(uploadsDir, f.path);
              if (fs.existsSync(abs)) fs.unlinkSync(abs);
            });
          }
          // SQLite CASCADE handles child rows, but delete top-level to trigger it
          db.run('DELETE FROM music_items WHERE id = ?', [id], (err4) => {
            if (err4) return res.status(500).json({ error: err4.message });
            io.emit('musicLibraryUpdated');
            res.json({ deleted: allIds.length });
          });
        });
      });
    });
  });

  // POST /api/music/upload — upload audio file (admin only)
  router.post('/upload', authenticate, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'unsupported file type' });
    }

    const parent_id = req.body.parent_id ? parseInt(req.body.parent_id, 10) : null;
    const name = req.body.name || req.file.originalname;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const dest = path.join(uploadsDir, filename);

    fs.writeFile(dest, req.file.buffer, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        'INSERT INTO music_items (type, name, path, parent_id) VALUES (?, ?, ?, ?)',
        ['file', name, filename, parent_id],
        function (err2) {
          if (err2) {
            fs.unlink(dest, () => {});
            return res.status(500).json({ error: err2.message });
          }
          io.emit('musicLibraryUpdated');
          res.json({ id: this.lastID, type: 'file', name, path: filename, parent_id });
        }
      );
    });
  });

  // DELETE /api/music/file/:id — delete file (admin only)
  router.delete('/file/:id', authenticate, (req, res) => {
    db.get('SELECT * FROM music_items WHERE id = ? AND type = ?', [req.params.id, 'file'], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'not found' });

      db.run('DELETE FROM music_items WHERE id = ?', [row.id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (row.path) {
          const abs = path.join(uploadsDir, row.path);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
        io.emit('musicLibraryUpdated');
        res.json({ deleted: 1 });
      });
    });
  });

  // PATCH /api/music/item/:id/move — move item to new parent (admin only)
  router.patch('/item/:id/move', authenticate, (req, res) => {
    const { parent_id } = req.body;
    db.run(
      'UPDATE music_items SET parent_id = ? WHERE id = ?',
      [parent_id ?? null, req.params.id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'not found' });
        io.emit('musicLibraryUpdated');
        res.json({ updated: 1 });
      }
    );
  });

  // PATCH /api/music/item/:id — rename item (admin only)
  router.patch('/item/:id', authenticate, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    db.run(
      'UPDATE music_items SET name = ? WHERE id = ?',
      [name, req.params.id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'not found' });
        io.emit('musicLibraryUpdated');
        res.json({ updated: 1 });
      }
    );
  });

  return router;
};
