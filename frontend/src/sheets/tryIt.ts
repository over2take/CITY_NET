// The builder's TRY IT page as logic (4c2; approved mockup docs/mockups/builder-try-it.html,
// 2026-10-08): a made-up character on the draft as it stands, unsaved changes included. What is
// typed is thrown away unless SAVE AS THE SAMPLE CHARACTER writes the stats back to STATS & RULES;
// RESET goes back to them. Formulas are worked out by the server from what is typed
// (POST /api/systems/preview-values, the typed numbers as the sample); health is tried on a pretend
// token by the game's own rules (POST /api/systems/try-health).

import type { Definition } from './systemsApi';
import type { CustomRenderField } from './customTemplates';
import { allStats, sampleOf, withSample } from './statsRules';

/** A made-up character: field id to what is in it. */
export type Character = Record<string, string | number>;

/** The name a made-up character starts with. */
export const SAMPLE_NAME = 'Sample character';

/** The character TRY IT starts from, and RESET goes back to: the sample, with a name. */
export const sampleCharacter = (def: Definition): Character => {
  const out: Character = { name: SAMPLE_NAME };
  for (const s of allStats(def)) {
    const v = sampleOf(def, s.id);
    if (v !== null) out[s.id] = v;
  }
  return out;
};

/** What was typed into a field: a number field's number (blank as nothing), text as written. */
export const withTyped = (character: Character, field: Pick<CustomRenderField, 'id' | 'type'>, value: unknown): Character => {
  const next = { ...character };
  if (field.type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (value === '' || value === null || value === undefined || !Number.isFinite(n)) delete next[field.id];
    else next[field.id] = n;
  } else if (value === '' || value === null || value === undefined) delete next[field.id];
  else next[field.id] = String(value);
  return next;
};

/** The draft with the character's numbers as its sample, for the server to work formulas out from. */
export const withCharacterAsData = (def: Definition, character: Character): Definition => ({
  ...def,
  samples: Object.fromEntries(Object.entries(character).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))),
});

/** Whether the character's stats differ from the sample's: SAVE AS THE SAMPLE CHARACTER is offered then. */
export const differsFromSample = (def: Definition, character: Character): boolean =>
  allStats(def).some((s) => {
    const typed = typeof character[s.id] === 'number' ? character[s.id] as number : null;
    return typed !== sampleOf(def, s.id);
  });

/** The draft with the character's stats saved as its sample: SAVE AS THE SAMPLE CHARACTER. */
export const withCharacterAsSample = (def: Definition, character: Character): Definition =>
  allStats(def).reduce((d, s) => withSample(d, s.id, typeof character[s.id] === 'number' ? character[s.id] as number : null), def);

/** A pretend token's health. */
export interface PretendToken { current: number; max: number; temp: number }

/**
 * The pretend token TRY IT starts with: full, at 10, or at the model's own count of wounds,
 * where the token's current is the wounds left.
 */
export const startingToken = (def: Definition): PretendToken => {
  const health = (def.core as { health?: { model?: string; count?: number } } | undefined)?.health;
  const max = health?.model === 'wounds' && Number.isInteger(health.count) && (health.count as number) > 0 ? health.count as number : 10;
  return { current: max, max, temp: 0 };
};

/** The pretend token as the HEALTH folder's panels read a token. */
export const asLocation = (token: PretendToken) => ({ id: -1, hp_current: token.current, hp_max: token.max, hp_temp: token.temp });

/**
 * A pretend token's maximum set as the game's set_max does it (routes/locations.js): a token at 0
 * fills to the new maximum, and current never stays above it.
 */
export const withMax = (token: PretendToken, max: number): PretendToken => {
  const m = Math.max(0, Math.round(Number.isFinite(max) ? max : 0));
  return { ...token, max: m, current: token.current === 0 ? m : Math.min(token.current, m) };
};
