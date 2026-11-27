// Dying at the table (8c1b1; approved mockup docs/mockups/rule-library.html, 2026-11-26): a token's health changing, seen
// by the running game's `dying` rule (systemBuilder/dying.js). Every place that writes a token's health calls noticeHealth
// after it, with whether it was damage; this reads the token as it is now and works out whether they went down, were hurt
// while down or came back up, keeps that on the token and says it.
//
// The state lives on the token (`locations.dying`, JSON, null when not down), one copy per player written alike as their
// health is, and kept per game system beside it (tokens/vitals.js). Everyone may know a token is down, the word; the count
// is its owner's and the GM's (the mockup's answer 5), so publicDying is what anyone else is sent, and each line is said to
// them alone (`dice_rolls.seen_by`: the owner, or '' for the GM alone, an NPC's).
//
// Who goes down is the rule's WHO GOES DOWN: a player's character always, an NPC as ticked (the user, 2026-11-26).

const { dyingRuleOf, goesDown, afterHealth, aTurn, deathSave, stateOf } = require('../systemBuilder/dying');
const { effectiveData } = require('../systemBuilder/choices');
const { outNow } = require('../systemBuilder/health');

const get = (db, sql, args = []) => new Promise((ok, no) => db.get(sql, args, (e, row) => (e ? no(e) : ok(row))));
const run = (db, sql, args = []) => new Promise((ok, no) => db.run(sql, args, function (e) { if (e) no(e); else ok(this); }));

/** Who hears what dying says: set once by the sockets (sockets/index.js), { lines: [{ line, seenBy }], changed }. */
let announce = null;
const setAnnouncer = (fn) => { announce = typeof fn === 'function' ? fn : null; };

/** One token's changes one after another, so two hits landing together each count. */
const queues = new Map();
const inTurn = (key, job) => {
  const before = queues.get(key) || Promise.resolve();
  const mine = before.then(job, job);
  const settled = mine.catch(() => {});
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return mine;
};

const TOKEN = 'id, name, shape, owner, hp_current, hp_max, hp_temp, dying';
const isPlayer = (row) => row.shape === 'rhombus' && !!row.owner;
/** A token as the log names it: its name (or its player's), an NPC said so. */
const whoOf = (row) => `${String(row.name || row.owner || 'TOKEN').toUpperCase()}${isPlayer(row) ? '' : ' (NPC)'}`;
/** Who may read a token's count and its lines: its player, or (an NPC's) the GM alone. */
const seenByOf = (row) => (isPlayer(row) ? row.owner : '');

/** What anyone but a token's player and the GM is sent of its dying: the word's state alone. */
const publicDying = (text) => {
  const st = stateOf(text);
  return st ? JSON.stringify({ state: st.state }) : null;
};

/** The sheet behind a token in the running game: its player's own, or an NPC's linked one; {} for none. */
const sheetOf = async (db, row, system) => {
  const sheet = isPlayer(row)
    ? await get(db, 'SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [row.owner, system])
    : await get(db, 'SELECT cs.data FROM npc_sheet_links l JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ? AND cs.system = ?', [row.id, system]);
  try { return sheet ? JSON.parse(sheet.data || '{}') : {}; } catch { return {}; }
};

/** A token's state written, every copy of a player's alike. */
const writeState = (db, row, st) => {
  const text = st ? JSON.stringify(st) : null;
  return isPlayer(row)
    ? run(db, "UPDATE locations SET dying = ? WHERE shape = 'rhombus' AND owner = ?", [text, row.owner])
    : run(db, 'UPDATE locations SET dying = ? WHERE id = ?', [text, row.id]);
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A token's health just written (`hurt` where it was damage): what the running game's dying rule makes of it, kept and said.
 * `locationId` the token, or `owner` a player's (any copy of theirs); `runtime` the running systems (systemBuilder/runtime.js,
 * by default). Resolves to { st, said } where anything was worked out, else null.
 * Never throws: a write that changed health has already happened, and dying is said after it.
 */
const noticeHealth = (db, { runtime = require('../systemBuilder/runtime'), locationId, owner, hurt = false }) => {
  const id = Number(locationId);
  const found = owner !== undefined && owner !== null
    ? get(db, `SELECT ${TOKEN} FROM locations WHERE shape = 'rhombus' AND owner = ? ORDER BY id LIMIT 1`, [String(owner)])
    : Number.isInteger(id) ? get(db, `SELECT ${TOKEN} FROM locations WHERE id = ?`, [id]) : Promise.resolve(null);
  return found.then((first) => {
    if (!first || !['rhombus', 'friendly_rhombus', 'enemy_rhombus'].includes(first.shape)) return null;
    return inTurn(isPlayer(first) ? `player:${first.owner}` : `npc:${first.id}`, async () => {
      const setting = await get(db, "SELECT value FROM global_settings WHERE key = 'game_system'");
      const system = setting && setting.value;
      const rule = system ? dyingRuleOf(runtime.definitionOf(system)) : null;
      // Read again in turn: the one before may have changed it.
      const row = await get(db, `SELECT ${TOKEN} FROM locations WHERE id = ?`, [first.id]);
      if (!row) return null;
      // Not under the rule (off, or WHO GOES DOWN no longer takes them): a state kept from before is let go.
      if (!rule || !goesDown(rule, row.shape)) {
        if (row.dying !== null && row.dying !== undefined) {
          await writeState(db, row, null);
          if (announce) announce({ lines: [], changed: true, owner: isPlayer(row) ? row.owner : null });
        }
        return null;
      }
      const health = runtime.health(system);
      const isOut = outNow(health, { current: row.hp_current, max: row.hp_max, temp: row.hp_temp }, await sheetOf(db, row, system));
      const st = stateOf(row.dying);
      const out = afterHealth(rule, st, { wasOut: !!st, isOut, hurt });
      const changed = !same(st, out.st);
      if (changed) await writeState(db, row, out.st);
      // Every change is said (going down, a hit while down, back up); a said one always changed something.
      if (announce && out.said) {
        announce({ lines: out.said ? [{ line: `${whoOf(row)} · ${out.said}`, seenBy: seenByOf(row), account: isPlayer(row) ? row.owner : null }] : [], changed, owner: isPlayer(row) ? row.owner : null });
      }
      return out;
    });
  }).catch((e) => {
    console.error('[dying] Could not notice a health change:', e.message);
    return null;
  });
};

/** Whether a token is in a running fight, where the tracker counts its turns: its player, or it, among a scene's combatants. */
const inFight = async (db, row) => {
  const id = isPlayer(row) ? `player:${row.owner}` : `npc:${row.id}`;
  const scenes = await new Promise((ok) => db.all('SELECT combatants FROM initiative_scene', [], (e, rows) => ok(e ? [] : rows || [])));
  return scenes.some((s) => {
    try { return JSON.parse(s.combatants || '[]').some((c) => c && c.id === id); } catch { return false; }
  });
};

/**
 * `job(row, rule, system)` on a token down under the running game's rule, in its turn: resolves to what the job does, or
 * { ok: false, error } where there is no such token or it isn't down under the rule.
 */
const onDown = (db, { runtime, locationId }, job) => get(db, `SELECT ${TOKEN} FROM locations WHERE id = ?`, [Number(locationId)]).then((first) => {
  if (!first || !['rhombus', 'friendly_rhombus', 'enemy_rhombus'].includes(first.shape)) return { ok: false, error: 'No such token' };
  return inTurn(isPlayer(first) ? `player:${first.owner}` : `npc:${first.id}`, async () => {
    const setting = await get(db, "SELECT value FROM global_settings WHERE key = 'game_system'");
    const system = setting && setting.value;
    const rule = system ? dyingRuleOf(runtime.definitionOf(system)) : null;
    const row = await get(db, `SELECT ${TOKEN} FROM locations WHERE id = ?`, [first.id]);
    if (!row || !rule || !goesDown(rule, row.shape)) return { ok: false, error: 'This game has no dying rule for them' };
    return job(row, rule, system);
  });
});

/**
 * A death save (8c1b2; the mockup's answer 3): pressed by the token's player or the GM, rolled on the server with the
 * character's own numbers. In a fight it waits for their turn (the GM's needn't); out of one each save is a turn. A natural
 * that brings them back heals 1, as HEAL would, and being healed above 0 then lets the rest go (noticeHealth). `who` is the
 * one who pressed it, as the log names them. Resolves to { ok: true, st, words } or { ok: false, error }.
 */
const rollDeathSave = (db, { runtime = require('../systemBuilder/runtime'), locationId, byGm = false, who, account = null, rng }) => onDown(db, { runtime, locationId }, async (row, rule, system) => {
  const st = stateOf(row.dying);
  const definition = runtime.definitionOf(system);
  const values = effectiveData(definition, await sheetOf(db, row, system));
  const made = deathSave(rule, st, { definition, values, rng, inFight: await inFight(db, row), byGm });
  if (!made.ok) return made;
  await writeState(db, row, made.st);
  const results = {};
  for (const d of made.dice) results[d.sides] = [...(results[d.sides] || []), ...d.rolls];
  if (announce) {
    announce({
      lines: [{ line: `${who}: ${whoOf(row)} · ${made.words}`, seenBy: seenByOf(row), account: account || (isPlayer(row) ? row.owner : null), userName: who, results, total: made.total }],
      changed: true, owner: isPlayer(row) ? row.owner : null,
    });
  }
  if (made.heal > 0) await backUp(db, { system, health: runtime.health(system), row, amount: made.heal });
  return { ok: true, st: made.st, words: made.words };
});

/** Healed by `amount` as HEAL heals under the game's health model, every copy of a player's token alike. */
const backUp = (db, { system, health, row, amount }) => new Promise((ok) => {
  const { targetOf, takeOff } = require('./hitOnTarget');
  targetOf(db, row.id, system, (target) => (target ? takeOff(db, { system, health, target, amount, kind: 'heal' }, ok) : ok(null)));
});

/** The words for a turn of a token down: its save due, or the turns it has left. */
const turnLine = (row, rule, said) => (said === 'DEATH SAVE' ? `${whoOf(row)} IS ${rule.word}: DEATH SAVE` : `${whoOf(row)} · ${rule.word} · ${said}`);

/**
 * A turn of theirs going by (8c1b2): the tracker's turn start in a fight, or the GM's A TURN GOES BY out of one (in a fight
 * that is the tracker's to count, so refused). A save comes due; turns left run down. Resolves { ok: true, st, said } or
 * { ok: false, error }.
 */
const turnGoesBy = (db, { runtime = require('../systemBuilder/runtime'), locationId, byTracker = false }) => onDown(db, { runtime, locationId }, async (row, rule) => {
  const st = stateOf(row.dying);
  if (!st) return { ok: false, error: 'Not down' };
  if (!byTracker && await inFight(db, row)) return { ok: false, error: 'In a fight the tracker counts their turns' };
  const turned = aTurn(rule, st);
  // A save comes due only on a fight's turn: one lit out of a fight would let them roll out of turn once one starts.
  const out = byTracker || !turned.st ? turned : { ...turned, st: { ...turned.st, due: st.due } };
  if (same(st, out.st)) return { ok: true, st, said: null };
  await writeState(db, row, out.st);
  if (announce) {
    announce({ lines: out.said ? [{ line: turnLine(row, rule, out.said), seenBy: seenByOf(row), account: isPlayer(row) ? row.owner : null }] : [], changed: true, owner: isPlayer(row) ? row.owner : null });
  }
  return { ok: true, st: out.st, said: out.said };
});

/**
 * The tracker's turn moments (sockets/initiative.js): each combatant whose turn starts and is down has a turn go by. Ids as
 * the tracker has them ('player:kes', 'npc:12'). Resolves when all are done; never throws.
 */
const dyingTurns = async (db, { runtime = require('../systemBuilder/runtime'), moments }) => {
  for (const { when, ids } of Array.isArray(moments) ? moments : []) {
    if (when !== 'turn_start') continue;
    for (const id of Array.isArray(ids) ? ids : []) {
      const m = /^(npc|player):(.+)$/.exec(String(id));
      if (!m) continue;
      const row = await (m[1] === 'player'
        ? get(db, "SELECT id FROM locations WHERE shape = 'rhombus' AND owner = ? ORDER BY id LIMIT 1", [m[2]])
        : get(db, "SELECT id FROM locations WHERE id = ? AND shape IN ('enemy_rhombus', 'friendly_rhombus')", [Number(m[2])])).catch(() => null);
      // One not down is told so, and nothing changes.
      if (row) await turnGoesBy(db, { runtime, locationId: row.id, byTracker: true }).catch(() => null);
    }
  }
};

module.exports = { noticeHealth, setAnnouncer, publicDying, whoOf, seenByOf, sheetOf, writeState, inTurn, isPlayer, inFight, rollDeathSave, turnGoesBy, dyingTurns };
