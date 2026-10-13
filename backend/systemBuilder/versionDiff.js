// What a new version of a system changes (4h1a; approved mockup docs/mockups/version-preview.html,
// 2026-10-13). Before PUBLISH, from v2 on, the builder shows the GM what the draft changes from the
// version the game runs, and what that means for each character playing it, or, when nobody plays
// it yet, on the system's SAMPLE values. Nothing is written by any of this, and publishing deletes
// nothing: a field a version leaves off keeps its value on the sheet, hidden, as a currency keeps
// its balances and a token its conditions.
//
//   versionChanges(before, after)        the changes themselves, as a flat list
//   characterChanges(before, after, data) what they mean for one sheet's values
//   sampleChanges(before, after)          the worked-out values that change, on the draft's samples
//
// Each change is { kind, change, id, ... }:
//   sheet      removed | added | renamed (from, to) | gm_only | player_edit | options_removed (options)
//   formula    changed (from, to: the formula text) | added | removed
//   stat       range (from, to: { min, max }) | outside (one sheet's value past the new range)
//   health     changed (from, to: the model)
//   currency   removed | added
//   part       off | on
//   condition  removed | added
//   other      changed: a section that changes nothing on a character (words, rests, NPC tiers...)
// A value that changes for a character is { kind: 'formula', change: 'value', id, label, from, to }.
//
// Pure: definitions and sheet data in, lists out. The route (4h1b) reads the characters.

const { effectiveSheet, fieldsOf } = require('./sheet');
const { compileSystem } = require('./derived');
const { derivedLabel } = require('./stats');
const { conditionsOf } = require('./conditions');
const { currenciesOf } = require('./currencies');
const { PARTS, partOn } = require('./parts');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = (v) => (Array.isArray(v) ? v : []);

/** The sections that change nothing on any character, said in one line. */
const OTHER = ['name', 'description', 'author', 'license', 'words', 'buildings', 'bank', 'lookups', 'npc', 'rests'];

const fieldMap = (definition) => new Map(fieldsOf(effectiveSheet(definition))
  .filter((f) => isPlainObject(f) && typeof f.id === 'string')
  .map((f) => [f.id, f]));
const labelOf = (f) => (typeof f.label === 'string' && f.label ? f.label : f.id);
const optionValue = (o) => String(o.value ?? o.label);

const formulaText = (d) => (d.kind === 'condition' ? `if ${d.when} then ${d.then} else ${d.else}` : String(d.formula ?? ''));
const derivedMap = (definition) => new Map(list(definition && definition.derived)
  .filter((d) => isPlainObject(d) && typeof d.id === 'string')
  .map((d) => [d.id, d]));

const statMap = (definition) => new Map(list(definition && definition.stats)
  .filter((g) => isPlainObject(g))
  .flatMap((g) => list(g.stats))
  .filter((s) => isPlainObject(s) && typeof s.id === 'string')
  .map((s) => [s.id, s]));
const range = (s) => ({ min: Number.isSafeInteger(s.min) ? s.min : null, max: Number.isSafeInteger(s.max) ? s.max : null });

/** The health a version runs: none with token health off, else its model's settings (a pool unset). */
const healthOf = (definition) => (partOn(definition, 'token_health')
  ? ((definition && isPlainObject(definition.core) && isPlainObject(definition.core.health)) ? definition.core.health : { model: 'pool' })
  : { model: 'none' });

const byId = (items) => new Map(items.map((x) => [x.id, x]));

/** What `after` changes from `before`, none of it about any one character. */
const versionChanges = (before, after) => {
  const out = [];

  const was = fieldMap(before);
  const now = fieldMap(after);
  // A worked-out value coming or going is said once, as a formula (below), not as a field too.
  const oldFormulas = derivedMap(before);
  const newFormulas = derivedMap(after);
  for (const [id, f] of was) {
    const g = now.get(id);
    if (!g) { if (!oldFormulas.has(id)) out.push({ kind: 'sheet', change: 'removed', id, label: labelOf(f) }); continue; }
    if (labelOf(f) !== labelOf(g)) out.push({ kind: 'sheet', change: 'renamed', id, from: labelOf(f), to: labelOf(g) });
    if (f.edit !== 'gm' && g.edit === 'gm') out.push({ kind: 'sheet', change: 'gm_only', id, label: labelOf(g) });
    if (f.edit === 'gm' && g.edit !== 'gm') out.push({ kind: 'sheet', change: 'player_edit', id, label: labelOf(g) });
    if (f.type === 'select' && g.type === 'select') {
      const kept = new Set(list(g.options).filter(isPlainObject).map(optionValue));
      const gone = list(f.options).filter((o) => isPlainObject(o) && !kept.has(optionValue(o)));
      if (gone.length) out.push({ kind: 'sheet', change: 'options_removed', id, label: labelOf(g), options: gone.map((o) => ({ value: optionValue(o), label: String(o.label ?? o.value) })) });
    }
  }
  for (const [id, g] of now) if (!was.has(id) && !newFormulas.has(id)) out.push({ kind: 'sheet', change: 'added', id, label: labelOf(g) });

  for (const [id, d] of oldFormulas) {
    const e = newFormulas.get(id);
    if (!e) out.push({ kind: 'formula', change: 'removed', id, label: derivedLabel(d) });
    else if (formulaText(d) !== formulaText(e)) out.push({ kind: 'formula', change: 'changed', id, label: derivedLabel(e), from: formulaText(d), to: formulaText(e) });
  }
  for (const [id, e] of newFormulas) if (!oldFormulas.has(id)) out.push({ kind: 'formula', change: 'added', id, label: derivedLabel(e), to: formulaText(e) });

  const oldStats = statMap(before);
  for (const [id, s] of statMap(after)) {
    const t = oldStats.get(id);
    if (t && !same(range(t), range(s))) out.push({ kind: 'stat', change: 'range', id, label: s.label || id, from: range(t), to: range(s) });
  }

  const health = [healthOf(before), healthOf(after)];
  if (!same(health[0], health[1])) out.push({ kind: 'health', change: 'changed', id: 'health', from: health[0].model, to: health[1].model });

  const oldMoney = byId(currenciesOf(before));
  const newMoney = byId(currenciesOf(after));
  for (const [id, c] of oldMoney) if (!newMoney.has(id)) out.push({ kind: 'currency', change: 'removed', id, label: c.name });
  for (const [id, c] of newMoney) if (!oldMoney.has(id)) out.push({ kind: 'currency', change: 'added', id, label: c.name });

  for (const part of PARTS) {
    const [a, b] = [partOn(before, part), partOn(after, part)];
    if (a && !b) out.push({ kind: 'part', change: 'off', id: part });
    if (!a && b) out.push({ kind: 'part', change: 'on', id: part });
  }

  const oldConditions = byId(conditionsOf(before));
  const newConditions = byId(conditionsOf(after));
  for (const [id, c] of oldConditions) if (!newConditions.has(id)) out.push({ kind: 'condition', change: 'removed', id, label: c.name });
  for (const [id, c] of newConditions) if (!oldConditions.has(id)) out.push({ kind: 'condition', change: 'added', id, label: c.name });

  for (const section of OTHER) {
    if (!same((before || {})[section], (after || {})[section])) out.push({ kind: 'other', change: 'changed', id: section });
  }
  return out;
};

/** Every worked-out value a version gives `data`, or null when its formulas can't run. */
const valuesUnder = (definition, data) => {
  const compiled = compileSystem({ lookups: (definition || {}).lookups, derived: list((definition || {}).derived) });
  return compiled.ok ? compiled.system.evaluate(data || {}) : null;
};

/** The worked-out values that differ between the two versions, for `data`: old → new (null: none). */
const valueChanges = (before, after, data) => {
  const was = valuesUnder(before, data);
  const now = valuesUnder(after, data);
  if (!now) return [];
  const labels = derivedMap(after);
  return Object.entries(now)
    .filter(([id, v]) => !was || !Object.prototype.hasOwnProperty.call(was, id) || was[id] !== v)
    .map(([id, v]) => ({ kind: 'formula', change: 'value', id, label: derivedLabel(labels.get(id)), from: was && Object.prototype.hasOwnProperty.call(was, id) ? was[id] : null, to: v }));
};

const filled = (v) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());

/**
 * What the new version means for one sheet (`data`): the values it holds that stop showing (kept),
 * a choice it picked that goes, a stat past its new range (kept), and the worked-out values that
 * change. The changes that reach everyone alike (a renamed field, the health model) are the
 * version's own, not repeated here.
 */
const characterChanges = (before, after, data) => {
  const sheet = isPlainObject(data) ? data : {};
  const out = [];
  for (const c of versionChanges(before, after)) {
    if (c.kind === 'sheet' && c.change === 'removed' && filled(sheet[c.id])) out.push({ ...c, value: sheet[c.id] });
    if (c.kind === 'sheet' && c.change === 'options_removed' && c.options.some((o) => o.value === String(sheet[c.id]))) out.push({ ...c, value: sheet[c.id] });
    if (c.kind === 'stat' && filled(sheet[c.id])) {
      const v = Number(sheet[c.id]);
      // An unreadable value (NaN) is past neither end.
      if ((c.to.min !== null && v < c.to.min) || (c.to.max !== null && v > c.to.max)) {
        out.push({ kind: 'stat', change: 'outside', id: c.id, label: c.label, value: v, min: c.to.min, max: c.to.max });
      }
    }
  }
  return [...out, ...valueChanges(before, after, sheet)];
};

/** The worked-out values that change, on the draft's SAMPLE values: for a system nobody plays yet. */
const sampleChanges = (before, after) => valueChanges(before, after, isPlainObject((after || {}).samples) ? after.samples : {});

module.exports = { OTHER, versionChanges, characterChanges, sampleChanges };
