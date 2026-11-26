// SEND TO, the GM's (8b7a; approved mockup docs/mockups/send-to.html, 2026-11-26, all as recommended). A damage roll that
// reached no target through the map's attack, a grenade or a spell rolled straight from a sheet, is kept with its line in the
// log: what it rolled, each part and its type, so what the GM sends is the server's own numbers, never the screen's. The GM
// sends it on to tokens, each FULL or HALF (it saved: each part halved before its resistances, rounded down, answer 2 A), each
// taken as the table applies damage (tokens/hitOnTarget.js: under CONFIRM it waits on the target's HEALTH, answer 1 A), and
// each token once per roll. Which lines (answer 3 A): a gear line's DAMAGE, and a plain roll of the sheet's whose total is
// sent as damage with no type; never a lone d20 (to hit), a roll against a number, or one read as symbols or a count.

/** The most tokens one SEND takes (a blast, not the whole map). */
const MOST_TARGETS = 30;

/** Where a sent hit's saved half is said, before its resistances: "→ GOBLIN B · SAVED: HALF · TAKES 14 OF 28". */
const SAVED_HALF = 'SAVED: HALF';
/** The same to players who aren't told its numbers. */
const SAVED = 'SAVED';

/** A gear line's roll (systemBuilder/gearRolls.js rollGear) as it is kept to send, or null: only a DAMAGE that came to something. */
const sendableGear = (made) => {
  if (!made || !made.ok || made.kind !== 'damage' || !(made.value > 0)) return null;
  const parts = Array.isArray(made.parts) && made.parts.length
    ? made.parts.map((p) => ({ value: p.value, type: p.type || null, label: p.label || null }))
    : [{ value: made.value, type: null, label: null }];
  return { what: String(made.line || 'DAMAGE'), total: made.value, parts };
};

/** Whether a roll's dice are one d20 and nothing else: a roll to hit, not damage. */
const loneD20 = (groups) => {
  const faces = (groups || []).flatMap((g) => (g.faces || []).filter((f) => !f.extra).map(() => g.sides));
  return faces.length === 1 && faces[0] === 20;
};

/**
 * A plain roll of the sheet's (systemBuilder/tableRolls.js rollField) as it is kept to send, or null: its total as one part of
 * no type, where it is a sum of dice (`read` sum) with no number to beat, no symbols, and isn't a lone d20, and came to something.
 */
const sendableField = (made) => {
  if (!made || !made.ok || !made.result) return null;
  const r = made.result;
  if ((made.read || 'sum') !== 'sum' || r.target !== null || r.symbols || loneD20(r.groups) || !(made.total > 0)) return null;
  const what = (made.board && made.board.label) || String(made.roll || 'ROLL').toUpperCase();
  return { what, total: made.total, parts: [{ value: made.total, type: null, label: null }] };
};

/** Each part halved, rounded down, before its resistances (answer 2 A). */
const halved = (parts) => parts.map((p) => ({ ...p, value: Math.floor(Math.max(0, Number(p.value) || 0) / 2) }));

/**
 * A SEND's targets checked: `[{ locationId, half }]`, each a token's id once, at most MOST_TARGETS. Gives
 * `{ ok: true, targets }` (half true or false) or `{ ok: false, error }`.
 */
const targetsOf = (given) => {
  if (!Array.isArray(given) || !given.length) return { ok: false, error: 'Pick who it goes to' };
  if (given.length > MOST_TARGETS) return { ok: false, error: `At most ${MOST_TARGETS} at once` };
  const seen = new Set();
  const targets = [];
  for (const t of given) {
    const id = t && typeof t === 'object' ? t.locationId : undefined;
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Nothing to send to' };
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push({ locationId: id, half: t.half === true });
  }
  return { ok: true, targets };
};

/** A sent hit's log line: "SENT BY GM · Fireball (from MIRA) → GOBLIN B · SAVED: HALF · TAKES 14 OF 28". Only the GM sends. */
const sentWords = (roll, hitWords) => `SENT BY GM · ${roll.what} (from ${String(roll.from_name).toUpperCase()}) → ${hitWords}`;

/** A kept roll as the GM's tray is told it: what to say on SEND TO, and the tokens it went to. */
const sendShown = (roll, sent = []) => {
  let parts = [];
  try { parts = JSON.parse(roll.parts || '[]'); } catch { parts = []; }
  const types = [...new Set(parts.map((p) => p.label || p.type).filter(Boolean).map((t) => String(t).toUpperCase()))];
  return { rollId: roll.roll_id, what: roll.what, from: roll.from_name, total: roll.total, types, sent };
};

/** Keeps a roll to send. `roll`: { roll_id, system, what, from_name, by_user, total, parts }. */
const keepSendable = (db, roll, cb) => db.run(
  'INSERT INTO sendable_rolls (roll_id, system, what, from_name, by_user, total, parts) VALUES (?, ?, ?, ?, ?, ?, ?)',
  [roll.roll_id, roll.system, roll.what, roll.from_name, roll.by_user ?? null, roll.total, JSON.stringify(roll.parts)],
  (err) => cb(err || null),
);

/**
 * The kept rolls among `rollIds`, each as sendShown gives it, with the names of the tokens each went to, oldest send first.
 * Calls back a Map of roll id to it; empty where none (or the tables aren't there).
 */
const sendsOf = (db, rollIds, cb) => {
  const ids = (rollIds || []).filter((id) => Number.isInteger(id));
  if (!ids.length) return cb(new Map());
  const marks = ids.map(() => '?').join(', ');
  db.all(`SELECT * FROM sendable_rolls WHERE roll_id IN (${marks})`, ids, (err, rolls) => {
    if (err || !rolls || !rolls.length) return cb(new Map());
    db.all(`SELECT roll_id, target_name FROM roll_sends WHERE roll_id IN (${marks}) ORDER BY rowid`, ids, (e2, sends) => {
      const by = new Map();
      for (const s of e2 ? [] : sends || []) by.set(s.roll_id, [...(by.get(s.roll_id) || []), s.target_name]);
      cb(new Map(rolls.map((r) => [r.roll_id, sendShown(r, by.get(r.roll_id) || [])])));
    });
  });
};

/**
 * Claims a token for a roll, once (roll_sends is unique on both): calls back true where this is its first send, false where
 * it went there already (or couldn't be kept).
 */
const claimSend = (db, rollId, locationId, cb) => db.run(
  'INSERT OR IGNORE INTO roll_sends (roll_id, location_id, target_name) VALUES (?, ?, ?)',
  [rollId, locationId, ''],
  function claimed(err) { cb(!err && this.changes === 1); },
);

/** A claimed send named for its target, or let go where the token was gone. */
const nameSend = (db, rollId, locationId, name, cb) => db.run('UPDATE roll_sends SET target_name = ? WHERE roll_id = ? AND location_id = ?', [name, rollId, locationId], () => cb());
const dropSend = (db, rollId, locationId, cb) => db.run('DELETE FROM roll_sends WHERE roll_id = ? AND location_id = ?', [rollId, locationId], () => cb());

module.exports = {
  MOST_TARGETS, SAVED_HALF, SAVED, sendableGear, sendableField, loneD20, halved, targetsOf, sentWords, sendShown,
  keepSendable, sendsOf, claimSend, nameSend, dropSend,
};
