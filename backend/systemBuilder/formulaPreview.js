// One formula as the builder's formula box shows it (formula box 1; approved mockup
// docs/mockups/formula-box.html, 2026-10-29): read by the game's own parser, its mistake said
// before PUBLISH, or worked out for the sample character, with each name it reads and that name's
// value, so the box can say it in words (+2 for each level · sample Level 3: +6).
//
// Stricter than publishing, which only asks that a formula reads: a name the system hasn't got
// (@lvl) quietly counts as 0 at the table, so here it is a mistake, with the nearest real name. A
// modifier's amount reads the sheet as typed and the levels, never a formula (choices.js), so one
// reading a formula is the same mistake PUBLISH refuses.
//
// The sample character has stats only (stats.js `samples`); every level name reads SAMPLE_LEVEL,
// so a formula on levels shows something worth reading.

const { parse, evaluate, references } = require('./expression');
const { ruleValue } = require('./rules');
const { tablesOf, lookupIn, previewDerived } = require('./derived');
const { namesOf, levelNamesOf } = require('./choices');

/** What every level name reads for the sample character. */
const SAMPLE_LEVEL = 3;
/** What a formula box holds: a modifier's amount, an option's requirement, a feature's uses. */
const KINDS = new Set(['amount', 'requires', 'uses']);
/** The most formulas one request reads. */
const MOST = 20;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** How many single-letter changes turn `a` into `b`. */
const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
};

/** The known name nearest `name`, two changes at most, or null. */
const nearest = (name, known) => {
  let best = null;
  let bestAt = 3;
  for (const k of known) {
    const d = distance(name, k);
    if (d < bestAt) { best = k; bestAt = d; }
  }
  return best;
};

/** The sample character as formulas read it: its stats, its formulas worked out, every level at SAMPLE_LEVEL. */
const sampleOf = (definition) => {
  const samples = isPlainObject(definition.samples) ? definition.samples : {};
  const { values } = previewDerived({ lookups: definition.lookups, derived: definition.derived }, samples);
  const levels = Object.fromEntries([...levelNamesOf(definition)].map((n) => [n, SAMPLE_LEVEL]));
  return { ...samples, ...values, ...levels };
};

/**
 * One formula read against `definition`: `{ ok: false, problem, suggest? }` when it can't be used,
 * else `{ ok: true, value, reads }`, `reads` naming each @name it reads with its label and value.
 */
const previewFormula = (definition, text, kind, sample = sampleOf(definition)) => {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, problem: 'Empty' };
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const isTable = (name) => own(tables, name);
  let tree;
  try { tree = parse(text, isTable); } catch (e) { return { ok: false, problem: e.message }; }
  const names = namesOf(definition);
  const fields = [...references(tree).fields];
  const unknown = fields.find((n) => !names.has(n));
  if (unknown) {
    const suggest = nearest(unknown, names.keys());
    return { ok: false, problem: `@${unknown} isn't one of this system's names`, name: unknown, ...(suggest ? { suggest } : {}) };
  }
  if (kind === 'amount') {
    const formulas = new Set((Array.isArray(definition.derived) ? definition.derived : []).filter(isPlainObject).map((d) => d.id));
    const levels = levelNamesOf(definition);
    const formula = fields.find((n) => formulas.has(n) && !levels.has(n));
    if (formula) return { ok: false, problem: `@${formula} is a formula: an amount reads stats as typed and levels` };
  }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const value = evaluate(tree, {
    field: (name) => num(sample[name]),
    rule: (name) => ruleValue(name, sample),
    table: (name, x) => lookupIn(isTable(name) ? tables[name] : [], x),
  });
  return { ok: true, value, reads: fields.map((id) => ({ id, label: names.get(id), value: num(sample[id]) })) };
};

/** Up to MOST formulas, `{ text, kind }` each, read against one sample: the box's request. */
const previewFormulas = (definition, formulas) => {
  const sample = sampleOf(definition);
  return (Array.isArray(formulas) ? formulas : []).slice(0, MOST).map((f) => previewFormula(
    definition, isPlainObject(f) ? f.text : undefined, isPlainObject(f) && KINDS.has(f.kind) ? f.kind : 'requires', sample,
  ));
};

module.exports = { previewFormula, previewFormulas, SAMPLE_LEVEL, MOST, distance, nearest };
