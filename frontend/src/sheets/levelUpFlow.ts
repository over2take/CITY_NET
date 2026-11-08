// LEVEL_UP.EXE as logic (7d3a; approved mockup docs/mockups/level-up.html, 2026-11-07): its folders, which class is
// going up, and what the new level unlocks. The window only draws it. Nothing changes until FINISH: the server keeps
// only the player's place (backend levelUp.js LEVELING_KEY). From 7d3b, a class they don't hold yet can be taken up,
// and the picks a new level opens are made in the window, FINISH waiting for them.

import { listShown, pickedOf, workedOn, type ChoiceListShown, type FeatureShown, type OptionShown } from './choicesShown';
import { characterLevel, HEALTH_SHOWN_KEY, type LevelTarget, type LevelUpOffer, type LevelUpPick } from './xpMeter';
import type { SheetTemplate } from './types';

export type LevelUpStep = 'which' | 'health' | 'unlocks';
export const LEVEL_UP_STEP_NAMES: Record<LevelUpStep, string> = { which: 'WHICH CLASS', health: 'HEALTH', unlocks: 'WHAT IT UNLOCKS' };

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

/** The folders: WHICH CLASS only when there's a choice of what goes up, HEALTH only where it's per level (7d5a). */
export const levelUpSteps = (offer: LevelUpOffer, more = 0, health = false): LevelUpStep[] =>
  [...(offer.targets.length + more > 1 ? ['which' as const] : []), ...(health ? ['health' as const] : []), 'unlocks'];

/** What a level gains (7d5a), AVERAGE (FIXED): { die, average, adds, gained }, or null where health isn't per level. */
export interface HealthGain { die: number | null; average: number; adds: number; gained: number }
export const healthGain = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined, target: LevelTarget): HealthGain | null => {
  const h = template?.levels?.health;
  if (!h) return null;
  // The level itself, there being no class, goes up by the die for all, as the server does.
  const die = h.dieOn === 'all' ? h.die ?? null : (target.option ? h.dice[target.option] ?? null : null);
  const shown = data?.[HEALTH_SHOWN_KEY] as { adds?: unknown } | undefined;
  const adds = typeof shown?.adds === 'number' ? shown.adds : 0;
  const average = die ? Math.ceil(die / 2) : 0;
  return { die, average, adds, gained: Math.max(1, average + adds) };
};

const same = (t: LevelTarget, place: { list?: string; option?: string }) => t.list === place.list && t.option === place.option;

/** What's going up: the one their place names, held or new and met, or the first they hold. Null with nothing to raise. */
export const chosenTarget = (offer: LevelUpOffer, joinable: LevelTarget[] = []): LevelTarget | null =>
  (offer.leveling ? [...offer.targets, ...joinable.filter((t) => !t.unmet)].find((t) => same(t, offer.leveling!)) : undefined) ?? offer.targets[0] ?? null;

/** One thing the new level brings: a feature, what it comes from, and the list it opens a pick of: its name, id and how many. */
export interface Unlocked { id: string; label: string; text?: string; from: string; opens?: string; opensList?: string; count?: number }

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
    out.push({ id: f.id, label: f.label, ...(f.text ? { text: f.text } : {}), from, ...(opens ? { opens, opensList: f.opens, count: f.opensCount ?? 1 } : {}) });
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

/** How many picks one feature still wants: as many as it opens, or as many as there are to pick. Rolled for, none here. */
export const picksWanted = (asked: PickAsked): number => (asked.rolled ? 0 : Math.min(asked.count, asked.options.filter((o) => !o.unmet).length));

/** Whether every pick the new level asks for is made, so FINISH can go. */
export const picksMade = (asked: PickAsked[], picks: LevelUpPick[]): boolean =>
  asked.every((a) => picks.filter((p) => p.from === a.feature && p.list === a.list.id).length >= picksWanted(a));

/** A pick in or out: taken back if made, or made while the feature has room. */
export const withPickToggled = (picks: LevelUpPick[], asked: PickAsked, option: string): LevelUpPick[] => {
  const mine = (p: LevelUpPick) => p.from === asked.feature && p.list === asked.list.id;
  if (picks.some((p) => mine(p) && p.option === option)) return picks.filter((p) => !(mine(p) && p.option === option));
  if (picks.filter(mine).length >= asked.count) return picks;
  return [...picks, { list: asked.list.id, option, from: asked.feature }];
};

/** The window's title: whose, and what it goes to. */
export const levelUpTitle = (name: string, target: LevelTarget | null): string =>
  `LEVEL_UP.EXE · ${name.toUpperCase()}${target ? ` · ${target.name.toUpperCase()} ${target.level + 1}` : ''}`;
