import type { Definition } from './systemsApi';
import { partIsOn, withPart } from './wordsFeatures';
import { allStats } from './statsRules';
import { rollList } from './rolls';
import { restList } from './rests';

// The RULE LIBRARY's LUCK card, as logic (8c5b; approved mockup docs/mockups/rule-library.html, the LUCK card, answers 6 and 7):
// what a game's `luck` section says (backend/systemBuilder/luck.js), read with what a game starts with, and the definition with
// one thing changed. The card's switch is the PARTS row LUCK's: on is the part on with the section written. Turned on the first
// time it starts as CYBERPUNK RED; off it keeps the section. A preset reads the system's own stat for THE MOST where it has one
// of that name (@luck, @edge), 3 where it hasn't. Pure, so the card (components/RuleLibraryPage.tsx) only draws.

export type Each = 'plus' | 'die';
export interface Luck { name: string; most: string; each: Each; on: 'all' | string[]; refills: string[] }
export type LuckPresetId = 'cpr' | 'pool';

/** Mirrors LIMITS and START in backend/systemBuilder/luck.js. */
export const LIMITS = { name: 30, text: 200, most: 99, spend: 20, rolls: 50 };
export const START: Luck = { name: 'LUCK', most: '3', each: 'plus', on: 'all', refills: ['end_of_session'] };
export const EACHES: { id: Each; label: string }[] = [{ id: 'plus', label: 'ADDS +1' }, { id: 'die', label: 'ADDS A DIE' }];

/** The presets, named after the games that play this way; THE MOST from the stat of that name where the system has one. */
export const PRESETS: { id: LuckPresetId; label: string; luck: Luck; stat: string }[] = [
  { id: 'cpr', label: 'CYBERPUNK RED', stat: 'luck', luck: { name: 'LUCK', most: '3', each: 'plus', on: 'all', refills: ['end_of_session'] } },
  { id: 'pool', label: 'A DICE POOL GAME', stat: 'edge', luck: { name: 'EDGE', most: '3', each: 'die', on: 'all', refills: ['end_of_scene'] } },
];

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Whether the rule is on: LUCK on PARTS, and the section written. */
export const luckOn = (def: Definition): boolean => partIsOn(def, 'luck') && isObject(def.luck);

/** The section as the card shows it: what it says, and what a game starts with for the rest. */
export const luckOf = (def: Definition): Luck => {
  const l = isObject(def.luck) ? def.luck : {};
  return {
    name: typeof l.name === 'string' ? l.name : START.name,
    most: typeof l.most === 'number' ? String(l.most) : typeof l.most === 'string' ? l.most : START.most,
    each: l.each === 'die' ? 'die' : 'plus',
    on: Array.isArray(l.on) ? strings(l.on) : 'all',
    refills: Array.isArray(l.refills) ? strings(l.refills) : [...START.refills],
  };
};

const withLuckSection = (def: Definition, luck: Luck): Definition => ({ ...def, luck: { ...(isObject(def.luck) ? def.luck : {}), ...luck } });

/** A preset's luck for this system: THE MOST its own stat of the preset's name, where it has one. */
const presetFor = (def: Definition, id: LuckPresetId): Luck => {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  const has = allStats(def).some((s) => s.id === p.stat);
  return { ...p.luck, refills: [...p.luck.refills], ...(has ? { most: `@${p.stat}` } : {}) };
};

/** The card's switch, which is the PARTS row's: on writes the section (CYBERPUNK RED the first time) and the part on; off keeps it. */
export const withLuckOn = (def: Definition, on: boolean): Definition => {
  if (!on) return withPart(def, 'luck', false);
  const parted = withPart(def, 'luck', true);
  return isObject(def.luck) ? parted : withLuckSection(parted, presetFor(def, 'cpr'));
};

/** A preset's numbers written in. */
export const withLuckPreset = (def: Definition, id: LuckPresetId): Definition => withLuckSection(def, presetFor(def, id));

/** The preset the card says now; null once the GM has changed anything. */
export const luckPresetNow = (def: Definition): LuckPresetId | null => {
  const now = JSON.stringify(luckOf(def));
  return PRESETS.find((p) => JSON.stringify(presetFor(def, p.id)) === now)?.id ?? null;
};

/** One thing changed; the rest as shown. */
export const withLuck = (def: Definition, patch: Partial<Luck>): Definition => withLuckSection(def, { ...luckOf(def), ...patch });

/** ONLY THESE ROLLS: one roll ticked or not, in the system's order. */
export const withLuckRoll = (def: Definition, rollId: string, on: boolean): Definition => {
  const now = luckOf(def).on;
  const ticked = new Set(now === 'all' ? [] : now);
  if (on) ticked.add(rollId); else ticked.delete(rollId);
  return withLuck(def, { on: rollList(def).map((r) => r.id).filter((id) => ticked.has(id)) });
};

/** REFILLED BY: one rest ticked or not, in the system's order. */
export const withLuckRefill = (def: Definition, restId: string, on: boolean): Definition => {
  const ticked = new Set(luckOf(def).refills);
  if (on) ticked.add(restId); else ticked.delete(restId);
  return withLuck(def, { refills: restList(def).map((r) => r.id).filter((id) => ticked.has(id)) });
};

/** The rolls ONLY THESE ROLLS offers, and the rests REFILLED BY does (those on, and any it names that were turned off). */
export const luckRolls = (def: Definition): { id: string; label: string }[] => rollList(def).map((r) => ({ id: r.id, label: (r.label || r.id).toUpperCase() }));
export const luckRests = (def: Definition): { id: string; label: string; on: boolean }[] => {
  const named = new Set(luckOf(def).refills);
  return restList(def).filter((r) => r.on || named.has(r.id)).map((r) => ({ id: r.id, label: (r.name || r.id).toUpperCase(), on: r.on }));
};
