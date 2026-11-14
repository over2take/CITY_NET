// Going up a level (7d2b; approved mockup docs/mockups/level-up.html, 2026-11-07). A player goes up once it's
// available: enough XP, or the GM having given them a level, kept on the sheet under OWED_KEY. Any approval is
// the table's, outside the app. The GM's LEVEL_UP gives one that way, so the player still makes their own
// choices, and LEVEL_DOWN takes back a level given but not used, or else a level.
//
// What goes up is a pick in a levelled list (a class), the player saying which when they have several. With no
// levelled list it is a stat called level, written whether the system has one or not, so a game with neither
// still counts. A system with both raises the two together. Changing XP never moves a level.
//
// MAX HEALTH: PER LEVEL by ROLL or THE PLAYER CHOOSES (7d5b): the level's die is rolled in the window and kept with the
// place, for the class it was rolled for, the moment it's rolled, as every roll in the flow is: the player can't roll
// again, take the average instead, or move to another class until the GM clears it. FINISH takes it as the level's.
//
// LEVEL_UP.EXE (7d3a) keeps the player's place under LEVELING_KEY, which class they're raising, so leaving the
// window loses nothing. Nothing else changes until FINISH, which is 'up'. From 7d3b the class can be one they don't
// hold yet, from a levelled list with room, coming in at level 1, and FINISH brings the picks the new level opens:
// each made after the level goes up, checked as a pick on the sheet is, and if one can't be, nothing changes.
//
// An INCREASE (7d6b) unlocked by the new level, a class's or what everyone has at the character's, is spent with
// FINISH too: { feature: { stat: points } }, every point, no more than its most on one stat, on stats it may raise,
// none past where they stop. The GM may go up without spending it. LEVEL_DOWN takes off what the levels it takes
// away were spent on. OR A FEAT INSTEAD (7d6c): a pick from the list it offers, made with FINISH's picks, in place of
// the points, never with them.
//
// What each level gained, put right (7d7b; approved mockup docs/mockups/level-record.html, 2026-11-09): the GM clears a
// past level's kept roll ('clearLevel') for the player to roll again ('rollLevel', to the tray, kept), or sets the
// die's part of any level ('setLevel'; with none, back to the average, level 1 to the full die); and clears an increase
// ('clearIncrease') for the player to spend again ('spendIncrease', checked as at FINISH).
//
// Pure: the socket (sockets/choices.js) stores it through the sheet's queue, and works the numbers out again.

const { choicesOf, heldOf, levelsOf, targetsOf, pickedOf, picksOf: activePicks, unlockedOf, increaseOf, effectiveData, namesOf, INCREASES_KEY } = require('./choices');
const { pickAction } = require('./picking');
const { XP_KEY, advances, earnsXp, levelTable, levelsOf: settingsOf, healthOf, levelDie, averageOf, HEALTH_LEVELS_KEY, HEALTH_BASE_KEY, healthBaseOf } = require('./levels');
const { spentOf } = require('./choices');
const { rankedStatsOf, stepFieldOf, rankNameAt } = require('./ranks');
const { creatingNow, ROLLED_KEPT } = require('./creation');
const crypto = require('crypto');

const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

const OWED_KEY = '_levels_owed';
/** Where LEVEL_UP.EXE's place is kept (7d3a): { list, option } for a class, {} for the level itself. */
const LEVELING_KEY = '_leveling';
const NOT_YET = 'Not yet: there isn\'t enough for the next level';
/** At most this many picks come with one level. */
const MOST_PICKS = 20;
/** The picks sent with a level up, as far as they read: [{ list, option, from? }]. */
const picksOf = (v) => (Array.isArray(v) ? v : []).filter((p) => isPlainObject(p) && typeof p.list === 'string' && typeof p.option === 'string')
  .slice(0, MOST_PICKS).map((p) => ({ list: p.list, option: p.option, ...(typeof p.from === 'string' ? { from: p.from } : {}) }));
/** At most this many increases, and stats in one, come with one level. */
const MOST_INCREASES = 20;
/**
 * The increases sent with a level up (7d6b), as far as they read: { feature: { stat: points } }, whole points from 1.
 * Whether they hold is withIncreasesSpent's.
 */
const increasesOf = (v) => {
  if (!isPlainObject(v)) return {};
  const out = {};
  for (const [feature, spread] of Object.entries(v).slice(0, MOST_INCREASES)) {
    if (!isPlainObject(spread)) continue;
    const kept = Object.fromEntries(Object.entries(spread).slice(0, MOST_INCREASES).filter(([, n]) => Number.isInteger(n) && n >= 1));
    if (Object.keys(kept).length) out[feature] = kept;
  }
  return out;
};
/** The features unlocked on `after` and not on `before`. */
const newlyUnlocked = (definition, before, after) => {
  const had = new Set(unlockedOf(activePicks(definition, before)).map(({ feature }) => feature.id));
  return unlockedOf(activePicks(definition, after)).map(({ feature }) => feature).filter((f) => !had.has(f.id));
};

/**
 * What's wrong with spending an increase so, or null (7d6b): every point, no more than its most on one stat, on stats it
 * raises, none past where they stop, each stat read as it is with everything else on it.
 */
const spreadProblem = (definition, sheet, feature, inc, spread) => {
  const names = namesOf(definition);
  const name = feature.label || feature.id;
  let total = 0;
  const now = effectiveData(definition, sheet);
  // A stat held as a rank (7f1c2) is raised a step a point, up to its top rank, whatever a number would stop at.
  const ranked = new Map(rankedStatsOf(definition).map(({ stat, ranks }) => [stat.id, ranks]));
  for (const [stat, n] of Object.entries(spread)) {
    const statName = String(names.get(stat) || stat);
    if (!inc.stats.includes(stat)) return `${name} doesn't raise ${statName}`;
    if (n > inc.most) return `${name}: at most ${inc.most} on one stat`;
    if (ranked.has(stat)) {
      const ranks = ranked.get(stat);
      const top = ranks.list.length - 1;
      if (Math.round(Number(now[stepFieldOf(stat)]) || 0) + n > top) return `${name}: ${statName} stops at ${rankNameAt(ranks, top)}`;
    } else if (inc.cap !== null && Number(now[stat]) + n > inc.cap) {
      // A stat that isn't a number is never past it.
      return `${name}: ${statName} stops at ${inc.cap}`;
    }
    total += n;
  }
  return total === inc.points ? null : `${name}: spend all ${inc.points} ${inc.points === 1 ? 'point' : 'points'}`;
};
/** The sheet with an increase spent so, kept by its feature. */
const withSpread = (sheet, feature, spread) => ({ ...sheet, [INCREASES_KEY]: { ...(isPlainObject(sheet[INCREASES_KEY]) ? sheet[INCREASES_KEY] : {}), [feature.id]: spread } });
/** Whether a pick was taken in place of an increase's points (7d6c). */
const takenInstead = (definition, sheet, feature, inc) => !!inc.instead && activePicks(definition, sheet).some((p) => p.from === feature.id && p.list.id === inc.instead);

/**
 * The sheet with each INCREASE the new level unlocked spent (7d6b): { data } or { error }. Each stat is checked as it
 * reads with everything else on it, the increases spent before it included. The GM may leave one unspent.
 */
const withIncreasesSpent = (definition, before, after, increases, gm) => {
  let sheet = after;
  for (const feature of newlyUnlocked(definition, before, after)) {
    const inc = increaseOf(definition, feature);
    if (!inc) continue;
    const name = feature.label || feature.id;
    const spread = increases[feature.id];
    const other = inc.instead ? choicesOf(definition).find((c) => c.id === inc.instead) : null;
    // A pick taken in its place (7d6c), with FINISH's picks: then nothing is spent.
    if (other && takenInstead(definition, sheet, feature, inc)) {
      if (spread) return { error: `${name}: the points or a ${other.one || other.id}, not both` };
      continue;
    }
    if (!spread) {
      if (gm) continue;
      return { error: other ? `Spend ${name}'s points, or pick a ${other.one || other.id}, first` : `Spend ${name}'s points first` };
    }
    const problem = spreadProblem(definition, sheet, feature, inc, spread);
    if (problem) return { error: problem };
    sheet = withSpread(sheet, feature, spread);
  }
  return { data: sheet };
};

/** A level of the record (7d7b): a whole number from 1 to the character's level, or why not. */
const recordLevel = (definition, sheet, action) => {
  if (healthOf(definition).how !== 'level') return { error: 'Health isn\'t kept per level in this game' };
  const level = Number(action.level);
  const top = characterLevel(definition, sheet);
  if (!Number.isInteger(level) || level < 1 || level > top) return { error: 'No such level' };
  // An uploaded maximum stands for its levels (7d7c), while it counts.
  const base = healthBaseOf(sheet);
  if (base && top >= base.level && level <= base.level) return { error: 'Counted in the uploaded maximum: the GM clears that first' };
  const kept = isPlainObject(sheet[HEALTH_LEVELS_KEY]) ? sheet[HEALTH_LEVELS_KEY] : {};
  const record = isPlainObject(kept[level]) ? kept[level] : {};
  return { level, kept, record };
};
/** That level's die, as kept, or the first class's (level 1's). Null with none. */
const recordDie = (definition, sheet, record) => {
  if (Number.isInteger(record.die)) return record.die;
  const first = levelTargets(definition, sheet).find((t) => t.option);
  return levelDie(definition, first ? first.option : null);
};
/** The sheet with one level of the record kept so (null: nothing kept). */
const withRecord = (sheet, kept, level, record) => {
  const { [level]: gone, ...rest } = kept;
  const next = record ? { ...rest, [level]: record } : rest;
  return { ...sheet, [HEALTH_LEVELS_KEY]: next };
};
/** An unlocked feature's increase, by id, with the feature (7d7b), or why not. */
const unlockedIncrease = (definition, sheet, id) => {
  const feature = unlockedOf(activePicks(definition, sheet)).map((u) => u.feature).find((f) => f.id === id);
  const inc = feature ? increaseOf(definition, feature) : null;
  return inc ? { feature, inc } : { error: 'No increase unlocked there' };
};
/** The sheet without what the increases a level down locks again were spent on (7d6b). */
const withIncreasesGone = (definition, before, after) => {
  if (!isPlainObject(after[INCREASES_KEY])) return after;
  const locked = new Set(newlyUnlocked(definition, after, before).map((f) => f.id));
  const left = Object.fromEntries(Object.entries(after[INCREASES_KEY]).filter(([id]) => !locked.has(id)));
  if (Object.keys(left).length) return { ...after, [INCREASES_KEY]: left };
  const { [INCREASES_KEY]: gone, ...rest } = after;
  return rest;
};

/** The place's health (7d5b): { roll, die } once rolled, { average: true } once the average was taken. Null before. */
const healthPlaceOf = (data) => {
  const place = isPlainObject(data) ? data[LEVELING_KEY] : null;
  // Whatever reads it checks the roll and the average for itself.
  return isPlainObject(place) && place.health ? place.health : null;
};
/** Whether the place is for this target: the class, or the level itself. */
const placedFor = (data, target) => {
  const place = isPlainObject(data) ? data[LEVELING_KEY] : null;
  if (!isPlainObject(place)) return false;
  // An option's id is the system's own, across every list.
  return !!target.stat || place.option === target.option.id;
};
/** A kept roll for another class: what to say, or null. */
const rolledForAnother = (data, target) => {
  const health = healthPlaceOf(data);
  if (!health || !Number.isInteger(health.roll) || placedFor(data, target)) return null;
  return 'Rolled for health, and kept: your GM can clear it to change class';
};

/**
 * MAX HEALTH: PER LEVEL (7d5a): the sheet with what the level it reached gained, from the die of the class going up
 * (the die for all for the level itself, there being no class): { data } or { error }. AVERAGE (FIXED) takes half the
 * die; ROLL (7d5b) the roll kept with the place, which it must have but from the GM; THE PLAYER CHOOSES either.
 * Nothing kept where health isn't per level.
 */
const withHealthKept = (definition, before, after, target, gm) => {
  const h = healthOf(definition);
  if (h.how !== 'level') return { data: after };
  const level = characterLevel(definition, after);
  const die = levelDie(definition, target.option || null);
  const health = placedFor(before, target) ? healthPlaceOf(before) : null;
  // Nothing is rolled without a die.
  const rolled = health && Number.isInteger(health.roll) ? health.roll : null;
  const average = h.gain === 'average' || (health && health.average === true) || (die === null && !(h.gain === 'beat' && h.beat.way === 'pool')) || gm;
  if (rolled === null && !average) return { error: h.gain === 'choose' ? 'Take the average or roll for health first' : 'Roll for health first' };
  const kept = isPlainObject(after[HEALTH_LEVELS_KEY]) ? after[HEALTH_LEVELS_KEY] : {};
  // A reroll's level adds what took it to its new maximum (7d5c).
  // The GM going up with no roll to beat: the level gains nothing, as an unbeaten roll would.
  if (rolled === null && h.gain === 'beat') return { data: { ...after, [HEALTH_LEVELS_KEY]: { ...kept, [level]: { die, took: 0, gained: 0 } } } };
  const took = rolled === null ? { took: averageOf(die) }
    : Number.isInteger(health.gained) ? { took: rolled, rolled: true, gained: health.gained } : { took: rolled, rolled: true };
  return { data: { ...after, [HEALTH_LEVELS_KEY]: { ...kept, [level]: { die, ...took } } } };
};
/** The sheet without what a level it has left gained. */
const withHealthGone = (data, level) => {
  if (!isPlainObject(data[HEALTH_LEVELS_KEY]) || !(String(level) in data[HEALTH_LEVELS_KEY])) return data;
  const { [level]: gone, ...rest } = data[HEALTH_LEVELS_KEY];
  return { ...data, [HEALTH_LEVELS_KEY]: rest };
};

/** The sheet without a level up's place. */
const settled = (data) => { const { [LEVELING_KEY]: place, ...rest } = data; return rest; };
const whole = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; };
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const levelledLists = (definition) => choicesOf(definition).filter((c) => c.levelled === true);

/** What can go up: a list's own picks with levels, or with no levelled list, the level stat. */
const levelTargets = (definition, data) => {
  if (!levelledLists(definition).length) return [{ stat: true, level: Math.max(1, whole(data.level)) }];
  return heldOf(definition, data).filter((p) => p.active && !p.from && p.list.levelled === true);
};

/** A character's level: a stat called level if there is one, or their levelled picks added up. At least 1. */
const characterLevel = (definition, data) => {
  if (targetsOf(definition).has('level') || !levelledLists(definition).length) return Math.max(1, whole(data.level));
  return Math.max(1, whole(levelsOf(definition, heldOf(definition, data).filter((p) => p.active)).level));
};

const owedOf = (data) => whole(data[OWED_KEY]);
const withOwed = (data, owed) => {
  const { [OWED_KEY]: gone, ...rest } = data;
  return owed > 0 ? { ...rest, [OWED_KEY]: owed } : rest;
};
const atTop = (definition, level) => level >= settingsOf(definition).top;
/** Whether their XP has reached the next level. */
const xpReady = (definition, data, level) => {
  if (!earnsXp(definition)) return false;
  const need = levelTable(definition)[level + 1];
  return need !== undefined && whole(data[XP_KEY]) >= need;
};

/**
 * The sheet with one target's level moved by `by`, and a level stat beside a levelled list moved with it: { data }
 * or { error }. A class not held yet is picked, at level 1, as the player would pick it (7d3b).
 */
const moved = (definition, data, target, by, gm) => {
  if (target.stat) return { data: { ...data, level: target.level + by } };
  const pick = { list: target.list.id, option: target.option.id };
  // Down from a class's level 1 (7d7d): the class goes, the picks under its features waiting.
  const done = target.new ? pickAction(definition, data, { kind: 'pick', ...pick }, { gm })
    : target.level + by < 1 ? pickAction(definition, data, { kind: 'drop', ...pick }, { gm: true })
      : pickAction(definition, data, { kind: 'level', ...pick, level: target.level + by }, { gm: true });
  if (!done.ok) return { error: done.error };
  return { data: targetsOf(definition).has('level') ? { ...done.data, level: Math.max(1, whole(data.level) + by) } : done.data };
};

/** The picks a new level opens, made in turn on the sheet as it now is: { data } or { error }. */
const withPicksMade = (definition, data, picks, gm) => {
  let sheet = data;
  for (const p of picks) {
    const done = pickAction(definition, sheet, { kind: 'pick', ...p }, { gm });
    if (!done.ok) return { error: done.error };
    sheet = done.data;
  }
  return { data: sheet };
};

/** The one named, the only one, or why not. */
const pickTarget = (definition, data, action) => {
  const all = levelTargets(definition, data);
  if (!all.length) {
    const c = levelledLists(definition)[0];
    return { error: `Pick a ${c.one || c.id} first` };
  }
  if (all[0].stat) return { target: all[0] };
  // A class they don't hold yet, from a levelled list they pick from themselves (7d3b).
  const held = all.some((p) => p.option.id === action.option && p.list.id === action.list);
  const joining = !held && typeof action.list === 'string' ? levelledLists(definition).find((c) => c.id === action.list && pickedOf(c) !== 'features') : null;
  const option = joining && (Array.isArray(joining.options) ? joining.options : []).find((o) => isPlainObject(o) && o.id === action.option);
  if (option) return { target: { new: true, list: joining, option, level: 0 } };
  if (typeof action.option === 'string') {
    const named = all.find((p) => p.option.id === action.option && (!action.list || p.list.id === action.list));
    return named ? { target: named } : { error: 'This character doesn\'t hold that' };
  }
  return all.length === 1 ? { target: all[0] } : { error: 'Say which one goes up' };
};

/**
 * { kind: 'up', list, option }: the player when it's available, or the GM any time, to go up now.
 * { kind: 'place', list, option, picks }: which LEVEL_UP.EXE is raising, and the picks made in it, kept until they go up.
 * 'up' takes the picks too: [{ list, option, from }], made once the level is, and the increases (7d6b): { feature: { stat: points } }.
 * 'place' keeps them as they're being spent.
 * { kind: 'healthRoll' | 'healthAverage', list, option } (7d5b): the level's health rolled, or its average taken, kept
 * with the place; a roll comes back as `rolled` for the tray. { kind: 'clearHealth' }: the GM's CLEAR THE ROLL.
 * { kind: 'give' }: the GM's LEVEL_UP, a level for the player to take. { kind: 'down', option }: the GM's LEVEL_DOWN; a class
 * held at level 1 goes (7d7d), unless it is their only one.
 * The record (7d7b): { kind: 'rollLevel', level } a cleared level rolled again, and { kind: 'spendIncrease', feature, spread },
 * the player's or the GM's; { kind: 'clearLevel', level }, { kind: 'setLevel', level, took } and { kind: 'clearIncrease', feature }, the GM's.
 * { kind: 'clearBase' } (7d7c): the GM's, an uploaded maximum gone, each level counted as here.
 * Gives { ok: true, data, level, owed } or { ok: false, error }.
 */
const levelAction = (definition, data, action, { gm = false, rng = cryptoRng } = {}) => {
  const sheet = isPlainObject(data) ? data : {};
  const kind = isPlainObject(action) ? action.kind : null;
  if (!advances(definition)) return { ok: false, error: 'Levels here are typed in' };
  const level = characterLevel(definition, sheet);
  const owed = owedOf(sheet);
  const said = (next) => ({ ok: true, data: next, level: characterLevel(definition, next), owed: owedOf(next) });

  if (kind === 'up') {
    if (atTop(definition, level)) return { ok: false, error: 'Already the highest level' };
    const byXp = xpReady(definition, sheet, level);
    if (!gm && !byXp && !owed) return { ok: false, error: NOT_YET };
    const { target, error } = pickTarget(definition, sheet, action);
    if (error) return { ok: false, error };
    const raised = moved(definition, sheet, target, 1, gm);
    if (raised.error) return { ok: false, error: raised.error };
    const health = withHealthKept(definition, sheet, raised.data, target, gm);
    if (health.error) return { ok: false, error: health.error };
    const picked = withPicksMade(definition, health.data, picksOf(action.picks), gm);
    if (picked.error) return { ok: false, error: picked.error };
    const spent = withIncreasesSpent(definition, sheet, picked.data, increasesOf(action.increases), gm);
    if (spent.error) return { ok: false, error: spent.error };
    const next = settled(spent.data);
    // XP covers it, or a level the GM gave does. What was earned isn't spent on what was given.
    return said(byXp || !owed ? next : withOwed(next, owed - 1));
  }
  if (kind === 'place') {
    if (atTop(definition, level)) return { ok: false, error: 'Already the highest level' };
    if (!gm && !xpReady(definition, sheet, level) && !owed) return { ok: false, error: NOT_YET };
    const { target, error } = pickTarget(definition, sheet, action);
    if (error) return { ok: false, error };
    const another = !gm && rolledForAnother(sheet, target);
    if (another) return { ok: false, error: another };
    const picks = picksOf(action.picks);
    const increases = increasesOf(action.increases);
    // The health already settled for this class stays with it.
    const health = placedFor(sheet, target) ? healthPlaceOf(sheet) : null;
    return said({ ...sheet, [LEVELING_KEY]: { ...(target.stat ? {} : { list: target.list.id, option: target.option.id }), ...(picks.length ? { picks } : {}),
      ...(Object.keys(increases).length ? { increases } : {}), ...(health ? { health } : {}) } });
  }
  if (kind === 'healthRoll' || kind === 'healthAverage') {
    const h = healthOf(definition);
    if (h.how !== 'level' || h.gain === 'average' || (kind === 'healthAverage' && h.gain !== 'choose')) {
      return { ok: false, error: kind === 'healthRoll' ? 'Health isn\'t rolled in this game' : 'Health here isn\'t the player\'s to choose' };
    }
    if (atTop(definition, level)) return { ok: false, error: 'Already the highest level' };
    if (!gm && !xpReady(definition, sheet, level) && !owed) return { ok: false, error: NOT_YET };
    const { target, error } = pickTarget(definition, sheet, action);
    if (error) return { ok: false, error };
    const another = !gm && rolledForAnother(sheet, target);
    if (another) return { ok: false, error: another };
    const kept = placedFor(sheet, target) ? healthPlaceOf(sheet) : null;
    if (!gm && kept && Number.isInteger(kept.roll)) return { ok: false, error: ROLLED_KEPT };
    const die = levelDie(definition, target.option || null);
    // A pool to beat is rolled whatever the class's die (7d5d).
    if (die === null && !(h.gain === 'beat' && h.beat.way === 'pool')) return { ok: false, error: `Nothing to roll: ${target.stat ? 'there is no die for every level' : `${target.option.label || target.option.id} has no HIT DIE`}` };
    const place = placedFor(sheet, target) ? sheet[LEVELING_KEY] : {};
    const at = { ...(target.stat ? {} : { list: target.list.id, option: target.option.id }), ...(Array.isArray(place.picks) ? { picks: place.picks } : {}),
      ...(isPlainObject(place.increases) ? { increases: place.increases } : {}) };
    if (kind === 'healthAverage') return said({ ...sheet, [LEVELING_KEY]: { ...at, health: { average: true } } });
    if (h.gain === 'beat') {
      // Loaded here: it reads this module's characterLevel as it loads.
      const beat = require('./healthLevels').rollToBeat(definition, sheet, die, rng);
      const results = {};
      for (const r of beat.rolls) results[r.die] = [...(results[r.die] || []), r.roll];
      return {
        ...said({ ...sheet, [LEVELING_KEY]: { ...at, health: { roll: beat.total, die, gained: beat.gained, over: beat.over, beat: true } } }),
        rolled: { results, total: beat.total, over: beat.over, gained: beat.gained, dice: beat.rolls.length, beat: true, ...(beat.gainRoll ? { gainDie: beat.gainRoll.die } : {}) },
      };
    }
    if (h.gain === 'reroll') {
      // Loaded here: it reads this module's characterLevel as it loads.
      const all = require('./healthLevels').rerollAll(definition, sheet, die, rng);
      const results = {};
      for (const r of all.rolls) results[r.die] = [...(results[r.die] || []), r.roll];
      return {
        ...said({ ...sheet, [LEVELING_KEY]: { ...at, health: { roll: all.total, die, gained: all.gained, over: all.over } } }),
        rolled: { results, total: all.total, over: all.over, gained: all.gained, dice: all.rolls.length },
      };
    }
    const roll = Math.floor(rng() * die) + 1;
    return { ...said({ ...sheet, [LEVELING_KEY]: { ...at, health: { roll, die } } }), rolled: { sides: die, rolls: [roll], total: roll } };
  }
  if (kind === 'rollLevel') {
    const at = recordLevel(definition, sheet, action);
    if (at.error) return { ok: false, error: at.error };
    if (at.record.cleared !== true) return { ok: false, error: 'Nothing to roll there: your GM clears a roll first' };
    const die = recordDie(definition, sheet, at.record);
    if (!Number.isInteger(die)) return { ok: false, error: 'Nothing to roll: no die at that level' };
    const roll = Math.floor(rng() * die) + 1;
    return { ...said(withRecord(sheet, at.kept, at.level, { die, took: roll, rolled: true })), rolled: { sides: die, rolls: [roll], total: roll, level: at.level } };
  }
  if (kind === 'spendIncrease') {
    const found = unlockedIncrease(definition, sheet, action.feature);
    if (found.error) return { ok: false, error: found.error };
    const { feature, inc } = found;
    const kept = isPlainObject(sheet[INCREASES_KEY]) ? sheet[INCREASES_KEY] : {};
    if (spentOf(inc, kept[feature.id])) return { ok: false, error: 'Already spent: your GM can clear it' };
    if (takenInstead(definition, sheet, feature, inc)) return { ok: false, error: 'Taken as a pick in place of the points' };
    const spread = increasesOf({ [feature.id]: action.spread })[feature.id];
    if (!spread) return { ok: false, error: `Spend ${feature.label || feature.id}'s points first` };
    const problem = spreadProblem(definition, sheet, feature, inc, spread);
    if (problem) return { ok: false, error: problem };
    return said(withSpread(sheet, feature, spread));
  }
  if (!gm) return { ok: false, error: 'That is the GM\'s to do' };
  if (kind === 'clearLevel') {
    const at = recordLevel(definition, sheet, action);
    if (at.error) return { ok: false, error: at.error };
    // Level 1 is the full die, or set: never rolled.
    if (at.record.rolled !== true) return { ok: false, error: 'Nothing rolled there to clear' };
    return said(withRecord(sheet, at.kept, at.level, { die: recordDie(definition, sheet, at.record), cleared: true }));
  }
  if (kind === 'setLevel') {
    const at = recordLevel(definition, sheet, action);
    if (at.error) return { ok: false, error: at.error };
    const die = recordDie(definition, sheet, at.record);
    // None: back to the average, or level 1's full die: nothing kept but its die.
    if (action.took === null || action.took === undefined) return said(withRecord(sheet, at.kept, at.level, at.level === 1 ? null : { die }));
    if (!Number.isInteger(die)) return { ok: false, error: 'Nothing to set: no die at that level' };
    if (!Number.isInteger(action.took) || action.took < 1 || action.took > die) return { ok: false, error: `A whole number from 1 to ${die}` };
    return said(withRecord(sheet, at.kept, at.level, { die, took: action.took, set: true }));
  }
  if (kind === 'clearIncrease') {
    const kept = isPlainObject(sheet[INCREASES_KEY]) ? sheet[INCREASES_KEY] : {};
    if (!Object.prototype.hasOwnProperty.call(kept, action.feature)) return { ok: false, error: 'Nothing spent there to clear' };
    const { [action.feature]: gone, ...rest } = kept;
    if (Object.keys(rest).length) return said({ ...sheet, [INCREASES_KEY]: rest });
    const { [INCREASES_KEY]: all, ...without } = sheet;
    return said(without);
  }
  if (kind === 'clearBase') {
    // Back to each level counted as here: the full die, then each kept or the average (7d7c).
    if (!(HEALTH_BASE_KEY in sheet)) return { ok: false, error: 'No uploaded maximum to clear' };
    const { [HEALTH_BASE_KEY]: gone, ...rest } = sheet;
    return said(rest);
  }
  if (kind === 'clearHealth') {
    const health = healthPlaceOf(sheet);
    if (!health || !Number.isInteger(health.roll)) return { ok: false, error: 'Nothing rolled there to clear' };
    const { health: gone, ...place } = sheet[LEVELING_KEY];
    return said({ ...sheet, [LEVELING_KEY]: place });
  }
  if (kind === 'give') {
    if (atTop(definition, level + owed)) return { ok: false, error: 'Already the highest level' };
    return said(withOwed(sheet, owed + 1));
  }
  if (kind === 'down') {
    if (owed) return said(withOwed(settled(sheet), owed - 1));
    const all = levelTargets(definition, sheet);
    const named = typeof action.option === 'string' ? all.find((p) => p.option && p.option.id === action.option) : null;
    // The last of them, the most recently picked, that has a level to give; with none, the last class held at level 1,
    // which goes (7d7d). A character's only class at level 1 stays.
    const target = named || [...all].reverse().find((p) => p.level > 1) || all[all.length - 1];
    if (!target || (target.level <= 1 && all.length < 2)) return { ok: false, error: 'Already level 1' };
    const lowered = settled(moved(definition, sheet, target, -1, true).data);
    return said(withIncreasesGone(definition, sheet, withHealthGone(lowered, level)));
  }
  return { ok: false, error: 'Nothing to do' };
};

/** The stat a player can't type while levels go up on their own, once the character is made. */
const lockedByLevels = (definition, data) => (definition && advances(definition) && !creatingNow(definition, isPlainObject(data) ? data : {}) ? new Set(['level']) : new Set());

/**
 * The dice-log line for a level's health roll (7d5b): "Wren rolled Health (d10) [7]"; a reroll's (7d5c) "Wren rerolled
 * Health, 4 dice [31]: over 27, the new maximum" or "[20]: not over 27, +1".
 */
const healthRollLine = (who, rolled) => (rolled.beat
  ? `${who} rolled Health to beat ${rolled.over}, ${rolled.dice} ${rolled.dice === 1 ? 'die' : 'dice'} [${rolled.total}]: ${rolled.total > rolled.over ? `beaten, +${rolled.gained}${rolled.gainDie ? ` (d${rolled.gainDie})` : ''}` : 'not beaten, nothing gained'}`
  : rolled.results
  ? `${who} rerolled Health, ${rolled.dice} ${rolled.dice === 1 ? 'die' : 'dice'} [${rolled.total}]: ${rolled.total > rolled.over ? `over ${rolled.over}, the new maximum` : `not over ${rolled.over}, +1`}`
  : `${who} rolled Health${rolled.level ? ` for level ${rolled.level}` : ''} (d${rolled.sides}) [${rolled.total}]`);

module.exports = { OWED_KEY, LEVELING_KEY, characterLevel, levelTargets, levelAction, lockedByLevels, healthRollLine };
