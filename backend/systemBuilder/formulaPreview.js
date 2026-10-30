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
//
// Formula box 2 adds a roll's ADD and AGAINST, which also read the stat being rolled (@this,
// @this_mod, @tie, @tie_mod, tableRolls.js): the sample rolls the first stat the roll is ROLLED BY.
// And a rest's refill amounts (rests.js), which name the character's own numbers and may hold dice:
// what dice decide is said as a range, the least to the most they can come to.

const { parse, evaluate, references } = require('./expression');
const { ruleValue } = require('./rules');
const { tablesOf, lookupIn, previewDerived } = require('./derived');
const { namesOf, levelNamesOf } = require('./choices');
const { fieldsRolledBy, fieldsFor } = require('./tableRolls');
const { reachOf } = require('./rests');
const { prepare } = require('./tierRolls');
const { effectiveSheet, fieldsOf } = require('./sheet');

/** What every level name reads for the sample character. */
const SAMPLE_LEVEL = 3;
/**
 * What a formula box holds: a modifier's amount, an option's requirement, a feature's uses; a roll's
 * ADD and AGAINST; a rest's refill amount.
 */
const KINDS = new Set(['amount', 'requires', 'uses', 'add', 'against', 'refill']);
/** What a roll's own names are called in words. */
const ROLL_OWN = new Map([['this', 'rolled stat'], ['this_mod', 'rolled stat\'s modifier'], ['tie', 'tied stat'], ['tie_mod', 'tied stat\'s modifier']]);
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

/** A name the box doesn't know, as its mistake, with the nearest it does. */
const unknownName = (name, known) => {
  const suggest = nearest(name, known);
  return { ok: false, problem: `@${name} isn't one of this system's names`, name, ...(suggest ? { suggest } : {}) };
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * A rest's refill amount: a number, a formula or dice, naming the character's own numbers and no
 * tables. With dice, `value` is the least it comes to and `most` the most.
 */
const previewRefill = (definition, text, sample) => {
  const reach = reachOf(definition);
  const written = [...new Set([...text.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]))];
  const unknown = written.find((n) => !reach.names.has(n));
  if (unknown) return unknownName(unknown, reach.names);
  let prepared;
  try { prepared = prepare(text, { known: (n) => reach.names.has(n), refused: (n) => `@${n} isn't one of this system's names` }); } catch (e) { return { ok: false, problem: e.message }; }
  const counts = prepared.dice.map((d) => (typeof d.count === 'object' ? Math.max(0, Math.round(num(sample[d.count.name]))) : d.count));
  const at = (face) => evaluate(prepared.tree, {
    field: (n) => { const m = /^tier_die_(\d+)$/.exec(n); return m ? counts[Number(m[1])] * face(prepared.dice[Number(m[1])].sides) : num(sample[n]); },
    rule: () => 0, table: () => 0,
  });
  const labels = new Map([...fieldsOf(effectiveSheet(definition)).filter((f) => f && typeof f.id === 'string').map((f) => [f.id, f.label || f.id]), ...namesOf(definition)]);
  const least = at(() => 1);
  const most = at((sides) => sides);
  return {
    ok: true, value: least, ...(prepared.dice.length ? { most } : {}),
    reads: written.map((id) => ({ id, label: labels.get(id) || id, value: num(sample[id]) })),
  };
};

/**
 * One formula read against `definition`: `{ ok: false, problem, suggest? }` when it can't be used,
 * else `{ ok: true, value, reads }`, `reads` naming each @name it reads with its label and value.
 * A roll's box (`kind` add or against) names its roll in `roll`; it says the stat it samples in
 * `rolling`.
 */
const previewFormula = (definition, text, kind, sample = sampleOf(definition), roll = null) => {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, problem: 'Empty' };
  if (kind === 'refill') return previewRefill(definition, text, sample);
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const isTable = (name) => own(tables, name);
  let tree;
  try { tree = parse(text, isTable); } catch (e) { return { ok: false, problem: e.message }; }
  const rolled = kind === 'add' || kind === 'against';
  const names = new Map([...namesOf(definition), ...(rolled ? ROLL_OWN : [])]);
  const fields = [...references(tree).fields];
  const unknown = fields.find((n) => !names.has(n));
  if (unknown) return unknownName(unknown, names.keys());
  if (kind === 'amount') {
    const formulas = new Set((Array.isArray(definition.derived) ? definition.derived : []).filter(isPlainObject).map((d) => d.id));
    const levels = levelNamesOf(definition);
    const formula = fields.find((n) => formulas.has(n) && !levels.has(n));
    if (formula) return { ok: false, problem: `@${formula} is a formula: an amount reads stats as typed and levels` };
  }
  // A roll's box reads the first stat it is ROLLED BY as @this, as the table would.
  const found = rolled && Array.isArray(definition.rolls) ? definition.rolls.find((r) => isPlainObject(r) && r.id === roll) : null;
  const stat = found ? fieldsRolledBy(definition, found)[0] : undefined;
  const field = rolled ? fieldsFor(definition, sample, stat) : (name) => num(sample[name]);
  const value = evaluate(tree, {
    field,
    rule: (name) => ruleValue(name, sample),
    table: (name, x) => lookupIn(isTable(name) ? tables[name] : [], x),
  });
  return {
    ok: true, value, reads: fields.map((id) => ({ id, label: names.get(id), value: field(id) })),
    ...(stat ? { rolling: names.get(stat) || stat } : {}),
  };
};

/** Up to MOST formulas, `{ text, kind, roll? }` each, read against one sample: the box's request. */
const previewFormulas = (definition, formulas) => {
  const sample = sampleOf(definition);
  return (Array.isArray(formulas) ? formulas : []).slice(0, MOST).map((f) => previewFormula(
    definition, isPlainObject(f) ? f.text : undefined, isPlainObject(f) && KINDS.has(f.kind) ? f.kind : 'requires', sample,
    isPlainObject(f) && typeof f.roll === 'string' ? f.roll : null,
  ));
};

module.exports = { previewFormula, previewFormulas, SAMPLE_LEVEL, MOST, distance, nearest };
