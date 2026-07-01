const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');

module.exports = (db, io, { emitUpdate }) => {
  const router = express.Router({ mergeParams: true });

  const uploadsDir = path.join(__dirname, '../uploads/battle_maps');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Memory storage so we can hash before writing to disk.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  // List maps for a specific location.
  router.get('/', (req, res) => {
    db.all('SELECT * FROM battle_maps WHERE location_id = ? ORDER BY order_index ASC', [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // Shared helper: upsert a battle map record.
  function upsertMap(locationId, designation, imageUrl, res) {
    let orderIndex = 0;
    if (designation === 'Lobby') orderIndex = 0;
    else if (designation === 'Penthouse') orderIndex = 999;
    else if (designation.startsWith('Level ')) {
      const n = parseInt(designation.split(' ')[1], 10);
      orderIndex = isNaN(n) ? 1 : n;
    }

    db.get('SELECT id FROM battle_maps WHERE location_id = ? AND designation = ?', [locationId, designation], (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });

      if (existing) {
        db.run('UPDATE battle_maps SET image_url = ?, order_index = ? WHERE id = ?', [imageUrl, orderIndex, existing.id], (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          res.json({ message: 'Battle map updated', id: existing.id, imageUrl });
        });
      } else {
        db.run('INSERT INTO battle_maps (location_id, designation, image_url, order_index) VALUES (?, ?, ?, ?)', [locationId, designation, imageUrl, orderIndex], function(err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          emitUpdate();
          res.json({ message: 'Battle map created', id: this.lastID, imageUrl });
        });
      }
    });
  }

  // Upload a new image (deduplicates by content hash).
  router.post('/', authenticate, upload.single('image'), (req, res) => {
    if (req.user.isTemporary) return res.status(403).json({ error: 'Only main admin can manage battle maps' });

    const { designation } = req.body;
    if (!req.file || !designation) return res.status(400).json({ error: 'Image and designation are required' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const filename = hash + ext;
    const filepath = path.join(uploadsDir, filename);

    // Only write if this exact file isn't already on disk.
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, req.file.buffer);
    }

    const imageUrl = '/uploads/battle_maps/' + filename;
    upsertMap(req.params.id, designation, imageUrl, res);
  });

  // Assign an image that is already on the server to this location/designation.
  router.post('/use-existing', authenticate, express.json(), (req, res) => {
    if (req.user.isTemporary) return res.status(403).json({ error: 'Only main admin can manage battle maps' });

    const { designation, imageUrl } = req.body;
    if (!designation || !imageUrl) return res.status(400).json({ error: 'designation and imageUrl are required' });

    // Verify the image actually exists on disk before trusting the URL.
    const filename = path.basename(imageUrl);
    const filepath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Image not found on server' });

    upsertMap(req.params.id, designation, imageUrl, res);
  });

  router.delete('/:mapId', authenticate, (req, res) => {
    if (req.user.isTemporary) return res.status(403).json({ error: 'Only main admin can manage battle maps' });

    db.get('SELECT image_url FROM battle_maps WHERE id = ?', [req.params.mapId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Map not found' });

      // Only delete the file if no other battle_map record references it.
      db.get('SELECT COUNT(*) as cnt FROM battle_maps WHERE image_url = ? AND id != ?', [row.image_url, req.params.mapId], (err2, refRow) => {
        if (!err2 && refRow && refRow.cnt === 0) {
          const filePath = path.join(uploadsDir, path.basename(row.image_url));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        db.run('DELETE FROM battle_maps WHERE id = ?', [req.params.mapId], (err3) => {
          if (err3) return res.status(500).json({ error: err3.message });
          emitUpdate();
          res.json({ message: 'Battle map deleted' });
        });
      });
    });
  });

  // List all uploaded battle map image filenames (admin use)
  router.get('/images', authenticate, (req, res) => {
    const files = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))
      : [];
    res.json(files);
  });

  return router;
};
