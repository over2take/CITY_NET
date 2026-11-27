import type { Definition } from './systemsApi';
import { partIsOn, withPart } from './wordsFeatures';
import { allStats } from './statsRules';

// The RULE LIBRARY's dying card, as logic (8c2; approved mockup docs/mockups/rule-library.html, 2026-11-26, every recommended
// answer): what a game's `dying` section says (backend/systemBuilder/dying.js), read with what a game starts with, and the
// definition with one thing changed. The card's switch is the PARTS row DEATH SAVES': on is the part on with the section
// written. Turned on for the first time it starts as D&D 5E; off it keeps the section, so turning it back on finds it as it
// was. A preset is the game's numbers written in, then the GM's to change; WHO GOES DOWN stays as the GM set it. Cyberpunk
// RED rolls under BODY: its preset reads @body where the system has a stat of that id, 10 where it hasn't.
// Pure, so the card (components/RuleLibraryPage.tsx) only draws.

export type Way = 'count' | 'once' | 'turns' | 'none';
export type SaveWay = 'at_least' | 'under';
export type Hurt = 'nothing' | 'failure' | 'dead';
export type NaturalThen = 'back_up' | 'stable' | 'two_failures' | 'dead';
export interface Natural { face: number; then: NaturalThen }
export interface Dying {
  word: string;
  way: Way;
  save: { dice: string; way: SaveWay; target: string };
  to_live: number;
  to_die: number;
  harder: number;
  naturals: Natural[];
  turns: number;
  hurt: Hurt;
  npcs: { friendly: boolean; enemy: boolean };
}
export type PresetId = 'dnd' | 'cpr' | 'cwn' | 'none';

/** Mirrors LIMITS in backend/systemBuilder/dying.js. */
export const LIMITS = { word: 30, text: 200, count: 10, turns: 100, harder: 20, naturals: 6, face: 1000 };

/** What a game starts with where its section doesn't say: as backend dying.js START. */
export const START: Dying = {
  word: 'DYING', way: 'count', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, harder: 0,
  naturals: [], turns: 6, hurt: 'nothing', npcs: { friendly: false, enemy: false },
};

/** HOW IT GOES, as the card's buttons say each, and what each means. */
export const WAYS: { id: Way; label: string; means: string }[] = [
  { id: 'count', label: 'SAVES COUNTED', means: 'Each save is a success or a failure; enough successes and they are stable, enough failures and they are dead.' },
  { id: 'once', label: 'ONE FAIL IS DEATH', means: 'Each turn they roll; making it keeps them alive one more turn, missing it once is death. It gets harder each time. Only stabilizing ends it.' },
  { id: 'turns', label: 'TURNS LEFT', means: 'No roll: they have so many turns, then they are dead, unless someone stabilizes them first.' },
  { id: 'none', label: 'NO ROLL', means: 'No roll and no count: the word shows, and the table decides what happens. Healing above 0 clears it.' },
];
export const HURTS: { id: Hurt; label: string }[] = [
  { id: 'nothing', label: 'NOTHING MORE' }, { id: 'failure', label: 'A FAILURE' }, { id: 'dead', label: 'DEAD' },
];
export const NATURAL_THENS: { id: NaturalThen; label: string }[] = [
  { id: 'back_up', label: 'BACK WITH 1 HP' }, { id: 'stable', label: 'STABLE' }, { id: 'two_failures', label: 'TWO FAILURES' }, { id: 'dead', label: 'DEAD' },
];

/** The presets, named after the games that play this way: their numbers, written in. */
export const PRESETS: { id: PresetId; label: string; dying: Omit<Dying, 'npcs'> }[] = [
  { id: 'dnd', label: 'D&D 5E', dying: {
    word: 'DYING', way: 'count', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, harder: 0,
    naturals: [{ face: 20, then: 'back_up' }, { face: 1, then: 'two_failures' }], turns: 6, hurt: 'failure',
  } },
  { id: 'cpr', label: 'CYBERPUNK RED', dying: {
    word: 'MORTALLY WOUNDED', way: 'once', save: { dice: '1d10', way: 'under', target: '10' }, to_live: 3, to_die: 3, harder: 1,
    naturals: [{ face: 10, then: 'dead' }], turns: 6, hurt: 'nothing',
  } },
  { id: 'cwn', label: 'CITIES WITHOUT NUMBER', dying: {
    word: 'MORTALLY WOUNDED', way: 'turns', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, harder: 0,
    naturals: [], turns: 6, hurt: 'dead',
  } },
  { id: 'none', label: 'NO ROLL (PBTA, BLADES)', dying: {
    word: 'TAKEN OUT', way: 'none', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, harder: 0,
    naturals: [], turns: 6, hurt: 'nothing',
  } },
];

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const pick = <T extends string>(v: unknown, of: readonly { id: T }[], or: T): T => (of.some((o) => o.id === v) ? v as T : or);

/** Whether the rule is on: DEATH SAVES on PARTS, and the section written. */
export const dyingOn = (def: Definition): boolean => partIsOn(def, 'death') && isObject(def.dying);

/** The section as the card shows it: what it says, and what a game starts with for the rest. */
export const dyingOf = (def: Definition): Dying => {
  const d = isObject(def.dying) ? def.dying : {};
  const save = isObject(d.save) ? d.save : {};
  const npcs = isObject(d.npcs) ? d.npcs : {};
  return {
    word: typeof d.word === 'string' ? d.word : START.word,
    way: pick(d.way, WAYS, START.way),
    save: {
      dice: typeof save.dice === 'string' ? save.dice : START.save.dice,
      way: save.way === 'under' ? 'under' : 'at_least',
      target: typeof save.target === 'number' ? String(save.target) : typeof save.target === 'string' ? save.target : START.save.target,
    },
    to_live: whole(d.to_live, 1, LIMITS.count) ? d.to_live : START.to_live,
    to_die: whole(d.to_die, 1, LIMITS.count) ? d.to_die : START.to_die,
    harder: whole(d.harder, -LIMITS.harder, LIMITS.harder) ? d.harder : START.harder,
    naturals: Array.isArray(d.naturals)
      ? d.naturals.filter(isObject).map((n) => ({ face: Number.isInteger(n.face) ? n.face as number : 0, then: pick(n.then, NATURAL_THENS, 'dead') }))
      : [],
    turns: whole(d.turns, 1, LIMITS.turns) ? d.turns : START.turns,
    hurt: pick(d.hurt, HURTS, START.hurt),
    npcs: { friendly: npcs.friendly === true, enemy: npcs.enemy === true },
  };
};

/** The section written with `dying`, keeping what the card doesn't draw (STABILIZE, 8c4a, until its part of the card). */
const withDyingSection = (def: Definition, dying: Obj): Definition => ({ ...def, dying: { ...(isObject(def.dying) ? def.dying : {}), ...dying } });

/**
 * The card's switch, which is the PARTS row's: on writes the section (D&D 5E the first time) and the part on; off turns the part
 * off and keeps the section.
 */
export const withDyingOn = (def: Definition, on: boolean): Definition => {
  if (!on) return withPart(def, 'death', false);
  const parted = withPart(def, 'death', true);
  return isObject(def.dying) ? parted : withDyingSection(parted, presetDying(def, 'dnd', START.npcs));
};

/** A preset's numbers for this system: Cyberpunk RED's target its BODY, where it has one. */
const presetFor = (def: Definition, id: PresetId): Omit<Dying, 'npcs'> => {
  const p = (PRESETS.find((x) => x.id === id) ?? PRESETS[0]).dying;
  const body = id === 'cpr' && allStats(def).some((s) => s.id === 'body');
  return JSON.parse(JSON.stringify(body ? { ...p, save: { ...p.save, target: '@body' } } : p));
};
const presetDying = (def: Definition, id: PresetId, npcs: Dying['npcs']): Obj => ({ ...presetFor(def, id), npcs: { ...npcs } });

/** A preset's numbers written in; WHO GOES DOWN kept as the GM set it. */
export const withPreset = (def: Definition, id: PresetId): Definition => withDyingSection(def, presetDying(def, id, dyingOf(def).npcs));

/** The preset the card says now, where every number is one's; null once the GM has changed any. */
export const presetNow = (def: Definition): PresetId | null => {
  const now: Partial<Dying> = dyingOf(def);
  delete now.npcs;
  return PRESETS.find((p) => JSON.stringify(presetFor(def, p.id)) === JSON.stringify(now))?.id ?? null;
};

/** One thing changed; the rest as shown. */
export const withDying = (def: Definition, patch: Partial<Omit<Dying, 'save' | 'npcs'>>): Definition => withDyingSection(def, { ...dyingOf(def), ...patch });
export const withSave = (def: Definition, patch: Partial<Dying['save']>): Definition => {
  const now = dyingOf(def);
  return withDyingSection(def, { ...now, save: { ...now.save, ...patch } });
};
export const withNpcs = (def: Definition, patch: Partial<Dying['npcs']>): Definition => {
  const now = dyingOf(def);
  return withDyingSection(def, { ...now, npcs: { ...now.npcs, ...patch } });
};

/** A whole number typed into a box, held to its range; what it was where the box holds nothing whole. */
export const wholeTyped = (text: string, lo: number, hi: number, was: number): number => {
  const n = Number(text.trim());
  return text.trim() && Number.isInteger(n) ? Math.max(lo, Math.min(hi, n)) : was;
};

/** ON A NATURAL: one more (the top face of the dice, then 1, then the lowest not yet taken), changed, or taken off. */
export const withNaturalAdded = (def: Definition): Definition => {
  const now = dyingOf(def);
  if (now.naturals.length >= LIMITS.naturals) return def;
  const top = Number(/^\s*\d*d(\d+)\s*$/i.exec(now.save.dice)?.[1] ?? 20);
  const taken = new Set(now.naturals.map((n) => n.face));
  const face = [top, ...Array.from({ length: LIMITS.naturals + 1 }, (_, i) => i + 1)].find((f) => !taken.has(f))!;
  return withDying(def, { naturals: [...now.naturals, { face, then: 'dead' }] });
};
export const withNatural = (def: Definition, index: number, patch: Partial<Natural>): Definition =>
  withDying(def, { naturals: dyingOf(def).naturals.map((n, i) => (i === index ? { ...n, ...patch } : n)) });
export const withoutNatural = (def: Definition, index: number): Definition =>
  withDying(def, { naturals: dyingOf(def).naturals.filter((_, i) => i !== index) });

/** What the card asks under each way: the save's rows, the count's, the turns'. */
export const asks = (way: Way) => ({ save: way === 'count' || way === 'once', count: way === 'count', harder: way === 'once', turns: way === 'turns' });

/** What starts it, said on the card: the game's health running out, as its SETUP model says it. */
export const startsWhen = (def: Definition): string => {
  const core = isObject(def.core) ? def.core : {};
  const model = isObject(core.health) ? core.health.model : 'pool';
  switch (model) {
    case 'typed': return 'the heaviest damage fills the track';
    case 'harm': return 'harm goes past the top level';
    case 'wounds': return 'no wounds are left';
    case 'tracks': return 'the first track reaches 0';
    case 'none': return 'never: this game has no health (SETUP: NO HEALTH)';
    default: return '0 HP';
  }
};
