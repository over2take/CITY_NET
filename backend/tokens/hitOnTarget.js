// A hit reaching its target (8b5c; approved mockup docs/mockups/damage-pipeline.html, section 5, answer 4: after the map's
// attack says HIT, the attacker's next DAMAGE roll from a line of gear goes to that target). What the hit comes to on it,
// each part against the target's resistances (systemBuilder/damageTaken.js), and, where APPLY DAMAGE is AUTO, taken off its
// health as the HEALTH folder's DAMAGE would be: one pool through tokens/poolHealth.js, any other model through the
// system's own rule on the sheet behind the token (systemBuilder/health.js). OFF only says it; CONFIRM keeps it waiting on
// the target until someone APPLYs or DISMISSes it (8b6b1, tokens/waitingHits.js). The log's words for the GM and, where an NPC's resistances are not all revealed, for the players; with
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
const { keepHit, rowWords, WAITING } = require('./waitingHits');
const { halved, SAVED_HALF, SAVED } = require('./sendTo');

/** How long a HIT waits for its damage (the mockup: "a minute without one, and it waits no more"). */
const HIT_WAITS_MS = 60_000;

/** The GM's note where players were told less, as a roll's hidden target's (tableRolls.js HIDDEN, 6c4h). */
const TOLD_LESS = HIDDEN.replace(/^ · /, '');

/** The table's APPLY DAMAGE, WORK OUT RESISTANCES and HIT TOTALS ON NPCS, as { key: value }. */
const tableSettings = (db, cb) => db.all('SELECT key, value FROM global_settings WHERE key IN (?, ?, ?)', [APPLY_DAMAGE_SETTING, WORK_OUT_SETTING, HIT_TOTALS_SETTING],
  (e, rows) => cb(Object.fromEntries((e ? [] : rows || []).map((r) => [r.key, r.value]))));

/**
 * The token a hit is on and the sheet behind it: a player's own in the game being played, or an NPC's by its link. Calls
 * back { row, player, sheet }, or null where the token is gone.
 */
const targetOf = (db, targetId, system, cb) => {
  db.get('SELECT id, name, shape, owner, controllers, hp_current, hp_max, hp_temp, conditions FROM locations WHERE id = ?', [targetId], (err, row) => {
    if (err || !row) return cb(null);
    const player = row.shape === 'rhombus' && !!row.owner;
    const done = (e, s) => cb({ row, player, sheet: e ? null : s || null });
    if (player) return db.get('SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [row.owner, system], done);
    db.get(`SELECT cs.id, cs.data FROM npc_sheet_links l JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ? AND cs.system = ?`,
      [row.id, system], done);
  });
};

/**
 * `amount` taken off a token as the HEALTH folder's DAMAGE takes it: one pool through tokens/poolHealth.js (every copy of a
 * player's token), any other model through the system's own rule on the sheet as it is when written. Calls back
 * { ok: true, owner } (`owner` a player whose token changed) or { ok: false, error }. AUTO's hit and APPLY alike (8b6b1).
 */
const takeOff = (db, { system, health, target: { row, player, sheet }, amount }, cb) => {
  const writeToken = (t) => {
    const [sql, params] = player
      ? ['UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE shape = "rhombus" AND owner = ?', [t.current, t.max, t.temp, row.owner]]
      : ['UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE id = ?', [t.current, t.max, t.temp, row.id]];
    db.run(sql, params, (e) => cb(e ? { ok: false, error: 'Could not be saved' } : { ok: true, owner: player ? row.owner : null }));
  };
  const token = { current: row.hp_current, max: row.hp_max, temp: row.hp_temp };
  if (!health || health.model === 'pool') return writeToken(poolAfter(token, 'damage', amount));
  // Another model: its rule on the sheet as it is when written, as the HEALTH folder's DAMAGE.
  const act = { kind: 'damage', amount };
  if (!sheet) {
    const result = applyHealthAction(health, { current: token.current, max: token.max, temp: token.temp }, {}, act);
    if (!result.ok) return cb({ ok: false, error: result.error });
    if (Object.keys(result.sheetPatch).length) return cb({ ok: false, error: 'This token has no sheet to keep that on' });
    return writeToken(result.token);
  }
  let result = null;
  mutateSheet(db, sheet.id, (d) => {
    result = applyHealthAction(health, token, d, act);
    if (!result.ok) return undefined;
    const next = { ...d, ...result.sheetPatch };
    applyDerived(system, next);
    return next;
  }, (e) => {
    if (e || !result) return cb({ ok: false, error: 'Could not read the sheet' });
    if (!result.ok) return cb({ ok: false, error: result.error });
    writeToken(result.token);
  });
};

/**
 * `made` a DAMAGE roll (gearRolls.js rollGear), `targetId` the token the HIT was on, `from` who made it ({ name, what, user }:
 * "KES", "Flame Tongue", their account). Calls back { targetName, applied, waiting?, words, players?, owner? }: `words` the
 * GM's, `players` the players' only where they are told less, `owner` a player whose token changed, `waiting` a hit kept
 * under CONFIRM (8b6b1). Nothing (null) where the target is gone. SEND TO (8b7a): `half` a target that saved, each part
 * halved before its resistances; `dry` only what it would take ({ targetName, taken, rolled, words }), kept and taken nowhere.
 */
const hitOnTarget = (db, { system, definition, health, targetId, made, from = {}, half = false, dry = false }, cb) => {
  targetOf(db, targetId, system, (target) => {
    if (!target) return cb(null);
    const { row, player, sheet } = target;
    tableSettings(db, (settings) => {
      let data = {};
      try { data = sheet ? JSON.parse(sheet.data || '{}') : {}; } catch { data = {}; }
      const conditionIds = parseTokenConditions(row.conditions).map((c) => c.id);
      const worked = resistancesOf(definition, data, conditionIds);
      const rules = damageRulesOf(definition, settings);
      const rolledParts = Array.isArray(made.parts) && made.parts.length ? made.parts : [{ value: made.value }];
      // SEND TO's HALF (8b7a, answer 2 A): each part halved before its resistances, said against the roll's whole total.
      const parts = half ? halved(rolledParts) : rolledParts;
      const taken = damageTaken(parts, worked, { worksOut: worksOutOf(definition), workOut: rules.workOut });
      const of = half ? damageTaken(rolledParts, null, { worksOut: {}, workOut: false }).rolled : taken.rolled;
      const name = row.name || 'THE TARGET';
      // The players' words: an NPC's resistances only as revealed, and nothing of what it took where the table keeps that
      // to the GM (on unless the table switched it off); a player's character's all.
      const gmOnly = !player && settings[HIT_TOTALS_SETTING] !== '0';
      const seen = gmOnly ? { taken: seenBy(taken, {}).taken, total: false }
        : seenBy(taken, player ? null : revealedOnly(worked, revealedIn(data[REVEALED_KEY])));
      // The GM's line says when players were told less, as a roll's hidden target does (6c4h).
      // What it took last, in either; the GM's notes it was told less before that.
      const lead = half ? [SAVED_HALF] : [];
      const theirLead = half ? [seen.total ? SAVED_HALF : SAVED] : [];
      const say = (verb, notes = []) => {
        const words = takenWords(name, taken, { verb, notes, lead, of });
        const players = takenWords(name, seen.taken, { verb, total: seen.total, notes, lead: theirLead, of });
        return players === words ? { words } : { words: takenWords(name, taken, { verb, notes: [...notes, TOLD_LESS], lead, of }), players };
      };
      // SEND TO's picker (8b7a): what it would take, kept and taken nowhere, in the GM's words (no note of the players').
      if (dry) return cb({ targetName: name, applied: false, taken: taken.taken, rolled: of, words: takenWords(name, taken, { verb: 'WOULD TAKE', lead, of }) });
      // CONFIRM (8b6b1; answer 1 A): kept on the target, worked out now, until someone APPLYs or DISMISSes it.
      if (rules.apply === 'confirm') {
        const said = say('WOULD TAKE', [WAITING]);
        return keepHit(db, {
          location_id: row.id, system, target_name: name, taken: taken.taken, rolled: of,
          from_name: String(from.name || 'SOMEONE'), what: String(from.what || 'DAMAGE'),
          words: rowWords(name, said.words), players: said.players ? rowWords(name, said.players) : null,
          totals_hidden: seen.total ? 0 : 1, by_user: from.user || null,
        }, (e) => cb(e
          ? { targetName: name, applied: false, ...say('WOULD TAKE', [NOT_APPLIED.confirm]) }
          : { targetName: name, applied: false, waiting: true, ...said }));
      }
      if (rules.apply !== 'auto') return cb({ targetName: name, applied: false, ...say('WOULD TAKE', [NOT_APPLIED[rules.apply]]) });
      takeOff(db, { system, health, target, amount: taken.taken }, (done) => cb(done.ok
        ? { targetName: name, applied: true, ...say('TAKES'), ...(done.owner ? { owner: done.owner } : {}) }
        : { targetName: name, applied: false, ...say('WOULD TAKE', [done.error === 'Could not be saved' ? 'NOT APPLIED: COULD NOT BE SAVED' : `NOT APPLIED: ${String(done.error).toUpperCase()}`]) }));
    });
  });
};

module.exports = { hitOnTarget, targetOf, takeOff, HIT_WAITS_MS };
