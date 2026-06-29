const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');

module.exports = (db, io, { emitUpdate }) => {
  const router = express.Router({ mergeParams: true });

  const uploadsDir = path.join(__dirname, '../uploads/battle_maps');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
    }
  });
  const upload = multer({ storage });

  router.get('/', (req, res) => {
    db.all('SELECT * FROM battle_maps WHERE location_id = ? ORDER BY order_index ASC', [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.post('/', authenticate, upload.single('image'), (req, res) => {
    if (req.user.isTemporary) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Only main admin can manage battle maps' });
    }

    const { designation } = req.body;
    if (!req.file || !designation) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Image and designation are required' });
    }

    const locationId = req.params.id;
    const imageUrl = '/uploads/battle_maps/' + req.file.filename;

    let orderIndex = 0;
    if (designation === 'Lobby') orderIndex = 0;
    else if (designation === 'Penthouse') orderIndex = 999;
    else if (designation.startsWith('Level ')) {
      const levelNum = parseInt(designation.split(' ')[1], 10);
      orderIndex = isNaN(levelNum) ? 1 : levelNum;
    }

    db.get('SELECT id, image_url FROM battle_maps WHERE location_id = ? AND designation = ?', [locationId, designation], (err, existing) => {
      if (err) { fs.unlinkSync(req.file.path); return res.status(500).json({ error: err.message }); }

      if (existing) {
        const oldPath = path.join(__dirname, '../..', existing.image_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
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
  });

  router.delete('/:mapId', authenticate, (req, res) => {
    if (req.user.isTemporary) {
      return res.status(403).json({ error: 'Only main admin can manage battle maps' });
    }
    db.get('SELECT image_url FROM battle_maps WHERE id = ?', [req.params.mapId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Map not found' });

      const filePath = path.join(__dirname, '../..', row.image_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      db.run('DELETE FROM battle_maps WHERE id = ?', [req.params.mapId], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        emitUpdate();
        res.json({ message: 'Battle map deleted' });
      });
    });
  });

  return router;
};
