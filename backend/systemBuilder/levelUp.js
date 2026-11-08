// Going up a level (7d2b; approved mockup docs/mockups/level-up.html, 2026-11-07). A player goes up once it's
// available: enough XP, or the GM having given them a level, kept on the sheet under OWED_KEY. Any approval is
// the table's, outside the app. The GM's LEVEL_UP gives one that way, so the player still makes their own
// choices, and LEVEL_DOWN takes back a level given but not used, or else a level.
//
// What goes up is a pick in a levelled list (a class), the player saying which when they have several. With no
// levelled list it is a stat called level, written whether the system has one or not, so a game with neither
// still counts. A system with both raises the two together. Changing XP never moves a level.
//
// LEVEL_UP.EXE (7d3a) keeps the player's place under LEVELING_KEY, which class they're raising, so leaving the
// window loses nothing. Nothing else changes until FINISH, which is 'up'. From 7d3b the class can be one they don't
// hold yet, from a levelled list with room, coming in at level 1, and FINISH brings the picks the new level opens:
// each made after the level goes up, checked as a pick on the sheet is, and if one can't be, nothing changes.
//
// Pure: the socket (sockets/choices.js) stores it through the sheet's queue, and works the numbers out again.

const { choicesOf, heldOf, levelsOf, targetsOf, pickedOf } = require('./choices');
const { pickAction } = require('./picking');
const { XP_KEY, advances, earnsXp, levelTable, levelsOf: settingsOf } = require('./levels');
const { creatingNow } = require('./creation');

const OWED_KEY = '_levels_owed';
/** Where LEVEL_UP.EXE's place is kept (7d3a): { list, option } for a class, {} for the level itself. */
const LEVELING_KEY = '_leveling';
const NOT_YET = 'Not yet: there isn\'t enough for the next level';
/** At most this many picks come with one level. */
const MOST_PICKS = 20;
/** The picks sent with a level up, as far as they read: [{ list, option, from? }]. */
const picksOf = (v) => (Array.isArray(v) ? v : []).filter((p) => isPlainObject(p) && typeof p.list === 'string' && typeof p.option === 'string')
  .slice(0, MOST_PICKS).map((p) => ({ list: p.list, option: p.option, ...(typeof p.from === 'string' ? { from: p.from } : {}) }));
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
  const done = target.new
    ? pickAction(definition, data, { kind: 'pick', list: target.list.id, option: target.option.id }, { gm })
    : pickAction(definition, data, { kind: 'level', list: target.list.id, option: target.option.id, level: target.level + by }, { gm: true });
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
 * 'up' takes the picks too: [{ list, option, from }], made once the level is.
 * { kind: 'give' }: the GM's LEVEL_UP, a level for the player to take. { kind: 'down', option }: the GM's LEVEL_DOWN.
 * Gives { ok: true, data, level, owed } or { ok: false, error }.
 */
const levelAction = (definition, data, action, { gm = false } = {}) => {
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
    const picked = withPicksMade(definition, raised.data, picksOf(action.picks), gm);
    if (picked.error) return { ok: false, error: picked.error };
    const next = settled(picked.data);
    // XP covers it, or a level the GM gave does. What was earned isn't spent on what was given.
    return said(byXp || !owed ? next : withOwed(next, owed - 1));
  }
  if (kind === 'place') {
    if (atTop(definition, level)) return { ok: false, error: 'Already the highest level' };
    if (!gm && !xpReady(definition, sheet, level) && !owed) return { ok: false, error: NOT_YET };
    const { target, error } = pickTarget(definition, sheet, action);
    if (error) return { ok: false, error };
    const picks = picksOf(action.picks);
    return said({ ...sheet, [LEVELING_KEY]: { ...(target.stat ? {} : { list: target.list.id, option: target.option.id }), ...(picks.length ? { picks } : {}) } });
  }
  if (!gm) return { ok: false, error: 'That is the GM\'s to do' };
  if (kind === 'give') {
    if (atTop(definition, level + owed)) return { ok: false, error: 'Already the highest level' };
    return said(withOwed(sheet, owed + 1));
  }
  if (kind === 'down') {
    if (owed) return said(withOwed(settled(sheet), owed - 1));
    const all = levelTargets(definition, sheet);
    const named = typeof action.option === 'string' ? all.find((p) => p.option && p.option.id === action.option) : null;
    // The last of them, the most recently picked, that has a level to give.
    const target = named || [...all].reverse().find((p) => p.level > 1);
    if (!target || target.level <= 1) return { ok: false, error: 'Already level 1' };
    return said(settled(moved(definition, sheet, target, -1, true).data));
  }
  return { ok: false, error: 'Nothing to do' };
};

/** The stat a player can't type while levels go up on their own, once the character is made. */
const lockedByLevels = (definition, data) => (definition && advances(definition) && !creatingNow(definition, isPlainObject(data) ? data : {}) ? new Set(['level']) : new Set());

module.exports = { OWED_KEY, LEVELING_KEY, characterLevel, levelTargets, levelAction, lockedByLevels };
