// LEVEL_UP.EXE as logic (7d3a; approved mockup docs/mockups/level-up.html, 2026-11-07): its folders, which class is
// going up, and what the new level unlocks. The window only draws it. Nothing changes until FINISH: the server keeps
// only the player's place (backend levelUp.js LEVELING_KEY).

import { workedOn, type FeatureShown } from './choicesShown';
import { characterLevel, type LevelTarget, type LevelUpOffer } from './xpMeter';
import type { SheetTemplate } from './types';

export type LevelUpStep = 'which' | 'unlocks';
export const LEVEL_UP_STEP_NAMES: Record<LevelUpStep, string> = { which: 'WHICH CLASS', unlocks: 'WHAT IT UNLOCKS' };

/** The folders: WHICH CLASS only when there's a choice of what goes up. */
export const levelUpSteps = (offer: LevelUpOffer): LevelUpStep[] => (offer.targets.length > 1 ? ['which', 'unlocks'] : ['unlocks']);

const same = (t: LevelTarget, place: { list?: string; option?: string }) => t.list === place.list && t.option === place.option;

/** What's going up: the one their place names, or the first. Null with nothing to raise. */
export const chosenTarget = (offer: LevelUpOffer): LevelTarget | null =>
  (offer.leveling ? offer.targets.find((t) => same(t, offer.leveling!)) : undefined) ?? offer.targets[0] ?? null;

/** One thing the new level brings: a feature, what it comes from, and the list it opens a pick of. */
export interface Unlocked { id: string; label: string; text?: string; from: string; opens?: string }

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
    out.push({ id: f.id, label: f.label, ...(f.text ? { text: f.text } : {}), from, ...(opens ? { opens } : {}) });
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

/** The window's title: whose, and what it goes to. */
export const levelUpTitle = (name: string, target: LevelTarget | null): string =>
  `LEVEL_UP.EXE · ${name.toUpperCase()}${target ? ` · ${target.name.toUpperCase()} ${target.level + 1}` : ''}`;
