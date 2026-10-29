// A character's picks on their sheet, as logic (7a3b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27). The lists come in the render copy, in words (backend choices.js choicesShown); the
// character's own picks, levels and uses come in their sheet, worked out by the server on every save
// (choices.js workedOf, under WORKED_KEY). Nothing here works a number out: the server does, and the
// sheet only draws what it says. Pure, so the CHOICES block (components/ChoicesSection.tsx) only draws.
//
// What the picks do to the numbers shows on the fields themselves (7a3b2, choiceEffects): the badge the
// sheet already draws for CWN chrome, the value with its bonuses and where each came from (14 → 16,
// Hardy +2), from what the server says each modifier came from.
//
// Lists inside lists (7a5a2; approved mockup docs/mockups/nested-choices.html, 2026-10-28): a list
// picked THROUGH FEATURES isn't a block of its own; its picks hang under the feature that opened them
// (underPick), with room for more while the server says so (worked.opens). A pick whose feature locked
// again is kept and shown waiting. A list EVERYONE HAS has nothing to pick: its options are held, at
// the character's level.

import type { SheetEffects, FieldEffect } from './cyberwareEffects';
import type { SheetTemplate } from './types';

export interface FeatureShown {
  id: string; label: string; text?: string; at?: number;
  modifies?: string[]; uses?: { refill: string | null }; rolls?: string[]; changes?: string[]; opens?: string;
  /** How many picks it opens (7a5a): 1 when it says nothing. */
  opensCount?: number;
}
export interface OptionShown { id: string; label: string; description?: string; needs?: string; features: FeatureShown[] }
/** How a list is picked (backend choices.js PICKED). */
export type Picked = 'own' | 'features' | 'both' | 'everyone';
export interface ChoiceListShown { id: string; one: string; many: string; picks: number | 'any'; again: boolean; levelled: boolean; picked?: Picked; options: OptionShown[] }

/** What the server worked out of a character's picks on their last save (backend choices.js workedOf). */
export interface Worked {
  /** Every pick kept: `from` the feature it was picked under, `waiting` when that no longer counts. */
  picks: { list: string; option: string; level?: number; from?: string; waiting?: true }[];
  /** Each unlocked feature opening a list picked through features, and how many it gives and has. */
  opens: { feature: string; list: string; count: number; used: number }[];
  levels: Record<string, number>;
  from: Record<string, { feature: string; amount: number }[]>;
  uses: Record<string, { max: number; spent: number }>;
  unmet: string[];
}

/** Where a save writes it (backend choices.js WORKED_KEY). */
export const WORKED_KEY = '_worked';

/** An action on the picks, as the socket takes it (backend systemBuilder/picking.js). */
export type ChoicesAction =
  | { kind: 'pick'; list: string; option: string; from?: string }
  | { kind: 'drop'; list: string; option: string }
  | { kind: 'level'; list: string; option: string; level: number }
  | { kind: 'use'; feature: string; spent: number };

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The sheet's worked-out view of its picks, or an empty one when it has none yet. */
export const workedOn = (data: Obj | null | undefined): Worked => {
  const w = isObject(data) && isObject(data[WORKED_KEY]) ? data[WORKED_KEY] as Obj : {};
  return {
    picks: Array.isArray(w.picks) ? (w.picks as unknown[]).filter((p): p is Worked['picks'][number] => isObject(p) && typeof p.list === 'string' && typeof p.option === 'string') : [],
    opens: Array.isArray(w.opens) ? (w.opens as unknown[]).filter((o): o is Worked['opens'][number] => isObject(o) && typeof o.feature === 'string' && typeof o.list === 'string') : [],
    levels: isObject(w.levels) ? w.levels as Worked['levels'] : {},
    from: isObject(w.from) ? w.from as Worked['from'] : {},
    uses: isObject(w.uses) ? w.uses as Worked['uses'] : {},
    unmet: Array.isArray(w.unmet) ? (w.unmet as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  };
};

/** The level a feature unlocks at: 1 when it says none. */
const atOf = (f: FeatureShown) => (Number.isInteger(f.at) && (f.at as number) >= 1 ? f.at as number : 1);

/** One pick as the block draws it: its option, its level, the features it has and the next to come. */
export interface PickShown { option: OptionShown; level: number | null; unlocked: FeatureShown[]; next: FeatureShown | null }

/** One list as the block draws it. */
export interface ListShown {
  list: ChoiceListShown;
  picks: PickShown[];
  /** Whether another can be picked: as many as it picks, or more when it allows more (again) or any. */
  room: boolean;
  /** The options not picked yet, each with what it needs when it isn't met. */
  open: { option: OptionShown; unmet: string | null }[];
  /** A levelled list's levels added up, and the line saying how: SOLDIER 3 + MAGE 1. */
  level: number | null;
  breakdown: string;
}

/** How a list is picked: on its own when it says nothing. */
export const pickedOf = (list: ChoiceListShown): Picked => list.picked ?? 'own';

/**
 * One pick as the block draws it. Its features unlock by its level: a levelled list's own, or the
 * character's level for a list everyone has (the server sends it); a list without levels has them all.
 */
const pickShown = (list: ChoiceListShown, p: Worked['picks'][number]): PickShown | null => {
  const option = list.options.find((o) => o.id === p.option);
  if (!option) return null;
  const everyone = pickedOf(list) === 'everyone';
  const gate = list.levelled ? (Number.isInteger(p.level) ? p.level as number : 1) : everyone && Number.isInteger(p.level) ? p.level as number : null;
  const sorted = [...option.features].sort((a, b) => atOf(a) - atOf(b));
  return {
    option,
    level: list.levelled ? gate : null,
    unlocked: sorted.filter((f) => gate === null || atOf(f) <= gate),
    next: gate === null ? null : sorted.find((f) => atOf(f) > gate) ?? null,
  };
};

export const listShown = (list: ChoiceListShown, worked: Worked): ListShown => {
  // A list's own picks: those under a feature hang there instead, and waiting ones are said apart.
  const picks = worked.picks.filter((p) => p.list === list.id && !p.from && !p.waiting)
    .map((p) => pickShown(list, p)).filter((p): p is PickShown => !!p);
  const taken = new Set(worked.picks.filter((p) => p.list === list.id).map((p) => p.option));
  const unmet = new Set(worked.unmet);
  const mode = pickedOf(list);
  return {
    list,
    picks,
    room: mode !== 'features' && mode !== 'everyone' && (list.again || list.picks === 'any' || picks.length < list.picks),
    open: list.options.filter((o) => !taken.has(o.id)).map((option) => ({ option, unmet: unmet.has(option.id) ? option.needs ?? 'a requirement' : null })),
    level: list.levelled ? picks.reduce((n, p) => n + (p.level ?? 0), 0) : null,
    breakdown: picks.map((p) => `${p.option.label.toUpperCase()} ${p.level ?? ''}`.trim()).join(' + '),
  };
};

/** The lists drawn as blocks of their own: every one but those picked only under features. */
export const listsOnTheirOwn = (lists: ChoiceListShown[]): ChoiceListShown[] => lists.filter((l) => pickedOf(l) !== 'features');

/** What hangs under a feature that opens a list (7a5a2): its picks, those waiting, and the room for more. */
export interface UnderFeature {
  list: ChoiceListShown;
  picks: PickShown[];
  waiting: OptionShown[];
  /** Picks still to make there, when the feature is unlocked; 0 otherwise. */
  room: number;
  open: { option: OptionShown; unmet: string | null }[];
}

/** Under `feature`, when it opens a list picked through features or both. Null otherwise. */
export const underFeature = (feature: FeatureShown, lists: ChoiceListShown[], worked: Worked): UnderFeature | null => {
  const list = lists.find((l) => l.id === feature.opens);
  if (!list || (pickedOf(list) !== 'features' && pickedOf(list) !== 'both')) return null;
  const mine = worked.picks.filter((p) => p.list === list.id && p.from === feature.id);
  const opening = worked.opens.find((o) => o.feature === feature.id);
  const taken = new Set(worked.picks.filter((p) => p.list === list.id).map((p) => p.option));
  const unmet = new Set(worked.unmet);
  return {
    list,
    picks: mine.filter((p) => !p.waiting).map((p) => pickShown(list, p)).filter((p): p is PickShown => !!p),
    waiting: mine.filter((p) => p.waiting).map((p) => list.options.find((o) => o.id === p.option)).filter((o): o is OptionShown => !!o),
    room: opening ? Math.max(0, opening.count - opening.used) : 0,
    open: list.options.filter((o) => !taken.has(o.id)).map((option) => ({ option, unmet: unmet.has(option.id) ? option.needs ?? 'a requirement' : null })),
  };
};

/**
 * Picks kept but shown nowhere else: waiting with nothing above them to wait under (the pick that
 * opened them taken away), or a list's own picks while it is picked only through features. The GM
 * can take them away; they count again if what they wait for comes back.
 */
export const keptAside = (lists: ChoiceListShown[], worked: Worked): { list: ChoiceListShown; option: OptionShown }[] => {
  const shownFeatures = new Set(worked.picks.filter((p) => !p.waiting).flatMap((p) => {
    const list = lists.find((l) => l.id === p.list);
    return list?.options.find((o) => o.id === p.option)?.features.map((f) => f.id) ?? [];
  }));
  return worked.picks.filter((p) => p.waiting && !(p.from && shownFeatures.has(p.from))).flatMap((p) => {
    const list = lists.find((l) => l.id === p.list);
    const option = list?.options.find((o) => o.id === p.option);
    return list && option ? [{ list, option }] : [];
  });
};

/** A use pip clicked: one spent up to it, or, clicked again on one already spent, back to before it. */
export const spentAfterClick = (pip: number, spent: number): number => (pip < spent ? pip : pip + 1);

/** What a feature does, in a few words: MODIFIES DEFENSE, ROLL SPARK, ADVANTAGE ON MIND SAVE, OPENS SPECIALTY. */
export const featureDoes = (f: FeatureShown, lists: ChoiceListShown[]): string[] => [
  ...(f.modifies?.length ? [`+ ${f.modifies.join(', ').toUpperCase()}`] : []),
  ...(f.rolls ?? []).map((r) => `ROLL ${r.toUpperCase()}`),
  ...(f.changes ?? []).map((c) => c.toUpperCase()),
  ...(f.opens ? [`PICK ${(lists.find((l) => l.id === f.opens)?.one ?? f.opens).toUpperCase()}`] : []),
];

/**
 * What the picks do to each field, for the sheet's badge (SheetRenderer's ChromeBadge): a stat as
 * typed and with its bonuses, a formula as the server saved it (bonuses already in) and without them,
 * each bonus named by its feature. The token's maximum reads like a formula: the server puts its
 * bonuses on the token (7a5a3), and with no token there is nothing to show. Fields the sheet doesn't
 * show are left out.
 */
export const choiceEffects = (data: Obj | null | undefined, template: SheetTemplate): SheetEffects => {
  const worked = workedOn(data);
  const fields = new Map(template.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const out: Record<string, FieldEffect> = {};
  for (const [id, from] of Object.entries(worked.from)) {
    const field = fields.get(id);
    if (!field || !Array.isArray(from) || !from.length) continue;
    const onToken = field.source === 'token_hp_max';
    if (onToken && (!isObject(data) || data[id] === null || data[id] === undefined)) continue;
    const delta = from.reduce((n, s) => n + num(s.amount), 0);
    const stored = num(isObject(data) ? data[id] : 0);
    // A formula is saved with its bonuses in, the token's maximum holds them; a stat keeps what the player typed.
    const base = field.derived || onToken ? stored - delta : stored;
    out[id] = { id, base, value: base + delta, delta, sources: from.map((s) => ({ name: s.feature, value: num(s.amount), kind: 'stat' as const })) };
  }
  return { fields: out, unmatched: [] };
};
