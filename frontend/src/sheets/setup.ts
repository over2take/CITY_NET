// The builder's SETUP page as logic (4a3a): the core rules questions read from a system's
// definition and written back, and the starter sheet's HEALTH section the page previews. Pure,
// so the page only draws it. Approved mockup docs/mockups/builder-setup.html (2026-10-06).
//
// The answers are the definition's `core` (backend/systemBuilder/core.js checks them) and its
// cover fields (description, author, license). The lists of models, advancement kinds and units
// mirror core.js's, and the preview mirrors its healthLayout: a test holds each to the server's.

import type { Definition } from './systemsApi';

export type HealthModel = 'pool' | 'tracks' | 'typed' | 'harm' | 'wounds' | 'locations' | 'none';
export interface Named { id: string; label: string }
export interface HarmLevel extends Named { slots: number; penalty?: string }
export type Health =
  | { model: 'pool'; label?: string }
  | { model: 'tracks'; tracks: Named[]; overflow?: boolean }
  | { model: 'typed'; label?: string; types: Named[] }
  | { model: 'harm'; levels: HarmLevel[] }
  | { model: 'wounds'; count: number; penalty?: number }
  | { model: 'locations'; label?: string; locations: Named[] }
  | { model: 'none' };

/** The health models, as the SETUP page offers them (core.js HEALTH_MODELS). */
export const HEALTH_MODELS: { id: HealthModel; label: string; worksLike: string; examples: string }[] = [
  { id: 'pool', label: 'One pool', worksLike: 'A number that goes down', examples: 'D&D, CWN, Cyberpunk RED' },
  { id: 'tracks', label: 'Two tracks', worksLike: 'Two pools, filled by different damage', examples: 'Shadowrun physical and stun; Genesys wounds and strain' },
  { id: 'typed', label: 'Damage types on one track', worksLike: 'Boxes marked lightly or heavily', examples: 'Vampire superficial and aggravated' },
  { id: 'harm', label: 'Harm levels', worksLike: 'Named severities, each with its penalty', examples: 'Blades lesser, moderate, severe' },
  { id: 'wounds', label: 'Wound count', worksLike: 'A few wounds, then out', examples: 'Savage Worlds' },
  { id: 'locations', label: 'Hit locations', worksLike: 'Damage per location, with critical injuries', examples: 'WFRP' },
  { id: 'none', label: 'None', worksLike: 'Consequences are conditions', examples: 'Some narrative games' },
];

/** How characters advance: any of these, or none (core.js ADVANCEMENT). */
export const ADVANCEMENT: { id: string; label: string; examples: string }[] = [
  { id: 'levels', label: 'XP levels', examples: 'D&D, CWN' },
  { id: 'milestone', label: 'Milestone', examples: 'The GM levels the group up' },
  { id: 'spend', label: 'Spend XP', examples: 'Shadowrun karma, World of Darkness, Genesys' },
  { id: 'use', label: 'Improve by use', examples: 'Call of Cthulhu' },
];

/** Distance units, each with what the map's ruler does with it (3d; core.js DISTANCE). */
export const DISTANCE: { id: string; what: string }[] = [
  { id: 'feet', what: 'The map\'s own unit, as every built-in system' },
  { id: 'meters', what: 'Converted from the map\'s feet' },
  { id: 'yards', what: 'Converted from the map\'s feet' },
  { id: 'squares', what: 'Counts the map\'s squares' },
  { id: 'hexes', what: 'Counts the map\'s squares as hexes' },
  { id: 'zones', what: 'The ruler draws its line with no number' },
];

/** The dice offered as toggles; any other can be added (core.js DIE). */
export const COMMON_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', '2d6', '3d6', '4dF'];
export const MAX_DICE = 8;
const DIE = /^([1-9][0-9]?)?d([2-9]|[1-9][0-9]|100|F)$/;

/** How many entries each model's list may have (core.js checkHealth). */
export const LIST_LIMITS = { tracks: [2, 2], types: [2, 4], levels: [1, 6], locations: [1, 12] } as const;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a model starts as when the GM picks it: its usual shape, ready to rename. */
export const defaultHealth = (model: HealthModel): Health => {
  switch (model) {
    case 'tracks': return { model, tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true };
    case 'typed': return { model, label: 'HEALTH', types: [{ id: 'superficial', label: 'SUPERFICIAL' }, { id: 'aggravated', label: 'AGGRAVATED' }] };
    case 'harm': return { model, levels: [
      { id: 'lesser', label: 'LESSER', slots: 2, penalty: 'Less effect' },
      { id: 'moderate', label: 'MODERATE', slots: 2, penalty: '-1d' },
      { id: 'severe', label: 'SEVERE', slots: 1, penalty: 'Need help' },
    ] };
    case 'wounds': return { model, count: 3, penalty: -1 };
    case 'locations': return { model, label: 'HP', locations: ['HEAD', 'BODY', 'LEFT ARM', 'RIGHT ARM', 'LEFT LEG', 'RIGHT LEG'].map((label) => ({ id: idFor(label, []), label })) };
    case 'none': return { model };
    default: return { model: 'pool' };
  }
};

/**
 * An id for a new entry from its label: lowercase letters, digits and _, starting with a letter,
 * not one already `taken` (core.js NAME). An entry keeps its id when its label changes later, so
 * what characters have in it stays theirs.
 */
export const idFor = (label: string, taken: string[]): string => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  if (!/^[a-z]/.test(base)) base = `x${base}`.slice(0, 36);
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}_${n}`;
  return id;
};

/** Every answer SETUP shows, from a definition: what it says, or the defaults where it says nothing. */
export const setupOf = (def: Definition | null) => {
  const core = isObject(def?.core) ? def!.core as Record<string, unknown> : {};
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const health = isObject(core.health) && HEALTH_MODELS.some((m) => m.id === (core.health as { model?: string }).model)
    ? core.health as Health : { model: 'pool' as const };
  return {
    description: text(def?.description),
    author: text(def?.author),
    license: text(def?.license),
    health,
    advancement: Array.isArray(core.advancement) ? core.advancement.filter((a): a is string => typeof a === 'string') : [],
    dice: Array.isArray(core.dice) ? core.dice.filter((d): d is string => typeof d === 'string') : [],
    distance: typeof core.distance === 'string' && DISTANCE.some((d) => d.id === core.distance) ? core.distance : 'feet',
  };
};

/** The definition with a cover field set; a blank one is left out rather than stored empty. */
export const withCover = (def: Definition, key: 'description' | 'author' | 'license', value: string): Definition => {
  const next: Definition = { ...def };
  if (value.trim()) next[key] = value; else delete next[key];
  return next;
};

/** The definition with some of its core answers replaced. */
export const withCore = (def: Definition, patch: Record<string, unknown>): Definition => ({
  ...def,
  core: { ...(isObject(def.core) ? def.core : {}), ...patch },
});

/** Advancement with one kind turned on or off, kept in the page's order. */
export const toggleAdvancement = (chosen: string[], id: string): string[] =>
  ADVANCEMENT.map((a) => a.id).filter((a) => (a === id ? !chosen.includes(id) : chosen.includes(a)));

/** The dice with one toggled; a die past the limit is not added. */
export const toggleDie = (dice: string[], die: string): string[] =>
  (dice.includes(die) ? dice.filter((d) => d !== die) : dice.length >= MAX_DICE ? dice : [...dice, die]);

/** A die typed in: added, or why not. */
export const addDie = (dice: string[], typed: string): { dice: string[] } | { error: string } => {
  const die = typed.trim();
  if (!DIE.test(die)) return { error: `${die} is not a die (d2 to d100, or dF, with a count: 2d6)` };
  if (dice.includes(die)) return { dice };
  if (dice.length >= MAX_DICE) return { error: `Up to ${MAX_DICE} dice` };
  return { dice: [...dice, die] };
};

// ─── The preview ────────────────────────────────────────────────────────────

export interface PreviewField { id: string; label: string; type: string; source?: string; maxField?: string; hint?: string }
export interface PreviewSection { id: string; label: string; layout: string; tab: string; columns?: number; fields: PreviewField[] }

/** The starter sheet's health sections for a model, exactly as core.js healthLayout builds them. */
export const healthLayout = (health: unknown, hpWord = 'HP'): { sections: PreviewSection[]; header: { hpField?: string; hpMaxField?: string } } => {
  const h = (isObject(health) ? health : { model: 'pool' }) as Record<string, unknown>;
  const grid = (fields: PreviewField[]): PreviewSection => ({ id: 'health', label: 'HEALTH', layout: 'grid', tab: 'STATS', columns: 2, fields });
  const pool = (id: string, name: string): PreviewField[] => [
    { id, label: name, type: 'number', source: 'token_hp', maxField: `${id}_max` },
    { id: `${id}_max`, label: `${name} MAX`, type: 'number', source: 'token_hp_max' },
  ];
  const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObject) as Record<string, unknown>[] : []);
  switch (h.model) {
    case 'tracks': {
      const [first, second] = list(h.tracks) as unknown as Named[];
      if (!first || !second) return healthLayout({ model: 'pool' }, hpWord);
      return {
        sections: [grid([
          ...pool(first.id, first.label),
          { id: second.id, label: second.label, type: 'number', maxField: `${second.id}_max` },
          { id: `${second.id}_max`, label: `${second.label} MAX`, type: 'number' },
        ])],
        header: { hpField: first.id, hpMaxField: `${first.id}_max` },
      };
    }
    case 'typed':
      return {
        sections: [grid([
          ...pool('health', text(h.label, 'HEALTH')),
          ...list(h.types).map((t) => ({ id: t.id as string, label: t.label as string, type: 'number', hint: 'Boxes marked with this kind of damage' })),
        ])],
        header: { hpField: 'health', hpMaxField: 'health_max' },
      };
    case 'harm':
      return {
        sections: [{ id: 'harm', label: 'HARM', layout: 'list', tab: 'STATS', fields: list(h.levels).flatMap((level) =>
          Array.from({ length: Number.isInteger(level.slots) ? level.slots as number : 1 }, (_, i) => ({
            id: `${level.id}_${i + 1}`,
            label: i === 0 ? level.label as string : `${level.label} ${i + 1}`,
            type: 'text',
            ...(level.penalty ? { hint: level.penalty as string } : {}),
          }))) }],
        header: {},
      };
    case 'wounds':
      return {
        sections: [grid([
          { id: 'wounds', label: 'WOUNDS LEFT', type: 'number', source: 'token_hp', maxField: 'wounds_max' },
          { id: 'wounds_max', label: 'WOUNDS', type: 'number', source: 'token_hp_max',
            ...(Number.isInteger(h.count) ? { hint: `Out after ${h.count}` } : {}) },
        ])],
        header: { hpField: 'wounds', hpMaxField: 'wounds_max' },
      };
    case 'locations':
      return {
        sections: [
          grid(pool('hp', text(h.label, hpWord))),
          { id: 'injuries', label: 'INJURIES', layout: 'list', tab: 'STATS',
            fields: list(h.locations).map((l) => ({ id: l.id as string, label: l.label as string, type: 'text' })) },
        ],
        header: { hpField: 'hp', hpMaxField: 'hp_max' },
      };
    case 'none':
      return { sections: [], header: {} };
    default:
      return { sections: [grid(pool('hp', text(h.label, hpWord)))], header: { hpField: 'hp', hpMaxField: 'hp_max' } };
  }
};

/** What the preview says the token's health monitor shows under a model. */
export const tokenNote = (health: Health): string => {
  switch (health.model) {
    case 'tracks': {
      const [a, b] = health.tracks;
      return `The token's monitor shows ${a?.label ?? 'the first track'}; ${b?.label ?? 'the second'} lives on the sheet.${health.overflow ? ` A full ${b?.label ?? 'second track'} spills into ${a?.label ?? 'the first'}.` : ''}`;
    }
    case 'typed': return `The token's monitor shows ${health.label || 'HEALTH'}; heavier damage turns lighter boxes over.`;
    case 'harm': return 'No number on the token: it shows the worst level taken.';
    case 'wounds': return `Out after ${health.count} wounds${health.penalty ? `, each giving ${health.penalty} to rolls` : ''}.`;
    case 'locations': return 'Injuries are noted per location, under the health pool.';
    case 'none': return 'No health section. Consequences are written in as conditions.';
    default: return `The token's monitor shows ${health.label || 'HP'}.`;
  }
};
