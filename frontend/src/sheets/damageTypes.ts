// The builder's DAMAGE TYPES page as logic (8b1b; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23). A
// system's damage types read from its definition and written back, storing only what differs from the starter set, as
// CONDITIONS does; and what RESIST, IMMUNE and VULNERABLE mean in words. Mirrors backend/systemBuilder/damageTypes.js,
// which checks what is written; the tests hold the two together.

import type { Definition } from './systemsApi';
import { idFor } from './setup';

export const LIMITS = { types: 40, name: 30, description: 300, means: 200 } as const;
export type Kind = 'resist' | 'immune' | 'vulnerable';
export const KINDS: Kind[] = ['resist', 'immune', 'vulnerable'];
/** What each word means where the system says nothing: the server's MEANS. */
export const MEANS: Record<Kind, string> = { resist: 'Takes half, rounded down.', immune: 'Takes none.', vulnerable: 'Takes double.' };

/** A damage type, whole: one picture, its icon (drawn or uploaded) or a pad drawing. */
export interface DamageType { id: string; name: string; icon?: string; drawn?: string[]; description: string; standard: boolean }
/** A damage type as the page lists it, and whether it is on. */
export type Listed = DamageType & { on: boolean };
/** What the page changes on one type. An icon and a drawing are one picture: setting one takes the other off. */
export type TypePatch = { on?: boolean; name?: string; icon?: string; drawn?: string[]; description?: string };

/** The starter set every system has, as the server has it; `on: false` starts off. */
export const STANDARD: { id: string; name: string; icon: string; description: string; on?: false }[] = [
  { id: 'fire', name: 'Fire', icon: 'flame', description: 'Burns.' },
  { id: 'cold', name: 'Cold', icon: 'snow', description: 'Freezes.' },
  { id: 'lightning', name: 'Lightning', icon: 'bolt', description: 'Shocks.' },
  { id: 'acid', name: 'Acid', icon: 'drop', description: 'Eats away.' },
  { id: 'poison', name: 'Poison', icon: 'bio', description: 'Sickens.' },
  { id: 'necrotic', name: 'Necrotic', icon: 'skull', description: 'Withers life.' },
  { id: 'radiant', name: 'Radiant', icon: 'star', description: 'Searing light.' },
  { id: 'psychic', name: 'Psychic', icon: 'spiral', description: 'Hurts the mind.' },
  { id: 'force', name: 'Force', icon: 'ray', description: 'Pure magic.' },
  { id: 'thunder', name: 'Thunder', icon: 'wave', description: 'A blast of sound.' },
  { id: 'physical', name: 'Physical', icon: 'impact', description: 'Any blow, cut or shot.', on: false },
  { id: 'bludgeoning', name: 'Bludgeoning', icon: 'impact', description: 'Blunt blows.' },
  { id: 'piercing', name: 'Piercing', icon: 'point', description: 'Stabs and arrows.' },
  { id: 'slashing', name: 'Slashing', icon: 'blade', description: 'Cuts.' },
  { id: 'energy', name: 'Energy', icon: 'bolt', description: 'Lasers and plasma.', on: false },
  { id: 'kinetic', name: 'Kinetic', icon: 'point', description: 'Bullets and blows.', on: false },
  { id: 'emp', name: 'EMP', icon: 'signal', description: 'Fries electronics and chrome.', on: false },
];
const standardOf = (id: string) => STANDARD.find((s) => s.id === id);

type Obj = Record<string, unknown>;
type Stored = Record<string, Obj>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const damageOf = (def: Definition): Obj => (isObject(def.damage) ? def.damage : {});
const storedOf = (def: Definition): Stored => {
  const types = damageOf(def).types;
  return isObject(types) ? Object.fromEntries(Object.entries(types).filter(([, t]) => isObject(t))) as Stored : {};
};
const isDrawing = (v: unknown): v is string[] => Array.isArray(v) && v.length === 16 && v.every((r) => typeof r === 'string' && /^[0-9a-f]{4}$/.test(r));

const whole = (id: string, t: Obj, base?: typeof STANDARD[number]): Listed => {
  const typed = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : '';
  const look = isDrawing(t.drawn) ? { drawn: t.drawn } : { icon: typeof t.icon === 'string' && t.icon ? t.icon : (base ? base.icon : 'target') };
  return {
    id,
    name: typed || (base ? base.name : typeof t.name === 'string' ? t.name : ''),
    ...look,
    description: typeof t.description === 'string' ? t.description : (base ? base.description : ''),
    standard: !!base,
    on: base ? (typeof t.on === 'boolean' ? t.on : base.on !== false) : true,
  };
};

/** Every damage type the page lists: the starter set in order with its edits and whether each is on, then the system's own. */
export const damageList = (def: Definition): Listed[] => {
  const stored = storedOf(def);
  return [
    ...STANDARD.map((s) => whole(s.id, stored[s.id] ?? {}, s)),
    ...Object.entries(stored).filter(([id]) => !standardOf(id)).map(([id, t]) => whole(id, t)),
  ];
};

/** How many damage types a system has, the starter ones included, against the limit of 40. */
export const damageCount = (def: Definition) => STANDARD.length + Object.keys(storedOf(def)).filter((id) => !standardOf(id)).length;

const withDamage = (def: Definition, damage: Obj): Definition => {
  const next: Definition = { ...def };
  if (Object.keys(damage).length) next.damage = damage; else delete next.damage;
  return next;
};
const withStored = (def: Definition, stored: Stored): Definition => {
  const damage: Obj = { ...damageOf(def) };
  if (Object.keys(stored).length) damage.types = stored; else delete damage.types;
  return withDamage(def, damage);
};

/**
 * The definition with one damage type changed. A starter one keeps only what differs from the starter (its name, icon or
 * words put back, or a name left blank, store nothing; a description emptied on purpose is kept); one of the system's own
 * keeps its name as typed, so a blank one is a problem to fix rather than a lost type. An icon and a drawing are one
 * picture: setting one takes the other off.
 */
export const withDamageType = (def: Definition, id: string, patch: TypePatch): Definition => {
  const stored = storedOf(def);
  const base = standardOf(id);
  const entry: Obj = { ...(stored[id] ?? {}), ...patch };
  if (patch.icon !== undefined) delete entry.drawn;
  if (patch.drawn !== undefined) delete entry.icon;
  if (base) {
    if (entry.on === (base.on !== false) || typeof entry.on !== 'boolean') delete entry.on;
    for (const key of ['name', 'icon', 'description'] as const) {
      const v = entry[key];
      if (typeof v !== 'string') continue;
      if (v.trim() === base[key] || (key !== 'description' && !v.trim())) delete entry[key];
    }
  } else {
    delete entry.on;
    if (typeof entry.description === 'string' && !entry.description) delete entry.description;
    if (typeof entry.icon === 'string' && !entry.icon) delete entry.icon;
  }
  const next = { ...stored };
  if (Object.keys(entry).length || !base) next[id] = entry; else delete next[id];
  return withStored(def, next);
};

/** A name no type that is on has yet: "New type", then "New type 2"... */
const freeName = (def: Definition) => {
  const taken = new Set(damageList(def).filter((t) => t.on).map((t) => t.name.toUpperCase()));
  let name = 'New type';
  for (let n = 2; taken.has(name.toUpperCase()); n += 1) name = `New type ${n}`;
  return name;
};

/** The definition with a new damage type of its own, named to be renamed, and its id. Null at the limit. */
export const withNewDamageType = (def: Definition): { definition: Definition; id: string } | null => {
  if (damageCount(def) >= LIMITS.types) return null;
  const stored = storedOf(def);
  const name = freeName(def);
  const id = idFor(name, [...STANDARD.map((s) => s.id), ...Object.keys(stored)]);
  return { definition: withStored(def, { ...stored, [id]: { name } }), id };
};

/** The definition without one of the system's own types; a starter one is only switched off. */
export const withoutDamageType = (def: Definition, id: string): Definition => {
  if (standardOf(id)) return def;
  const rest = { ...storedOf(def) };
  delete rest[id];
  return withStored(def, rest);
};

/** What RESIST, IMMUNE and VULNERABLE mean in the system: its words, or the app's where it says none. */
export const meaningsOf = (def: Definition): Record<Kind, string> => Object.fromEntries(KINDS.map((k) => {
  const said = damageOf(def)[k];
  return [k, isObject(said) && typeof said.means === 'string' && said.means.trim() ? said.means.trim() : MEANS[k]];
})) as Record<Kind, string>;

/** What a word means as typed, for its box: blank where the system keeps the app's. */
export const meaningTyped = (def: Definition, kind: Kind): string => {
  const said = damageOf(def)[kind];
  return isObject(said) && typeof said.means === 'string' ? said.means : '';
};

/** The definition with what one word means set; blank, or the app's own words, stores nothing. */
export const withMeaning = (def: Definition, kind: Kind, means: string): Definition => {
  const damage: Obj = { ...damageOf(def) };
  if (!means.trim() || means.trim() === MEANS[kind]) delete damage[kind];
  else damage[kind] = { means };
  return withDamage(def, damage);
};

/**
 * What is wrong with a type's name, as the server says it (damageTypes.js checkDamage), or null: one of the system's own
 * needs one; letters, digits, spaces, a hyphen or an apostrophe, starting with a letter; never DMG; and no other type
 * that is on may have it, since a hit names its type. The server names the second of two that share one; the first is
 * told too, so the type just renamed says why wherever it sits in the list.
 */
export const nameTrouble = (def: Definition, id: string): string | null => {
  const list = damageList(def);
  const t = list.find((x) => x.id === id);
  if (!t) return null;
  const name = t.name.trim();
  if (!name) return 'Needs a name';
  if (!/^[A-Za-z][A-Za-z0-9 '-]*$/.test(name)) return 'Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter';
  if (name.toUpperCase() === 'DMG') return 'DMG is the word after a hit, so not a type\'s name';
  if (!t.on) return null;
  const key = name.toUpperCase().replace(/\s+/g, ' ');
  const same = list.filter((x) => x.on && x.name.trim().toUpperCase().replace(/\s+/g, ' ') === key);
  if (same.length < 2) return null;
  if (same[0].id !== id) return `${name.toUpperCase()} is already the name of damage type ${same[0].id}; a hit names its type, so each needs its own`;
  return `${name.toUpperCase()} is also the name of damage type ${same[1].id}; a hit names its type, so each needs its own`;
};
