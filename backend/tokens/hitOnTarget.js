// A hit reaching its target (8b5c; approved mockup docs/mockups/damage-pipeline.html, section 5, answer 4: after the map's
// attack says HIT, the attacker's next DAMAGE roll from a line of gear goes to that target). What the hit comes to on it,
// each part against the target's resistances (systemBuilder/damageTaken.js), and, where APPLY DAMAGE is AUTO, taken off its
// health as the HEALTH folder's DAMAGE would be: one pool through tokens/poolHealth.js, any other model through the
// system's own rule on the sheet behind the token (systemBuilder/health.js). OFF and CONFIRM only say it: CONFIRM's waiting
// hits are 8b6's. The log's words for the GM and, where an NPC's resistances are not all revealed, for the players; with
// the table's HIT TOTALS ON NPCS: GM ONLY, on unless switched off, players are told only that an NPC was hit (the user,
// 2026-11-25).

const { parseTokenConditions } = require('./conditions');
const { poolAfter } = require('./poolHealth');
const { mutateSheet } = require('../sheets/mutate');
const { applyDerived } = require('../sheets/templates');
const { applyHealthAction } = require('../systemBuilder/health');
const { resistancesOf } = require('../systemBuilder/choices');
const { worksOutOf, damageRulesOf, APPLY_DAMAGE_SETTING, WORK_OUT_SETTING, HIT_TOTALS_SETTING } = require('../systemBuilder/damageTypes');
const { REVEALED_KEY, revealedIn } = require('../systemBuilder/resistances');
const { revealedOnly } = require('../systemBuilder/resistancesShown');
const { damageTaken, takenWords, seenBy, NOT_APPLIED } = require('../systemBuilder/damageTaken');
const { HIDDEN } = require('../systemBuilder/tableRolls');

/** How long a HIT waits for its damage (the mockup: "a minute without one, and it waits no more"). */
const HIT_WAITS_MS = 60_000;

/** The GM's note where players were told less, as a roll's hidden target's (tableRolls.js HIDDEN, 6c4h). */
const TOLD_LESS = HIDDEN.replace(/^ · /, '');

/** The table's APPLY DAMAGE, WORK OUT RESISTANCES and HIT TOTALS ON NPCS, as { key: value }. */
const tableSettings = (db, cb) => db.all('SELECT key, value FROM global_settings WHERE key IN (?, ?, ?)', [APPLY_DAMAGE_SETTING, WORK_OUT_SETTING, HIT_TOTALS_SETTING],
  (e, rows) => cb(Object.fromEntries((e ? [] : rows || []).map((r) => [r.key, r.value]))));

/**
 * `made` a DAMAGE roll (gearRolls.js rollGear), `targetId` the token the HIT was on. Calls back { targetName, applied, words,
 * players?, owner? }: `words` the GM's, `players` the players' only where they are told less, `owner` a player whose token
 * changed. Nothing (null) where the target is gone.
 */
const hitOnTarget = (db, { system, definition, health, targetId, made }, cb) => {
  db.get('SELECT id, name, shape, owner, hp_current, hp_max, hp_temp, conditions FROM locations WHERE id = ?', [targetId], (err, row) => {
    if (err || !row) return cb(null);
    const player = row.shape === 'rhombus' && !!row.owner;
    const findSheet = (done) => (player
      ? db.get('SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [row.owner, system], (e, s) => done(e ? null : s || null))
      : db.get(`SELECT cs.id, cs.data FROM npc_sheet_links l JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ? AND cs.system = ?`,
        [row.id, system], (e, s) => done(e ? null : s || null)));
    findSheet((sheet) => tableSettings(db, (settings) => {
      let data = {};
      try { data = sheet ? JSON.parse(sheet.data || '{}') : {}; } catch { data = {}; }
      const conditionIds = parseTokenConditions(row.conditions).map((c) => c.id);
      const worked = resistancesOf(definition, data, conditionIds);
      const rules = damageRulesOf(definition, settings);
      const parts = Array.isArray(made.parts) && made.parts.length ? made.parts : [{ value: made.value }];
      const taken = damageTaken(parts, worked, { worksOut: worksOutOf(definition), workOut: rules.workOut });
      const name = row.name || 'THE TARGET';
      // The players' words: an NPC's resistances only as revealed, and nothing of what it took where the table keeps that
      // to the GM (on unless the table switched it off); a player's character's all.
      const gmOnly = !player && settings[HIT_TOTALS_SETTING] !== '0';
      const seen = gmOnly ? { taken: seenBy(taken, {}).taken, total: false }
        : seenBy(taken, player ? null : revealedOnly(worked, revealedIn(data[REVEALED_KEY])));
      // The GM's line says when players were told less, as a roll's hidden target does (6c4h).
      // What it took last, in either; the GM's notes it was told less before that.
      const say = (verb, notes = []) => {
        const words = takenWords(name, taken, { verb, notes });
        const players = takenWords(name, seen.taken, { verb, total: seen.total, notes });
        return players === words ? { words } : { words: takenWords(name, taken, { verb, notes: [...notes, TOLD_LESS] }), players };
      };
      if (rules.apply !== 'auto') return cb({ targetName: name, applied: false, ...say('WOULD TAKE', [NOT_APPLIED[rules.apply]]) });

      const writeToken = (t, owner) => {
        const [sql, params] = player
          ? ['UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE shape = "rhombus" AND owner = ?', [t.current, t.max, t.temp, row.owner]]
          : ['UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE id = ?', [t.current, t.max, t.temp, row.id]];
        db.run(sql, params, (e) => cb(e
          ? { targetName: name, applied: false, ...say('WOULD TAKE', ['NOT APPLIED: COULD NOT BE SAVED']) }
          : { targetName: name, applied: true, ...say('TAKES'), ...(owner ? { owner } : {}) }));
      };
      const token = { current: row.hp_current, max: row.hp_max, temp: row.hp_temp };
      if (!health || health.model === 'pool') return writeToken(poolAfter(token, 'damage', taken.taken), player ? row.owner : null);
      // Another model: its rule on the sheet as it is when written, as the HEALTH folder's DAMAGE.
      const act = { kind: 'damage', amount: taken.taken };
      const refused = (result) => cb({ targetName: name, applied: false, ...say('WOULD TAKE', [`NOT APPLIED: ${String(result.error).toUpperCase()}`]) });
      if (!sheet) {
        const result = applyHealthAction(health, { current: token.current, max: token.max, temp: token.temp }, {}, act);
        if (!result.ok) return refused(result);
        if (Object.keys(result.sheetPatch).length) return refused({ error: 'This token has no sheet to keep that on' });
        return writeToken(result.token, null);
      }
      let result = null;
      mutateSheet(db, sheet.id, (d) => {
        result = applyHealthAction(health, token, d, act);
        if (!result.ok) return undefined;
        const next = { ...d, ...result.sheetPatch };
        applyDerived(system, next);
        return next;
      }, (e) => {
        if (e || !result) return refused({ error: 'Could not read the sheet' });
        if (!result.ok) return refused(result);
        writeToken(result.token, player ? row.owner : null);
      });
    }));
  });
};

module.exports = { hitOnTarget, HIT_WAITS_MS };
