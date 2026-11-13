// The builder's IMPROVE BY USE section on LEVELS, as logic (7f3a2; approved mockup docs/mockups/ranks-and-xp.html,
// 2026-11-12): which stats improve, what marks one, the rest it is rolled at, the roll, what it must beat, the gain and
// its most, read from and written to `definition.improve`. What is left unsaid reads as Call of Cthulhu's. The server's
// own is backend systemBuilder/improveByUse.js, which checks it. Pure, so the page only draws.

import type { Definition } from './systemsApi';
import { statGroups } from './statsRules';
import { restsOf } from './rests';

export type MarkedBy = 'success' | 'any' | 'hand';
export interface ImproveSet { stats?: string; marked: MarkedBy; at: string; roll: string; over: string; gain: string; most?: number }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What it does, said nothing else (backend improveByUse.js DEFAULTS). */
export const IMPROVE_DEFAULTS = { marked: 'success' as MarkedBy, at: 'end_of_session', roll: 'd100', over: '@this', gain: '1d10' };
/** MARKED BY, in the page's words. */
export const MARKED_LABELS: Record<MarkedBy, string> = { success: 'A SUCCESSFUL ROLL OF IT', any: 'ANY ROLL OF IT', hand: 'BY HAND ONLY' };

const raw = (d: Definition): Record<string, unknown> => (isObject(d.improve) ? d.improve : {});

/** As stored, with what is left unsaid filled in; a box keeps what was typed, empty or not. */
export const improveSet = (d: Definition): ImproveSet => {
  const r = raw(d);
  const text = (key: 'roll' | 'over' | 'gain') => (typeof r[key] === 'string' ? r[key] as string : IMPROVE_DEFAULTS[key]);
  return {
    ...(typeof r.stats === 'string' ? { stats: r.stats } : {}),
    marked: r.marked === 'any' || r.marked === 'hand' || r.marked === 'success' ? r.marked : IMPROVE_DEFAULTS.marked,
    at: typeof r.at === 'string' && r.at ? r.at : IMPROVE_DEFAULTS.at,
    roll: text('roll'), over: text('over'), gain: text('gain'),
    ...(Number.isInteger(r.most) ? { most: r.most as number } : {}),
  };
};

/** A change to it: `stats: null` is every stat, `most: null` no end. */
export type ImprovePatch = { stats?: string | null; marked?: MarkedBy; at?: string; roll?: string; over?: string; gain?: string; most?: number | null };
export const withImprove = (d: Definition, patch: ImprovePatch): Definition => {
  const next: Record<string, unknown> = { ...raw(d) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return { ...d, improve: next };
};

/** The groups STATS THAT IMPROVE offers: those with a stat not held as a rank. */
export const improveGroups = (d: Definition): { id: string; label: string }[] => statGroups(d)
  .filter((g) => typeof g.id === 'string' && g.stats.some((s) => typeof s.id === 'string' && typeof (s as { rank?: unknown }).rank !== 'string'))
  .map((g) => ({ id: g.id, label: g.label || g.id }));

/** The rests AT offers: the game's, on and named. */
export const improveRests = (d: Definition): { id: string; name: string }[] => restsOf(d).map((r) => ({ id: r.id, name: r.name }));

/** What it does, in a line: "At END OF SESSION, each marked stat rolls d100; over @this, it gains 1d10, up to 99." */
export const improveLine = (d: Definition): string => {
  const s = improveSet(d);
  const rest = improveRests(d).find((r) => r.id === s.at)?.name ?? s.at;
  return `At ${rest.toUpperCase()}, each marked stat rolls ${s.roll}; over ${s.over}, it gains ${s.gain}${s.most === undefined ? '' : `, up to ${s.most}`}. The marks clear.`;
};

/** What the section says can't work yet, as the server would. */
export const improveNotes = (d: Definition): string[] => {
  const s = improveSet(d);
  const notes: string[] = [];
  const groups = new Set(improveGroups(d).map((g) => g.id));
  if (s.stats !== undefined && !groups.has(s.stats)) notes.push(`No group of stats that can improve is called ${s.stats}: a stat held as a rank doesn't`);
  if (s.stats === undefined && !groups.size) notes.push('There are no stats to improve yet. Make them on STATS & RULES');
  if (!improveRests(d).some((r) => r.id === s.at)) notes.push(`No rest is called ${s.at}. Pick one, or turn it on on RESTS`);
  for (const [key, name] of [['roll', 'ROLL'], ['over', 'IMPROVES IF OVER'], ['gain', 'THEN ADD']] as const) {
    if (!s[key].trim()) notes.push(`${name}: write dice or a formula`);
  }
  return notes;
};
