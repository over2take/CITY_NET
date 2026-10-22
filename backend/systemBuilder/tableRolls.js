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
// stat once the roll is made. A condition on the character with a modifier on all rolls (4e1a,
// waiting for this phase) is added to every roll as its own term, named: "+ 4 - 1 (HURT)" (6b3b).

const { makeRoll, FATE } = require('./rollStyles');
const { parse, evaluate } = require('./expression');
const { lookupIn } = require('./derived');
const { ruleValue } = require('./rules');
const { ALL_ROLLS } = require('./conditions');
const { diceOf, symbolsOf } = require('./diceFaces');

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
const describe = (result, symbols = []) => {
  const marks = new Map(symbols.map((s) => [s.id, s.mark ?? s.name.slice(0, 1).toUpperCase()]));
  // A named kind's name follows each face only where the roll mixes kinds (✶ Good ✕ Bad); with one
  // kind it is already said ("rolled 3×dF"), so the faces stand alone.
  const mixed = result.groups.filter((g) => g.faces.length).length > 1;
  const dice = result.groups.flatMap((g) => g.faces.map((f) => {
    const t = g.die ? ownFaceText(g, f, marks) : faceText(f, g.sides);
    return `${f.minus ? '-' : ''}${f.kept ? t : `(${t})`}${g.name && mixed ? ` ${g.name}` : ''}`;
  })).join(' ');
  // The dice's own value is said only when something is added to it; the total always. A
  // condition's term is named after its amount.
  const terms = (result.terms ?? []).map((t) => ` ${signed(t.amount)} (${t.label})`).join('');
  const added = `${result.add !== 0 ? ` ${signed(result.add)}` : ''}${terms}`;
  // Symbols counted say what is left of each (6c1b): COUNT THE SYMBOLS reads them as its outcome;
  // any other read says them after its total.
  const tally = result.symbols ? leftWords(result.symbols, symbols) : null;
  const working = result.read === 'symbols'
    ? `${dice || 'no dice'} = ${tally}${added ? ` · ${result.dice}${added} = ${result.total}` : ''}`
    : `${dice || 'no dice'}${added ? ` = ${result.dice}${added}` : ''} = ${result.total}${tally ? ` · ${tally}` : ''}`;
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

/** A face of a system's own die in the log: its number (signed on a die with any below 0) and the marks of its symbols. */
const ownFaceText = (g, f, marks) => {
  const n = f.blank ? '' : g.signed && f.value > 0 ? `+${f.value}` : String(f.value);
  const m = (f.symbols ?? []).map((s) => marks.get(s) ?? s).join('');
  return `${n}${m}` || '·';
};

/** What is left of each symbol, in the order the system lists them: "2 HIT, 1 EDGE", or "NOTHING LEFT". */
const leftWords = (tally, symbols) => {
  const order = [...symbols.map((s) => s.id), ...Object.keys(tally.left).filter((id) => !symbols.some((s) => s.id === id))];
  const names = new Map(symbols.map((s) => [s.id, s.name.toUpperCase()]));
  const said = order.filter((id) => (tally.left[id] ?? 0) > 0).map((id) => `${tally.left[id]} ${names.get(id) ?? id.toUpperCase()}`);
  return said.length ? said.join(', ') : 'NOTHING LEFT';
};

/**
 * A system's own dice for the dice menu (6c4a): each by an `own:` id, its faces as the log writes
 * them, read-only (the DICE tab edits them), as a game's built-in dice are offered.
 */
const menuDiceOf = (definition) => {
  const symbols = symbolsOf(definition);
  const marks = new Map(symbols.map((s) => [s.id, s.mark ?? s.name.slice(0, 1).toUpperCase()]));
  return diceOf(definition).map((d) => {
    const g = { die: d.id, ...(d.faces.some((f) => (f.n ?? 0) < 0) ? { signed: true } : {}) };
    return {
      id: `own:${d.id}`, name: d.name, sides: d.faces.length, locked: true, ...(d.color === 'danger' ? { color: 'danger' } : {}),
      faces: d.faces.map((f) => ({ value: ownFaceText(g, { value: f.n ?? 0, ...(f.n === null ? { blank: true } : {}), ...(f.s.length ? { symbols: f.s } : {}) }, marks) })),
    };
  });
};

/**
 * A handful of one of a system's own dice from the dice menu (6c4a), rolled as a roll of them is:
 * symbols counted and cancelled where its faces show any, the numbers summed where they don't.
 * Null when the system has no such die.
 */
const rollMenuDice = ({ definition, dieId, count, rng, who }) => {
  const die = diceOf(definition).find((d) => d.id === dieId);
  if (!die) return null;
  const symbolic = die.faces.some((f) => f.s.length);
  return rollField({
    definition, data: {}, rng, who,
    roll: { id: 'menu', label: `${count}×${die.name}`, dice: [{ count: String(count), die: die.id }], ...(symbolic ? { read: 'symbols' } : {}) },
  });
};

/** The dice for the tray, by kind: a named kind under its name, Fate dice as dF, the rest by size; a system's own die by its name, its faces as the log writes them. */
const trayOf = (result, symbols = []) => {
  const results = {};
  const diceSides = {};
  for (const g of result.groups) {
    if (!g.faces.length) continue;
    const key = g.name ?? (g.sides === FATE ? 'dF' : String(g.sides));
    const marks = new Map(symbols.map((s) => [s.id, s.mark ?? s.name.slice(0, 1).toUpperCase()]));
    results[key] = [...(results[key] ?? []), ...g.faces.map((f) => (g.die ? ownFaceText(g, f, marks) : f.value))];
    if (g.name || g.sides === FATE) diceSides[key] = g.sides === FATE ? 6 : g.sides;
  }
  return { results, diceSides };
};

/**
 * Roll a field of a custom system's sheet. `rollId` picks one of the field's rolls (the first if
 * not given); `chosen` the changes picked. The builder's TEST ROLL (6b1a) hands in `roll` itself,
 * which needn't be ROLLED BY anything yet, with no field or any, and `tryCosts` for changes that
 * cost something, since a test takes nothing. `conditions` are those on the character, whole as
 * conditionsOf gives them; each modifier on all rolls is added to the roll. Returns { ok: true, roll, result, historyText, results,
 * diceSides, total, glitch, criticalGlitch } or { ok: false, error } (nothing rolled).
 */
/** A condition's modifiers on all rolls, each a term named by its short name: HURT -1. */
const termsOf = (conditions) => (Array.isArray(conditions) ? conditions : []).flatMap((c) => (isPlainObject(c) && Array.isArray(c.modifiers) ? c.modifiers : [])
  .filter((m) => isPlainObject(m) && m.target === ALL_ROLLS && Number.isInteger(m.amount) && m.amount !== 0)
  .map((m) => ({ label: c.short || c.name || c.id, amount: m.amount })));

const rollField = ({ definition, data, fieldId, rollId, chosen = [], rng, who, forName, roll: given, tryCosts = false, conditions = [] }) => {
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

  const symbols = symbolsOf(definition);
  const result = makeRoll(roll, valueOf(definition, fieldsFor(definition, data, fieldId), data), rng, picks, termsOf(conditions), { dice: diceOf(definition), symbols });
  const label = roll.label || roll.id;
  const what = typeof fieldId === 'string' ? (statOf(definition, fieldId)?.label || formulaOf(definition, fieldId)?.label || fieldId) : null;
  const described = describe({ ...result, read: roll.read ?? 'sum' }, symbols);
  const { working, tags } = described;
  // A change that cost something says what it cost.
  const costWords = new Map(spends.map((s) => [s.label, s.words]));
  const changes = result.changes.length ? ` (${result.changes.map((l) => costWords.get(l) ?? l).join(', ')})` : '';
  const tray = trayOf(result, symbols);
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

module.exports = { rollsFor, fieldsRolledBy, modifierOf, fieldsFor, termsOf, rollField, describe, menuDiceOf, rollMenuDice };
