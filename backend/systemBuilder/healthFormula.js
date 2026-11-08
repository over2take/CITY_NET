// MAX HEALTH: A FORMULA (7d4; approved mockup docs/mockups/level-up.html, 2026-11-07): the token's maximum worked
// out from the sheet, as a derived value is, so it follows the stats, the derived values and the levels (@level,
// @soldier_level). Features adding to it (tokenMax.js) still add on top. Whole, and never below 0. Null where max
// health is AS IT IS, or the system or its formula can't be worked out.

const { compileSystem, tablesOf, lookupIn } = require('./derived');
const { parse, evaluate } = require('./expression');
const { ruleValue } = require('./rules');
const { overlayOf } = require('./choices');
const { healthOf } = require('./levels');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** What the formula comes to for this sheet now, or null. */
const healthFormulaValue = (definition, data) => {
  const h = healthOf(definition);
  // A missing or blank formula doesn't read, so it comes to nothing below.
  if (h.how !== 'formula') return null;
  // A system with no formulas of its own has none to work out first.
  const compiled = compileSystem({ lookups: definition.lookups, derived: Array.isArray(definition.derived) ? definition.derived : [] });
  if (!compiled.ok) return null;
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  let tree;
  try { tree = parse(h.formula, (name) => own(tables, name)); } catch { return null; }
  const sheet = isPlainObject(data) ? data : {};
  const overlay = overlayOf(definition, sheet);
  const values = compiled.system.evaluate(sheet, overlay);
  const over = overlay.sheet || {};
  const value = evaluate(tree, {
    field: (name) => (own(values, name) ? values[name] : own(over, name) ? num(over[name]) : num(sheet[name])),
    rule: (name) => ruleValue(name, sheet),
    table: (name, x) => lookupIn(own(tables, name) ? tables[name] : [], x),
  });
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
};

module.exports = { healthFormulaValue };
