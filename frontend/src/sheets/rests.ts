// The builder's RESTS page as logic (4f3; approved mockup docs/mockups/builder-rests.html,
// 2026-10-09). A system's rests read from its definition and written back, storing only what
// differs from the standard four, as conditions.ts does. Mirrors backend/systemBuilder/rests.js,
// which checks what is written and runs it; the tests hold the two together.

import type { Definition } from './systemsApi';
import type { CustomRenderSheet } from './customTemplates';
import { idFor, setupOf, healthLayout } from './setup';
import { partIsOn } from './wordsFeatures';
import { conditionList, withCondition } from './conditions';

export const LIMITS = { rests: 12, name: 30, refills: 20, amount: 200 } as const;
export const SECTION = 'section:';

export type How = 'full' | 'by' | 'max' | 'to';
export interface Refill { what: string; how: How; amount?: string; track?: string }
export interface Rest {
  id: string;
  name: string;
  standard: boolean;
  on: boolean;
  counts_as: string[];
  refills: Refill[];
}
/** What the page changes on one rest. */
export type RestPatch = Partial<Pick<Rest, 'name' | 'on' | 'counts_as' | 'refills'>>;

/** The standard rests every system starts with, as the server has them. */
export const STANDARD: { id: string; name: string }[] = [
  { id: 'short_rest', name: 'Short rest' },
  { id: 'long_rest', name: 'Long rest' },
  { id: 'end_of_scene', name: 'End of scene' },
  { id: 'end_of_session', name: 'End of session' },
];
const standardOf = (id: string) => STANDARD.find((s) => s.id === id);

type Stored = Record<string, Record<string, unknown>>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const storedOf = (def: Definition): Stored => (isObject(def.rests)
  ? Object.fromEntries(Object.entries(def.rests).filter(([, r]) => isObject(r))) as Stored : {});
const refillsOf = (v: unknown): Refill[] => (Array.isArray(v) ? v.filter(isObject).map((r) => ({ ...r }) as unknown as Refill) : []);
const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Every rest the page lists: the standard four in order, each with its edits and whether it is on,
 * then the system's own in the order written (a nameless one listed with a blank name, to be named).
 */
export const restList = (def: Definition): Rest[] => {
  const stored = storedOf(def);
  const whole = (id: string, name: string, r: Record<string, unknown>, standard: boolean): Rest => ({
    id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : name,
    standard,
    on: !standard || r.on !== false,
    counts_as: idsOf(r.counts_as),
    refills: refillsOf(r.refills),
  });
  return [
    ...STANDARD.map((s) => whole(s.id, s.name, stored[s.id] ?? {}, true)),
    ...Object.entries(stored).filter(([id]) => !standardOf(id)).map(([id, r]) => whole(id, '', r, false)),
  ];
};

/** The rests the game offers: those on and named, as the server's restsOf gives them. */
export const restsOf = (def: Definition) => {
  const on = restList(def).filter((r) => r.on && r.name.trim());
  const ids = new Set(on.map((r) => r.id));
  return on.slice(0, LIMITS.rests).map(({ on: _on, ...r }) => ({ ...r, counts_as: r.counts_as.filter((c) => ids.has(c) && c !== r.id) }));
};

/** How many rests a system has, the standard ones included, against the limit of 12. */
export const restCount = (def: Definition) => STANDARD.length + Object.keys(storedOf(def)).filter((id) => !standardOf(id)).length;

const withStored = (def: Definition, stored: Stored): Definition => {
  const next: Definition = { ...def };
  if (Object.keys(stored).length) next.rests = stored; else delete next.rests;
  return next;
};

/**
 * The definition with one rest changed. A standard rest keeps only what differs from the standard
 * (on, a name put back or left blank, nothing counted or refilled store nothing); one of the
 * system's own keeps its name as typed, so a blank one is a problem to fix rather than a lost rest.
 */
export const withRest = (def: Definition, id: string, patch: RestPatch): Definition => {
  const stored = storedOf(def);
  const base = standardOf(id);
  const entry: Record<string, unknown> = { ...(stored[id] ?? {}), ...patch };
  if (Array.isArray(entry.counts_as) && !entry.counts_as.length) delete entry.counts_as;
  if (Array.isArray(entry.refills) && !entry.refills.length) delete entry.refills;
  if (base) {
    if (entry.on !== false) delete entry.on;
    if (typeof entry.name === 'string' && (!entry.name.trim() || entry.name.trim() === base.name)) delete entry.name;
  } else {
    delete entry.on;
  }
  const next = { ...stored };
  if (Object.keys(entry).length || !base) next[id] = entry; else delete next[id];
  return withStored(def, next);
};

/** The definition with a new rest of its own, named to be renamed, and its id. Null at the limit. */
export const withNewRest = (def: Definition): { definition: Definition; id: string } | null => {
  if (restCount(def) >= LIMITS.rests) return null;
  const stored = storedOf(def);
  const id = idFor('new rest', [...STANDARD.map((s) => s.id), ...Object.keys(stored)]);
  return { definition: withStored(def, { ...stored, [id]: { name: 'New rest' } }), id };
};

/**
 * The definition without one of the system's own rests; a standard one is only turned off. Nothing
 * is left pointing at it: other rests stop counting as it, and conditions stop ending at it (one
 * that ended at no other rest goes back to ending when removed).
 */
export const withoutRest = (def: Definition, id: string): Definition => {
  if (standardOf(id)) return def;
  const { [id]: _gone, ...rest } = storedOf(def);
  let next = withStored(def, rest);
  for (const r of restList(next)) {
    if (r.counts_as.includes(id)) next = withRest(next, r.id, { counts_as: r.counts_as.filter((c) => c !== id) });
  }
  for (const c of conditionList(next)) {
    if (c.ends === 'rest' && (c.at ?? []).includes(id)) next = withWearsOff(next, c.id, id, false);
  }
  return next;
};

// ─── Counting as other rests ────────────────────────────────────────────────

/** Every rest `id` counts as, directly or through another, deepest first, each once. */
export const countedAs = (def: Definition, id: string): string[] => {
  const byId = new Map(restList(def).map((r) => [r.id, r]));
  const order: string[] = [];
  const seen = new Set<string>([id]);
  const visit = (at: string) => {
    for (const c of byId.get(at)?.counts_as ?? []) {
      if (seen.has(c) || !byId.has(c)) continue;
      seen.add(c);
      visit(c);
      order.push(c);
    }
  };
  visit(id);
  return order;
};

/** Whether `id` counting as `other` would make it count as itself. */
export const makesLoop = (def: Definition, id: string, other: string) => other === id || countedAs(def, other).includes(id);

// ─── Refills ────────────────────────────────────────────────────────────────

/** Health models whose HEAL takes an amount; harm levels heal a slot, and none has no health. */
const HEALS_BY_AMOUNT = new Set(['pool', 'tracks', 'typed', 'wounds', 'locations']);

/** One thing a refill can name, and what it may do to it. */
export interface Target {
  id: string;
  label: string;
  kind: 'health' | 'field' | 'section';
  hows: How[];
  /** A two-track system's tracks, for health up by an amount. */
  tracks?: { id: string; label: string }[];
}

export const HOW_LABELS: Record<How, string> = { full: 'TO FULL', by: 'UP OR DOWN BY', max: 'TO ITS MAXIMUM', to: 'SET TO' };

/**
 * What a system's rests can refill, from its definition and the sheet it plays with (the builder's
 * previewed effective sheet): health under its model, the sheet's numbers a rest may change (never
 * one worked out by a formula, linked to the token or bank, or part of the health layout), and the
 * sections holding any with a maximum. As the server's rests.js reachOf has them.
 */
export const refillTargets = (def: Definition, sheet: CustomRenderSheet | null): Target[] => {
  const out: Target[] = [];
  const health = partIsOn(def, 'token_health') ? setupOf(def).health as { model: string; label?: string; tracks?: { id: string; label: string }[] } : null;
  if (health && health.model !== 'none') {
    out.push({
      id: 'health', label: (health.label || 'HEALTH').toUpperCase(), kind: 'health',
      hows: HEALS_BY_AMOUNT.has(health.model) ? ['full', 'by'] : ['full'],
      ...(health.model === 'tracks' && Array.isArray(health.tracks) ? { tracks: health.tracks.filter(isObject).map((t) => ({ id: t.id, label: t.label })) } : {}),
    });
  }
  const derived = new Set(Array.isArray(def.derived) ? def.derived.filter(isObject).map((d) => d.id as string) : []);
  const healthFields = new Set(healthLayout(health ?? { model: 'none' }).sections.flatMap((s) => s.fields.map((f) => f.id)));
  const sections = sheet?.sections ?? [];
  const refillable = (f: { id: string; type: string; source?: string }) => f.type === 'number' && !f.source && !derived.has(f.id) && !healthFields.has(f.id);
  const numbers = sections.flatMap((s) => s.fields).filter((f) => f && typeof f.id === 'string' && refillable(f as { id: string; type: string; source?: string }));
  for (const f of numbers) {
    out.push({ id: f.id, label: f.label || f.id, kind: 'field', hows: (f as { maxField?: string }).maxField ? ['max', 'by', 'to'] : ['by', 'to'] });
  }
  for (const s of sections) {
    if (s.fields.some((f) => numbers.includes(f) && (f as { maxField?: string }).maxField)) {
      out.push({ id: `${SECTION}${s.id}`, label: `SECTION · ${s.label || s.id}`, kind: 'section', hows: ['max'] });
    }
  }
  return out;
};

/** A refill as the page lists it: "HP to full", "Fatigue down by 1", "every number in MAGIC to its maximum". */
export const describeRefill = (r: Refill, targets: Target[]): string => {
  const t = targets.find((x) => x.id === r.what);
  const what = t ? (t.kind === 'section' ? t.label.replace(/^SECTION · /, '') : t.label) : r.what;
  if (t?.kind === 'section') return `every number in ${what} to its maximum`;
  if (r.how === 'full') return `${what} to full`;
  if (r.how === 'max') return `${what} to its maximum`;
  const amount = String(r.amount ?? '').trim() || '0';
  if (r.how === 'to') return `${what} set to ${amount}`;
  const track = r.track ? ` (${t?.tracks?.find((x) => x.id === r.track)?.label ?? r.track})` : '';
  return /^-/.test(amount) ? `${what}${track} down by ${amount.replace(/^-\s*/, '')}` : `${what}${track} up by ${amount}`;
};

/** A new refill: the first target, its first way, with an amount where it needs one. */
export const newRefill = (targets: Target[]): Refill | null => {
  const t = targets[0];
  if (!t) return null;
  return fitRefill({ what: t.id, how: t.hows[0] }, targets);
};

/**
 * A refill made to fit what it names: a way that target allows (its first otherwise), an amount
 * only where one is needed (1 up by, 0 set to, when there was none), a track only for health up by.
 */
export const fitRefill = (r: Refill, targets: Target[]): Refill => {
  const t = targets.find((x) => x.id === r.what);
  const how = t && !t.hows.includes(r.how) ? t.hows[0] : r.how;
  const needs = how === 'by' || how === 'to';
  const amount = needs ? (r.amount !== undefined && String(r.amount).trim() !== '' ? String(r.amount) : how === 'by' ? '1' : '0') : undefined;
  const track = how === 'by' && t?.tracks && r.track && t.tracks.some((x) => x.id === r.track) ? r.track : undefined;
  return { what: r.what, how, ...(amount !== undefined ? { amount } : {}), ...(track ? { track } : {}) };
};

/** The definition with one rest's refill changed, made to fit. */
export const withRefill = (def: Definition, restId: string, index: number, patch: Partial<Refill>, targets: Target[]): Definition => {
  const r = restList(def).find((x) => x.id === restId);
  if (!r || !r.refills[index]) return def;
  const refills = r.refills.map((x, i) => (i === index ? fitRefill({ ...x, ...patch } as Refill, targets) : x));
  return withRest(def, restId, { refills });
};

/** The definition with a refill added to a rest, or as it was when there is nothing to refill or no room. */
export const withNewRefill = (def: Definition, restId: string, targets: Target[]): Definition => {
  const r = restList(def).find((x) => x.id === restId);
  const added = newRefill(targets);
  if (!r || !added || r.refills.length >= LIMITS.refills) return def;
  return withRest(def, restId, { refills: [...r.refills, added] });
};

/** The definition without one of a rest's refills. */
export const withoutRefill = (def: Definition, restId: string, index: number): Definition => {
  const r = restList(def).find((x) => x.id === restId);
  if (!r) return def;
  return withRest(def, restId, { refills: r.refills.filter((_, i) => i !== index) });
};

// ─── What wears off ─────────────────────────────────────────────────────────

/** The conditions a rest ends itself (not through a rest it counts as). */
export const wearsOff = (def: Definition, restId: string): string[] =>
  conditionList(def).filter((c) => c.ends === 'rest' && (c.at ?? []).includes(restId)).map((c) => c.id);

/**
 * The definition with a condition ending at a rest, or no longer. The same switch as AT A REST on the
 * CONDITIONS page: a condition with no rest left goes back to ending when removed; one that ended
 * after rounds ends one way, so it is left alone.
 */
export const withWearsOff = (def: Definition, conditionId: string, restId: string, on: boolean): Definition => {
  const c = conditionList(def).find((x) => x.id === conditionId);
  if (!c || c.ends === 'rounds') return def;
  const at = c.ends === 'rest' ? c.at ?? [] : [];
  const next = on ? [...new Set([...at, restId])] : at.filter((a) => a !== restId);
  return withCondition(def, conditionId, next.length ? { ends: 'rest', at: next } : { ends: 'removed' });
};
