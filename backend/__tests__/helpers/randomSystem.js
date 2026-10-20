// A whole custom system, made at random from a seed (4k1; plan row 4k random-system-soak): renamed
// words, parts off, building types and catalogues renamed or off, money, a health model, stats,
// formulas and lookup tables, a sheet layout of its own or none, NPC tiers, conditions, rests and
// house rules. The same seed always makes the same system, so a failing soak run (4k2, 4k3) is
// rebuilt from the seed it prints.
//
// Everything it makes is a system the server would publish: no problems at all
// (system_builder_random.test.js holds it to that over hundreds of seeds). It reads the server's own
// lists (terms, parts, building types, health models, standard conditions and rests) so it grows
// with them, and each section is made after what it may name, so nothing names what isn't there.

const { TERMS } = require('../../systemBuilder/terms');
const { PARTS } = require('../../systemBuilder/parts');
const { BUILDING_TYPES, CATALOGUES } = require('../../buildingTypes');
const { HEALTH_MODELS, ADVANCEMENT, DISTANCE } = require('../../systemBuilder/core');
const { STANDARD: STANDARD_CONDITIONS, ICONS } = require('../../systemBuilder/conditions');
const { STANDARD: STANDARD_RESTS, reachOf } = require('../../systemBuilder/rests');
const { starterSheet, effectiveSheet, fieldsOf } = require('../../systemBuilder/sheet');
const { npcSheetOf } = require('../../systemBuilder/npc');
const { PRESETS } = require('../../systemBuilder/rollStyles');

/** A small, fast generator with a seed (mulberry32): the same seed, the same numbers. */
const randomFrom = (seed) => {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const chance = (p) => next() < p;
  const some = (list, p) => list.filter(() => chance(p));
  const SYLLABLES = ['ka', 'ro', 'vel', 'mor', 'tis', 'an', 'ul', 'dra', 'zen', 'pho', 'qui', 'bel', 'sar', 'eth', 'ny', 'gor'];
  /** A made-up word of 1 to 3 syllables, capitalised. */
  const word = (max = 3) => {
    const w = Array.from({ length: int(1, max) }, () => pick(SYLLABLES)).join('');
    return w[0].toUpperCase() + w.slice(1);
  };
  return { next, int, pick, chance, some, word };
};

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const healthOf = (r) => {
  const model = r.pick(HEALTH_MODELS).id;
  const named = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, label: r.word(2).toUpperCase().slice(0, 20) }));
  switch (model) {
    case 'pool': return r.chance(0.5) ? { model, label: r.word(2).toUpperCase().slice(0, 20) } : { model };
    case 'tracks': return { model, tracks: named('trk', 2), overflow: r.chance(0.5) };
    case 'typed': return { model, types: named('dmg', r.int(2, 4)) };
    case 'harm': return { model, levels: named('harm', r.int(1, 6)).map((l) => ({ ...l, slots: r.int(1, 4), ...(r.chance(0.5) ? { penalty: `-${r.int(1, 3)}d` } : {}) })) };
    // 0 - n, not -n: a -0 would not survive being stored as JSON.
    case 'wounds': return { model, count: r.int(1, 10), penalty: 0 - r.int(0, 5) };
    case 'locations': return { model, locations: named('loc', r.int(1, 12)) };
    default: return { model };
  }
};

const currenciesOf = (r) => Array.from({ length: r.int(0, 3) }, (_, i) => {
  const name = r.word(2);
  const id = `cur${i + 1}`;
  const how = r.pick(['whole', 'decimals', 'coins']);
  const extra = { ...(r.chance(0.4) ? { debt: true } : {}), ...(r.chance(0.3) ? { negative: true } : {}) };
  if (how === 'decimals') return { id, name, symbol: r.pick(['$', '£', '¤', 'Cr']), decimals: r.int(1, 3), ...(r.chance(0.3) ? { symbolAfter: true, decimalMark: ',' } : {}), ...extra };
  if (how === 'coins') {
    const n = r.int(2, 3);
    let value = 1;
    const coins = [];
    for (let c = 0; c < n; c += 1) {
      coins.unshift({ id: `${id}c${c + 1}`, name: r.word(2), short: r.word(1).toLowerCase().slice(0, 4), value });
      value *= r.int(2, 20);
    }
    return { id, name, denominations: coins, ...extra };
  }
  return { id, name, ...(r.chance(0.5) ? { short: r.word(1).toLowerCase().slice(0, 4) } : {}), ...extra };
});

/** A formula from stats, tables and the formulas made before it, so none reads itself. */
const formulaFrom = (r, stats, tables, earlier) => {
  const operand = () => {
    const roll = r.next();
    if (roll < 0.4 && stats.length) return `@${r.pick(stats)}`;
    if (roll < 0.55 && tables.length && stats.length) return `${r.pick(tables)}(@${r.pick(stats)})`;
    if (roll < 0.7 && earlier.length) return `@${r.pick(earlier)}`;
    return String(r.int(0, 20));
  };
  const shapes = [
    () => `${operand()} + ${operand()}`,
    () => `${operand()} - ${r.int(0, 5)}`,
    () => `floor(${operand()} / ${r.int(2, 4)})`,
    () => `max(${operand()}, ${operand()})`,
    () => `min(${operand()}, ${r.int(5, 30)})`,
    () => `clamp(${operand()}, ${-r.int(0, 5)}, ${r.int(5, 20)})`,
    () => `if(${operand()} >= ${r.int(0, 15)}, ${operand()}, ${operand()})`,
    () => `${operand()} * ${r.int(1, 3)}`,
  ];
  return r.pick(shapes)();
};

/**
 * The system for `seed`. With `{ parts: false }` every part stays on, for runs that need the
 * game whole.
 */
const randomSystem = (seed, { parts = true } = {}) => {
  const r = randomFrom(seed);
  const def = { format: 1, name: `${r.word()} ${r.word()} ${seed}`.slice(0, 80) };
  if (r.chance(0.6)) def.description = `A game of ${r.word().toLowerCase()} and ${r.word().toLowerCase()}.`;
  if (r.chance(0.4)) def.author = r.word();

  // WORDS: some of the app's terms renamed, a short form where the app has one.
  const words = {};
  for (const term of r.some(Object.keys(TERMS), 0.35)) {
    const w = r.word(2).toUpperCase().slice(0, 40);
    words[term] = { singular: w, plural: `${w}S`.slice(0, 40), ...(TERMS[term].short && r.chance(0.5) ? { short: w.slice(0, 4) } : {}) };
  }
  if (Object.keys(words).length) def.words = words;

  // FEATURES: some parts off; building types and catalogues renamed or off.
  if (parts) {
    const off = r.some(PARTS, 0.2);
    if (off.length) def.parts = Object.fromEntries(off.map((p) => [p, { on: false }]));
  }
  const currencies = currenciesOf(r);
  if (currencies.length) def.currencies = currencies;
  const buildings = {};
  for (const [kind, list] of [['types', BUILDING_TYPES], ['catalogues', CATALOGUES]]) {
    const own = {};
    for (const b of r.some(list, 0.25)) {
      own[b.id] = r.chance(0.3) ? { on: false } : { name: r.word(2) };
      if (kind === 'catalogues' && currencies.length && own[b.id].on !== false && r.chance(0.4)) own[b.id].currency = r.pick(currencies).id;
    }
    if (Object.keys(own).length) buildings[kind] = own;
  }
  if (Object.keys(buildings).length) def.buildings = buildings;
  if (r.chance(0.5)) def.bank = { celebrations: true, ...(r.chance(0.5) ? { whale: r.int(100, 100000) } : {}) };

  // SETUP
  def.core = {
    health: healthOf(r),
    advancement: r.some(ADVANCEMENT.map((a) => a.id), 0.4),
    dice: r.some(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', '2d6', 'd100', '4dF'], 0.3),
    distance: r.pick(DISTANCE),
  };

  // STATS & RULES: stats in groups, a skill group tied to the first, samples within each range.
  const groups = Array.from({ length: r.int(1, 3) }, (_, g) => ({
    id: `grp${g + 1}`,
    label: r.word(2).toUpperCase().slice(0, 40),
    stats: Array.from({ length: r.int(1, 5) }, (_, s) => {
      const lo = r.int(0, 5);
      const stat = { id: `st${g + 1}_${s + 1}`, label: r.word(2) };
      if (r.chance(0.7)) { stat.min = lo; stat.max = lo + r.int(1, 20); }
      return stat;
    }),
  }));
  if (groups.length > 1) {
    for (const s of groups[1].stats) if (r.chance(0.5)) s.tie = r.pick(groups[0].stats).id;
  }
  def.stats = groups;
  const stats = groups.flatMap((g) => g.stats);
  def.samples = Object.fromEntries(stats.map((s) => [s.id, Number.isInteger(s.min) ? r.int(s.min, s.max) : r.int(0, 20)]));
  const tables = Array.from({ length: r.int(0, 2) }, (_, i) => `tbl${i + 1}`);
  if (tables.length) {
    def.lookups = Object.fromEntries(tables.map((t) => {
      let up = r.int(1, 5);
      const bands = Array.from({ length: r.int(1, 4) }, () => { const b = { upTo: up, value: r.int(-3, 5) }; up += r.int(1, 6); return b; });
      return [t, { bands: [...bands, { value: r.int(-3, 8) }] }];
    }));
  }
  const statIds = stats.map((s) => s.id);
  const derived = [];
  for (let i = 0; i < r.int(1, 6); i += 1) {
    derived.push({ id: `fx${i + 1}`, label: r.word(2), formula: formulaFrom(r, statIds, tables, derived.map((d) => d.id)) });
  }
  def.derived = derived;

  // CHARACTER SHEET: automatic, or the starter copied and arranged by hand with fields of its own.
  if (r.chance(0.5)) {
    const sheet = starterSheet(def);
    const tabs = Array.isArray(sheet.tabs) ? sheet.tabs : null;
    for (const s of sheet.sections) {
      if (r.chance(0.3)) s.label = r.word(2).toUpperCase().slice(0, 60);
      if (tabs && s.id !== 'identity' && r.chance(0.2)) s.tab = r.pick(tabs);
    }
    const own = { id: 'own_section', label: r.word(2).toUpperCase(), layout: r.pick(['list', 'grid', 'notes']), fields: [
      { id: 'own_text', label: r.word(2), type: 'text', ...(r.chance(0.5) ? { visibility: 'public' } : {}) },
      { id: 'own_count', label: r.word(2), type: 'number', ...(r.chance(0.5) ? { edit: 'gm' } : {}) },
      { id: 'own_pick', label: r.word(2), type: 'select', options: [{ value: 'a', label: r.word() }, { value: 'b', label: r.word() }] },
    ] };
    if (tabs) own.tab = r.pick(tabs);
    if (own.layout === 'grid') own.columns = r.int(1, 4);
    sheet.sections.push(own);
    def.sheet = sheet;
  }

  // NPCS: a stat block of their own sometimes (the character sheet without its own fields), and tiers.
  if (r.chance(0.3)) {
    const block = JSON.parse(JSON.stringify(effectiveSheet(def)));
    block.sections = block.sections.filter((s) => s.id !== 'own_section');
    def.npc = { sheet: block };
  }
  const tierCount = r.int(0, 3);
  if (tierCount) {
    const npcNumbers = fieldsOf(npcSheetOf(def)).filter((f) => isObject(f) && f.type === 'number' && !f.source && !derived.some((d) => d.id === f.id));
    def.npc = { ...(def.npc || {}), tiers: Array.from({ length: tierCount }, (_, i) => ({
      id: `tier${i + 1}`,
      label: r.word(2).toUpperCase().slice(0, 30),
      hp: r.pick([r.int(1, 40), '@level d8 + 4', `${r.int(2, 10)} + @level`]),
      defense: r.pick([r.int(8, 20), `10 + floor(@level / ${r.int(2, 4)})`]),
      values: Object.fromEntries(r.some(npcNumbers, 0.5).map((f) => [f.id, r.pick([r.int(0, 10), '2d6', '@level + 1'])])),
    })) };
  }

  // CONDITIONS: some standard ones off or renamed, and some of the system's own.
  const conditions = {};
  for (const c of r.some(STANDARD_CONDITIONS, 0.25)) conditions[c.id] = r.chance(0.5) ? { on: false } : { name: r.word(2) };
  const targets = ['all_rolls', ...statIds, ...derived.map((d) => d.id)];
  const restIds = STANDARD_RESTS.map((x) => x.id);
  for (let i = 0; i < r.int(0, 3); i += 1) {
    const own = { name: r.word(2), icon: r.pick(ICONS), description: `${r.word()} ${r.word().toLowerCase()}.` };
    const ends = r.pick(['removed', 'rounds', 'rest']);
    if (ends === 'rounds') { own.ends = 'rounds'; own.rounds = r.int(1, 10); }
    if (ends === 'rest') { own.ends = 'rest'; own.at = [r.pick(restIds)]; }
    if (r.chance(0.6)) own.modifiers = [{ target: r.pick(targets), amount: r.pick([-3, -2, -1, 1, 2]) }];
    conditions[`cond${i + 1}`] = own;
  }
  if (Object.keys(conditions).length) def.conditions = conditions;

  // RESTS: refills of whatever this system's rests can reach, and one or two of its own.
  const reach = reachOf(def);
  const refills = () => {
    const out = [];
    if (reach.health && reach.health.model !== 'none' && r.chance(0.6)) {
      out.push(['pool', 'tracks', 'typed', 'wounds', 'locations'].includes(reach.health.model) && r.chance(0.5)
        ? { what: 'health', how: 'by', amount: r.pick(['1', '1d6', '2']) } : { what: 'health', how: 'full' });
    }
    for (const [id, max] of [...reach.numbers].slice(0, 2)) {
      if (r.chance(0.5)) out.push(max ? { what: id, how: 'max' } : { what: id, how: 'by', amount: r.pick(['1', '-1', '1d4']) });
    }
    return out;
  };
  const rests = {};
  for (const s of r.some(STANDARD_RESTS, 0.4)) {
    rests[s.id] = r.chance(0.2) ? { on: false } : { refills: refills(), ...(r.chance(0.3) ? { name: r.word(2) } : {}) };
  }
  for (let i = 0; i < r.int(0, 2); i += 1) rests[`rest${i + 1}`] = { name: r.word(2), counts_as: [r.pick(restIds)], refills: refills() };
  if (Object.keys(rests).length) def.rests = rests;

  // HOUSE RULES: a few, with something of each kind waiting on them, and alternatives.
  const rules = Array.from({ length: r.int(0, 4) }, (_, i) => ({ id: `rule${i + 1}`, name: r.word(2).toUpperCase(), ...(r.chance(0.4) ? { starts: true } : {}), ...(r.chance(0.5) ? { description: `${r.word()}.` } : {}) }));
  if (rules.length) {
    def.house_rules = rules;
    const ruleId = () => r.pick(rules).id;
    for (const p of r.some(PARTS, 0.1)) def.parts = { ...(def.parts || {}), [p]: { on: !(def.parts && def.parts[p] && def.parts[p].on === false), only_with: ruleId() } };
    for (const sheet of [def.sheet, def.npc && def.npc.sheet]) {
      if (!isObject(sheet)) continue;
      for (const s of sheet.sections) if (s.id !== 'identity' && r.chance(0.2)) s.only_with = ruleId();
    }
    for (const [id, c] of Object.entries(def.conditions || {})) if (r.chance(0.3)) def.conditions[id] = { ...c, only_with: ruleId() };
    // An alternative reads only stats and tables, so no rule can make a loop.
    for (const d of derived) if (r.chance(0.3)) d.alternative = { rule: ruleId(), formula: formulaFrom(r, statIds, tables, []) };
  }

  // GRAPH: the map's layout for some systems, last so every seed's system is otherwise as before.
  if (r.chance(0.6)) {
    const nodes = [...statIds, ...derived.map((d) => d.id), ...tables.map((t) => `table:${t}`), ...rules.map((x) => `rule:${x.id}`)];
    const notes = Array.from({ length: r.int(0, 3) }, (_, i) => ({ id: `n${i + 1}`, text: `${r.word()} ${r.word()}.`, ...(nodes.length && r.chance(0.8) ? { on: r.pick(nodes.filter((n) => !n.startsWith('note:'))) } : {}) }));
    const grouped = r.some(derived.map((d) => d.id), 0.4);
    const graph = { positions: Object.fromEntries([...nodes, ...notes.map((n) => `note:${n.id}`)].map((n) => [n, [r.int(0, 60) * 24, r.int(0, 40) * 24]])) };
    if (grouped.length) graph.groups = [{ id: 'mapgroup1', label: r.word(2).toUpperCase().slice(0, 40), members: grouped }];
    const foldable = [...groups.map((g) => g.id), ...(grouped.length ? ['mapgroup1'] : [])];
    if (foldable.length && r.chance(0.5)) graph.collapsed = r.some(foldable, 0.5);
    if (notes.length) graph.notes = notes;
    def.graph = graph;
  }

  // ROLLS (6a2a): for some systems, each from a preset, rolled by stats, groups and formulas it
  // has; last, so every seed's system is otherwise as before.
  if (r.chance(0.5)) {
    const rollables = [...statIds, ...groups.map((g) => g.id), ...derived.map((d) => d.id)];
    def.rolls = Array.from({ length: r.int(1, 4) }, (_, i) => {
      const key = r.pick(Object.keys(PRESETS));
      return { id: `roll${i + 1}`, label: r.word(2).slice(0, 40), ...JSON.parse(JSON.stringify(PRESETS[key].roll)), by: r.some(rollables, 0.3) };
    });
  }
  return def;
};

module.exports = { randomSystem, randomFrom };
