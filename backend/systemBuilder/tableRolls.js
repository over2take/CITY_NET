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

const { makeRoll, FATE, SEEN } = require('./rollStyles');
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
 * matches, a glitch, named dice's effects, the changes picked. `hide` (6c4h) is what players are
 * kept from: the target (`target`), the verdict too (`verdict`), and the effects that come only on
 * a success or a failure (`effects`, their labels), which say the verdict as plainly.
 */
const describe = (result, symbols = [], hide = {}) => {
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
  const verdict = result.success ? 'SUCCESS' : 'FAILURE';
  const kept = new Set(hide.effects ?? []);
  const said = [
    ...(result.target !== null && !hide.verdict ? [hide.target ? verdict : `vs ${result.target}: ${verdict}`] : []),
    ...(result.band ? [result.band.toUpperCase()] : []),
    ...(result.natural ? [result.natural.label.toUpperCase()] : []),
    ...result.matches.map((m) => m.label.toUpperCase()),
    ...(result.glitch ? [result.glitch.toUpperCase()] : []),
    ...result.effects.filter((e) => !kept.has(e)).map((e) => e.toUpperCase()),
  ];
  const changes = result.changes.length ? ` (${result.changes.join(', ')})` : '';
  return { working, tags: said.length ? ` — ${said.join(' · ')}` : '', changes, board: boardOf(result, symbols, said) };
};

/**
 * What the tray's board says for a roll (6c4d1), in the log's words: what is left of the symbols
 * where it counts them (the total first where it reads a sum), and what it came to. Null where it
 * says nothing more than its total, which the board shows as it is.
 */
const boardOf = (result, symbols, said) => {
  const left = result.symbols ? leftList(result.symbols, symbols).join(' · ') || NOTHING_LEFT : null;
  const words = left && (result.read === 'symbols' ? left : `${result.total} · ${left}`);
  if (!words && !said.length) return null;
  return { ...(words ? { words } : {}), ...(said.length ? { outcome: said.join(' · ') } : {}) };
};

/** A face of a system's own die in the log: its number (signed on a die with any below 0) and the marks of its symbols. */
const ownFaceText = (g, f, marks) => {
  const n = f.blank ? '' : g.signed && f.value > 0 ? `+${f.value}` : String(f.value);
  const m = (f.symbols ?? []).map((s) => marks.get(s) ?? s).join('');
  return `${n}${m}` || '·';
};

/** The marks the log writes for each symbol: its own, or its name's first letter. */
const marksOf = (symbols) => new Map(symbols.map((s) => [s.id, s.mark ?? s.name.slice(0, 1).toUpperCase()]));

/** One of a die's faces (diceOf's `{ n, s }`) as the log writes it, `g` saying if the die is signed. */
const dieFaceText = (g, f, marks) => ownFaceText(g, { value: f.n ?? 0, ...(f.n === null ? { blank: true } : {}), ...(f.s.length ? { symbols: f.s } : {}) }, marks);

const NOTHING_LEFT = 'NOTHING LEFT';

/** What is left of each symbol, in the order the system lists them: ['2 HIT', '1 EDGE'], or none. */
const leftList = (tally, symbols) => {
  const order = [...symbols.map((s) => s.id), ...Object.keys(tally.left).filter((id) => !symbols.some((s) => s.id === id))];
  const names = new Map(symbols.map((s) => [s.id, s.name.toUpperCase()]));
  return order.filter((id) => (tally.left[id] ?? 0) > 0).map((id) => `${tally.left[id]} ${names.get(id) ?? id.toUpperCase()}`);
};

/** The same as the log writes it: "2 HIT, 1 EDGE", or "NOTHING LEFT". */
const leftWords = (tally, symbols) => leftList(tally, symbols).join(', ') || NOTHING_LEFT;

/**
 * A system's own dice for the dice menu (6c4a): each by an `own:` id, its faces as the log writes
 * them, read-only (the DICE tab edits them), as a game's built-in dice are offered.
 */
const menuDiceOf = (definition) => {
  const marks = marksOf(symbolsOf(definition));
  return diceOf(definition).map((d) => {
    const g = { die: d.id, ...(d.faces.some((f) => (f.n ?? 0) < 0) ? { signed: true } : {}) };
    return {
      id: `own:${d.id}`, name: d.name, sides: d.faces.length, locked: true, ...(d.color === 'danger' ? { color: 'danger' } : {}),
      faces: d.faces.map((f) => ({ value: dieFaceText(g, f, marks) })),
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

/**
 * The dice for the tray, by kind: a named kind under its name, Fate dice as dF, the rest by size; a
 * system's own die by its name, its faces as the log writes them. `own` is what utils/diceThrow
 * can't tell from those (6c4b1): each own die's every face and the one each landed on, and the
 * looks of the symbols they show.
 */
const trayOf = (result, symbols = [], dice = []) => {
  const results = {};
  const diceSides = {};
  const kinds = {};
  const marks = marksOf(symbols);
  for (const g of result.groups) {
    if (!g.faces.length) continue;
    const key = g.name ?? (g.sides === FATE ? 'dF' : String(g.sides));
    results[key] = [...(results[key] ?? []), ...g.faces.map((f) => (g.die ? ownFaceText(g, f, marks) : f.value))];
    if (g.name || g.sides === FATE) diceSides[key] = g.sides === FATE ? 6 : g.sides;
    const die = g.die ? dice.find((d) => d.id === g.die) : null;
    if (!die) continue;
    const kind = kinds[key] ?? (kinds[key] = {
      faces: die.faces.map((f) => ({ text: dieFaceText(g, f, marks), ...(f.n !== null ? { n: f.n } : {}), ...(f.s.length ? { s: f.s } : {}) })),
      landed: [],
      ...(die.color === 'danger' ? { color: 'danger' } : {}),
    });
    kind.landed.push(...g.faces.map((f) => f.face));
  }
  const shown = new Set(Object.values(kinds).flatMap((k) => k.faces.flatMap((f) => f.s ?? [])));
  const looks = symbols.filter((s) => shown.has(s.id))
    .map((s) => ({ id: s.id, mark: marks.get(s.id), ...(s.drawn ? { drawn: s.drawn } : {}), ...(s.icon ? { icon: s.icon } : {}) }));
  return { results, diceSides, own: { kinds, symbols: looks } };
};

/**
 * Roll a field of a custom system's sheet. `rollId` picks one of the field's rolls (the first if
 * not given); `chosen` the changes picked. The builder's TEST ROLL (6b1a) hands in `roll` itself,
 * which needn't be ROLLED BY anything yet, with no field or any, and `tryCosts` for changes that
 * cost something, since a test takes nothing. `conditions` are those on the character, whole as
 * conditionsOf gives them; each modifier on all rolls is added to the roll. Returns { ok: true, roll, result, historyText, results,
 * diceSides, own (the tray's own dice, 6c4b1), board (its words for the tray's board, 6c4d1, named 6c4d3), total, glitch,
 * criticalGlitch, players (6c4h: { historyText, board } as players see them where the target is kept from them, else
 * null; historyText and board are then the GM's) } or { ok: false, error } (nothing rolled).
 */
/** A condition's modifiers on all rolls, each a term named by its short name: HURT -1. */
const termsOf = (conditions) => (Array.isArray(conditions) ? conditions : []).flatMap((c) => (isPlainObject(c) && Array.isArray(c.modifiers) ? c.modifiers : [])
  .filter((m) => isPlainObject(m) && m.target === ALL_ROLLS && Number.isInteger(m.amount) && m.amount !== 0)
  .map((m) => ({ label: c.short || c.name || c.id, amount: m.amount })));

/** How much of `roll`'s target players see (6c4h): its own setting, or the system's, or SHOWN. */
const seenOf = (definition, roll) => (SEEN.includes(roll?.seen) ? roll.seen : SEEN.includes(definition?.target_seen) ? definition.target_seen : 'shown');

/** What players are kept from at `seen` (describe's `hide`), or null when they see it all. */
const hiddenAt = (seen, roll) => (seen === 'shown' ? null : {
  target: true,
  verdict: seen === 'gm',
  effects: seen === 'gm' ? (roll.effects ?? []).filter((e) => e.when === 'success' || e.when === 'failure').map((e) => e.label) : [],
});

/** Said on the GM's line when players were kept from some of it (6c4h). */
const HIDDEN = ' · HIDDEN FROM PLAYERS';

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
  const read = { ...result, read: roll.read ?? 'sum' };
  const described = describe(read, symbols);
  const { working, tags, board } = described;
  // A change that cost something says what it cost.
  const costWords = new Map(spends.map((s) => [s.label, s.words]));
  const changes = result.changes.length ? ` (${result.changes.map((l) => costWords.get(l) ?? l).join(', ')})` : '';
  const tray = trayOf(result, symbols, diceOf(definition));
  const named = String(what || label).toUpperCase();
  const line = (said) => `${who} rolled ${label}${what ? ` (${what})` : ''}${forName ? ` for ${forName}` : ''}${changes} [${working}]${said}`;
  // Players' own version where the target is kept from them (6c4h); with no target, nothing to keep.
  const hide = result.target === null ? null : hiddenAt(seenOf(definition, roll), roll);
  const theirs = hide ? describe(read, symbols, hide) : null;
  return {
    ok: true,
    roll: roll.id,
    result,
    historyText: line(tags) + (hide ? HIDDEN : ''),
    players: theirs ? { historyText: line(theirs.tags), board: { label: named, ...(theirs.board || {}) } } : null,
    results: tray.results,
    diceSides: tray.diceSides,
    own: tray.own,
    // Named for what was rolled (6c4d3): the field where there is one (PHYSICAL SAVE says more
    // than its roll's SAVE), otherwise the roll.
    board: { label: named, ...(board || {}) },
    total: result.total,
    glitch: !!result.glitch,
    criticalGlitch: !!result.glitch && result.critical === 'failure',
    spends: spends.map(({ from, by }) => ({ from, by })),
  };
};

module.exports = { rollsFor, fieldsRolledBy, modifierOf, fieldsFor, termsOf, rollField, describe, menuDiceOf, rollMenuDice, seenOf, HIDDEN };
