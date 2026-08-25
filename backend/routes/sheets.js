const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { TEMPLATES, DEFAULT_SYSTEM, isValidSystem, getLinkedFields, applyDerived, cwnEffectiveAc } = require('../sheets/templates');
const sheetImporters = require('../sheets/importers');
const pdfTemplate = require('../sheets/pdfTemplate');
const companionFetch = require('../sheets/companionFetch');
const { rateLimit } = require('../middleware/rateLimit');
const { mutateSheet, patchSheet } = require('../sheets/mutate');
const sheetAttack = require('../sheets/attack');
const headshots = require('../sheets/headshots');
const identity = require('../sheets/identity');

// Admin-facing character sheet routes. Player self-service (open/edit own
// sheet, quick-sheet lookups) goes through socket events, matching how the
// bank works - players in non-secure mode have no REST token.
//
// authenticate alone is not enough here: secure-mode player tokens also pass
// it. Full-sheet access is admin (or elevated temporary admin) only.
const requireAdmin = (req, res, next) => {
  const u = req.user;
  const isAdmin = u && (u.role === 'admin' || u.isTemporary);
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
};

/**
 * The ceiling on Companion imports, per caller.
 *
 * Ten in ten minutes. Importing your own character is something you do once, and a couple
 * more if you mistyped the code — so this is generous to a person and useless to a script
 * walking codes. Module scope rather than per-router: the counters have to outlive any
 * one request, and the router is built once anyway.
 */
const COMPANION_LIMIT = 10;
const companionLimit = rateLimit({ limit: COMPANION_LIMIT, windowMs: 10 * 60 * 1000 });

module.exports = (db, io) => {
  const router = express.Router();

  const portraitsDir = path.join(__dirname, '../uploads/portraits');
  if (!fs.existsSync(portraitsDir)) fs.mkdirSync(portraitsDir, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

  const getGameSystem = (cb) => {
    db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (err, row) => {
      cb(err, row ? row.value : DEFAULT_SYSTEM);
    });
  };

  // --- Game system setting ---

  // Public: every client needs to know the active system to pick a template
  router.get('/system', (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ system, systems: Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name })) });
    });
  });

  router.put('/system', authenticate, requireAdmin, (req, res) => {
    const { system } = req.body;
    if (!isValidSystem(system)) return res.status(400).json({ error: 'Unknown game system' });
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [system],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('gameSystemChanged', { system });
        res.json({ message: 'Game system updated', system });
      }
    );
  });

  // --- Admin sheet access ---

  // List all sheets (players and NPCs, every system) for the admin panel
  router.get('/', authenticate, requireAdmin, (req, res) => {
    db.all(
      `SELECT id, username, system, is_npc, npc_label, folder, portrait_url, updated_at
       FROM character_sheets ORDER BY is_npc, username`,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      }
    );
  });

  // Player's own sheet — used by non-admin players to fetch stats (e.g. SR6 initiative roll).
  router.get('/own', authenticate, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
        [req.user.username, system],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (!row) return res.status(404).json({ error: 'No sheet found' });
          res.json(JSON.parse(row.data || '{}'));
        }
      );
    });
  });

  // Full sheet for one player on the active system (admin view/edit).
  // Linked fields (token HP, bank cash) are overlaid at read time, same as
  // the player's own socket fetch.
  router.get('/user/:username', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT * FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
        [req.params.username, system],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (!row) return res.status(404).json({ error: 'No sheet for this player on the active system' });
          const data = JSON.parse(row.data || '{}');
          const linked = getLinkedFields(system);
          const done = () => res.json({ ...row, data });
          const overlayCash = () => {
            if (!Object.values(linked).includes('bank_balance')) return done();
            db.get(`SELECT balance FROM player_banks WHERE username = ?`, [req.params.username], (e3, bank) => {
              Object.entries(linked).forEach(([fieldId, source]) => {
                if (source === 'bank_balance') data[fieldId] = bank ? bank.balance : 0;
              });
              done();
            });
          };
          if (!Object.values(linked).some(s => s === 'token_hp' || s === 'token_hp_max' || s === 'token_ac')) return overlayCash();
          db.get(
            `SELECT hp_current, hp_max, melee_ac FROM locations WHERE shape = 'rhombus' AND owner = ?
             ORDER BY (battle_map_id IS NULL) DESC LIMIT 1`,
            [req.params.username],
            (e2, hpRow) => {
              Object.entries(linked).forEach(([fieldId, source]) => {
                if (source === 'token_hp') data[fieldId] = hpRow ? hpRow.hp_current : null;
                if (source === 'token_hp_max') data[fieldId] = hpRow ? hpRow.hp_max : null;
                if (source === 'token_ac') data[fieldId] = hpRow ? (hpRow.melee_ac ?? 10) : null;
              });
              overlayCash();
            }
          );
        }
      );
    });
  });

  // Admin per-field patch of any player's active-system sheet
  router.put('/user/:username', authenticate, requireAdmin, (req, res) => {
    const { fields } = req.body; // { fieldId: value, ... }
    if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'fields object required' });
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
        [req.params.username, system],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (!row) return res.status(404).json({ error: 'No sheet for this player on the active system' });
          // Linked fields (token HP, cash) live in other systems and are
          // edited through their own windows - never stored in sheet JSON.
          // token_ac is writable: it routes to the player's token.
          const linked = getLinkedFields(system);
          const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => !linked[k]));
          const acEntry = Object.entries(fields).find(([k]) => linked[k] === 'token_ac');
          const routeAc = (done) => {
            if (!acEntry) return done();
            const ac = Number(acEntry[1]);
            if (!Number.isFinite(ac) || ac < 0 || ac > 99) return done();
            db.run(
              `UPDATE locations SET melee_ac = ?, ranged_ac = ? WHERE shape = 'rhombus' AND owner = ?`,
              [ac, ac, req.params.username],
              () => { io.emit('dataUpdated', { isRhombusOnly: true }); done(); }
            );
          };
          // Through the queue. This is the GM editing a player's sheet, which is the
          // pairing most likely to collide with that player editing it themselves.
          mutateSheet(
            db,
            row.id,
            (current) => {
              const next = { ...current, ...patch };
              Object.keys(patch).forEach((f) => applyDerived(system, next, f));
              return next;
            },
            (err3, data) => {
              if (err3) return res.status(500).json({ error: err3.message });
              // Armor fields drive the token AC when set (overrides a direct
              // ac patch - armor is authoritative while equipped).
              const effAc = system === 'cities_without_number' ? cwnEffectiveAc(data) : null;
              const pushAc = effAc !== null
                ? (done) => db.run(
                    `UPDATE locations SET melee_ac = ?, ranged_ac = ? WHERE shape = 'rhombus' AND owner = ?`,
                    [effAc, effAc, req.params.username],
                    () => { io.emit('dataUpdated', { isRhombusOnly: true }); done(); }
                  )
                : routeAc;
              // Sheet name/description are the source of truth for the
              // player's token label - mirror them onto their rhombus
              if (Object.keys(patch).some((k) => k === identity.nameField(system) || k === 'description')) {
                identity.syncToken(db, system, req.params.username, (changed) => {
                  if (changed) io.emit('dataUpdated', { isRhombusOnly: true });
                });
              }
              pushAc(() => {
                io.emit('sheetUpdated', { username: req.params.username, system });
                res.json({ message: 'Sheet updated' });
              });
            }
          );
        }
      );
    });
  });

  // --- Sheet import ---

  // The blank form the upload above expects.
  //
  // Without it, "upload a fillable PDF" meant finding one whose field names happened to
  // match our aliases. This is that PDF, generated from a layout the round-trip test walks
  // through the importer — so what comes back out is what went in.
  //
  // Unauthenticated like the preview: it is a blank form with nobody's data in it.
  router.get('/import/template.pdf', (req, res) => {
    getGameSystem(async (err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!pdfTemplate.hasTemplate(system)) {
        return res.status(400).json({ error: `No import form for ${system} yet` });
      }
      try {
        const pdf = await pdfTemplate.buildTemplate(system);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="citynet-${system}-import.pdf"`);
        res.send(pdf);
      } catch (e) {
        res.status(500).json({ error: 'Could not build the form' });
      }
    });
  });

  // Stage-1+2 preview: extract candidates from a fillable PDF, JSON paste, or
  // raw text, and map them onto the active system's fields. No auth needed -
  // it only transforms what the caller sends; applying is where identity is
  // enforced (socket for players, admin PUTs for admins).
  router.post('/import/preview', upload.single('pdf'), (req, res) => {
    getGameSystem(async (err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      const importer = sheetImporters.getImporter(system);
      if (!importer) return res.status(400).json({ error: `No importer for ${system} yet` });
      try {
        let raw = null;
        let source = null;
        if (req.file) {
          raw = await sheetImporters.extractPdfFields(req.file.buffer);
          source = 'pdf-form';
          if (!raw) return res.status(422).json({ error: 'PDF has no fillable form fields. Copy the character text and paste it instead.' });
        } else if (req.body && req.body.json) {
          raw = typeof req.body.json === 'string' ? JSON.parse(req.body.json) : req.body.json;
          source = 'json';
        } else if (req.body && req.body.text) {
          raw = importer.parseText(String(req.body.text));
          source = 'text';
        } else {
          return res.status(400).json({ error: 'Send a PDF file, json, or text' });
        }
        const { mapped, unmapped, skipped } = importer.mapFields(raw);
        res.json({ system, source, mapped, unmapped, skipped });
      } catch (e) {
        res.status(422).json({ error: `Could not read input: ${e.message}` });
      }
    });
  });

  // A Cyberpunk RED Companion character, by its six-digit code.
  //
  // A third source for the same preview the PDF and the paste box feed, so nothing is
  // written here either — the player looks at what came back and then applies it.
  //
  // Server-side rather than from the browser: it avoids CORS, and it keeps the player's
  // address out of a request to a third party they did not choose to contact. One code is
  // one pair of requests, and a bad code is refused before any of it leaves the building.
  //
  // Rate limited, and anonymous on purpose. This is the only open route that spends our
  // outbound requests on a caller's say-so, which makes it two things without a limit: a
  // way to point our address at someone else's service as fast as you can ask, and an
  // oracle for walking a six-character keyspace to read back other people's characters.
  // Requiring a token would close both and take the feature away from open installs,
  // where players have none — so the ceiling is on the rate instead of on who may knock.
  router.post('/import/companion', companionLimit, (req, res) => {
    getGameSystem(async (err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      // The Companion is a Cyberpunk tool. Offering it under another system would be a
      // button that could only ever fail.
      if (system !== 'cyberpunk_red') {
        return res.status(400).json({ error: 'Companion codes are Cyberpunk RED only' });
      }
      const importer = sheetImporters.getImporter(system);
      if (!importer) return res.status(400).json({ error: `No importer for ${system} yet` });

      const result = await companionFetch.fetchCharacter(req.body && req.body.code);
      if (result.error) {
        // 400 for a code the player can fix, 502 for their service failing us.
        const theirFault = ['TIMEOUT', 'UNREACHABLE', 'SERVICE_ERROR', 'BAD_RESPONSE'].includes(result.error);
        return res.status(theirFault ? 502 : 400).json({
          error: companionFetch.REASONS[result.error] || 'Could not read that code',
          reason: result.error,
        });
      }

      const { mapped, unmapped, skipped } = importer.mapFields(result.candidates);
      res.json({
        system,
        source: 'companion',
        mapped,
        unmapped,
        skipped,
        // What the export could not give up — vehicle stats, weapon damage, an older
        // format's stats. Shown beside the preview so nobody reads a gap as a failure.
        missing: result.missing,
        // Rows rather than fields, so they travel beside `mapped` rather than in it —
        // `mapFields` maps names to sheet fields and cyberware is a list under one.
        cyberware: result.cyberware || [],
        exportVersion: result.version,
      });
    });
  });

  // --- NPC library (admin-only) ---

  // List all NPC sheets for the current game system, grouped by folder
  router.get('/npcs', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all(
        `SELECT id, npc_label, folder, portrait_url, updated_at
         FROM character_sheets WHERE is_npc = 1 AND system = ?
         ORDER BY folder, npc_label`,
        [system],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(rows);
        }
      );
    });
  });

  // Get full NPC sheet data (for editing). Like player sheets, HP is a
  // linked field: when the sheet is attached to a token, the token's HP is
  // overlaid at read time (first link wins if the sheet is on several tokens).
  router.get('/npcs/:id', authenticate, requireAdmin, (req, res) => {
    db.get(
      `SELECT * FROM character_sheets WHERE id = ? AND is_npc = 1`,
      [req.params.id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'NPC not found' });
        const data = JSON.parse(row.data || '{}');
        const linked = getLinkedFields(row.system);
        const wantsHp = Object.values(linked).some(s => s === 'token_hp' || s === 'token_hp_max' || s === 'token_ac');
        if (!wantsHp) return res.json({ ...row, data });
        db.get(
          `SELECT loc.hp_current, loc.hp_max, loc.melee_ac FROM npc_sheet_links l
           JOIN locations loc ON loc.id = l.location_id
           WHERE l.sheet_id = ? LIMIT 1`,
          [req.params.id],
          (err2, hpRow) => {
            if (!err2 && hpRow) {
              Object.entries(linked).forEach(([fieldId, source]) => {
                if (source === 'token_hp') data[fieldId] = hpRow.hp_current;
                if (source === 'token_hp_max') data[fieldId] = hpRow.hp_max;
                if (source === 'token_ac') data[fieldId] = hpRow.melee_ac ?? 10;
              });
            }
            res.json({ ...row, data });
          }
        );
      }
    );
  });

  // Create a new NPC sheet
  router.post('/npcs', authenticate, requireAdmin, (req, res) => {
    const { npc_label, folder, data } = req.body;
    if (!npc_label) return res.status(400).json({ error: 'npc_label required' });
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        `INSERT INTO character_sheets (username, system, data, is_npc, npc_label, folder)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [req.user.username, system, JSON.stringify(data || {}), npc_label, folder || null],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ id: this.lastID, npc_label, folder: folder || null, system });
        }
      );
    });
  });

  // Patch NPC sheet data / metadata
  router.put('/npcs/:id', authenticate, requireAdmin, (req, res) => {
    db.get(`SELECT id, data, system FROM character_sheets WHERE id = ? AND is_npc = 1`, [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'NPC not found' });
      const { fields, npc_label, folder } = req.body;
      // Linked fields (token HP) live on the location - never store them in
      // the sheet's JSON, same rule as player sheets. token_ac is writable:
      // it routes to the linked token when the sheet is attached to one.
      let cleanFields = fields;
      let acValue;
      if (fields) {
        const linked = getLinkedFields(row.system);
        cleanFields = Object.fromEntries(Object.entries(fields).filter(([k]) => !linked[k]));
        const acEntry = Object.entries(fields).find(([k]) => linked[k] === 'token_ac');
        if (acEntry) acValue = Number(acEntry[1]);
      }
      const routeAc = (done) => {
        if (!Number.isFinite(acValue) || acValue < 0 || acValue > 99) return done();
        db.run(
          `UPDATE locations SET melee_ac = ?, ranged_ac = ?
           WHERE id = (SELECT location_id FROM npc_sheet_links WHERE sheet_id = ? LIMIT 1)`,
          [acValue, acValue, req.params.id],
          function () { if (this && this.changes > 0) io.emit('dataUpdated', { isRhombusOnly: true }); done(); }
        );
      };
      let data = row.data;
      let mergedData = null;
      if (cleanFields) {
        const merged = { ...JSON.parse(row.data || '{}'), ...cleanFields };
        Object.keys(cleanFields).forEach((f) => applyDerived(row.system, merged, f));
        data = JSON.stringify(merged);
        mergedData = merged;
      }
      // Armor fields drive the linked token's AC when set
      if (mergedData && row.system === 'cities_without_number') {
        const effAc = cwnEffectiveAc(mergedData);
        if (effAc !== null) acValue = effAc;
      }
      const sets = ['data = ?', 'updated_at = CURRENT_TIMESTAMP'];
      const params = [data];
      if (npc_label !== undefined) { sets.push('npc_label = ?'); params.push(npc_label); }
      if (folder !== undefined) { sets.push('folder = ?'); params.push(folder || null); }
      params.push(req.params.id);
      db.run(`UPDATE character_sheets SET ${sets.join(', ')} WHERE id = ?`, params, (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        // Open token info windows refetch link data (name, description,
        // portrait shadow) when the sheet behind a linked token changes
        db.get(`SELECT location_id FROM npc_sheet_links WHERE sheet_id = ? LIMIT 1`, [req.params.id], (e3, link) => {
          if (!e3 && link) {
            io.emit('npcLinkChanged', { location_id: link.location_id, sheet_id: Number(req.params.id) });
            // Mirror name/description back to the linked token so the map
            // label and info panel stay in sync with the sheet.
            if (cleanFields) {
              const locCols = [];
              const locVals = [];
              if ('name' in cleanFields) { locCols.push('name = ?'); locVals.push(cleanFields.name); }
              if ('description' in cleanFields) { locCols.push('description = ?'); locVals.push(cleanFields.description); }
              if (locCols.length > 0) {
                locVals.push(link.location_id);
                db.run(`UPDATE locations SET ${locCols.join(', ')} WHERE id = ?`, locVals,
                  () => io.emit('dataUpdated', { isRhombusOnly: true }));
              }
            }
          }
        });
        routeAc(() => res.json({ message: 'NPC updated' }));
      });
    });
  });

  // Delete NPC sheet (cascades to npc_sheet_links)
  router.delete('/npcs/:id', authenticate, requireAdmin, (req, res) => {
    db.run(`DELETE FROM character_sheets WHERE id = ? AND is_npc = 1`, [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'NPC not found' });
      res.json({ message: 'NPC deleted' });
    });
  });

  // Public: name, description + portrait for enemy/friendly tokens so players
  // see who it is without exposing the full sheet (stats, etc). Admin can
  // still build mystery manually by leaving a token unlinked or unnamed.
  router.get('/npcs/link-public/:location_id', (req, res) => {
    db.get(
      `SELECT cs.portrait_url, json_extract(cs.data, '$.name') AS sheet_name,
              json_extract(cs.data, '$.description') AS sheet_description,
              json_extract(cs.data, '$.portrait_shadow_filter') AS portrait_shadow_filter
       FROM npc_sheet_links l
       JOIN character_sheets cs ON cs.id = l.sheet_id
       JOIN locations loc ON loc.id = l.location_id
       WHERE l.location_id = ? AND loc.shape IN ('friendly_rhombus', 'enemy_rhombus')`,
      [req.params.location_id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
      }
    );
  });

  // Public: the SR6 Stun track for the sheet backing a token (player sheet
  // by owner, or the linked NPC sheet). Drives the STUN bar in the health
  // review window. Two numbers only - no other sheet data leaks.
  router.get('/stun/:location_id', (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      if (system !== 'shadowrun_6e') return res.json({});
      db.get(`SELECT id, shape, owner FROM locations WHERE id = ?`, [req.params.location_id], (err2, loc) => {
        if (err2 || !loc) return res.json({});
        const send = (row) => {
          if (!row) return res.json({});
          let data;
          try { data = JSON.parse(row.data || '{}'); } catch { return res.json({}); }
          res.json({
            stun_current: Number(data.stun_current) || 0,
            stun_monitor: Number(data.stun_monitor) || 0,
          });
        };
        if (loc.shape === 'rhombus' && loc.owner) {
          db.get(`SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
            [loc.owner, system], (e3, row) => send(e3 ? null : row));
        } else {
          db.get(`SELECT cs.data FROM npc_sheet_links l JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ?`,
            [loc.id], (e3, row) => send(e3 ? null : row));
        }
      });
    });
  });

  // Which NPC sheet (if any) is linked to a token - drives the token menu's
  // GENERATE_SHEET vs OPEN_SHEET button
  router.get('/npcs/link/:location_id', authenticate, requireAdmin, (req, res) => {
    db.get(
      `SELECT cs.id AS sheet_id, cs.system, cs.npc_label, cs.portrait_url,
              json_extract(cs.data, '$.name') AS sheet_name,
              json_extract(cs.data, '$.description') AS sheet_description,
              json_extract(cs.data, '$.portrait_shadow_filter') AS portrait_shadow_filter
       FROM npc_sheet_links l
       JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ?`,
      [req.params.location_id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { sheet_id: null });
      }
    );
  });

  // Attach NPC sheet to a token (location). Under CP:R the sheet also stamps
  // the token's melee DV (6 + DEX + Evasion) - a starting value the GM can
  // override any time via EDIT_DV.
  router.post('/npcs/:id/link', authenticate, requireAdmin, (req, res) => {
    const { location_id } = req.body;
    if (!location_id) return res.status(400).json({ error: 'location_id required' });
    db.get(`SELECT id, system, data FROM character_sheets WHERE id = ? AND is_npc = 1`, [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'NPC not found' });
      db.run(
        `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)
         ON CONFLICT(location_id) DO UPDATE SET sheet_id = excluded.sheet_id`,
        [location_id, req.params.id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          const finish = () => {
            io.emit('npcLinkChanged', { location_id, sheet_id: Number(req.params.id) });
            res.json({ message: 'Linked' });
          };
          if (row.system !== 'cyberpunk_red') return finish();
          let data;
          try { data = JSON.parse(row.data || '{}'); } catch { return finish(); }
          db.get(`SELECT value FROM global_settings WHERE key = 'melee_dv_take10'`, (sErr, sRow) => {
            db.run(
              `UPDATE locations SET melee_ac = ? WHERE id = ?`,
              [sheetAttack.staticMeleeDv(data, !sErr && sRow?.value === '1'), location_id],
              () => { io.emit('dataUpdated', { isRhombusOnly: true }); finish(); }
            );
          });
        }
      );
    });
  });

  // Detach NPC sheet from a token
  router.delete('/npcs/:id/link/:location_id', authenticate, requireAdmin, (req, res) => {
    db.run(
      `DELETE FROM npc_sheet_links WHERE sheet_id = ? AND location_id = ?`,
      [req.params.id, req.params.location_id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('npcLinkChanged', { location_id: Number(req.params.location_id), sheet_id: null });
        res.json({ message: 'Unlinked' });
      }
    );
  });

  // Portrait upload — player uploads their own portrait; admin can upload
  // for any username via ?username= query param.
  router.post('/portrait', authenticate, upload.single('portrait'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'portrait file required' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (!allowed.includes(ext)) return res.status(400).json({ error: 'Unsupported image format' });

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const filename = hash + ext;
    const filepath = path.join(portraitsDir, filename);
    if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, req.file.buffer);
    const portrait_url = '/uploads/portraits/' + filename;

    // Determine whose sheet to update
    const u = req.user;
    const isAdmin = u && (u.role === 'admin' || u.isTemporary);

    // Admin can target an NPC sheet directly by id
    if (isAdmin && req.query.npc_id) {
      return db.run(
        `UPDATE character_sheets SET portrait_url = ? WHERE id = ? AND is_npc = 1`,
        [portrait_url, req.query.npc_id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          if (this.changes === 0) return res.status(404).json({ error: 'NPC not found' });
          res.json({ portrait_url });
        }
      );
    }

    const targetUsername = isAdmin && req.query.username ? req.query.username : u.username;
    if (!targetUsername) return res.status(400).json({ error: 'Cannot determine target username' });

    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(
        `UPDATE character_sheets SET portrait_url = ? WHERE username = ? AND system = ? AND is_npc = 0`,
        [portrait_url, targetUsername, system],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          io.emit('sheetUpdated', { username: targetUsername });
          res.json({ portrait_url });
        }
      );
    });
  });

  // Set portrait to a bundled stock headshot URL (admin-only).
  // Accepts { npc_id, url } or { username, url }; url must be a stock headshot.
  router.post('/portrait-url', authenticate, requireAdmin, (req, res) => {
    const { npc_id, username, url } = req.body || {};
    if (!url || typeof url !== 'string' || !headshots.isStockHeadshot(url)) {
      return res.status(400).json({ error: 'url must be a bundled stock headshot' });
    }
    if (npc_id) {
      return db.run(
        `UPDATE character_sheets SET portrait_url = ? WHERE id = ? AND is_npc = 1`,
        [url, npc_id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) return res.status(404).json({ error: 'NPC not found' });
          // Refresh any open token info window showing this NPC's portrait
          db.get(`SELECT location_id FROM npc_sheet_links WHERE sheet_id = ? LIMIT 1`, [npc_id], (e2, link) => {
            if (!e2 && link) io.emit('npcLinkChanged', { location_id: link.location_id, sheet_id: Number(npc_id) });
          });
          res.json({ portrait_url: url });
        }
      );
    }
    if (username) {
      getGameSystem((err, system) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(
          `UPDATE character_sheets SET portrait_url = ? WHERE username = ? AND system = ? AND is_npc = 0`,
          [url, username, system],
          (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            io.emit('sheetUpdated', { username });
            res.json({ portrait_url: url });
          }
        );
      });
      return;
    }
    res.status(400).json({ error: 'npc_id or username required' });
  });

  // Reset all player LUCK to max for the active system (admin-only)
  router.post('/reset-luck', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      const meta = TEMPLATES[system];
      if (!meta || !meta.luckField || !meta.luckMaxField) {
        return res.json({ reset: 0, reason: 'System has no LUCK field' });
      }
      const { luckField, luckMaxField } = meta;
      db.all(
        `SELECT id, username, data FROM character_sheets WHERE system = ? AND is_npc = 0`,
        [system],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          const updates = [];
          for (const row of rows) {
            let data;
            try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
            const max = data[luckMaxField];
            if (max === undefined || max === null) continue;
            updates.push({ id: row.id, username: row.username });
          }
          if (updates.length === 0) return res.json({ reset: 0 });
          let done = 0;
          for (const u of updates) {
            // The scan decides who is reset; the value is read again at write time, so a
            // player editing their sheet during a table-wide reset does not lose it.
            patchSheet(db, u.id, (d) => ({ [luckField]: Number(d[luckMaxField]) }), () => {
              io.emit('sheetUpdated', { username: u.username });
              done++;
              if (done === updates.length) res.json({ reset: updates.length });
            });
          }
        }
      );
    });
  });

  // CWN long rest: every character sheet on the active CWN system recovers
  // 1 System Strain (floored at 0). Admin-triggered, mirrors reset-luck.
  router.post('/cwn-rest', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      if (system !== 'cities_without_number') {
        return res.json({ rested: 0, reason: 'Active system is not CWN' });
      }
      db.all(
        `SELECT id, username, data, is_npc FROM character_sheets WHERE system = ?`,
        [system],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          const updates = [];
          for (const row of rows) {
            let data;
            try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
            const strain = Number(data.system_strain) || 0;
            if (strain <= 0) continue;
            updates.push({ id: row.id, username: row.username, isNpc: row.is_npc });
          }
          if (updates.length === 0) return res.json({ rested: 0 });
          let done = 0;
          for (const u of updates) {
            patchSheet(db, u.id, (d) => ({ edge: Number(d['edge_max']) }),
              () => {
                if (!u.isNpc) io.emit('sheetUpdated', { username: u.username });
                done++;
                if (done === updates.length) res.json({ rested: updates.length });
              }
            );
          }
        }
      );
    });
  });

  // SR6 Edge replenishment: reset all player sheets' edge to their edge_max.
  router.post('/reset-edge', authenticate, requireAdmin, (req, res) => {
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      if (system !== 'shadowrun_6e') {
        return res.json({ reset: 0, reason: 'Active system is not Shadowrun 6E' });
      }
      db.all(
        `SELECT id, username, data FROM character_sheets WHERE system = ? AND is_npc = 0`,
        [system],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          const updates = [];
          for (const row of rows) {
            let data;
            try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
            const max = data['edge_max'];
            if (max === undefined || max === null) continue;
            updates.push({ id: row.id, username: row.username });
          }
          if (updates.length === 0) return res.json({ reset: 0 });
          let done = 0;
          for (const u of updates) {
            // As with LUCK: the scan chooses who, the write reads the maximum again.
            patchSheet(db, u.id, (d) => ({ edge: Number(d['edge_max']) }), () => {
              io.emit('sheetUpdated', { username: u.username });
              done++;
              if (done === updates.length) res.json({ reset: updates.length });
            });
          }
        }
      );
    });
  });

  // SR6 Edge grant: give 1 Edge to a specific player (capped at edge_max).
  // Body: { username: string }
  router.post('/grant-edge', authenticate, requireAdmin, (req, res) => {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username required' });
    getGameSystem((err, system) => {
      if (err) return res.status(500).json({ error: err.message });
      if (system !== 'shadowrun_6e') {
        return res.json({ granted: false, reason: 'Active system is not Shadowrun 6E' });
      }
      db.get(
        `SELECT id, data FROM character_sheets WHERE system = ? AND username = ? AND is_npc = 0`,
        [system, username],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (!row) return res.status(404).json({ error: 'Sheet not found' });
          let data;
          try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
          const max = Number(data['edge_max']) || 0;
          const cur = Number(data['edge']) || 0;
          if (cur >= max) return res.json({ granted: false, reason: 'Already at maximum Edge', edge: cur, edge_max: max });
          patchSheet(
            db,
            row.id,
            // Recomputed at write time: two grants landing together must be +2, not +1.
            (d) => ({ edge: Math.min(Number(d['edge_max']) || 0, (Number(d['edge']) || 0) + 1) }),
            (err3, next) => {
              if (err3) return res.status(500).json({ error: err3.message });
              io.emit('sheetUpdated', { username });
              res.json({ granted: true, edge: next['edge'], edge_max: max });
            }
          );
        }
      );
    });
  });

  return router;
};

// The limiter outlives any one router, which is the point of it — and is also why a test
// has to be able to forget what it has counted between cases.
module.exports.companionLimit = companionLimit;
module.exports.COMPANION_LIMIT = COMPANION_LIMIT;
