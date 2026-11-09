// The XP meter on a sheet, as logic (7d2a; approved mockup docs/mockups/level-up.html, 2026-11-07): how far a
// character is toward their next level, in cells like the HP bar's. XP is never spent, and the table holds
// running totals, so what a level doesn't need carries into the next by itself.

import { workedOn } from './choicesShown';
import type { SheetTemplate } from './types';

/** What the server sends (backend levels.js levelsShown): the total to reach each level from 2. */
export interface LevelsShown {
  top: number; table?: Record<string, number>;
  /** MAX HEALTH: PER LEVEL (7d5a; backend levels.js levelsShown): how a level gains it, and each class's die. */
  health?: { gain: HealthGainBy; dieOn: 'class' | 'all'; die?: number; dice: Record<string, number>; beat?: BeatShown };
}
/** How a level's health is gained (backend levels.js GAINS): THE PLAYER CHOOSES is 'choose'. */
export type HealthGainBy = 'average' | 'roll' | 'choose' | 'reroll' | 'beat';
/** ROLL TO BEAT's settings (7d5d; backend levels.js): a pool of `count` d`die` and a d`gain` gained, or a die per level. */
export interface BeatShown { way: 'pool' | 'level'; count: number; die: number; gain: number }
/** The health kept with the place (7d5b): a roll and its die, or the average taken. */
export interface LevelUpHealth { roll?: number; die?: number; average?: true; /** A reroll's (7d5c): what it adds, and the maximum it had to beat. */ gained?: number; over?: number; /** A roll to beat (7d5d). */ beat?: true }
/** What a save works out PER LEVEL's max health to (backend runtime.js HEALTH_SHOWN_KEY). */
export const HEALTH_SHOWN_KEY = '_health';

/** Where a sheet keeps its XP (backend levels.js XP_KEY). */
export const XP_KEY = '_xp';
/** A level the GM gave, not taken yet (backend levelUp.js OWED_KEY). */
export const OWED_KEY = '_levels_owed';
/** LEVEL_UP.EXE's place (7d3a; backend levelUp.js LEVELING_KEY): the class it's raising, {} for the level itself. */
export const LEVELING_KEY = '_leveling';
/** A cell per point up to this many to the next level, as the HP bar has one per hit point. */
const ONE_PER_POINT = 40;
/** Past that, this many. */
const CELLS = 20;

export interface XpMeter {
  xp: number;
  level: number;
  /** The total the next level takes. Null: there is no next level. */
  need: number | null;
  cells: number;
  lit: number;
  ready: boolean;
}

const whole = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/** A character's level: their levelled lists added up, or a stat called level, and at least 1. */
export const characterLevel = (data: Record<string, unknown> | null | undefined): number => {
  const worked = data ? workedOn(data).levels.level : undefined;
  return Math.max(1, whole(worked ?? data?.level));
};

export const xpMeter = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined): XpMeter | null => {
  const table = template?.levels?.table;
  if (!table) return null;
  const xp = whole(data?.[XP_KEY]);
  const level = characterLevel(data);
  const next = table[level + 1];
  if (next === undefined) return { xp, level, need: null, cells: CELLS, lit: CELLS, ready: false };
  const from = table[level] ?? 0;
  const span = Math.max(1, next - from);
  const cells = span <= ONE_PER_POINT ? span : CELLS;
  return { xp, level, need: next, cells, lit: Math.max(0, Math.min(cells, Math.floor(((xp - from) / span) * cells))), ready: xp >= next };
};

/** One thing that can go up: a pick in a levelled list, or with none, the level stat (backend levelUp.js levelTargets). */
export interface LevelTarget { list?: string; option?: string; name: string; level: number; /** One they don't hold yet (7d3b), coming in at 1. */ new?: true; /** What it needs, when they don't meet it. */ unmet?: string }
/** A pick made in LEVEL_UP.EXE (7d3b): from a list a feature of the new level opens. */
export interface LevelUpPick { list: string; option: string; from?: string }
export interface LevelUpOffer {
  ready: boolean; targets: LevelTarget[]; firstPick: string | null;
  /** Where LEVEL_UP.EXE was left: null when it isn't open on this sheet. */
  leveling: { list?: string; option?: string; picks?: LevelUpPick[]; health?: LevelUpHealth } | null;
}

const placeOf = (data: Record<string, unknown> | null | undefined): LevelUpOffer['leveling'] => {
  const p = data?.[LEVELING_KEY];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const { list, option, picks, health } = p as Record<string, unknown>;
  const h = health && typeof health === 'object' ? health as Record<string, unknown> : {};
  const kept: LevelUpHealth = {
    ...(Number.isInteger(h.roll) ? { roll: h.roll as number } : {}), ...(Number.isInteger(h.die) ? { die: h.die as number } : {}),
    ...(h.average === true ? { average: true as const } : {}),
    ...(Number.isInteger(h.gained) ? { gained: h.gained as number } : {}), ...(Number.isInteger(h.over) ? { over: h.over as number } : {}),
    ...(h.beat === true ? { beat: true as const } : {}),
  };
  const made = (Array.isArray(picks) ? picks : []).filter((x): x is LevelUpPick => !!x && typeof x === 'object' && typeof (x as LevelUpPick).list === 'string' && typeof (x as LevelUpPick).option === 'string')
    .map((x) => ({ list: x.list, option: x.option, ...(typeof x.from === 'string' ? { from: x.from } : {}) }));
  return { ...(typeof list === 'string' ? { list } : {}), ...(typeof option === 'string' ? { option } : {}), ...(made.length ? { picks: made } : {}), ...(Object.keys(kept).length ? { health: kept } : {}) };
};

/** Whether this character can go up now, and what would. Null where levels are typed in. */
export const levelUpOffer = (template: SheetTemplate | null | undefined, data: Record<string, unknown> | null | undefined): LevelUpOffer | null => {
  const levels = template?.levels;
  if (!levels) return null;
  const level = characterLevel(data);
  const need = levels.table?.[level + 1];
  const ready = level < levels.top && (whole(data?.[OWED_KEY]) > 0 || (need !== undefined && whole(data?.[XP_KEY]) >= need));
  const lists = (template?.choices ?? []).filter((l) => l.levelled);
  const leveling = placeOf(data);
  if (!lists.length) return { ready, targets: [{ name: 'LEVEL', level }], firstPick: null, leveling };
  const targets = workedOn(data).picks.filter((p) => !p.from && !p.waiting).flatMap((p) => {
    const list = lists.find((l) => l.id === p.list);
    const option = list?.options.find((o) => o.id === p.option);
    return list && option ? [{ list: list.id, option: option.id, name: option.label, level: p.level ?? 1 }] : [];
  });
  return { ready, targets, firstPick: targets.length ? null : lists[0].one, leveling };
};

/** The line under the meter. */
export const xpMeterWords = (m: XpMeter): string => {
  if (m.need === null) return `${m.xp} · THE HIGHEST LEVEL`;
  if (!m.ready) return `${m.xp} / ${m.need} · ${m.need - m.xp} TO LEVEL ${m.level + 1}`;
  return `${m.xp} / ${m.need} · ENOUGH FOR LEVEL ${m.level + 1}${m.xp > m.need ? ` · ${m.xp - m.need} CARRIES OVER` : ''}`;
};
