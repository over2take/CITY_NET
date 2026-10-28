// A character's picks on their sheet, as logic (7a3b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27). The lists come in the render copy, in words (backend choices.js choicesShown); the
// character's own picks, levels and uses come in their sheet, worked out by the server on every save
// (choices.js workedOf, under WORKED_KEY). Nothing here works a number out: the server does, and the
// sheet only draws what it says. Pure, so the CHOICES block (components/ChoicesSection.tsx) only draws.

export interface FeatureShown {
  id: string; label: string; text?: string; at?: number;
  modifies?: string[]; uses?: { refill: string | null }; rolls?: string[]; changes?: string[]; opens?: string;
}
export interface OptionShown { id: string; label: string; description?: string; needs?: string; features: FeatureShown[] }
export interface ChoiceListShown { id: string; one: string; many: string; picks: number | 'any'; again: boolean; levelled: boolean; options: OptionShown[] }

/** What the server worked out of a character's picks on their last save (backend choices.js workedOf). */
export interface Worked {
  picks: { list: string; option: string; level?: number }[];
  levels: Record<string, number>;
  from: Record<string, { feature: string; amount: number }[]>;
  uses: Record<string, { max: number; spent: number }>;
  unmet: string[];
}

/** Where a save writes it (backend choices.js WORKED_KEY). */
export const WORKED_KEY = '_worked';

/** An action on the picks, as the socket takes it (backend systemBuilder/picking.js). */
export type ChoicesAction =
  | { kind: 'pick' | 'drop'; list: string; option: string }
  | { kind: 'level'; list: string; option: string; level: number }
  | { kind: 'use'; feature: string; spent: number };

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The sheet's worked-out view of its picks, or an empty one when it has none yet. */
export const workedOn = (data: Obj | null | undefined): Worked => {
  const w = isObject(data) && isObject(data[WORKED_KEY]) ? data[WORKED_KEY] as Obj : {};
  return {
    picks: Array.isArray(w.picks) ? (w.picks as unknown[]).filter((p): p is Worked['picks'][number] => isObject(p) && typeof p.list === 'string' && typeof p.option === 'string') : [],
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

export const listShown = (list: ChoiceListShown, worked: Worked): ListShown => {
  const picks = worked.picks.filter((p) => p.list === list.id).flatMap((p): PickShown[] => {
    const option = list.options.find((o) => o.id === p.option);
    if (!option) return [];
    const level = list.levelled ? (Number.isInteger(p.level) ? p.level as number : 1) : null;
    const sorted = [...option.features].sort((a, b) => atOf(a) - atOf(b));
    return [{
      option,
      level,
      unlocked: sorted.filter((f) => level === null || atOf(f) <= level),
      next: level === null ? null : sorted.find((f) => atOf(f) > level) ?? null,
    }];
  });
  const taken = new Set(picks.map((p) => p.option.id));
  const unmet = new Set(worked.unmet);
  return {
    list,
    picks,
    room: list.again || list.picks === 'any' || picks.length < list.picks,
    open: list.options.filter((o) => !taken.has(o.id)).map((option) => ({ option, unmet: unmet.has(option.id) ? option.needs ?? 'a requirement' : null })),
    level: list.levelled ? picks.reduce((n, p) => n + (p.level ?? 0), 0) : null,
    breakdown: picks.map((p) => `${p.option.label.toUpperCase()} ${p.level ?? ''}`.trim()).join(' + '),
  };
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
