// A system's derived values, from a definition instead of code.
//
// Today each game system's derived values - CWN's attribute modifiers and saves, Shadowrun's
// condition monitors - are a hand-written function in sheets/templates.js. This works the same
// kind of values out from a description a GM could write:
//
//   {
//     lookups: {
//       attribute_mod: { bands: [{ upTo: 3, value: -2 }, { upTo: 7, value: -1 }, { value: 0 }] },
//     },
//     derived: [
//       { id: 'str_mod', formula: 'attribute_mod(@str)' },
//       { id: 'save_physical', formula: '16 - (@level + max(@str_mod, @con_mod))' },
//       { id: 'burdened', kind: 'condition', when: '@load > @str', then: '1', else: '0' },
//     ],
//   }
//
// Formula: an expression (expression.js). Lookup: a table of bands, read top to bottom - the
// first band whose `upTo` the value does not exceed gives the answer, and the last band, with
// no `upTo`, catches everything above. Condition: `when` decides between `then` and `else`.
//
// Nothing live calls this yet. It is proven against the hand-written functions it would
// replace (see __tests__/system_builder_parity.test.js) before any system is moved onto it.
//
// Checking is separate from running, and reports every problem at once rather than the first,
// because the builder will show them as a list beside the graph.

const { parse, evaluate, references, NAME, BUILTINS } = require('./expression');
const { ruleValue, hasRule } = require('./rules');

const LIMITS = {
  /** Derived values in one system. */
  derived: 500,
  /** Lookup tables in one system. */
  lookups: 100,
  /** Bands in one lookup table. */
  bands: 100,
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Read a band table: the value for `x`. Bands are already checked. */
const lookupIn = (bands, x) => {
  for (const b of bands) {
    if (b.upTo === undefined || x <= b.upTo) return b.value;
  }
  return 0;
};

const checkLookups = (lookups, problems) => {
  const tables = {};
  if (lookups === undefined) return tables;
  if (!lookups || typeof lookups !== 'object' || Array.isArray(lookups)) {
    problems.push({ where: 'lookups', message: 'Lookups must be a set of named tables' });
    return tables;
  }
  const names = Object.keys(lookups);
  if (names.length > LIMITS.lookups) problems.push({ where: 'lookups', message: `More than ${LIMITS.lookups} lookup tables` });
  for (const name of names.slice(0, LIMITS.lookups)) {
    const where = `lookup ${name}`;
    if (!NAME.test(name)) { problems.push({ where, message: 'Names use lowercase letters, digits and _, starting with a letter' }); continue; }
    if (BUILTINS[name]) { problems.push({ where, message: `"${name}" is a built-in function; pick another name` }); continue; }
    const bands = lookups[name] && lookups[name].bands;
    if (!Array.isArray(bands) || bands.length === 0) { problems.push({ where, message: 'A table needs at least one band' }); continue; }
    if (bands.length > LIMITS.bands) { problems.push({ where, message: `More than ${LIMITS.bands} bands` }); continue; }
    let ok = true;
    let last = -Infinity;
    bands.forEach((b, i) => {
      const at = `${where}, band ${i + 1}`;
      if (!b || typeof b !== 'object' || !isFiniteNumber(b.value)) { problems.push({ where: at, message: 'Each band needs a number value' }); ok = false; return; }
      const final = i === bands.length - 1;
      if (b.upTo === undefined) {
        if (!final) { problems.push({ where: at, message: 'Only the last band may leave "up to" open' }); ok = false; }
        return;
      }
      if (!isFiniteNumber(b.upTo)) { problems.push({ where: at, message: '"Up to" must be a number' }); ok = false; return; }
      if (b.upTo <= last) { problems.push({ where: at, message: '"Up to" must rise from band to band' }); ok = false; }
      last = b.upTo;
    });
    if (ok) tables[name] = bands.map((b) => ({ upTo: b.upTo, value: b.value }));
  }
  return tables;
};

/** The expressions an entry is made of, by the part of the entry they came from. */
const partsOf = (entry) => (entry.kind === 'condition'
  ? { when: entry.when, then: entry.then, else: entry.else }
  : { formula: entry.formula });

/**
 * Check a definition and prepare it to run.
 *
 * Returns `{ ok: false, problems: [{ where, message }] }`, or `{ ok: true, system }` where
 * `system.evaluate(data)` gives every derived value and `system.apply(data)` writes them the
 * way the hand-written recompute functions do.
 */
const compileSystem = (definition) => {
  const problems = [];
  const def = definition && typeof definition === 'object' ? definition : {};
  const tables = checkLookups(def.lookups, problems);
  const isTable = (name) => Object.prototype.hasOwnProperty.call(tables, name)
    || Object.prototype.hasOwnProperty.call(def.lookups || {}, name);

  const entries = Array.isArray(def.derived) ? def.derived : [];
  if (!Array.isArray(def.derived)) problems.push({ where: 'derived', message: 'Derived values must be a list' });
  if (entries.length > LIMITS.derived) problems.push({ where: 'derived', message: `More than ${LIMITS.derived} derived values` });

  const compiled = [];
  const seen = new Set();
  for (const [i, entry] of entries.slice(0, LIMITS.derived).entries()) {
    const id = entry && entry.id;
    const where = typeof id === 'string' && id ? `derived ${id}` : `derived value ${i + 1}`;
    if (!entry || typeof entry !== 'object') { problems.push({ where, message: 'Not a derived value' }); continue; }
    if (typeof id !== 'string' || !NAME.test(id)) { problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' }); continue; }
    if (seen.has(id)) { problems.push({ where, message: 'Defined twice' }); continue; }
    seen.add(id);
    if (entry.kind !== undefined && entry.kind !== 'formula' && entry.kind !== 'condition') {
      problems.push({ where, message: `Unknown kind "${entry.kind}"` });
      continue;
    }

    const trees = {};
    let ok = true;
    for (const [part, source] of Object.entries(partsOf(entry))) {
      try {
        trees[part] = parse(source, isTable);
      } catch (err) {
        problems.push({ where: `${where}, ${part}`, message: err.message });
        ok = false;
      }
    }
    if (!ok) continue;

    const refs = { fields: new Set(), rules: new Set() };
    for (const tree of Object.values(trees)) {
      const r = references(tree);
      r.fields.forEach((f) => refs.fields.add(f));
      r.rules.forEach((x) => refs.rules.add(x));
    }
    for (const r of refs.rules) {
      if (!hasRule(r)) { problems.push({ where, message: `No rule called $${r}` }); ok = false; }
    }
    if (!ok) continue;
    compiled.push({ id, kind: entry.kind === 'condition' ? 'condition' : 'formula', trees, fields: refs.fields });
  }

  // Order: a value is worked out after every derived value it reads. Anything else @named is a
  // plain sheet field. A loop is reported with its path, since "A needs B needs A" is the
  // mistake a GM can actually fix.
  const byId = new Map(compiled.map((c) => [c.id, c]));
  const order = [];
  const state = new Map(); // id -> 'visiting' | 'done'
  const loops = [];
  const visit = (id, path) => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') {
      const from = path.indexOf(id);
      loops.push([...path.slice(from), id]);
      return;
    }
    state.set(id, 'visiting');
    for (const dep of byId.get(id).fields) {
      if (byId.has(dep)) visit(dep, [...path, id]);
    }
    state.set(id, 'done');
    order.push(id);
  };
  // Iterative over entries, recursive over dependencies: depth is bounded by LIMITS.derived.
  for (const c of compiled) visit(c.id, []);
  for (const loop of loops) {
    problems.push({ where: `derived ${loop[0]}`, message: `Depends on itself: ${loop.join(' → ')}` });
  }

  if (problems.length) return { ok: false, problems };

  const evaluateAll = (data) => {
    const sheet = data || {};
    const values = {};
    const ruleCache = new Map();
    const env = {
      field: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : num(sheet[name])),
      rule: (name) => {
        if (!ruleCache.has(name)) ruleCache.set(name, ruleValue(name, sheet));
        return ruleCache.get(name);
      },
      table: (name, x) => lookupIn(tables[name], x),
    };
    for (const id of order) {
      const c = byId.get(id);
      values[id] = c.kind === 'condition'
        ? (evaluate(c.trees.when, env) !== 0 ? evaluate(c.trees.then, env) : evaluate(c.trees.else, env))
        : evaluate(c.trees.formula, env);
    }
    return values;
  };

  /**
   * Write every derived value onto `data`, in the order the definition lists them, and return
   * the ids that changed - the contract of the recompute functions in sheets/templates.js, so
   * one can stand in for the other.
   */
  const apply = (data) => {
    const values = evaluateAll(data);
    const changed = [];
    for (const c of compiled) {
      const value = values[c.id];
      if (num(data[c.id]) !== value || data[c.id] === undefined) {
        data[c.id] = value;
        changed.push(c.id);
      }
    }
    return changed;
  };

  return {
    ok: true,
    system: { order: [...order], ids: compiled.map((c) => c.id), evaluate: evaluateAll, apply },
  };
};

/** The id a problem is about, when it is one derived value's: "derived save, formula" → "save". */
const problemId = (p) => {
  const m = /^derived ([a-z][a-z0-9_]*)(,|$)/.exec(p.where || '');
  return m ? m[1] : null;
};

/**
 * Every derived value the builder can show while a GM is still writing them (4b2b): worked out from
 * `data` (the sample character), leaving out each value with a problem and every value that reads
 * one, so one unfinished formula doesn't blank the rest. Returns { values, problems }, the problems
 * all of compileSystem's. The running game never uses this: it runs only a published, whole system.
 */
const previewDerived = ({ lookups, derived }, data) => {
  const all = Array.isArray(derived) ? derived : [];
  const first = compileSystem({ lookups, derived: all });
  if (first.ok) return { values: first.system.evaluate(data), problems: [] };
  let kept = all;
  let compiled = first;
  // Each round drops what failed and what reads it; bounded, since each drops at least one.
  for (let round = 0; round <= all.length && !compiled.ok; round += 1) {
    const out = new Set(compiled.problems.map(problemId).filter(Boolean));
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of kept) {
        if (!d || out.has(d.id)) continue;
        const text = [d.formula, d.when, d.then, d.else].filter((s) => typeof s === 'string').join(' ');
        if ([...out].some((id) => new RegExp(`@${id}(?![a-z0-9_])`).test(text))) { out.add(d.id); grew = true; }
      }
    }
    const next = kept.filter((d) => d && typeof d.id === 'string' && !out.has(d.id));
    if (next.length === kept.length) break;
    kept = next;
    compiled = compileSystem({ lookups, derived: kept });
  }
  return { values: compiled.ok ? compiled.system.evaluate(data) : {}, problems: first.problems };
};

module.exports = { compileSystem, previewDerived, LIMITS };
