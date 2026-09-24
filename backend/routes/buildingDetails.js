const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { LIMITS, rejectFormat, uploadErrors } = require('../middleware/uploadConstraints');
const gmNotes = require('../buildings/gmNotes');

// The parts of a building's info window that are not plain location fields: its photo,
// which everyone sees, and the GM's notes, which only the GM does.
//
// Both are main-admin only to change, and the notes are main-admin only to read. "Main
// admin" rather than anyone past `authenticate`: a player the GM has granted editing
// rights holds a temporary token that passes that check too, and notes written about
// the players are exactly what they must not be able to read.

/**
 * What a building photo may be. Stills only, and only what an `<img>` will show.
 *
 * Narrower than a battle map on purpose. There is no call for a looping photo, and SVG,
 * which the battle-map list keeps for floor plans, is a drawing rather than a photograph.
 */
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

/** Refuse anyone but the main admin, the way battle maps do. */
const mainAdminOnly = (req, res, next) => {
  if (req.user && req.user.isTemporary) {
    return res.status(403).json({ error: 'Only the main admin can do that' });
  }
  next();
};

module.exports = (db, io, { emitUpdate }) => {
  const router = express.Router({ mergeParams: true });

  const photosDir = path.join(__dirname, '../uploads/building_photos');
  if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

  // In memory: a photo is capped at a size that is no burden to hold, and hashing a buffer
  // is simpler than the stream-to-disk dance battle maps need for their 250MB videos.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.building_photo },
    // Recorded so a refusal for size can name the file - multer aborts before any handler.
    fileFilter: (req, file, cb) => { req.uploadFilename = file.originalname; cb(null, true); },
  });
  const photoUploadErrors = uploadErrors({ allowed: [...PHOTO_EXT], maxBytes: LIMITS.building_photo });

  /** The building, or a 404 already sent. */
  const withLocation = (req, res, next) => {
    db.get('SELECT id FROM locations WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Not found' });
      next();
    });
  };

  /**
   * Put a photo on a building.
   *
   * Stored under its content hash, so the same picture on two buildings is one file.
   * Everyone can see it once it is set - it is a picture of the place, like the
   * description - and it arrives with the building in the ordinary location list.
   */
  router.post('/photo', authenticate, mainAdminOnly, upload.single('photo'), photoUploadErrors, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No photo was sent' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    // The extension decides how it is served back: /uploads is public, and the type
    // follows the name on disk.
    if (!PHOTO_EXT.has(ext)) {
      return rejectFormat(res, { file: req.file, allowed: [...PHOTO_EXT], maxBytes: LIMITS.building_photo });
    }

    withLocation(req, res, () => {
      const filename = crypto.createHash('sha256').update(req.file.buffer).digest('hex') + ext;
      const filepath = path.join(photosDir, filename);
      try {
        if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, req.file.buffer);
      } catch (e) {
        return res.status(500).json({ error: 'Could not store the photo.' });
      }

      const photoUrl = `/uploads/building_photos/${filename}`;
      db.run('UPDATE locations SET photo_url = ? WHERE id = ?', [photoUrl, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        emitUpdate();
        res.json({ id: Number(req.params.id), photo_url: photoUrl });
      });
    });
  });

  /**
   * Take the photo off a building. The file stays.
   *
   * A saved map may still point at it, and loading that map later should bring the photo
   * back with the building rather than a broken image. Photos are small and deduplicated,
   * so keeping them costs little.
   */
  router.delete('/photo', authenticate, mainAdminOnly, withLocation, (req, res) => {
    db.run('UPDATE locations SET photo_url = NULL WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      emitUpdate();
      res.json({ id: Number(req.params.id), photo_url: null });
    });
  });

  /** The GM's notes on a building. Main admin only - never part of the public list. */
  router.get('/gm-notes', authenticate, mainAdminOnly, withLocation, (req, res) => {
    gmNotes.get(db, req.params.id, (err, notes) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: Number(req.params.id), notes });
    });
  });

  /**
   * Replace the GM's notes. Blank clears them.
   *
   * Not broadcast: nobody but the GM holds a copy, and telling every client that a
   * building changed would only make them all refetch a list the notes are not in.
   */
  router.put('/gm-notes', authenticate, mainAdminOnly, express.json(), withLocation, (req, res) => {
    const notes = req.body && typeof req.body.notes === 'string' ? req.body.notes : null;
    if (notes === null) return res.status(400).json({ error: 'notes must be text' });
    if (notes.length > gmNotes.MAX_LENGTH) {
      return res.status(413).json({ error: `Notes are limited to ${gmNotes.MAX_LENGTH.toLocaleString()} characters.` });
    }
    gmNotes.set(db, req.params.id, notes, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: Number(req.params.id), notes: notes.trim() ? notes : '' });
    });
  });

  return router;
};

module.exports.PHOTO_EXT = PHOTO_EXT;
