// The builder's NPCS page as logic (4b4b): a system's NPC stat block and its tiers, read from its
// definition and written back. Pure, so the page only draws it. Approved mockup
// docs/mockups/builder-npcs.html (2026-10-07):
//  - NPCs use the character sheet until the GM gives them a stat block of their own, which starts
//    as a copy of the character sheet;
//  - a tier is a difficulty: GENERATE_SHEET asks for a tier and a level, and each box (HP, defense,
//    each number) is a number, a formula reading @level, or dice, worked out by the server
//    (backend/systemBuilder/tierRolls.js). Text and pick-one fields are set as written; a blank
//    box leaves the field empty, and blank HP or defense leaves the token's own.
// The server checks all of it (backend/systemBuilder/npc.js).

import type { Definition, TriedTier } from './systemsApi';
import type { CustomRenderField, CustomRenderSheet } from './customTemplates';
import { idFor } from './setup';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The server's limits (npc.js LIMITS). */
export const LIMITS = { tiers: 20, label: 30, text: 300 };

export type Box = number | string;
export interface Tier { id: string; label: string; hp?: Box; defense?: Box; values?: Record<string, Box> }

const npcOf = (def: Definition): Obj => (isObject(def.npc) ? def.npc : {});
const withNpc = (def: Definition, npc: Obj): Definition => {
  const next: Definition = { ...def };
  if (Object.keys(npc).length) next.npc = npc; else delete next.npc;
  return next;
};

// ─── STAT BLOCK ─────────────────────────────────────────────────────────────

/** NPCs' own stat block, or null while they use the character sheet. */
export const ownBlock = (def: Definition): CustomRenderSheet | null => {
  const sheet = npcOf(def).sheet;
  return isObject(sheet) && Array.isArray(sheet.sections) ? sheet as unknown as CustomRenderSheet : null;
};

/** A stat block of their own, starting as the character sheet as drawn. */
export const withOwnBlock = (def: Definition, characterSheet: CustomRenderSheet): Definition =>
  withNpc(def, { ...npcOf(def), sheet: characterSheet });

/** Back to the character sheet: the stat block of their own dropped. */
export const withSharedBlock = (def: Definition): Definition => {
  const { sheet: _gone, ...rest } = npcOf(def);
  return withNpc(def, rest);
};

/**
 * The definition as the CHARACTER SHEET designer edits it, for the stat block: the stat block put
 * where the character sheet goes, so the same designer works on it (decided with the user: one
 * designer for both).
 */
export const asBlockDraft = (def: Definition): Definition => {
  const block = ownBlock(def);
  return block ? { ...def, sheet: block } : def;
};

/** A change the designer made to `asBlockDraft(def)`, put back as the stat block. */
export const fromBlockDraft = (def: Definition, edited: Definition): Definition => {
  const sheet = isObject(edited.sheet) ? edited.sheet : undefined;
  if (!sheet) return withSharedBlock(def);
  return withNpc(def, { ...npcOf(def), sheet });
};

/** The fields a tier can set: the stat block's, or the character sheet's when NPCs use it. */
export const blockFields = (def: Definition, characterSheet: CustomRenderSheet | null): CustomRenderField[] =>
  ((ownBlock(def) ?? characterSheet)?.sections ?? []).flatMap((s) => s.fields);

/**
 * The fields a tier sets as it starts: anything a GM fills in, never a value that lives on the
 * token or in the bank (the tier's HP and defense set those) or a formula (worked out).
 */
export const settableFields = (def: Definition, characterSheet: CustomRenderSheet | null): CustomRenderField[] => {
  const formulas = new Set((Array.isArray(def.derived) ? def.derived : []).filter(isObject).map((d) => d.id));
  return blockFields(def, characterSheet).filter((f) => !f.source && !formulas.has(f.id));
};

// ─── TIERS ──────────────────────────────────────────────────────────────────

/** The tiers, in order; the first is the default. */
export const tierList = (def: Definition): Tier[] => {
  const tiers = npcOf(def).tiers;
  return Array.isArray(tiers) ? tiers.filter((t) => isObject(t) && typeof t.id === 'string') as unknown as Tier[] : [];
};

const withTiers = (def: Definition, tiers: Tier[]): Definition => {
  const { tiers: _old, ...rest } = npcOf(def);
  return withNpc(def, tiers.length ? { ...rest, tiers } : rest);
};

/**
 * A new tier at the end, its id from its first name and kept after. It starts the stat block's
 * Level field at the level asked for, when there is one. Refused (unchanged) at twenty.
 */
export const withNewTier = (def: Definition, fields: CustomRenderField[], label = 'NEW TIER'): Definition => {
  const tiers = tierList(def);
  if (tiers.length >= LIMITS.tiers) return def;
  const level = fields.find((f) => f.id === 'level' && f.type === 'number');
  return withTiers(def, [...tiers, { id: idFor(label, tiers.map((t) => t.id)), label, ...(level ? { values: { level: '@level' } } : {}) }]);
};

/** A tier renamed; its id stays. A blank name is not stored. */
export const withTierLabel = (def: Definition, id: string, label: string): Definition =>
  (label.trim() ? withTiers(def, tierList(def).map((t) => (t.id === id ? { ...t, label: label.slice(0, LIMITS.label) } : t))) : def);

/** What is typed, stored: a whole number as a number, anything else as written, blank as nothing. */
const boxOf = (text: string): Box | undefined => {
  const t = text.trim();
  if (!t) return undefined;
  return /^\d+$/.test(t) ? Number(t) : text.slice(0, LIMITS.text);
};

/** A tier's HP or defense set from what was typed: a number, a formula or dice; blank keeps the token's own. */
export const withTierBox = (def: Definition, id: string, key: 'hp' | 'defense', text: string): Definition =>
  withTiers(def, tierList(def).map((t) => {
    if (t.id !== id) return t;
    const next: Tier = { ...t };
    const box = boxOf(text);
    if (box === undefined) delete next[key]; else next[key] = box;
    return next;
  }));

/**
 * What a tier starts a field with. A number field takes a number, a formula or dice, like HP; a text
 * or pick-one field takes what is written. Blank leaves the field empty.
 */
export const withTierValue = (def: Definition, id: string, field: CustomRenderField, text: string): Definition =>
  withTiers(def, tierList(def).map((t) => {
    if (t.id !== id) return t;
    const values = { ...(t.values ?? {}) };
    const box = field.type === 'number' ? boxOf(text) : (text === '' ? undefined : text.slice(0, LIMITS.text));
    if (box === undefined) delete values[field.id]; else values[field.id] = box;
    const { values: _old, ...rest } = t;
    return Object.keys(values).length ? { ...rest, values } : rest;
  }));

/** A box as the page shows it: what was written, a number as its digits, nothing as empty. */
export const boxText = (box: Box | undefined): string => (box === undefined ? '' : String(box));

/** A tier moved up (-1) or down (+1); the one on top is the default. */
export const withTierMoved = (def: Definition, id: string, dir: -1 | 1): Definition => {
  const tiers = tierList(def);
  const i = tiers.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tiers.length) return def;
  const next = [...tiers];
  [next[i], next[j]] = [next[j], next[i]];
  return withTiers(def, next);
};

/** A tier removed. NPCs already made from it keep their sheets. */
export const withoutTier = (def: Definition, id: string): Definition => withTiers(def, tierList(def).filter((t) => t.id !== id));

// ─── TRY IT ─────────────────────────────────────────────────────────────────

/** What is wrong with each of a tier's boxes, from a try (the server's own reading). */
export const boxErrors = (tried: TriedTier | null): { hp?: string; defense?: string; values: Record<string, string> } => {
  const out: { hp?: string; defense?: string; values: Record<string, string> } = { values: {} };
  if (!tried) return out;
  if ('error' in tried.hp) out.hp = tried.hp.error;
  if ('error' in tried.defense) out.defense = tried.defense.error;
  for (const [id, box] of Object.entries(tried.values)) if ('error' in box) out.values[id] = box.error;
  return out;
};

/** A tried box as the page shows it: its value, what the dice came up, or a dash. */
export const triedText = (box: TriedTier['hp'] | undefined): { value: string; dice: string } => {
  if (!box || 'blank' in box || 'error' in box) return { value: '—', dice: '' };
  return { value: String(box.value), dice: box.dice.map((d) => `${d.count}d${d.sides} [${d.rolls.join(' ')}]`).join(' ') };
};
