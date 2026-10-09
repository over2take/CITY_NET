// What one rest does to one character (4f2a; approved mockup docs/mockups/builder-rests.html,
// 2026-10-09): the rests it counts as first, deepest first and each once, then its own refills in
// order; then the conditions that wear off at any of them. Pure: the route reads the character,
// calls this, and writes what it hands back.
//
// Health comes back through the system's own health model: "up by" is the model's HEAL
// (health.js), and "to full" clears it the model's way (the pool to its max, a second track to
// none, marks and harm cleared). Sheet numbers are held between 0 and their maximum. Amounts are
// worked out from the character's own numbers as they stand when the refill is reached, so a
// refill can read what an earlier one in the same rest changed.
//
// With no `rng` it is a preview: dice are not rolled, and a value they decide is reported as
// pending ("9 + 1d8 + @con_mod") until a later refill settles it.

const { restsOf, reachOf, amountNames, SECTION } = require('./rests');
const { conditionsOf } = require('./conditions');
const { applyHealthAction } = require('./health');
const { effectiveSheet, fieldsOf } = require('./sheet');
const { ownWords } = require('./terms');
const { rollAmount } = require('./tierRolls');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v.filter(isPlainObject) : []);

/** The rests `id` runs, in order: each it counts as (theirs first), then itself; each once. */
const restOrder = (rests, id) => {
  const byId = new Map(rests.map((r) => [r.id, r]));
  const order = [];
  // Marked seen before its own are visited, so a loop (refused on publish) can't come back round.
  const seen = new Set();
  const visit = (at) => {
    if (seen.has(at) || !byId.has(at)) return;
    seen.add(at);
    for (const c of byId.get(at).counts_as) visit(c);
    order.push(at);
  };
  visit(id);
  return order;
};

/** Health back to full, the model's way: the token's numbers and the sheet's. */
const fullHealth = (health, token, sheet) => {
  const t = { ...token, current: num(token.max) };
  const patch = {};
  switch (health.model) {
    case 'tracks': {
      const second = list(health.tracks)[1];
      if (second) patch[second.id] = 0;
      break;
    }
    case 'typed':
      for (const type of list(health.types)) patch[type.id] = 0;
      break;
    case 'harm': {
      const slots = list(health.levels).flatMap((l) => Array.from({ length: Math.max(1, Math.floor(num(l.slots))) }, (_, i) => `${l.id}_${i + 1}`));
      for (const id of slots) if (sheet[id] !== undefined && String(sheet[id]).trim() !== '') patch[id] = '';
      t.current = slots.length;
      t.max = slots.length;
      break;
    }
    case 'wounds':
      // No maximum on the token: the system's wound count, as its DAMAGE and HEAL read it.
      if (num(token.max) <= 0) { t.current = Math.max(0, Math.floor(num(health.count))); t.max = t.current; }
      break;
    default:
  }
  return { token: t, patch };
};

/**
 * One rest for one character.
 *
 *   definition  the running custom system's
 *   restId      one of its rests that is on
 *   sheet       the character's sheet data, with its formulas worked out ({} when it has none)
 *   token       { current, max, temp } of its token, or null when it has none on the map
 *   conditions  its token's conditions, [{ id, left? }]
 *   rng         rolls dice (0 to below 1); none for a preview
 *
 * Returns { ok: true, sheetPatch, token, conditions, gone, changes, rolls } or { ok: false, error }.
 * `token` is the new one, or null when there is no token. `changes` lists each value that moved,
 * once, as { what, label, from, to } with `pending` (the dice still to roll) in a preview.
 * `rolls` lists every amount worked out, with its dice.
 */
const restOn = ({ definition, restId, sheet = {}, token = null, conditions = [], rng = null }) => {
  const rests = restsOf(definition);
  if (!rests.some((r) => r.id === restId)) return { ok: false, error: 'Not one of this system\'s rests' };
  const order = restOrder(rests, restId);
  const reach = reachOf(definition);
  const names = amountNames(reach.names);
  const fields = new Map(fieldsOf(effectiveSheet(definition)).filter((f) => f && typeof f.id === 'string').map((f) => [f.id, f]));
  const hpWord = ownWords(definition).hp;
  const healthLabel = (reach.health && reach.health.label) || (hpWord && hpWord.short) || 'HP';

  const data = { ...sheet };
  let t = token ? { current: num(token.current), max: num(token.max), temp: num(token.temp) } : null;
  const patch = {};
  const changes = new Map();
  const pending = new Map(); // what -> the dice still to roll, in a preview
  const rolls = [];

  /** The numbers an amount may read: the sheet's, with fields linked to the token read from it. */
  const values = () => {
    const v = { ...data };
    for (const [id, f] of fields) {
      if (f.source === 'token_hp' && t) v[id] = t.current;
      if (f.source === 'token_hp_max' && t) v[id] = t.max;
    }
    return v;
  };
  const note = (what, label, from, to) => {
    const before = changes.has(what) ? changes.get(what).from : from;
    changes.set(what, { what, label, from: before, to });
  };
  const setField = (id, value) => { data[id] = value; patch[id] = value; };
  /** An amount worked out, or null in a preview when dice decide it. */
  const amountOf = (text) => {
    let rolled = false;
    const r = rollAmount(text, values(), names, rng || (() => { rolled = true; return 0; }));
    if (!rng && rolled) return null;
    if ('error' in r || 'blank' in r) return 0;
    rolls.push({ amount: String(text), value: r.value, dice: r.dice });
    return r.value;
  };
  /** In a preview, a value already waiting on dice: an amount up or down joins what is waiting. */
  const waitsOn = (key, amount, label, from) => {
    if (!pending.has(key)) return false;
    pending.get(key).push(String(amount));
    note(key, label, from, null);
    return true;
  };

  const refillField = (id, how, amount) => {
    const f = fields.get(id);
    const maxId = reach.numbers.get(id);
    const max = maxId ? num(data[maxId]) : Infinity;
    const label = (f && f.label) || id;
    const from = num(data[id]);
    if (how === 'max') { pending.delete(id); setField(id, Math.max(0, max)); note(id, label, from, data[id]); return; }
    if (how === 'by' && waitsOn(id, amount, label, from)) return;
    const value = amountOf(amount);
    if (value === null) {
      pending.set(id, [String(amount)]);
      note(id, label, from, null);
      return;
    }
    pending.delete(id);
    const next = Math.max(0, Math.min(max, how === 'to' ? value : from + value));
    setField(id, next);
    note(id, label, from, next);
  };

  const refillHealth = (how, amount, track) => {
    const health = reach.health;
    if (!t || !health || health.model === 'none') return;
    const second = health.model === 'tracks' ? list(health.tracks)[1] : null;
    const before = { current: t.current, second: second ? num(data[second.id]) : 0 };
    const key = track && second && track === second.id ? `health:${track}` : 'health';
    if (how === 'full') {
      const full = fullHealth(health, t, data);
      t = full.token;
      for (const [id, v] of Object.entries(full.patch)) setField(id, v);
      pending.delete('health');
      if (second) pending.delete(`health:${second.id}`);
    } else {
      const label = key === 'health' ? healthLabel : second.label;
      const from = key === 'health' ? before.current : before.second;
      if (waitsOn(key, amount, label, from)) return;
      const value = amountOf(amount);
      if (value === null) { pending.set(key, [String(amount)]); note(key, label, from, null); return; }
      // An amount of 0 or less heals nothing: the model refuses it.
      const healed = applyHealthAction(health, t, data, { kind: 'heal', amount: value, ...(track ? { track } : {}) });
      if (!healed.ok) return;
      t = { ...t, current: num(healed.token.current), max: num(healed.token.max) };
      for (const [id, v] of Object.entries(healed.sheetPatch)) setField(id, v);
    }
    // Noted whenever it moved or was noted before: dice waiting on it may just have been settled.
    if (t.current !== before.current || changes.has('health')) note('health', healthLabel, before.current, pending.has('health') ? null : t.current);
    if (second && (num(data[second.id]) !== before.second || changes.has(`health:${second.id}`))) {
      note(`health:${second.id}`, second.label, before.second, pending.has(`health:${second.id}`) ? null : num(data[second.id]));
    }
  };

  for (const id of order) {
    for (const r of rests.find((x) => x.id === id).refills) {
      if (r.what === 'health') refillHealth(r.how, r.amount, r.track);
      else if (typeof r.what === 'string' && r.what.startsWith(SECTION)) {
        for (const f of reach.sections.get(r.what.slice(SECTION.length)) || []) refillField(f, 'max');
      } else if (reach.numbers.has(r.what)) refillField(r.what, r.how, r.amount);
    }
  }

  const ends = new Set(order);
  const wearsOff = new Set(conditionsOf(definition).filter((c) => c.ends === 'rest' && c.at.some((a) => ends.has(a))).map((c) => c.id));
  const kept = list(conditions).filter((c) => !wearsOff.has(c.id));
  const gone = list(conditions).filter((c) => wearsOff.has(c.id)).map((c) => c.id);

  return {
    ok: true,
    sheetPatch: patch,
    token: t,
    conditions: kept,
    gone,
    changes: [...changes.values()]
      .filter((c) => c.to === null || c.to !== c.from)
      .map((c) => (c.to === null ? { ...c, pending: pending.get(c.what) || [] } : c)),
    rolls,
  };
};

module.exports = { restOn, restOrder };
