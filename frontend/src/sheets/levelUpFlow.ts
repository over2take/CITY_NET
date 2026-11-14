// LEVEL_UP.EXE as logic (7d3a; approved mockup docs/mockups/level-up.html, 2026-11-07): its folders, which class is
// going up, and what the new level unlocks. The window only draws it. Nothing changes until FINISH: the server keeps
// only the player's place (backend levelUp.js LEVELING_KEY). From 7d3b, a class they don't hold yet can be taken up,
// and the picks a new level opens are made in the window, FINISH waiting for them. 7d6b: an INCREASE the new level
// unlocks is spent in ABILITY INCREASE, FINISH waiting for every point, or (7d6c) a pick from the list it offers instead.

import { listShown, pickedOf, workedOn, type ChoiceListShown, type FeatureShown, type IncreaseShown, type OptionShown } from './choicesShown';
import { characterLevel, levelUpOffer, HEALTH_SHOWN_KEY, type BeatShown, type HealthGainBy, type LevelTarget, type LevelUpIncreases, type LevelUpOffer, type LevelUpPick } from './xpMeter';
import type { SheetTemplate } from './types';

export type LevelUpStep = 'which' | 'health' | 'unlocks' | 'increase';
export const LEVEL_UP_STEP_NAMES: Record<LevelUpStep, string> = { which: 'WHICH CLASS', health: 'HEALTH', unlocks: 'WHAT IT UNLOCKS', increase: 'ABILITY INCREASE' };

/**
 * The classes they could take up (7d3b): those of a levelled list they pick from themselves, not held, while it has
 * room (one picked under features never has its own), a list picked by roll left to the sheet. Each with what it needs when they don't meet it. Only once they hold one.
 */
export const newClasses = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined, offer: LevelUpOffer): LevelTarget[] => {
  if (!offer.targets.some((t) => t.option)) return [];
  const worked = workedOn(data);
  return (template?.choices ?? []).filter((l) => l.levelled && l.players !== 'roll').flatMap((l) => {
    const shown = listShown(l, worked);
    return shown.room ? shown.open.map(({ option, unmet }) => ({ list: l.id, option: option.id, name: option.label, level: 0, new: true as const, ...(unmet ? { unmet } : {}) })) : [];
  });
};

/**
 * The folders: WHICH CLASS only when there's a choice of what goes up, HEALTH only where it's per level (7d5a), and
 * ABILITY INCREASE only when the new level unlocks one (7d6b).
 */
export const levelUpSteps = (offer: LevelUpOffer, more = 0, health = false, increases = false): LevelUpStep[] =>
  [...(offer.targets.length + more > 1 ? ['which' as const] : []), ...(health ? ['health' as const] : []), 'unlocks', ...(increases ? ['increase' as const] : [])];

/**
 * What a level gains (7d5a; ROLL and THE PLAYER CHOOSES, 7d5b): the die, its average, what each level adds, how it's
 * gained, the roll kept for this class, and what it all comes to: `gained` null while there is still something to
 * roll or choose. Null where health isn't per level.
 */
export interface HealthGain {
  die: number | null; average: number; adds: number; by: HealthGainBy; rolled: number | null; tookAverage: boolean; gained: number | null;
  /** REROLL ALL (7d5c) and ROLL TO BEAT (7d5d): how many dice go, the maximum to beat, and whether the roll beat it. */
  dice: number; max: number; over: boolean | null;
  /** ROLL TO BEAT's settings (7d5d). */
  beat?: BeatShown;
}
export const healthGain = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined, target: LevelTarget): HealthGain | null => {
  const h = template?.levels?.health;
  if (!h) return null;
  // The level itself, there being no class, goes up by the die for all, as the server does.
  const die = h.dieOn === 'all' ? h.die ?? null : (target.option ? h.dice[target.option] ?? null : null);
  const shown = data?.[HEALTH_SHOWN_KEY] as { adds?: unknown; max?: unknown; levels?: { die?: unknown }[] } | undefined;
  const adds = typeof shown?.adds === 'number' ? shown.adds : 0;
  const max = typeof shown?.max === 'number' ? shown.max : 0;
  const pool = h.gain === 'beat' && h.beat?.way === 'pool' ? h.beat : null;
  const dice = pool ? pool.count : (Array.isArray(shown?.levels) ? shown!.levels!.filter((l) => typeof l?.die === 'number').length : 0) + (die ? 1 : 0);
  const average = die ? Math.ceil(die / 2) : 0;
  const place = levelUpOffer(template, data)?.leveling;
  const here = !!place && place.list === target.list && place.option === target.option;
  const rolled = here && typeof place?.health?.roll === 'number' ? place.health.roll : null;
  const tookAverage = here && place?.health?.average === true;
  // A class with no die has nothing to roll, but a pool to beat is rolled all the same.
  const fixed = h.gain === 'average' || (!die && !pool) || tookAverage;
  const kept = typeof place?.health?.gained === 'number' ? place.health.gained : null;
  const gained = rolled !== null ? kept ?? Math.max(1, rolled + adds) : fixed ? Math.max(1, average + adds) : null;
  return { die, average, adds, by: h.gain, rolled, tookAverage, gained, dice, max: typeof place?.health?.over === 'number' && rolled !== null ? place.health.over : max, over: rolled === null || kept === null ? null : kept > 1 || rolled > max, ...(h.beat ? { beat: h.beat } : {}) };
};

/** The class a kept health roll was made for, by name, while it's another than `target` (7d5b): it can't be left. */
export const healthRolledFor = (offer: LevelUpOffer, targets: LevelTarget[], target: LevelTarget): string | null => {
  const place = offer.leveling;
  if (typeof place?.health?.roll !== 'number' || (place.list === target.list && place.option === target.option)) return null;
  return targets.find((t) => t.list === place.list && t.option === place.option)?.name ?? null;
};

/**
 * The GM's line on a player's sheet (7d5b): where they are in LEVEL_UP.EXE, and a kept health roll to clear. From 7d7a
 * there whatever they're doing, their level and whether one is ready, with FILL IT IN FOR THEM while there's a level to
 * go. Null where levels are typed in, or before their first pick.
 */
export const gmLevelingLine = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined): { words: string; canClear: boolean; canFill: boolean } | null => {
  const offer = levelUpOffer(template, data);
  if (!offer || offer.firstPick) return null;
  const level = characterLevel(data);
  const canFill = level < (template?.levels?.top ?? 0);
  if (!offer.leveling) return { words: `LEVEL ${level}${offer.ready ? ' · LEVEL UP READY' : ''}`, canClear: false, canFill };
  const place = offer.leveling;
  const target = offer.targets.find((t) => t.list === place.list && t.option === place.option);
  const name = target ? `${target.option ? target.name.toUpperCase() : 'LEVEL'} ${target.level} → ${target.level + 1}` : place.option ? `NEW: ${place.option.toUpperCase()}` : 'THE NEXT LEVEL';
  const roll = place.health?.roll;
  return {
    words: `LEVELING UP · ${name}${typeof roll === 'number' ? ` · HEALTH ${place.health?.beat ? `ROLLED ${roll} TO BEAT ${place.health.over}, +${place.health.gained}` : typeof place.health?.gained === 'number' ? `REROLLED ${roll}, +${place.health.gained}` : `ROLLED ${roll}${place.health?.die ? ` ON A D${place.health.die}` : ''}`}` : place.health?.average ? ' · HEALTH: THE AVERAGE' : ''}`,
    canClear: typeof roll === 'number',
    canFill,
  };
};

const same = (t: LevelTarget, place: { list?: string; option?: string }) => t.list === place.list && t.option === place.option;

/** What's going up: the one their place names, held or new and met, or the first they hold. Null with nothing to raise. */
export const chosenTarget = (offer: LevelUpOffer, joinable: LevelTarget[] = []): LevelTarget | null =>
  (offer.leveling ? [...offer.targets, ...joinable.filter((t) => !t.unmet)].find((t) => same(t, offer.leveling!)) : undefined) ?? offer.targets[0] ?? null;

/** One thing the new level brings: a feature, what it comes from, the list it opens a pick of (its name, id and how many), and an INCREASE (7d6b). */
export interface Unlocked { id: string; label: string; text?: string; from: string; opens?: string; opensList?: string; count?: number; increase?: IncreaseShown }

const at = (f: FeatureShown) => f.at ?? 1;

/**
 * What going up unlocks: the class's features at its new level, those of what was picked under its features in
 * a list without levels (they follow the class's level, 7a5d), and what everyone has at the character's new level.
 */
export const unlockedBy = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined, target: LevelTarget): Unlocked[] => {
  const lists = template?.choices ?? [];
  const picks = workedOn(data).picks.filter((p) => !p.waiting);
  const out: Unlocked[] = [];
  const add = (f: FeatureShown, from: string) => {
    const opens = f.opens ? (lists.find((l) => l.id === f.opens)?.one ?? f.opens) : undefined;
    out.push({ id: f.id, label: f.label, ...(f.text ? { text: f.text } : {}), from, ...(opens ? { opens, opensList: f.opens, count: f.opensCount ?? 1 } : {}), ...(f.increase ? { increase: f.increase } : {}) });
  };
  const optionOf = (list: string, option: string) => lists.find((l) => l.id === list)?.options.find((o) => o.id === option);
  if (target.list && target.option) {
    const option = optionOf(target.list, target.option);
    const to = target.level + 1;
    for (const f of option?.features ?? []) if (at(f) === to) add(f, option!.label);
    const opened = new Set((option?.features ?? []).map((f) => f.id));
    for (const p of picks) {
      if (!p.from || !opened.has(p.from) || lists.find((l) => l.id === p.list)?.levelled) continue;
      const under = optionOf(p.list, p.option);
      for (const f of under?.features ?? []) if (at(f) === to) add(f, under!.label);
    }
  }
  const total = characterLevel(data) + 1;
  for (const p of picks) {
    if (lists.find((l) => l.id === p.list)?.picked !== 'everyone') continue;
    const o = optionOf(p.list, p.option);
    for (const f of o?.features ?? []) if (at(f) === total) add(f, o!.label);
  }
  return out;
};

/** What a feature the new level unlocks lets them pick (7d3b): the list's options not held, each with what it needs. */
export interface PickAsked { feature: string; list: ChoiceListShown; count: number; rolled: boolean; options: { option: OptionShown; unmet: string | null }[] }

/** The picks the new level asks for: one entry per feature opening a list picked under features. */
export const picksAsked = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined, unlocked: Unlocked[]): PickAsked[] => {
  const worked = workedOn(data);
  return unlocked.flatMap((u) => {
    const list = (template?.choices ?? []).find((l) => l.id === u.opensList);
    if (!list || !['features', 'both'].includes(pickedOf(list))) return [];
    const held = new Set(worked.picks.filter((p) => p.list === list.id).map((p) => p.option));
    return [{
      feature: u.id, list, count: u.count ?? 1, rolled: list.players === 'roll',
      options: list.options.filter((o) => !held.has(o.id)).map((option) => ({ option, unmet: worked.unmet.includes(option.id) ? option.needs ?? 'a requirement' : null })),
    }];
  });
};

/**
 * How many picks one feature still wants: as many as it opens, or as many as there are to pick, those not met left out
 * but for the GM (7d7a), who may add them anyway. Rolled for, none here.
 */
export const picksWanted = (asked: PickAsked, anyway = false): number => (asked.rolled ? 0 : Math.min(asked.count, asked.options.filter((o) => anyway || !o.unmet).length));

/** Whether every pick the new level asks for is made, so FINISH can go. */
export const picksMade = (asked: PickAsked[], picks: LevelUpPick[], anyway = false): boolean =>
  asked.every((a) => picks.filter((p) => p.from === a.feature && p.list === a.list.id).length >= picksWanted(a, anyway));

/** A pick in or out: taken back if made, or made while the feature has room. */
export const withPickToggled = (picks: LevelUpPick[], asked: PickAsked, option: string): LevelUpPick[] => {
  const mine = (p: LevelUpPick) => p.from === asked.feature && p.list === asked.list.id;
  if (picks.some((p) => mine(p) && p.option === option)) return picks.filter((p) => !(mine(p) && p.option === option));
  if (picks.filter(mine).length >= asked.count) return picks;
  return [...picks, { list: asked.list.id, option, from: asked.feature }];
};

/** A stat as the sheet reads it now (7d6b): as typed, with what the picks add (the server's worked.from). */
export const statNow = (data: Record<string, unknown> | null | undefined, stat: string): number => {
  const typed = Number(data?.[stat]);
  return (Number.isFinite(typed) ? typed : 0) + (workedOn(data).from[stat] ?? []).reduce((n, s) => n + (Number.isFinite(s.amount) ? s.amount : 0), 0);
};

/** A ranked stat's step now (7f1c2): as picked, with the steps the picks add (the server's worked.from on its step field). */
export const rankStepNow = (data: Record<string, unknown> | null | undefined, stat: string): number => statNow(data, `${stat}_rank`);

/** What an increase shows a stat at with `on` points more: a rank's name at its step (the top holding), or the number. */
export const raisedTo = (data: Record<string, unknown> | null | undefined, stat: { id: string; ranks?: string[] }, on: number): string => {
  if (!stat.ranks?.length) return String(statNow(data, stat.id) + on);
  const at = Math.min(stat.ranks.length - 1, Math.max(0, Math.round(rankStepNow(data, stat.id)) + on));
  return stat.ranks[at];
};

/** How many of an increase's points are still to spend. */
export const pointsLeft = (u: Unlocked, spread: Record<string, number> = {}): number =>
  (u.increase?.points ?? 0) - Object.values(spread).reduce((n, p) => n + p, 0);

/** Whether a point more can go on a stat: one left, under the most on one, and not past where it stops. */
export const canRaise = (data: Record<string, unknown> | null | undefined, u: Unlocked, spread: Record<string, number>, stat: string): boolean => {
  const inc = u.increase;
  const on = spread[stat] ?? 0;
  if (!inc || pointsLeft(u, spread) <= 0 || on >= inc.most) return false;
  // A rank goes up a step a point, to its top rank, whatever a number stops at (7f1c2).
  const ranks = inc.stats.find((s) => s.id === stat)?.ranks;
  if (ranks?.length) return Math.round(rankStepNow(data, stat)) + on + 1 <= ranks.length - 1;
  return inc.cap === undefined || statNow(data, stat) + on + 1 <= inc.cap;
};

/** The spreads with a point more (by 1) or less (by -1) on a stat; one emptied is left out. */
export const withRaised = (spreads: LevelUpIncreases, feature: string, stat: string, by: 1 | -1): LevelUpIncreases => {
  const spread = { ...(spreads[feature] ?? {}) };
  const now = (spread[stat] ?? 0) + by;
  if (now > 0) spread[stat] = now; else delete spread[stat];
  const rest = withoutSpread(spreads, feature);
  return Object.keys(spread).length ? { ...rest, [feature]: spread } : rest;
};

/** Whether a pick from the list an increase offers instead was taken (7d6c). */
export const insteadTaken = (picks: LevelUpPick[], u: Unlocked): boolean =>
  picks.some((p) => p.from === u.id && p.list === u.increase?.instead);

/** The pick an increase offers instead (7d6c), as a pick a feature opens: one, from that list. Null without one. */
export const insteadAsked = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined, u: Unlocked): PickAsked | null =>
  (u.increase?.instead ? picksAsked(template, data, [{ id: u.id, label: u.label, from: u.from, opensList: u.increase.instead, count: 1 }])[0] ?? null : null);

/** The spreads without a feature's (7d6c: the pick taken instead). */
export const withoutSpread = (spreads: LevelUpIncreases, feature: string): LevelUpIncreases =>
  Object.fromEntries(Object.entries(spreads).filter(([id]) => id !== feature));

/**
 * Whether every increase the new level unlocks has every point spent, or the pick taken instead (7d6c), so FINISH can
 * go. Anything else has none to spend.
 */
export const increasesSpent = (unlocked: Unlocked[], spreads: LevelUpIncreases, picks: LevelUpPick[] = []): boolean =>
  unlocked.every((u) => pointsLeft(u, spreads[u.id]) === 0 || insteadTaken(picks, u));

/** The window's title: whose, and what it goes to. */
export const levelUpTitle = (name: string, target: LevelTarget | null): string =>
  `LEVEL_UP.EXE · ${name.toUpperCase()}${target ? ` · ${target.name.toUpperCase()} ${target.level + 1}` : ''}`;
