// A custom system's rolls at the table (Phase 6, 6a2b; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19). Pure, no I/O: the socket (sockets/index.js requestSheetRoll) hands in the running
// system, the stored sheet and the dice, and sends on what comes back, through the same log and
// dice tray as every roll.
//
// A die button on the sheet rolls a stat, a formula or a stat of a group a roll is ROLLED BY. In the
// roll's formula text, @this is the value rolled; @this_mod its modifier, from the formula its stats
// list shows as MOD (one reading only it through a table: mod(@str)); a skill's @tie is the ability
// it is tied to, @tie_mod that ability's modifier; any other @name is the sheet's value, 0 when it
// has none. A change that costs something (6b3a) is paid from the sheet as stored: taken from a stat,
// refused when it hasn't enough; or added to one, refused past its highest. The socket changes the
// stat once the roll is made.

const { makeRoll, FATE } = require('./rollStyles');
const { parse, evaluate } = require('./expression');
const { lookupIn } = require('./derived');
const { ruleValue } = require('./rules');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const groupsOf = (def) => (Array.isArray(def.stats) ? def.stats.filter((g) => isPlainObject(g) && Array.isArray(g.stats)) : []);
const statOf = (def, id) => groupsOf(def).flatMap((g) => g.stats).find((s) => isPlainObject(s) && s.id === id);
const formulaOf = (def, id) => (Array.isArray(def.derived) ? def.derived.find((d) => isPlainObject(d) && d.id === id) : undefined);

/** The rolls a field rolls: those ROLLED BY it, or by the stats group it is in. */
const rollsFor = (def, fieldId) => {
  const group = groupsOf(def).find((g) => g.stats.some((s) => isPlainObject(s) && s.id === fieldId));
  return (Array.isArray(def.rolls) ? def.rolls : []).filter((r) => isPlainObject(r) && Array.isArray(r.by)
    && (r.by.includes(fieldId) || (group && r.by.includes(group.id))));
};

/** The fields a roll is ROLLED BY, in its order: a stats group as its stats, a stat or formula as itself. */
const fieldsRolledBy = (def, roll) => {
  const out = [];
  for (const id of Array.isArray(roll && roll.by) ? roll.by : []) {
    const group = groupsOf(def).find((g) => g.id === id);
    for (const f of group ? group.stats.filter(isPlainObject).map((s) => s.id) : [id]) if (typeof f === 'string' && !out.includes(f)) out.push(f);
  }
  return out;
};

/** The formula that is a stat's modifier: one reading only that stat through a table, `mod(@str)`. */
const modifierOf = (def, statId) => {
  const tables = new Set(isPlainObject(def.lookups) ? Object.keys(def.lookups) : []);
  const shape = /^\s*([a-z][a-z0-9_]*)\(\s*@([a-z][a-z0-9_]*)\s*\)\s*$/;
  return (Array.isArray(def.derived) ? def.derived : []).find((d) => {
    const m = isPlainObject(d) && typeof d.formula === 'string' ? shape.exec(d.formula) : null;
    return !!m && m[2] === statId && tables.has(m[1]);
  })?.id ?? null;
};

/**
 * What the roll's formula text reads for this field: @this and the rest named above, then the
 * sheet. Values the sheet stores are numbers or nothing; anything else reads as 0.
 */
const fieldsFor = (def, data, fieldId) => {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const mod = (id) => { const m = id ? modifierOf(def, id) : null; return m ? num(data[m]) : 0; };
  const tie = typeof fieldId === 'string' ? statOf(def, fieldId)?.tie : undefined;
  const own = { this: num(data[fieldId]), this_mod: mod(fieldId), tie: tie ? num(data[tie]) : 0, tie_mod: mod(tie) };
  const has = (o, name) => Object.prototype.hasOwnProperty.call(o, name);
  return (name) => (has(own, name) ? own[name] : num(has(data, name) ? data[name] : 0));
};

/** Formula text worked out for a character, as a formula is (derived.js): its fields, $rules, the system's tables. */
const valueOf = (def, field, data) => {
  const tables = isPlainObject(def.lookups) ? def.lookups : {};
  const has = (name) => Object.prototype.hasOwnProperty.call(tables, name) && isPlainObject(tables[name]) && Array.isArray(tables[name].bands);
  const table = (name, x) => (has(name) ? lookupIn(tables[name].bands, x) : 0);
  return (text) => evaluate(parse(text, has), { field, rule: (name) => ruleValue(name, data), table });
};

const signed = (n) => (n < 0 ? `- ${-n}` : `+ ${n}`);
const faceText = (f, sides) => (sides === FATE ? (f.value > 0 ? '+' : f.value < 0 ? '-' : '0') : String(f.value));

/**
 * The log's words for a roll made: its dice (kept ones bare, the rest in brackets, a die taken away
 * with a minus), what is added, the total, and what it came to: met or not, a band, a natural,
 * matches, a glitch, named dice's effects, the changes picked.
 */
const describe = (result) => {
  const dice = result.groups.flatMap((g) => g.faces.map((f) => {
    const t = faceText(f, g.sides);
    return `${f.minus ? '-' : ''}${f.kept ? t : `(${t})`}${g.name ? ` ${g.name}` : ''}`;
  })).join(' ');
  // The dice's own value is said only when something is added to it; the total always.
  const working = `${dice || 'no dice'}${result.add !== 0 ? ` = ${result.dice} ${signed(result.add)}` : ''} = ${result.total}`;
  const said = [
    ...(result.target !== null ? [`vs ${result.target}: ${result.success ? 'SUCCESS' : 'FAILURE'}`] : []),
    ...(result.band ? [result.band.toUpperCase()] : []),
    ...(result.natural ? [result.natural.label.toUpperCase()] : []),
    ...result.matches.map((m) => m.label.toUpperCase()),
    ...(result.glitch ? [result.glitch.toUpperCase()] : []),
    ...result.effects.map((e) => e.toUpperCase()),
  ];
  const changes = result.changes.length ? ` (${result.changes.join(', ')})` : '';
  return { working, tags: said.length ? ` — ${said.join(' · ')}` : '', changes };
};

/** The dice for the tray, by kind: a named kind under its name, Fate dice as dF, the rest by size. */
const trayOf = (result) => {
  const results = {};
  const diceSides = {};
  for (const g of result.groups) {
    if (!g.faces.length) continue;
    const key = g.name ?? (g.sides === FATE ? 'dF' : String(g.sides));
    results[key] = [...(results[key] ?? []), ...g.faces.map((f) => f.value)];
    if (g.name || g.sides === FATE) diceSides[key] = g.sides === FATE ? 6 : g.sides;
  }
  return { results, diceSides };
};

/**
 * Roll a field of a custom system's sheet. `rollId` picks one of the field's rolls (the first if
 * not given); `chosen` the changes picked. The builder's TEST ROLL (6b1a) hands in `roll` itself,
 * which needn't be ROLLED BY anything yet, with no field or any, and `tryCosts` for changes that
 * cost something, since a test takes nothing. Returns { ok: true, roll, result, historyText, results,
 * diceSides, total, glitch, criticalGlitch } or { ok: false, error } (nothing rolled).
 */
const rollField = ({ definition, data, fieldId, rollId, chosen = [], rng, who, forName, roll: given, tryCosts = false }) => {
  if (!isPlainObject(definition) || (!given && typeof fieldId !== 'string')) return { ok: false, error: 'Nothing to roll' };
  const options = given ? [given] : rollsFor(definition, fieldId);
  const roll = given ?? (rollId === undefined || rollId === null ? options[0] : options.find((r) => r.id === rollId));
  if (!roll) return { ok: false, error: 'That field has no such roll' };
  const picks = Array.isArray(chosen) ? chosen.filter((c) => typeof c === 'string') : [];
  // What the changes picked cost, checked against the sheet as stored; a test pays nothing.
  const spends = [];
  for (const c of (roll.changes ?? []).filter((x) => picks.includes(x.id) && x.cost)) {
    const { from, amount, adds } = c.cost;
    const stat = statOf(definition, from);
    const name = (stat?.label || from).toUpperCase();
    const now = Number.isFinite(Number(data[from])) ? Number(data[from]) : 0;
    if (!tryCosts) {
      if (adds && Number.isFinite(stat?.max) && now + amount > stat.max) return { ok: false, error: `${c.label} adds ${amount} ${name}, past its highest (${now} of ${stat.max})` };
      if (!adds && now < amount) return { ok: false, error: `${c.label} costs ${amount} ${name}, and there ${now === 1 ? 'is' : 'are'} only ${now}` };
    }
    spends.push({ from, by: adds ? amount : -amount, label: c.label, words: `${c.label}: ${adds ? '+' : '−'}${amount} ${name}` });
  }

  const result = makeRoll(roll, valueOf(definition, fieldsFor(definition, data, fieldId), data), rng, picks);
  const label = roll.label || roll.id;
  const what = typeof fieldId === 'string' ? (statOf(definition, fieldId)?.label || formulaOf(definition, fieldId)?.label || fieldId) : null;
  const described = describe(result);
  const { working, tags } = described;
  // A change that cost something says what it cost.
  const costWords = new Map(spends.map((s) => [s.label, s.words]));
  const changes = result.changes.length ? ` (${result.changes.map((l) => costWords.get(l) ?? l).join(', ')})` : '';
  const tray = trayOf(result);
  return {
    ok: true,
    roll: roll.id,
    result,
    historyText: `${who} rolled ${label}${what ? ` (${what})` : ''}${forName ? ` for ${forName}` : ''}${changes} [${working}]${tags}`,
    results: tray.results,
    diceSides: tray.diceSides,
    total: result.total,
    glitch: !!result.glitch,
    criticalGlitch: !!result.glitch && result.critical === 'failure',
    spends: spends.map(({ from, by }) => ({ from, by })),
  };
};

module.exports = { rollsFor, fieldsRolledBy, modifierOf, fieldsFor, rollField, describe };
