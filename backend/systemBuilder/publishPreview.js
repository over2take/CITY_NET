// What PUBLISH would change, read off the database (4h1b; approved mockup
// docs/mockups/version-preview.html, 2026-10-13): versionDiff.js's comparison, run over every
// character playing the system with what lives outside their sheets too (token health and defense,
// money, conditions on tokens). From v2 on, characters or not; a first version has nothing before
// it to compare with. Nothing is written.
//
// A token keeps the running system's health and conditions on its row and every other system's in
// token_vitals (tokens/vitals.js), so a system that isn't running is read from there.
//
// The numbers are worked out as the game would run each version: with the table's house-rule choices
// (houseRules.js), a rule the new version adds as it starts (4j5c). The changes themselves are the
// versions as written.

const { versionChanges, characterChanges, sampleChanges } = require('./versionDiff');
const { effectiveSheet, fieldsOf } = require('./sheet');
const { currenciesOf } = require('./currencies');
const { houseRulesOn, withHouseRules, choicesFrom } = require('./houseRules');

const all = (db, sql, params) => new Promise((ok, no) => db.all(sql, params, (e, rows) => (e ? no(e) : ok(rows || []))));
const one = (db, sql, params) => new Promise((ok, no) => db.get(sql, params, (e, row) => (e ? no(e) : ok(row || null))));
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };

/** Where a linked field's value lives on a token row. */
const TOKEN_COLUMN = { token_hp: 'hp_current', token_hp_max: 'hp_max', token_ac: 'melee_ac' };

/** Every field either version links to something outside the sheet, by id: its source. */
const linkedFields = (before, after) => {
  const out = {};
  for (const def of [before, after]) {
    for (const f of fieldsOf(effectiveSheet(def))) if (f && typeof f.source === 'string') out[f.id] = f.source;
  }
  return out;
};

/**
 * One character's token as this system has it: the row itself while the system runs, its
 * token_vitals row otherwise. A player's is their first rhombus (the city map's first), an NPC's the
 * token its sheet is linked to.
 */
const tokenOf = async (db, system, running, sheet) => {
  const where = sheet.is_npc
    ? await one(db, 'SELECT l.id FROM npc_sheet_links k JOIN locations l ON l.id = k.location_id WHERE k.sheet_id = ? ORDER BY l.id LIMIT 1', [sheet.id])
    : await one(db, `SELECT id FROM locations WHERE shape = 'rhombus' AND owner = ? ORDER BY (battle_map_id IS NULL) DESC, id LIMIT 1`, [sheet.username]);
  if (!where) return null;
  return running
    ? one(db, 'SELECT hp_current, hp_max, melee_ac, conditions FROM locations WHERE id = ?', [where.id])
    : one(db, 'SELECT hp_current, hp_max, melee_ac, conditions FROM token_vitals WHERE location_id = ? AND system = ?', [where.id, system]);
};

/**
 * What publishing `after` over `before` would change for `system` ({ id, version }): { first: true }
 * for a first version, else { from, to, changes, characters, sample }. Each character is { kind,
 * username | sheet_id, name, changes }, theirs alone (versionDiff characterChanges), with money a
 * removed currency still holds and conditions a removed one leaves on their token; `sample` is the
 * numbers on the SAMPLE values, when nobody plays it.
 */
const previewPublish = async (db, { system, version, before, after, running }) => {
  if (!before) return { first: true };
  const changes = versionChanges(before, after);
  const chosen = choicesFrom(await all(db, `SELECT key, value FROM global_settings WHERE key LIKE 'house_rule:%'`, []), system);
  const [ranBefore, ranAfter] = [before, after].map((d) => withHouseRules(d, houseRulesOn(d, chosen)));
  const linked = linkedFields(before, after);
  const goneMoney = changes.filter((c) => c.kind === 'currency' && c.change === 'removed');
  const goneConditions = changes.filter((c) => c.kind === 'condition' && c.change === 'removed');
  // A system's first currency is held in bank_accounts, the rest in bank_balances (bank/currencies.js).
  const [main] = currenciesOf(before);

  const sheets = await all(db,
    'SELECT id, username, is_npc, npc_label, data FROM character_sheets WHERE system = ? ORDER BY is_npc, username COLLATE NOCASE, id',
    [system]);
  const characters = [];
  for (const s of sheets) {
    const data = parse(s.data, {});
    const sheet = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
    const token = await tokenOf(db, system, running, s);
    for (const [id, source] of Object.entries(linked)) {
      if (TOKEN_COLUMN[source]) sheet[id] = token ? token[TOKEN_COLUMN[source]] : null;
    }
    if (!s.is_npc && Object.values(linked).includes('bank_balance')) {
      const account = await one(db, 'SELECT balance FROM bank_accounts WHERE username = ? AND system = ?', [s.username, system]);
      for (const [id, source] of Object.entries(linked)) if (source === 'bank_balance') sheet[id] = account ? account.balance : 0;
    }
    const mine = characterChanges(ranBefore, ranAfter, sheet);
    if (!s.is_npc) {
      for (const c of goneMoney) {
        const held = main && main.id === c.id
          ? await one(db, 'SELECT balance, debt FROM bank_accounts WHERE username = ? AND system = ?', [s.username, system])
          : await one(db, 'SELECT balance, debt FROM bank_balances WHERE username = ? AND system = ? AND currency = ?', [s.username, system, c.id]);
        if (held && (Number(held.balance) || Number(held.debt))) mine.push({ kind: 'currency', change: 'held', id: c.id, label: c.label, balance: Number(held.balance) || 0, debt: Number(held.debt) || 0 });
      }
    }
    const onToken = new Set(parse(token && token.conditions, []).filter((x) => x && typeof x.id === 'string').map((x) => x.id));
    for (const c of goneConditions) if (onToken.has(c.id)) mine.push({ kind: 'condition', change: 'on_token', id: c.id, label: c.label });
    const name = (typeof data.name === 'string' && data.name.trim()) || (s.is_npc ? s.npc_label : s.username) || 'Unnamed';
    characters.push({
      kind: s.is_npc ? 'npc' : 'player',
      ...(s.is_npc ? { sheet_id: s.id } : { username: s.username }),
      name,
      changes: mine,
    });
  }
  return {
    first: false,
    from: version,
    to: version + 1,
    changes,
    characters,
    sample: characters.length ? null : sampleChanges(ranBefore, ranAfter),
  };
};

module.exports = { previewPublish, linkedFields };
