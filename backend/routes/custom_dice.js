const express = require('express');
const { authenticate } = require('../middleware/auth');

const MAX_SIDES = 999;
const MAX_NAME_LEN = 40;
const MAX_FACE_LEN = 40;

// Names owned by the built-in dice list in the roller UI.
const STANDARD_NAMES = new Set(['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);

/** Shape a DB row into the client-facing die (faces parsed from JSON). */
const toDie = (row) => ({
  id: row.id,
  name: row.name,
  sides: row.sides,
  faces: JSON.parse(row.faces),
});

/**
 * Validate an incoming die. Returns { error } on failure, or { name, sides,
 * facesJson } ready for persistence. Uniqueness is enforced by the DB, not here.
 */
const validate = (body) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'name is required' };
  if (name.length > MAX_NAME_LEN) return { error: `name must be ${MAX_NAME_LEN} characters or fewer` };
  if (STANDARD_NAMES.has(name.toLowerCase())) return { error: 'name is reserved by a standard die' };

  const sides = parseInt(body.sides, 10);
  if (isNaN(sides) || sides < 2) return { error: 'sides must be at least 2' };
  if (sides > MAX_SIDES) return { error: `sides must be ${MAX_SIDES} or fewer` };

  if (!Array.isArray(body.faces)) return { error: 'faces must be an array' };
  if (body.faces.length !== sides) return { error: 'faces length must equal sides' };

  const faces = [];
  for (const f of body.faces) {
    const value = f && typeof f.value === 'string' ? f.value.trim() : '';
    if (!value) return { error: 'every face needs a value' };
    faces.push({ value: value.slice(0, MAX_FACE_LEN) });
  }

  return { name, sides, facesJson: JSON.stringify(faces) };
};

module.exports = (db, io, { recordAction }) => {
  const router = express.Router();

  /**
   * Push the full list to every connected client. Custom dice are small and
   * change rarely, so sending the whole set avoids any merge logic clientside.
   */
  const broadcast = () => {
    db.all('SELECT * FROM custom_dice ORDER BY id ASC', [], (err, rows) => {
      if (err) return;
      io.emit('customDiceUpdated', rows.map(toDie));
    });
  };

  router.get('/', (req, res) => {
    db.all('SELECT * FROM custom_dice ORDER BY id ASC', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map(toDie));
    });
  });

  router.post('/', authenticate, (req, res) => {
    const v = validate(req.body);
    if (v.error) return res.status(400).json({ error: v.error });

    db.run(
      'INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)',
      [v.name, v.sides, v.facesJson],
      function (err) {
        if (err) {
          if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: 'a die with that name already exists' });
          return res.status(500).json({ error: err.message });
        }
        const id = this.lastID;
        db.get('SELECT * FROM custom_dice WHERE id = ?', [id], (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          recordAction('custom_die_create', { id });
          broadcast();
          res.json(toDie(row));
        });
      }
    );
  });

  router.put('/:id', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM custom_dice WHERE id = ?', [id], (err, old) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!old) return res.status(404).json({ error: 'Die not found' });

      const v = validate(req.body);
      if (v.error) return res.status(400).json({ error: v.error });

      db.run(
        'UPDATE custom_dice SET name = ?, sides = ?, faces = ? WHERE id = ?',
        [v.name, v.sides, v.facesJson, id],
        (err2) => {
          if (err2) {
            if (/UNIQUE/i.test(err2.message)) return res.status(409).json({ error: 'a die with that name already exists' });
            return res.status(500).json({ error: err2.message });
          }
          recordAction('custom_die_update', { id, old_data: old });
          broadcast();
          res.json({ message: 'Die updated' });
        }
      );
    });
  });

  router.delete('/:id', authenticate, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM custom_dice WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Die not found' });
      db.run('DELETE FROM custom_dice WHERE id = ?', [id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        recordAction('custom_die_delete', { id, data: row });
        broadcast();
        res.json({ message: 'Die deleted' });
      });
    });
  });

  return router;
};
