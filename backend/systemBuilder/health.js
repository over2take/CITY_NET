// How a custom system's health model takes damage and healing, as pure rules.
//
// The setup answers (core.js) say which model a system uses. This works out what DAMAGE and
// HEAL do under it, from the token's numbers and the sheet behind the token, and hands back
// what to write. Nothing here touches the database; routes/locations.js reads, calls this,
// and writes. The built-in systems never come here: their health is their own code.
//
// Each model keeps the token's current and max as the "how hurt" the heart monitor reads, so
// every model shows on the map; the detail lives on the sheet, in the fields the starter
// sheet makes for it (core.js healthLayout):
//
//   pool       the token's pool; temp HP absorbs first                  (as the built-in route)
//   tracks     the first track is the token's, the second is `<id>` / `<id>_max` on the sheet;
//              with overflow, damage past the second spills into the first  (Shadowrun)
//   typed      boxes = the token's max; each type's marks are `<type id>` on the sheet. On a
//              full track a box turns into the next heavier type             (Vampire)
//   harm       text in `<level id>_<n>`; a full level pushes harm up one; past the top, out (Blades)
//   wounds     the token's current is the wounds left; each taken costs the penalty  (Savage Worlds)
//   locations  the pool, plus a note on the sheet's line for the location hit        (WFRP)
//   none       no damage or healing: consequences are conditions

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const whole = (v) => Math.max(0, Math.floor(num(v)));
const list = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e === 'object') : []);
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** Pool damage as the built-in route does it: temp HP first, then the pool, never below 0. */
const poolDamage = (token, amount) => {
  let temp = whole(token.temp);
  let remaining = amount;
  if (temp >= remaining) { temp -= remaining; remaining = 0; } else { remaining -= temp; temp = 0; }
  return { ...token, current: Math.max(0, num(token.current) - remaining), temp };
};

/** Pool healing: up to the max, when there is one. */
const poolHeal = (token, amount) => {
  const max = num(token.max);
  const raised = num(token.current) + amount;
  return { ...token, current: max > 0 ? Math.min(max, raised) : raised };
};

const fail = (error) => ({ ok: false, error });
const done = (token, sheetPatch = {}, extra = {}) => ({
  ok: true, token, sheetPatch, out: token.current <= 0, ...extra,
});

const tracks = (health, token, sheet, action) => {
  const [first, second] = list(health.tracks);
  if (!first || !second) return fail('This system\'s tracks are not set up');
  const onSecond = action.track === second.id;
  if (action.track !== undefined && !onSecond && action.track !== first.id) return fail('Not one of this system\'s tracks');
  if (action.kind === 'set_max') {
    // The first track's maximum is the token's own, set as for any system.
    if (!onSecond) return fail('The first track\'s maximum is set on the token');
    const patch = { [`${second.id}_max`]: action.amount };
    if (whole(sheet[second.id]) > action.amount) patch[second.id] = action.amount;
    return done(token, patch);
  }
  if (!onSecond) {
    return done(action.kind === 'damage' ? poolDamage(token, action.amount) : poolHeal(token, action.amount));
  }
  const max = num(sheet[`${second.id}_max`]);
  const now = whole(sheet[second.id]);
  if (action.kind === 'heal') return done(token, { [second.id]: Math.max(0, now - action.amount) });
  const raised = now + action.amount;
  // No maximum set: the track just counts up.
  if (max <= 0) return done(token, { [second.id]: raised });
  const excess = Math.max(0, raised - max);
  const patch = { [second.id]: Math.min(max, raised) };
  if (excess > 0 && health.overflow === true) return done(poolDamage(token, excess), patch, { overflow: excess });
  return done(token, patch);
};

const typed = (health, token, sheet, action) => {
  const types = list(health.types);
  if (types.length < 2) return fail('This system\'s damage types are not set up');
  const index = action.type === undefined ? 0 : types.findIndex((t) => t.id === action.type);
  if (index < 0) return fail('Not one of this system\'s damage types');
  const boxes = whole(token.max);
  if (boxes <= 0) return fail('Set the size of the track first');
  const marks = types.map((t) => whole(sheet[t.id]));
  const total = () => marks.reduce((a, b) => a + b, 0);
  const heaviest = types.length - 1;

  let turned = 0;
  if (action.kind === 'heal') {
    // A named type heals its own marks; otherwise the lightest heal first.
    let left = action.amount;
    const order = action.type === undefined ? types.map((_, i) => i) : [index];
    for (const i of order) { const take = Math.min(left, marks[i]); marks[i] -= take; left -= take; }
  } else {
    for (let n = 0; n < action.amount; n += 1) {
      if (total() < boxes) { marks[index] += 1; continue; }
      // Full: the lightest box below the heaviest type becomes one step heavier.
      const lighter = marks.findIndex((m, i) => m > 0 && i < heaviest);
      if (lighter < 0) break; // every box already the heaviest: nothing left to take
      marks[lighter] -= 1;
      marks[lighter + 1] += 1;
      turned += 1;
    }
  }
  // Marks cannot outnumber the boxes, even from a sheet edited by hand.
  const patch = Object.fromEntries(types.map((t, i) => [t.id, marks[i]]));
  const current = Math.max(0, boxes - total());
  // How many boxes turned heavier, for the window to say so.
  return { ok: true, token: { ...token, current }, sheetPatch: patch, out: marks[heaviest] >= boxes, ...(turned ? { turned } : {}) };
};

const harm = (health, token, sheet, action) => {
  const levels = list(health.levels);
  if (!levels.length) return fail('This system\'s harm levels are not set up');
  const index = action.level === undefined ? 0 : levels.findIndex((l) => l.id === action.level);
  if (index < 0) return fail('Not one of this system\'s harm levels');
  const slots = (level) => Array.from({ length: Math.max(1, whole(level.slots)) }, (_, i) => `${level.id}_${i + 1}`);
  const all = levels.flatMap(slots);
  const patch = {};
  let out = false;
  let placed = null;
  if (action.kind === 'heal') {
    // A named slot, or the last one filled at the level.
    const own = slots(levels[index]);
    const target = action.slot !== undefined ? own[action.slot - 1] : [...own].reverse().find((id) => !blank(sheet[id]));
    if (!target) return fail(action.slot !== undefined ? 'No such slot at that level' : 'Nothing to heal at that level');
    patch[target] = '';
  } else {
    const note = blank(action.note) ? 'Harm' : String(action.note).trim().slice(0, 60);
    // The first free slot at this level or, when it is full, the next level up.
    for (let i = index; i < levels.length && !placed; i += 1) {
      const free = slots(levels[i]).find((id) => blank(sheet[id]));
      if (free) { patch[free] = note; placed = levels[i].id; }
    }
    out = !placed;
  }
  const filled = all.filter((id) => !blank(id in patch ? patch[id] : sheet[id])).length;
  const current = out ? 0 : all.length - filled;
  // Which level the harm landed on: the window says so when it moved up.
  return { ok: true, token: { ...token, current, max: all.length }, sheetPatch: patch, out, ...(placed ? { placed } : {}) };
};

const wounds = (health, token, action) => {
  const max = num(token.max) > 0 ? num(token.max) : whole(health.count);
  const current = num(token.current);
  const next = action.kind === 'damage' ? Math.max(0, current - action.amount) : Math.min(max, current + action.amount);
  const taken = Math.max(0, max - next);
  return done({ ...token, current: next, max }, {}, { penalty: taken * num(health.penalty) });
};

const locations = (health, token, sheet, action) => {
  const location = action.location === undefined ? null : list(health.locations).find((l) => l.id === action.location);
  if (action.location !== undefined && !location) return fail('Not one of this system\'s hit locations');
  const patch = {};
  if (location && action.kind === 'damage') {
    const note = blank(action.note) ? 'Hit' : String(action.note).trim().slice(0, 60);
    const before = blank(sheet[location.id]) ? '' : `${String(sheet[location.id]).trim()}; `;
    patch[location.id] = `${before}${note}`.slice(-300);
  }
  if (location && action.kind === 'heal') patch[location.id] = '';
  return done(action.kind === 'damage' ? poolDamage(token, action.amount) : poolHeal(token, action.amount), patch);
};

/**
 * DAMAGE or HEAL under a custom system's health model.
 *
 *   health  the system's core.health (checked on publish)
 *   token   { current, max, temp } from the token
 *   sheet   the data of the sheet behind the token ({} when there is none)
 *   action  { kind: 'damage' | 'heal' | 'set_max', amount, track?, type?, level?, slot?, note?, location? }
 *           set_max is the second track's maximum (tracks only)
 *
 * Returns { ok: true, token, sheetPatch, out, overflow?, penalty?, turned?, placed? } or
 * { ok: false, error }. turned: boxes that turned heavier; placed: the harm level written to.
 */
const applyHealthAction = (health, token, sheet, action) => {
  if (!health || typeof health !== 'object') return fail('This system has no health model');
  if (!action || !['damage', 'heal', 'set_max'].includes(action.kind)) return fail('Damage or heal');
  // A second track's maximum lives on the sheet; every other maximum is the token's own.
  if (action.kind === 'set_max' && health.model !== 'tracks') return fail('This maximum is set on the token');
  const amount = whole(action.amount);
  // Harm is a note, not a number; every other model needs an amount.
  if (health.model !== 'harm' && amount <= 0) return fail('An amount above 0');
  const a = { ...action, amount };
  const t = { current: num(token && token.current), max: num(token && token.max), temp: whole(token && token.temp) };
  const s = sheet && typeof sheet === 'object' ? sheet : {};
  switch (health.model) {
    case 'pool': return done(a.kind === 'damage' ? poolDamage(t, amount) : poolHeal(t, amount));
    case 'tracks': return tracks(health, t, s, a);
    case 'typed': return typed(health, t, s, a);
    case 'harm': return harm(health, t, s, a);
    case 'wounds': return wounds(health, t, a);
    case 'locations': return locations(health, t, s, a);
    case 'none': return fail('This system tracks harm as conditions, not health');
    default: return fail('This system has no health model');
  }
};

module.exports = { applyHealthAction, poolDamage, poolHeal };
