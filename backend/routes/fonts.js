const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');

const ALLOWED_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);

module.exports = (db, io) => {
  const router = express.Router();
  const fontsDir = path.join(__dirname, '../uploads/fonts');
  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  });

  // GET — list uploaded fonts
  router.get('/', (req, res) => {
    fs.readdir(fontsDir, (err, files) => {
      if (err) return res.status(500).json({ error: err.message });
      const fonts = files
        .filter(f => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
        .map(f => ({ name: path.basename(f, path.extname(f)), file: f, url: `/uploads/fonts/${f}` }));
      res.json(fonts);
    });
  });

  // POST — upload a font file
  router.post('/', authenticate, upload.single('font'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'Invalid font format. Use ttf, otf, woff, or woff2.' });
    // Sanitise filename — alphanumeric, dashes, underscores only
    const baseName = path.basename(req.file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${baseName}${ext}`;
    const dest = path.join(fontsDir, fileName);
    fs.writeFile(dest, req.file.buffer, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ name: baseName, file: fileName, url: `/uploads/fonts/${fileName}` });
    });
  });

  // DELETE — remove a font file
  router.delete('/:file', authenticate, (req, res) => {
    const fileName = path.basename(req.params.file); // strip any path traversal
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'Invalid file' });
    const filePath = path.join(fontsDir, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Font not found' });
    fs.unlink(filePath, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Font deleted' });
    });
  });

  return router;
};
