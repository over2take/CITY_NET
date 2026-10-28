// A system's own house rules (4j; approved mockup docs/mockups/optional-rules.html, 2026-10-14):
// rules the GM turns on or off for their table, as the built-in games' house rules are.
//
//   house_rules: [
//     { id: 'magic', name: 'MAGIC', description: 'Characters can learn spells.', starts: false },
//   ],
//
// A rule is made once, and things go under it where they live: a PARTS part
// (parts.shops.only_with), a sheet section, the character sheet's or the NPC stat block's
// (sheet.sections[].only_with), a condition (conditions.hexed.only_with), and a formula's one
// alternative, worked out instead while its rule is on (derived[].alternative: { rule, formula }).
// Off hides and never deletes. `starts` is how a game begins and how an installed copy arrives; the
// table's own choice is kept on the server, never in the definition.
//
// Named "house rules" throughout, never "rules": a formula's $name is one of the engine's built-in
// rules (expression.js), which is something else.
//
// Pure: checks only. definition.js runs them; the game's choice is applied elsewhere.

const { compileSystem } = require('./derived');
const { STANDARD } = require('./conditions');

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = { rules: 20, name: 40, description: 300 };
const RULE_KEYS = new Set(['id', 'name', 'description', 'starts']);
const ALTERNATIVE_KEYS = new Set(['rule', 'formula']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const text = (value, where, max, problems, { required = false } = {}) => {
  if (value === undefined) { if (required) problems.push({ where, message: 'Required' }); return; }
  if (typeof value !== 'string' || (required && !value.trim())) { problems.push({ where, message: required ? 'Cannot be blank' : 'Must be text' }); return; }
  if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

/** The ids of a definition's house rules, from the entries well formed enough to read. */
const houseRuleIdsOf = (definition) => new Set((definition && Array.isArray(definition.house_rules) ? definition.house_rules : [])
  .filter((r) => isPlainObject(r) && typeof r.id === 'string').map((r) => r.id));

/** The house rules list itself. */
const checkList = (list, problems) => {
  if (list === undefined) return;
  if (!Array.isArray(list)) { problems.push({ where: 'house_rules', message: 'Must be a list of house rules' }); return; }
  if (list.length > LIMITS.rules) problems.push({ where: 'house_rules', message: `At most ${LIMITS.rules} house rules` });
  const ids = new Set();
  list.slice(0, LIMITS.rules).forEach((r, i) => {
    const where = isPlainObject(r) && typeof r.id === 'string' ? `house rule ${r.id}` : `house rule ${i + 1}`;
    if (!isPlainObject(r)) { problems.push({ where, message: 'Must be a house rule' }); return; }
    for (const key of Object.keys(r)) if (!RULE_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a house rule' });
    if (typeof r.id !== 'string' || !NAME.test(r.id)) problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (ids.has(r.id)) problems.push({ where, message: 'Defined twice' });
    else ids.add(r.id);
    text(r.name, `${where}, name`, LIMITS.name, problems, { required: true });
    text(r.description, `${where}, description`, LIMITS.description, problems);
    if (r.starts !== undefined && typeof r.starts !== 'boolean') problems.push({ where: `${where}, starts`, message: 'Must say starts: true or starts: false' });
  });
};

/** One `only_with`: absent, or one of the system's house rules. */
const checkOnlyWith = (value, where, ids, problems) => {
  if (value === undefined) return;
  if (typeof value !== 'string' || !ids.has(value)) problems.push({ where: `${where}, only_with`, message: 'Not one of this system\'s house rules' });
};

/** The sections of a sheet layout, each with where it is. */
const sectionsOf = (sheet, label) => (isPlainObject(sheet) && Array.isArray(sheet.sections) ? sheet.sections : [])
  .map((s, i) => [s, isPlainObject(s) && typeof s.id === 'string' ? `${label} section ${s.id}` : `${label} section ${i + 1}`])
  .filter(([s]) => isPlainObject(s));

/**
 * The formulas as they'd be worked out with `on` house rules on: each alternative in its formula's
 * place while its rule is on (an alternative's own mistakes are reported where it is, not here).
 */
const derivedWith = (derived, on) => derived.map((d) => (isPlainObject(d) && isPlainObject(d.alternative) && on.has(d.alternative.rule)
  && typeof d.alternative.formula === 'string' ? { ...d, formula: d.alternative.formula } : d));

/**
 * Each formula's alternative: a rule and a formula, on a formula (not a condition). Its formula is
 * checked as the engine reads it, and the formulas are worked out again with each house rule on
 * alone and with all of them on, so an alternative that makes a loop is found. (A loop only some
 * other mix of rules makes would go unseen; the graph in Phase 5 can check every mix.)
 */
const checkAlternatives = (definition, ids, problems) => {
  const derived = Array.isArray(definition.derived) ? definition.derived : [];
  const withAlternative = new Set();
  derived.forEach((d, i) => {
    if (!isPlainObject(d) || d.alternative === undefined) return;
    const where = typeof d.id === 'string' ? `derived ${d.id}, alternative` : `derived value ${i + 1}, alternative`;
    const a = d.alternative;
    if (d.kind === 'condition') { problems.push({ where, message: 'Only a formula has an alternative' }); return; }
    if (!isPlainObject(a)) { problems.push({ where, message: 'Must say a house rule and a formula' }); return; }
    for (const key of Object.keys(a)) if (!ALTERNATIVE_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Only a house rule and a formula' });
    if (typeof a.rule !== 'string' || !ids.has(a.rule)) problems.push({ where: `${where}, rule`, message: 'Not one of this system\'s house rules' });
    if (typeof a.formula !== 'string' || !a.formula.trim()) { problems.push({ where: `${where}, formula`, message: 'Cannot be blank' }); return; }
    if (typeof d.id === 'string') withAlternative.add(d.id);
  });
  if (!withAlternative.size) return;

  const base = compileSystem({ lookups: definition.lookups, derived });
  const known = new Set((base.ok ? [] : base.problems).map((p) => `${p.where}|${p.message}`));
  const reported = new Set();
  const used = [...new Set(derived.filter((d) => isPlainObject(d) && isPlainObject(d.alternative) && ids.has(d.alternative.rule)).map((d) => d.alternative.rule))];
  for (const on of [...used.map((r) => new Set([r])), new Set(used)]) {
    const tried = compileSystem({ lookups: definition.lookups, derived: derivedWith(derived, on) });
    if (tried.ok) continue;
    for (const p of tried.problems) {
      // A mistake in an alternative's own formula is said where the alternative is.
      const own = /^derived ([a-z][a-z0-9_]*), formula$/.exec(p.where);
      const where = own && withAlternative.has(own[1]) ? `derived ${own[1]}, alternative, formula` : p.where;
      const key = `${where}|${p.message}`;
      if (known.has(`${p.where}|${p.message}`) || reported.has(key)) continue;
      reported.add(key);
      problems.push(own && withAlternative.has(own[1]) ? { where, message: p.message } : { where, message: `${p.message} (with ${[...on].join(', ')} on)` });
    }
  }
};

/** Problems with a definition's house rules and everything that waits on one, pushed onto `problems`. */
const checkHouseRules = (definition, problems) => {
  checkList(definition.house_rules, problems);
  const ids = houseRuleIdsOf(definition);
  if (isPlainObject(definition.parts)) {
    for (const [part, setting] of Object.entries(definition.parts)) if (isPlainObject(setting)) checkOnlyWith(setting.only_with, `parts ${part}`, ids, problems);
  }
  for (const [s, where] of sectionsOf(definition.sheet, 'sheet')) checkOnlyWith(s.only_with, where, ids, problems);
  for (const [s, where] of sectionsOf(isPlainObject(definition.npc) ? definition.npc.sheet : undefined, 'npc sheet')) checkOnlyWith(s.only_with, where, ids, problems);
  if (isPlainObject(definition.conditions)) {
    for (const [id, c] of Object.entries(definition.conditions)) if (isPlainObject(c)) checkOnlyWith(c.only_with, `condition ${id}`, ids, problems);
  }
  checkAlternatives(definition, ids, problems);
};

/** The global_settings key that keeps whether the table has `rule` on while `system` runs. */
const houseRuleKey = (system, rule) => `house_rule:${system}:${rule}`;

/**
 * The table's choices for `system` from global_settings rows ({ key, value }): rule id -> on.
 * '1' is on, '0' off; anything else, or another system's, is no choice at all.
 */
const choicesFrom = (rows, system) => {
  const prefix = `house_rule:${system}:`;
  const chosen = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.key !== 'string' || !r.key.startsWith(prefix)) continue;
    if (r.value === '1') chosen[r.key.slice(prefix.length)] = true;
    else if (r.value === '0') chosen[r.key.slice(prefix.length)] = false;
  }
  return chosen;
};

/** A definition's house rules, well formed enough to run. */
const houseRulesOf = (definition) => (definition && Array.isArray(definition.house_rules) ? definition.house_rules : [])
  .filter((r) => isPlainObject(r) && typeof r.id === 'string');

/** Which house rules are on: the table's choice where it made one, otherwise how each starts. */
const houseRulesOn = (definition, chosen = {}) => new Set(houseRulesOf(definition)
  .filter((r) => (typeof chosen[r.id] === 'boolean' ? chosen[r.id] : r.starts === true)).map((r) => r.id));

/** A sheet layout without the sections waiting on a rule that is off, and the tabs they leave empty. */
const sheetWith = (sheet, on) => {
  if (!isPlainObject(sheet) || !Array.isArray(sheet.sections)) return sheet;
  const waiting = (s) => isPlainObject(s) && typeof s.only_with === 'string' && !on.has(s.only_with);
  if (!sheet.sections.some(waiting)) return sheet;
  const sections = sheet.sections.filter((s) => !waiting(s));
  const next = { ...sheet, sections };
  if (Array.isArray(sheet.tabs)) {
    const used = new Set(sections.map((s) => isPlainObject(s) && s.tab));
    const tabs = sheet.tabs.filter((t) => used.has(t));
    if (tabs.length) next.tabs = tabs; else delete next.tabs;
  }
  // The header's subtitle shows only fields still on the sheet.
  if (isPlainObject(sheet.header) && Array.isArray(sheet.header.subtitleFields)) {
    const fields = new Set(sections.flatMap((s) => (isPlainObject(s) && Array.isArray(s.fields) ? s.fields : []).map((f) => f && f.id)));
    next.header = { ...sheet.header, subtitleFields: sheet.header.subtitleFields.filter((id) => fields.has(id)) };
  }
  return next;
};

/**
 * The definition as the game runs it with the house rules in `on` on (houseRulesOn). Whatever waits on
 * a rule that is off is hidden, never deleted: a part is off, a sheet section (and a tab it leaves
 * empty) is left out of the layout, a standard condition is off and one of the system's own left out;
 * and each formula whose alternative's rule is on is worked out by the alternative instead. A new
 * object: the stored definition is never changed.
 */
const withHouseRules = (definition, on) => {
  if (!isPlainObject(definition)) return definition;
  const off = (v) => typeof v === 'string' && !on.has(v);
  const next = { ...definition };
  if (isPlainObject(definition.parts)) {
    next.parts = Object.fromEntries(Object.entries(definition.parts)
      .map(([id, p]) => [id, isPlainObject(p) && off(p.only_with) ? { ...p, on: false } : p]));
  }
  next.sheet = sheetWith(definition.sheet, on);
  if (next.sheet === undefined) delete next.sheet;
  if (isPlainObject(definition.npc) && definition.npc.sheet !== undefined) next.npc = { ...definition.npc, sheet: sheetWith(definition.npc.sheet, on) };
  if (isPlainObject(definition.conditions)) {
    const standard = new Set(STANDARD.map((c) => c.id));
    next.conditions = Object.fromEntries(Object.entries(definition.conditions)
      .filter(([id, c]) => standard.has(id) || !(isPlainObject(c) && off(c.only_with)))
      .map(([id, c]) => [id, standard.has(id) && isPlainObject(c) && off(c.only_with) ? { ...c, on: false } : c]));
  }
  if (Array.isArray(definition.derived)) next.derived = derivedWith(definition.derived, on);
  return next;
};

module.exports = {
  checkHouseRules, houseRuleIdsOf, houseRulesOf, houseRulesOn, withHouseRules, houseRuleKey, choicesFrom, LIMITS,
};
