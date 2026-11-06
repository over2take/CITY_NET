// A system's NEW CHARACTER flow (7c1; approved mockup docs/mockups/new-character.html, 2026-11-03):
// the steps a player is walked through for a new character, in the GM's order, in place of a blank
// sheet. Off unless the GM turns it on, so a game with no answer works as it always has.
//
//   creation: {
//     on: true,                               // GUIDED NEW CHARACTER
//     order: ['who', 'stats', 'list:classes', 'kits', 'money'],   // only what was moved
//     off: ['money', 'stats:stress'],         // steps switched off; WHO THEY ARE never is
//     statsBy: 'group',                       // GROUP BY GROUP (7c3a); unsaid, ONE WAY FOR ALL
//     ways: {                                 // how a stats step is set; unsaid, typed in
//       stats: { way: 'array', numbers: [15, 14, 13, 12] },                 // 7c3b
//       'stats:skills': { way: 'roll', each: '4d6 drop lowest', placed: 'arrange' },   // 7c3c; or 'order'
//       'stats:traits': { way: 'buy', points: 20, lowest: 8, highest: 15, costs: { 8: 0, 9: 1 } },   // 7c3d; no costs, 1 for 1
//     },
//     kits: [{                                // 7c4a: what a character can start with
//       id: 'traveler', name: 'TRAVELER',
//       items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }],
//       who: 'pick',                          // all: everyone; pick: a player may; needs: only if; gm: the GM gives it
//       // requires: '@wits >= 12',           // with who: 'needs', the same box as a list's
//     }],
//     money: {                                // 7c4d: what each currency starts at; one unsaid, nothing
//       gold: { how: 'roll', each: '3d6 * 10' },   // whole gold pieces, rolled once, kept
//       honor: { how: 'number', amount: 5 },       // the same for everyone, in its smallest unit
//       silver: { how: 'typed' },                  // what the player says they have
//     },                                      // a system with the app's single money says main
//   }
//
// A step is read from what the system has, never stored: WHO THEY ARE always; THE STATS with stats to
// set, or one for each stats group with GROUP BY GROUP (stats:<group>); one for each list picked on its own (a list picked only under features is picked there, and
// one everyone has isn't picked); KITS; MONEY while the BANK part is on. So a list made later joins
// by itself, before KITS, and a list deleted leaves, and an order naming what has gone is no problem.
// A group left out says so the same way either way, as stats:<group> in `off`: a step switched off with
// GROUP BY GROUP, and left out of THE STATS with ONE WAY FOR ALL. So changing between them loses nothing.
//
// A character's place in the flow (7c2) is kept on their sheet, under CREATING_KEY, where a player's
// own edits can't reach it (an underscore key, as their picks are):
//
//   _creating: {}                   opened, nothing started: the window's START
//   _creating: { at: 'stats' }      working, on that step
//   _creating: { at, rolled: { stats: [14, 9, 12] } }   what a step's ROLL came to (7c3c), kept: once only
//   _creating: { at, kit: 'traveler' }   the kit picked (7c4b), changed as they like: given out at FINISH
//   _creating: { at, money: { gold: 1200 } }   what was rolled or typed for each currency (7c4d): paid at FINISH
//   _creating: { done: true, uploaded?: true }   finished, or came in as an upload
//
// Who is asked at all is the browser's to work out (sheets/newCharacterFlow.ts): a blank sheet with
// nothing here. Being asked only opens a window, so nothing is guarded by it, and nothing is locked
// after it: the sheet works as it always has. What the flow does change on the server, while it is under
// way: a player may take a pick back (picking.js), and may not write a stat set some way other than
// typing (lockedWhileCreating), or a number placed could simply be typed over. Finished, it is theirs.
//
// A way is kept under the step it sets, so one way for all and each group's keep theirs through changing
// between them. A fixed array's numbers are placed by `place`, on the stats themselves, so there is
// nothing else to keep: a number counts as placed while a stat holds it and the pool still has it.
//
// Pure: checks and reads only. definition.js runs the checks, picking.js and the socket the rest.

const { partOn } = require('./parts');
const { currenciesOf } = require('./currencies');
const { choicesOf, pickedOf, meets, needsText } = require('./choices');
const { fieldsOf } = require('./sheet');
const { parse } = require('./expression');
const { cryptoRng } = require('../utils/random');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** How many ids `order` and `off` may hold: every list a system can have, and room. */
const LIMITS = { steps: 40, numbers: 40, rollDice: 20, rollSides: 100, rollAdd: 1000, buyRange: 100, buyPoints: 100000, moneyMost: 1000000000000, kits: 40, kitName: 60, kitItems: 40, itemName: 80, itemQty: 99 };
const KEYS = new Set(['on', 'order', 'off', 'statsBy', 'ways', 'kits', 'money']);
const MONEY_KEYS = { number: new Set(['how', 'amount']), roll: new Set(['how', 'each']), typed: new Set(['how']) };
/** What a system with no currencies of its own calls the app's single money, in `money`. */
const MAIN_MONEY = 'main';
const KIT_KEYS = new Set(['id', 'name', 'items', 'who', 'requires']);
const ITEM_KEYS = new Set(['name', 'qty']);
const KIT_WHO = ['all', 'pick', 'needs', 'gm'];
const KIT_ID = /^[a-z][a-z0-9_]{0,63}$/;
const STATS_STEP = /^stats(?::[a-z][a-z0-9_]{0,63})?$/;
const WAY_KEYS = { typed: new Set(['way']), array: new Set(['way', 'numbers']), roll: new Set(['way', 'each', 'placed']), buy: new Set(['way', 'points', 'lowest', 'highest', 'costs']) };
const PLACED = ['order', 'arrange'];
const ROLL_READS = `Reads like 3d6, 4d6 drop lowest or 2d6 + 6, up to ${LIMITS.rollDice} dice of up to ${LIMITS.rollSides} sides`;
const STEP = /^(?:who|stats(?::[a-z][a-z0-9_]{0,63})?|kits|money|list:[a-z][a-z0-9_]{0,63})$/;
/** Where a sheet keeps its place in the flow. */
const CREATING_KEY = '_creating';

const creationIn = (definition) => (isPlainObject(definition && definition.creation) ? definition.creation : {});
/** A stats group's own step, with GROUP BY GROUP. */
const isGroupStep = (id) => id.startsWith('stats:');
/** The stats groups with stats in them. */
const statGroupsOf = (definition) => list(definition && definition.stats).filter((g) => isPlainObject(g) && list(g.stats).length);
const byGroup = (definition) => creationIn(definition).statsBy === 'group';
/** The groups a player sets: all but those left out. */
const statGroupsAsked = (definition) => {
  const off = new Set(list(creationIn(definition).off));
  return statGroupsOf(definition).filter((g) => !off.has(`stats:${g.id}`));
};

/** Every step this system has, in the order they come until the GM moves them. */
const stepIdsOf = (definition) => [
  'who',
  ...(byGroup(definition)
    ? statGroupsOf(definition).map((g) => `stats:${g.id}`)
    : statGroupsOf(definition).length ? ['stats'] : []),
  ...choicesOf(definition).filter((c) => ['own', 'both'].includes(pickedOf(c))).map((c) => `list:${c.id}`),
  'kits',
  ...(partOn(definition, 'bank') ? ['money'] : []),
];

/**
 * The flow as this system has it: { on, steps: [{ id, off }] }, the steps the GM moved in their order,
 * then any since added, each before KITS and MONEY when it is a list, so a new list lands with the others,
 * and after the other groups when it is a stats group. THE STATS and the groups' steps stand in for each
 * other in an order, so changing how the stats are asked keeps their place.
 */
const creationOf = (definition) => {
  const c = creationIn(definition);
  const have = stepIdsOf(definition);
  const groups = have.filter(isGroupStep);
  const read = list(c.order).flatMap((id) => {
    if (id === 'stats' && byGroup(definition)) return groups;
    return typeof id === 'string' && isGroupStep(id) && !byGroup(definition) ? ['stats'] : [id];
  });
  const moved = read.filter((id, i, all) => have.includes(id) && all.indexOf(id) === i);
  const ids = [...moved];
  for (const id of have) {
    if (ids.includes(id)) continue;
    const lastGroup = ids.map(isGroupStep).lastIndexOf(true);
    const before = id.startsWith('list:') ? ids.findIndex((x) => x === 'kits' || x === 'money')
      : isGroupStep(id) && lastGroup >= 0 ? lastGroup + 1 : -1;
    if (before >= 0) ids.splice(before, 0, id); else ids.push(id);
  }
  const off = new Set(list(c.off));
  return { on: c.on === true, steps: ids.map((id) => ({ id, off: id !== 'who' && off.has(id) })) };
};

/** How a stats step is set: typed in, unless the GM says otherwise. */
const wayOf = (definition, step) => {
  const ways = creationIn(definition).ways;
  const way = isPlainObject(ways) ? ways[step] : null;
  if (isPlainObject(way) && way.way === 'array' && Array.isArray(way.numbers)) return way;
  if (isPlainObject(way) && way.way === 'roll' && typeof way.each === 'string') return way;
  if (isPlainObject(way) && way.way === 'buy' && [way.points, way.lowest, way.highest].every(Number.isSafeInteger)) return way;
  return { way: 'typed' };
};

/** What a number costs in a point buy: its place in the table, or 1 for 1 above the lowest. */
const costOf = (way, n) => {
  if (!isPlainObject(way.costs)) return n - way.lowest;
  return Number.isSafeInteger(way.costs[n]) ? way.costs[n] : 0;
};

/** The number a stat holds in a point buy: the lowest until it is bought up, or if it holds no such number. */
const heldIn = (way, data, stat) => {
  const n = isPlainObject(data) ? data[stat.id] : undefined;
  return Number.isInteger(n) && n >= way.lowest && n <= way.highest ? n : way.lowest;
};

/** The points a character's numbers come to. */
const spentOn = (way, stats, data) => stats.reduce((sum, s) => sum + costOf(way, heldIn(way, data, s)), 0);

/**
 * What a stat is rolled with, as the GM writes it: "3d6", "4d6 drop lowest", "5d6 drop lowest 2",
 * "2d6 + 6". Gives { count, sides, drop, which, add }, or null when it doesn't read.
 */
const parseStatRoll = (text) => {
  const m = /^\s*(\d*)d(\d+)(?:\s+drop\s+(lowest|highest)(?:\s+(\d+))?)?(?:\s*([+-])\s*(\d+))?\s*$/i.exec(typeof text === 'string' ? text : '');
  if (!m) return null;
  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const drop = m[3] ? Number(m[4] ?? 1) : 0;
  const add = m[6] ? Number(m[6]) * (m[5] === '-' ? -1 : 1) : 0;
  if (count < 1 || count > LIMITS.rollDice || sides < 2 || sides > LIMITS.rollSides) return null;
  if (m[3] && (drop < 1 || drop >= count)) return null;
  if (Math.abs(add) > LIMITS.rollAdd) return null;
  return { count, sides, drop, which: m[3] ? m[3].toLowerCase() : null, add };
};

/** The lowest and highest a roll can come to. */
const statRollRange = (r) => ({ lo: (r.count - r.drop) + r.add, hi: (r.count - r.drop) * r.sides + r.add });

/** One stat's roll: every die thrown, and what it comes to with those dropped. */
const rollEach = (r, rng) => {
  const dice = Array.from({ length: r.count }, () => Math.floor(rng() * r.sides) + 1);
  const ordered = [...dice].sort((a, b) => a - b);
  const kept = r.which === 'lowest' ? ordered.slice(r.drop) : r.which === 'highest' ? ordered.slice(0, ordered.length - r.drop) : ordered;
  return { dice, total: kept.reduce((a, b) => a + b, 0) + r.add };
};

/** The stats a step sets: all asked, or one group's, without those the GM keeps to themselves on the sheet. */
const statsOfStep = (definition, step) => {
  const gmOnly = new Set(fieldsOf(definition && definition.sheet).filter((f) => isPlainObject(f) && f.edit === 'gm').map((f) => f.id));
  const groups = step === 'stats' ? statGroupsAsked(definition) : statGroupsOf(definition).filter((g) => `stats:${g.id}` === step);
  return groups.flatMap((g) => g.stats.filter(isPlainObject)).filter((s) => !gmOnly.has(s.id));
};

/**
 * Which numbers of a pool the stats hold, and those left: a number counts once, and a value the pool
 * doesn't have isn't placed (it can only be there from before the GM changed the way).
 */
const placedFrom = (pool, stats, data) => {
  const left = [...pool];
  const placed = {};
  for (const s of stats) {
    const at = left.indexOf(data[s.id]);
    if (at >= 0) placed[s.id] = left.splice(at, 1)[0];
  }
  return { placed, left };
};

/** What a step's ROLL came to on this sheet, or null: not rolled yet. */
const rolledOn = (data, step) => {
  const place = isPlainObject(data) && isPlainObject(data[CREATING_KEY]) ? data[CREATING_KEY] : {};
  const rolled = isPlainObject(place.rolled) ? place.rolled[step] : null;
  return Array.isArray(rolled) ? rolled : null;
};

/** The numbers a step's stats take from: an array's, or what its ROLL came to. Null: nothing yet. */
const poolOf = (definition, data, step) => {
  const way = wayOf(definition, step);
  if (way.way === 'array') return way.numbers;
  return way.way === 'roll' ? rolledOn(data, step) : null;
};

/** Whether a stats step with a way of its own is done: every stat holding a number. */
const wayDone = (definition, data, step) => {
  if (['typed', 'buy'].includes(wayOf(definition, step).way)) return true;
  const pool = poolOf(definition, data, step);
  if (!pool) return false;
  const stats = statsOfStep(definition, step);
  const { placed } = placedFrom(pool, stats, data);
  return stats.every((s) => placed[s.id] !== undefined);
};

/** The kits as written; what isn't one is the checks' to say. */
const kitsOf = (definition) => list(creationIn(definition).kits).filter((k) => isPlainObject(k) && typeof k.id === 'string');
/** A kit's items in words: "Rope, 3x Rations". */
const kitWords = (kit) => list(kit.items).filter(isPlainObject).map((i) => (i.qty === 1 ? i.name : `${i.qty}x ${i.name}`)).join(', ');
/**
 * Every kit as GIVE.EXE lists it (7c4c), any of them being the GM's to hand over: one going to a player
 * that way too, and one going ONLY IF whether or not it is met, as the GM can give anything.
 */
const kitsGivable = (definition) => kitsOf(definition).map((k) => ({ id: k.id, name: k.name, price: 0, holds: kitWords(k) }));
/** One kit by id, to give. */
const kitToGive = (definition, id) => kitsOf(definition).find((k) => k.id === id) || null;

/** The kits a player sees: a kit the GM gives stays the GM's, and could name who it is for. */
const kitsAsked = (definition) => kitsOf(definition).filter((k) => k.who !== 'gm');
/** The kits offered to pick from. */
const kitsOffered = (definition) => kitsOf(definition).filter((k) => k.who === 'pick' || k.who === 'needs');

/**
 * What each currency starts at (7c4d), in the system's order: { id, name, how, ... } for those the GM
 * set. None with the bank off, as there is nowhere to pay it. A currency since deleted is passed over.
 */
const moneyOf = (definition) => {
  const set = creationIn(definition).money;
  if (!isPlainObject(set) || !partOn(definition, 'bank')) return [];
  const currencies = currenciesOf(definition);
  return (currencies.length ? currencies : [{ id: MAIN_MONEY, name: 'Money' }])
    .filter((c) => isPlainObject(set[c.id]) && Object.keys(MONEY_KEYS).includes(set[c.id].how))
    .map((c) => ({ ...set[c.id], id: c.id, name: c.name, currency: c }));
};

/** A roll's whole amount in smallest units: a gold piece, a dollar, the app's money as it comes. */
const wholeOf = (currency) => {
  if (Array.isArray(currency.denominations) && currency.denominations.length) return Math.max(...currency.denominations.map((d) => d.value));
  return 10 ** (Number.isInteger(currency.decimals) ? currency.decimals : 0);
};

/** What money is rolled with, as the GM writes it: a stat's roll, with "* 10" after it if it likes. */
const parseMoneyRoll = (text) => {
  const m = /^(.*?)(?:\s*\*\s*(\d+))?\s*$/.exec(typeof text === 'string' ? text : '');
  const roll = m ? parseStatRoll(m[1]) : null;
  if (!roll) return null;
  const times = m[2] === undefined ? 1 : Number(m[2]);
  return times >= 1 && times <= LIMITS.rollAdd ? { roll, times } : null;
};

/** The steps a player is walked through, in order: those on, with something to ask. */
const stepsAsked = (definition) => creationOf(definition).steps
  .filter((s) => !s.off
    && (s.id !== 'stats' || statGroupsAsked(definition).length > 0)
    && (s.id !== 'kits' || kitsAsked(definition).length > 0)
    && (s.id !== 'money' || moneyOf(definition).length > 0))
  .map((s) => s.id);

/** The ways of the steps asked, those not typed in, by step. */
const waysShown = (definition) => {
  const ways = {};
  for (const step of stepsAsked(definition)) if (STATS_STEP.test(step) && wayOf(definition, step).way !== 'typed') ways[step] = wayOf(definition, step);
  return ways;
};

/** What the browser needs to draw the flow: the steps and the stats to set, or null while it is off. */
const creationShown = (definition) => (creationOf(definition).on ? {
  steps: stepsAsked(definition),
  ...(Object.keys(waysShown(definition)).length ? { ways: waysShown(definition) } : {}),
  ...(moneyOf(definition).length ? {
    money: moneyOf(definition).map(({ id, name, how, amount, each }) => ({ id, name, how, ...(how === 'number' ? { amount } : {}), ...(how === 'roll' ? { each } : {}) })),
  } : {}),
  ...(kitsAsked(definition).length ? {
    kits: kitsAsked(definition).map((k) => ({
      id: k.id, name: k.name, items: list(k.items), who: k.who,
      // In the sheet's words, as an option's is: never a formula.
      ...(k.who === 'needs' ? { needs: needsText(definition, k.requires) } : {}),
    })),
  } : {}),
  stats: statGroupsAsked(definition).map((g) => ({
    id: g.id,
    label: g.label || g.id,
    stats: g.stats.filter(isPlainObject).map((s) => ({ id: s.id, label: s.label || s.id, ...(s.min === undefined ? {} : { min: s.min }), ...(s.max === undefined ? {} : { max: s.max }) })),
  })),
} : null);

/** A sheet's place in the flow, or null. */
const placeOf = (data) => (isPlainObject(data) && isPlainObject(data[CREATING_KEY]) ? data[CREATING_KEY] : null);

/** Whether this character is partway through the flow: opened, not finished, with the flow still on. */
const creatingNow = (definition, data) => {
  const place = placeOf(data);
  return !!place && place.done !== true && creationOf(definition).on;
};

/**
 * The stats a player may not write themselves just now: while this character is being made, those of a
 * step set some way other than typing. Empty with no system (a built-in one), or once it is finished.
 */
const lockedWhileCreating = (definition, data) => {
  if (!definition || !creatingNow(definition, data)) return new Set();
  return new Set(stepsAsked(definition)
    .filter((step) => STATS_STEP.test(step) && wayOf(definition, step).way !== 'typed')
    .flatMap((step) => statsOfStep(definition, step).map((s) => s.id)));
};

/** A number put on a stat, or with `value` null taken back, in its pool. */
const placeNumber = (definition, sheet, action) => {
  if (!stepsAsked(definition).includes(action.step)) return { ok: false, error: 'Not one of this game\'s steps' };
  const way = wayOf(definition, action.step);
  if (way.way !== 'array' && !(way.way === 'roll' && way.placed === 'arrange')) return { ok: false, error: 'These stats aren\'t placed' };
  const pool = poolOf(definition, sheet, action.step);
  if (!pool) return { ok: false, error: 'Roll them first' };
  const stats = statsOfStep(definition, action.step);
  if (!stats.some((s) => s.id === action.stat)) return { ok: false, error: 'Not one of this step\'s stats' };
  const { placed, left } = placedFrom(pool, stats, sheet);
  if (action.value === null) {
    const { [action.stat]: gone, ...rest } = sheet;
    return { ok: true, data: rest };
  }
  // The number already on this stat goes back in the pool as this one comes off it.
  const free = placed[action.stat] === undefined ? left : [...left, placed[action.stat]];
  if (!free.includes(action.value)) return { ok: false, error: 'That number is already placed' };
  return { ok: true, data: { ...sheet, [action.stat]: action.value } };
};

/** A point buy's stats on the sheet: each holding a number it can, the lowest until bought up. */
const filledIn = (definition, sheet, step) => {
  const way = wayOf(definition, step);
  if (way.way !== 'buy') return sheet;
  const next = { ...sheet };
  for (const s of statsOfStep(definition, step)) next[s.id] = heldIn(way, sheet, s);
  return next;
};

/** A stat bought up or down (7c3d): to a number in the range, while the points allow; going down always may. */
const buyNumber = (definition, sheet, action) => {
  if (!stepsAsked(definition).includes(action.step)) return { ok: false, error: 'Not one of this game\'s steps' };
  const way = wayOf(definition, action.step);
  if (way.way !== 'buy') return { ok: false, error: 'These stats aren\'t bought' };
  const stats = statsOfStep(definition, action.step);
  const stat = stats.find((s) => s.id === action.stat);
  if (!stat) return { ok: false, error: 'Not one of this step\'s stats' };
  if (!Number.isInteger(action.value) || action.value < way.lowest || action.value > way.highest) return { ok: false, error: `From ${way.lowest} to ${way.highest}` };
  const next = { ...filledIn(definition, sheet, action.step), [stat.id]: action.value };
  if (spentOn(way, stats, next) > way.points && action.value > heldIn(way, sheet, stat)) return { ok: false, error: 'Not enough points left' };
  return { ok: true, data: next };
};

/** A kit picked (7c4b), or with `kit` null, put back. One at a time: a new pick takes its place. */
const pickKit = (definition, sheet, action) => {
  if (!stepsAsked(definition).includes('kits')) return { ok: false, error: 'Not one of this game\'s steps' };
  const { kit: gone, ...place } = placeOf(sheet);
  if (action.kit === null) return { ok: true, data: { ...sheet, [CREATING_KEY]: place } };
  const kit = kitsOffered(definition).find((k) => k.id === action.kit);
  if (!kit) return { ok: false, error: 'Not a kit to pick from' };
  if (!meets(definition, sheet, kit)) return { ok: false, error: `${kit.name} needs ${needsText(definition, kit.requires)}` };
  return { ok: true, data: { ...sheet, [CREATING_KEY]: { ...place, kit: kit.id } } };
};

/**
 * Why this character can't finish on their kit, or null: a kit to pick left unpicked, or one picked
 * that they have since stopped meeting. With every kit out of reach, there's nothing to ask.
 */
const kitProblem = (definition, sheet) => {
  if (!stepsAsked(definition).includes('kits')) return null;
  const offered = kitsOffered(definition);
  const picked = offered.find((k) => k.id === placeOf(sheet).kit);
  if (picked) return meets(definition, sheet, picked) ? null : `${picked.name} needs ${needsText(definition, picked.requires)}`;
  return offered.some((k) => meets(definition, sheet, k)) ? 'Pick a kit first' : null;
};

/** The items a character finishes with: every kit everyone gets, then the one they picked. */
const kitItemsOf = (definition, sheet) => {
  if (!stepsAsked(definition).includes('kits')) return [];
  const picked = placeOf(sheet).kit;
  return kitsAsked(definition).filter((k) => k.who === 'all' || k.id === picked).flatMap((k) => list(k.items));
};

/** What was rolled or typed for each currency so far. */
const moneyHeld = (sheet) => {
  const place = placeOf(sheet);
  return place && isPlainObject(place.money) ? place.money : {};
};

/** One currency's starting amount set as this asks: rolled once, or typed and changed as they like. */
const setMoney = (definition, sheet, action, rng) => {
  const entry = moneyOf(definition).find((e) => e.id === action.id);
  if (!stepsAsked(definition).includes('money') || !entry) return { ok: false, error: 'Not one of this game\'s amounts' };
  const place = placeOf(sheet);
  const keep = (next) => ({ ...sheet, [CREATING_KEY]: { ...place, money: next } });
  if (action.kind === 'moneyRoll') {
    if (entry.how !== 'roll') return { ok: false, error: `${entry.name} isn't rolled` };
    if (moneyHeld(sheet)[entry.id] !== undefined) return { ok: false, error: 'Rolled, and kept: rolling again is the GM\'s' };
    const parsed = parseMoneyRoll(entry.each);
    if (!parsed) return { ok: false, error: 'This game\'s roll doesn\'t read' };
    const rolled = rollEach(parsed.roll, rng);
    const total = Math.max(0, rolled.total * parsed.times);
    return {
      ok: true,
      data: keep({ ...moneyHeld(sheet), [entry.id]: total * wholeOf(entry.currency) }),
      rolled: { label: String(entry.name).toUpperCase(), each: entry.each, sides: parsed.roll.sides, rolls: rolled.dice, totals: [total], total, named: null },
    };
  }
  if (entry.how !== 'typed') return { ok: false, error: `${entry.name} isn't typed in` };
  if (action.amount === null) {
    const { [entry.id]: gone, ...rest } = moneyHeld(sheet);
    return { ok: true, data: keep(rest) };
  }
  if (!Number.isInteger(action.amount) || action.amount < 0 || action.amount > LIMITS.moneyMost) return { ok: false, error: 'A whole amount, 0 or more' };
  return { ok: true, data: keep({ ...moneyHeld(sheet), [entry.id]: action.amount }) };
};

/** Why this character can't finish on their money, or null. */
const moneyProblem = (definition, sheet) => {
  if (!stepsAsked(definition).includes('money')) return null;
  const missing = moneyOf(definition).find((e) => e.how !== 'number' && !Number.isInteger(moneyHeld(sheet)[e.id]));
  if (!missing) return null;
  return missing.how === 'roll' ? `Roll for ${missing.name} first` : `Say how much ${missing.name} first`;
};

/** What a character is paid on finishing: { id, amount }, the id null for the app's single money. */
const moneyToPay = (definition, sheet) => {
  if (!stepsAsked(definition).includes('money')) return [];
  return moneyOf(definition)
    .map((e) => ({ id: e.id === MAIN_MONEY ? null : e.id, amount: e.how === 'number' ? e.amount : moneyHeld(sheet)[e.id] }))
    .filter((p) => p.amount > 0);
};

/** What a stats step is called, in the log. */
const stepLabel = (definition, step) => {
  if (step === 'stats') return 'THE STATS';
  const group = statGroupsOf(definition).find((g) => `stats:${g.id}` === step);
  return String((group && group.label) || step).toUpperCase();
};

/**
 * A step's ROLL (7c3c): once for each of its stats, on the secure dice, kept. In order, each number goes
 * straight on its stat; arranged, they wait to be placed. Once rolled it stays rolled.
 */
const rollStats = (definition, sheet, action, rng) => {
  if (!stepsAsked(definition).includes(action.step)) return { ok: false, error: 'Not one of this game\'s steps' };
  const way = wayOf(definition, action.step);
  if (way.way !== 'roll') return { ok: false, error: 'These stats aren\'t rolled' };
  if (rolledOn(sheet, action.step)) return { ok: false, error: 'Rolled, and kept: rolling again is the GM\'s' };
  const parsed = parseStatRoll(way.each);
  if (!parsed) return { ok: false, error: 'This game\'s roll doesn\'t read' };
  const stats = statsOfStep(definition, action.step);
  const rolls = stats.map(() => rollEach(parsed, rng));
  const totals = rolls.map((r) => r.total);
  const place = placeOf(sheet);
  const next = { ...sheet, [CREATING_KEY]: { ...place, rolled: { ...(isPlainObject(place.rolled) ? place.rolled : {}), [action.step]: totals } } };
  if (way.placed !== 'arrange') stats.forEach((s, i) => { next[s.id] = totals[i]; });
  return {
    ok: true,
    data: next,
    rolled: {
      label: stepLabel(definition, action.step),
      each: way.each,
      sides: parsed.sides,
      rolls: rolls.flatMap((r) => r.dice),
      totals,
      total: totals.reduce((a, b) => a + b, 0),
      // In order, each is already a stat's, so the log says whose.
      named: way.placed === 'arrange' ? null : stats.map((s) => s.label || s.id),
    },
  };
};

/** The dice-log line for a step's ROLL: "Wren rolled THE STATS (4d6 drop lowest): Might 14, Wits 9". */
const statRollLine = (who, rolled) => `${who} rolled ${rolled.label} (${rolled.each}): ${rolled.totals.map((n, i) => (rolled.named ? `${rolled.named[i]} ${n}` : n)).join(', ')}`;

/**
 * One step of a character's way through the flow: { kind: 'open' }, { kind: 'at', step },
 * { kind: 'place', step, stat, value }, { kind: 'roll', step }, { kind: 'buy', step, stat, value }, { kind: 'kit', kit },
 * { kind: 'moneyRoll', id }, { kind: 'moneyTyped', id, amount } or { kind: 'finish' }. Gives back { ok: true,
 * data } (no `data` when there is nothing to change, `rolled` for the log after a roll, and on finishing
 * `items` to give out and `pay` to pay in, those being the caller's to do), or
 * { ok: false, error } in words. `rng` rolls the dice, 0 to 1 (the secure source unless one is handed in).
 */
const creationAction = (definition, data, action, { rng = cryptoRng } = {}) => {
  const sheet = isPlainObject(data) ? data : {};
  const kind = isPlainObject(action) ? action.kind : null;
  if (!creationOf(definition).on) return { ok: false, error: 'This game has no guided new character' };
  if (kind === 'open') return placeOf(sheet) ? { ok: true } : { ok: true, data: { ...sheet, [CREATING_KEY]: {} } };
  if (!['at', 'finish', 'place', 'roll', 'buy', 'kit', 'moneyRoll', 'moneyTyped'].includes(kind)) return { ok: false, error: 'Nothing to do' };
  if (!creatingNow(definition, sheet)) return { ok: false, error: 'This character isn\'t being made' };
  if (kind === 'place') return placeNumber(definition, sheet, action);
  if (kind === 'roll') return rollStats(definition, sheet, action, rng);
  if (kind === 'buy') return buyNumber(definition, sheet, action);
  if (kind === 'kit') return pickKit(definition, sheet, action);
  if (kind === 'moneyRoll' || kind === 'moneyTyped') return setMoney(definition, sheet, action, rng);
  if (kind === 'finish') {
    if (stepsAsked(definition).some((step) => STATS_STEP.test(step) && !wayDone(definition, sheet, step))) return { ok: false, error: 'Every stat needs its number first' };
    const statSteps = stepsAsked(definition).filter((step) => STATS_STEP.test(step));
    const over = statSteps.some((step) => {
      const way = wayOf(definition, step);
      return way.way === 'buy' && spentOn(way, statsOfStep(definition, step), sheet) > way.points;
    });
    if (over) return { ok: false, error: 'More points spent than there are' };
    const kitWrong = kitProblem(definition, sheet);
    if (kitWrong) return { ok: false, error: kitWrong };
    const moneyWrong = moneyProblem(definition, sheet);
    if (moneyWrong) return { ok: false, error: moneyWrong };
    const filled = statSteps.reduce((data, step) => filledIn(definition, data, step), sheet);
    return { ok: true, data: { ...filled, [CREATING_KEY]: { done: true } }, items: kitItemsOf(definition, sheet), pay: moneyToPay(definition, sheet) };
  }
  if (!stepsAsked(definition).includes(action.step)) return { ok: false, error: 'Not one of this game\'s steps' };
  // A point buy's stats start at their lowest as the player arrives, so what they read says so.
  const arrived = STATS_STEP.test(action.step) ? filledIn(definition, sheet, action.step) : sheet;
  return { ok: true, data: { ...arrived, [CREATING_KEY]: { ...placeOf(sheet), at: action.step } } };
};

/**
 * The sheet after an upload (the approved mockup's call: taken as it is, no steps after it): marked
 * done, so it is never asked. Nothing changes where the flow is off or already finished.
 */
const withUpload = (definition, data) => {
  const place = placeOf(data);
  if (!creationOf(definition).on || (place && place.done === true)) return data;
  return { ...data, [CREATING_KEY]: { done: true, uploaded: true } };
};

/** "2 numbers", "1 stat". */
const counted = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;

/**
 * What stops a step's way working at the table, in words: too few numbers for its stats, or one that
 * doesn't fit a stat, as a player may place each on any.
 */
/** What is wrong with what money is rolled with, in words. */
const moneyRollProblems = (each) => {
  const parsed = parseMoneyRoll(each);
  if (!parsed) return [`${ROLL_READS}, with * 10 after it if you like`];
  const { lo } = statRollRange(parsed.roll);
  return lo < 0 ? [`${each} can roll ${lo * parsed.times}, below nothing`] : [];
};

const stepWayProblems = (definition, step) => {
  const way = wayOf(definition, step);
  const stats = statsOfStep(definition, step);
  if (way.way === 'buy') {
    if (way.lowest > way.highest) return ['The lowest is above the highest'];
    if (way.highest - way.lowest >= LIMITS.buyRange) return [`At most ${LIMITS.buyRange} numbers`];
    const found = [];
    const missing = [];
    if (isPlainObject(way.costs)) {
      for (let n = way.lowest; n <= way.highest; n += 1) if (!Number.isSafeInteger(way.costs[n]) || way.costs[n] < 0) missing.push(n);
    }
    if (missing.length) found.push(`${missing.join(', ')} needs a cost, of 0 or more`);
    const start = stats.length * costOf(way, way.lowest);
    if (start > way.points) found.push(`Every stat at its lowest costs ${start}, more than the ${way.points} points`);
    for (const s of stats) {
      if (Number.isSafeInteger(s.min) && way.lowest < s.min) found.push(`${way.lowest} is below ${s.label || s.id}'s lowest, ${s.min}`);
      if (Number.isSafeInteger(s.max) && way.highest > s.max) found.push(`${way.highest} is above ${s.label || s.id}'s highest, ${s.max}`);
    }
    return found;
  }
  if (way.way === 'roll') {
    const parsed = parseStatRoll(way.each);
    if (!parsed) return [ROLL_READS];
    const { lo, hi } = statRollRange(parsed);
    return stats.flatMap((s) => [
      ...(Number.isSafeInteger(s.min) && lo < s.min ? [`${way.each} can roll ${lo}, below ${s.label || s.id}'s lowest, ${s.min}`] : []),
      ...(Number.isSafeInteger(s.max) && hi > s.max ? [`${way.each} can roll ${hi}, above ${s.label || s.id}'s highest, ${s.max}`] : []),
    ]);
  }
  if (way.way !== 'array') return [];
  const numbers = way.numbers.filter(Number.isSafeInteger);
  const found = [];
  if (numbers.length < stats.length) found.push(`${counted(numbers.length, 'number')} for ${counted(stats.length, 'stat')}: each stat needs one`);
  for (const n of [...new Set(numbers)]) {
    for (const s of stats) {
      if (Number.isSafeInteger(s.min) && n < s.min) found.push(`${n} is below ${s.label || s.id}'s lowest, ${s.min}`);
      if (Number.isSafeInteger(s.max) && n > s.max) found.push(`${n} is above ${s.label || s.id}'s highest, ${s.max}`);
    }
  }
  return found;
};

/** A definition's `ways` checked: what each is, then whether the steps asked can be done that way. */
const checkWays = (definition, ways, problems) => {
  if (ways === undefined) return;
  if (!isPlainObject(ways)) { problems.push({ where: 'creation, ways', message: 'Must say how each step\'s stats are set' }); return; }
  for (const [step, way] of Object.entries(ways)) {
    const where = `creation, ways, ${step}`;
    if (!STATS_STEP.test(step)) { problems.push({ where, message: 'Only the stats have a way to be set' }); continue; }
    if (!isPlainObject(way) || !Object.keys(WAY_KEYS).includes(way.way)) { problems.push({ where, message: 'Must be typed, array, roll or buy' }); continue; }
    for (const key of Object.keys(way)) if (!WAY_KEYS[way.way].has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of this way' });
    if (way.way === 'roll') {
      if (typeof way.each !== 'string') problems.push({ where: `${where}, each`, message: 'Must say what each is rolled with' });
      if (!PLACED.includes(way.placed)) problems.push({ where: `${where}, placed`, message: 'Must be order or arrange' });
      continue;
    }
    if (way.way === 'buy') {
      for (const key of ['points', 'lowest', 'highest']) if (!Number.isSafeInteger(way[key])) problems.push({ where: `${where}, ${key}`, message: 'Must be a whole number' });
      if (Number.isSafeInteger(way.points) && (way.points < 0 || way.points > LIMITS.buyPoints)) problems.push({ where: `${where}, points`, message: `From 0 to ${LIMITS.buyPoints}` });
      if (way.costs !== undefined && !isPlainObject(way.costs)) problems.push({ where: `${where}, costs`, message: 'Must say what each number costs' });
      continue;
    }
    if (way.way !== 'array') continue;
    if (!Array.isArray(way.numbers)) { problems.push({ where: `${where}, numbers`, message: 'Must be a list of numbers' }); continue; }
    if (way.numbers.length > LIMITS.numbers) problems.push({ where: `${where}, numbers`, message: `At most ${LIMITS.numbers} numbers` });
    if (!way.numbers.every(Number.isSafeInteger)) problems.push({ where: `${where}, numbers`, message: 'Must be whole numbers' });
  }
  // Only the way of a step this game has: the other way of asking's stays set, unused.
  for (const { id } of creationOf(definition).steps) {
    if (STATS_STEP.test(id)) stepWayProblems(definition, id).forEach((message) => problems.push({ where: `creation, ways, ${id}`, message }));
  }
};

/** A definition's kits checked (7c4a): each named, with items in it, and saying who gets it. */
const checkKits = (definition, kits, problems) => {
  if (kits === undefined) return;
  if (!Array.isArray(kits)) { problems.push({ where: 'creation, kits', message: 'Must be a list of kits' }); return; }
  // Kits land in the inventory: a sheet designed without one would hide them.
  const designed = isPlainObject(definition.sheet) && Array.isArray(definition.sheet.sections) ? definition.sheet.sections : null;
  if (kits.length && designed && !designed.some((s) => isPlainObject(s) && s.layout === 'inventory')) {
    problems.push({ where: 'creation, kits', message: 'Kits land in the inventory, and this sheet has none: add one on CHARACTER SHEET' });
  }
  if (kits.length > LIMITS.kits) problems.push({ where: 'creation, kits', message: `At most ${LIMITS.kits} kits` });
  const tables = new Set(isPlainObject(definition.lookups) ? Object.keys(definition.lookups) : []);
  const seen = new Set();
  kits.slice(0, LIMITS.kits).forEach((kit, i) => {
    const named = isPlainObject(kit) && typeof kit.name === 'string' && kit.name.trim() ? kit.name.trim() : `${i + 1}`;
    const where = `creation, kit ${named}`;
    if (!isPlainObject(kit)) { problems.push({ where, message: 'Must be a kit' }); return; }
    for (const key of Object.keys(kit)) if (!KIT_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a kit' });
    if (typeof kit.id !== 'string' || !KIT_ID.test(kit.id)) problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (seen.has(kit.id)) problems.push({ where, message: 'Another kit has this id already' });
    else seen.add(kit.id);
    if (typeof kit.name !== 'string' || !kit.name.trim()) problems.push({ where, message: 'Needs a name' });
    else if (kit.name.length > LIMITS.kitName) problems.push({ where, message: `Longer than ${LIMITS.kitName} characters` });
    if (!KIT_WHO.includes(kit.who)) problems.push({ where: `${where}, who`, message: 'Must be all, pick, needs or gm' });
    if (kit.who === 'needs') {
      if (typeof kit.requires !== 'string' || !kit.requires.trim()) problems.push({ where: `${where}, requires`, message: 'ONLY IF needs a requirement' });
      else {
        try { parse(kit.requires, (name) => tables.has(name)); } catch (e) { problems.push({ where: `${where}, requires`, message: e.message }); }
      }
    } else if (kit.requires !== undefined) problems.push({ where: `${where}, requires`, message: 'Only a kit going ONLY IF has a requirement' });
    if (!Array.isArray(kit.items)) { problems.push({ where: `${where}, items`, message: 'Must be a list of items' }); return; }
    if (!kit.items.length) problems.push({ where: `${where}, items`, message: 'Has nothing in it' });
    if (kit.items.length > LIMITS.kitItems) problems.push({ where: `${where}, items`, message: `At most ${LIMITS.kitItems} items` });
    kit.items.slice(0, LIMITS.kitItems).forEach((item) => {
      if (!isPlainObject(item)) { problems.push({ where: `${where}, items`, message: 'Each must be an item' }); return; }
      for (const key of Object.keys(item)) if (!ITEM_KEYS.has(key)) problems.push({ where: `${where}, items, ${key}`, message: 'Not part of an item' });
      if (typeof item.name !== 'string' || !item.name.trim()) problems.push({ where: `${where}, items`, message: 'Each item needs a name' });
      else if (item.name.length > LIMITS.itemName) problems.push({ where: `${where}, items`, message: `${item.name.slice(0, 20)}…: longer than ${LIMITS.itemName} characters` });
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > LIMITS.itemQty) problems.push({ where: `${where}, items`, message: `${typeof item.name === 'string' ? item.name : 'An item'}: from 1 to ${LIMITS.itemQty} of it` });
    });
  });
};

/** A definition's starting money checked (7c4d): each amount read, each roll one that can't go below 0. */
const checkMoney = (money, problems) => {
  if (money === undefined) return;
  if (!isPlainObject(money)) { problems.push({ where: 'creation, money', message: 'Must say what each currency starts at' }); return; }
  for (const [id, set] of Object.entries(money)) {
    const where = `creation, money, ${id}`;
    if (!isPlainObject(set) || !Object.keys(MONEY_KEYS).includes(set.how)) { problems.push({ where, message: 'Must be number, roll or typed' }); continue; }
    for (const key of Object.keys(set)) if (!MONEY_KEYS[set.how].has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of this way' });
    if (set.how === 'number' && (!Number.isInteger(set.amount) || set.amount < 0 || set.amount > LIMITS.moneyMost)) problems.push({ where: `${where}, amount`, message: 'A whole amount, 0 or more' });
    if (set.how === 'roll') moneyRollProblems(set.each).forEach((message) => problems.push({ where: `${where}, each`, message }));
  }
};

/** A definition's `creation` checked, its problems added to `problems`. */
const checkCreation = (definition, problems) => {
  const c = definition.creation;
  if (c === undefined) return;
  if (!isPlainObject(c)) { problems.push({ where: 'creation', message: 'Must say how a new character is made' }); return; }
  for (const key of Object.keys(c)) if (!KEYS.has(key)) problems.push({ where: `creation, ${key}`, message: 'Not part of the new character flow' });
  if (c.on !== undefined && typeof c.on !== 'boolean') problems.push({ where: 'creation, on', message: 'Must say on: true or on: false' });
  for (const key of ['order', 'off']) {
    const v = c[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) { problems.push({ where: `creation, ${key}`, message: 'Must be a list of steps' }); continue; }
    if (v.length > LIMITS.steps) problems.push({ where: `creation, ${key}`, message: `At most ${LIMITS.steps} steps` });
    if (v.slice(0, LIMITS.steps).some((id) => typeof id !== 'string' || !STEP.test(id))) problems.push({ where: `creation, ${key}`, message: 'Steps are who, stats, kits, money, stats: and a group\'s id, or list: and a list\'s id' });
  }
  if (list(c.off).includes('who')) problems.push({ where: 'creation, off', message: 'WHO THEY ARE is always asked: a character needs a name' });
  if (c.statsBy !== undefined && c.statsBy !== 'group') problems.push({ where: 'creation, statsBy', message: 'Must say group, or nothing for one way for all' });
  checkWays(definition, c.ways, problems);
  checkKits(definition, c.kits, problems);
  checkMoney(c.money, problems);
};

module.exports = { LIMITS, CREATING_KEY, stepIdsOf, creationOf, checkCreation, stepsAsked, creationShown, creatingNow, creationAction, withUpload, lockedWhileCreating, placedFrom, stepWayProblems, parseStatRoll, statRollRange, statRollLine, kitsGivable, kitToGive, kitWords, parseMoneyRoll, moneyRollProblems, moneyOf, wholeOf, MAIN_MONEY };
