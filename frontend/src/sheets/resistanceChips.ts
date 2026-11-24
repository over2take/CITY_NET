import type { Kind } from './damageTypes';

// The RESISTANCES and VULNERABILITIES rows of a token's HEALTH as logic (8b3c2b; the user, 2026-11-24: below CONDITIONS,
// built like it, two rows, every source; draft 2 approved). From what the server sends (backend/systemBuilder/
// resistancesShown.js): a chip for each type the character has something for, in the game's order, and one ALL chip for
// what counts against every type, so RESIST ALL is one chip and not one per type. A chip sits in VULNERABILITIES when
// VULNERABLE is what counts, otherwise in RESISTANCES, two that cancel there too. Adding by hand and taking off build the
// whole list the server keeps (PUT /api/locations/:id/resistances): rows as kind and type only, the server keeping who
// added each.

export interface Source { kind: Kind; from: string; all?: true; hand?: true; by?: string }
export interface Worked { kind: Kind | null; from: Source[] }
export interface HandRow { kind: Kind; type: string; by?: string }
export interface TypeShown { id: string; name: string; icon?: string; drawn?: string[] }
export interface ResistanceView {
  on: boolean;
  types?: TypeShown[];
  means?: Record<Kind, string>;
  worked?: Record<string, Worked>;
  hand?: HandRow[];
  /** What the one looking may add: anything (the GM), RESIST and IMMUNE (a player, `by`), or nothing (no sheet). */
  may?: { add: boolean; vulnerable: boolean; by?: string };
}
export interface Chip { id: string; name: string; icon?: string; drawn?: string[]; kind: Kind | null; from: Source[] }

/** A row's type for every type the game has on, as the server says it. */
export const ALL = 'all';
export const KIND_WORDS: Record<Kind, string> = { resist: 'RESIST', immune: 'IMMUNE', vulnerable: 'VULNERABLE' };

/** Of the kinds one type is given, what counts, as the server works it out: IMMUNE beats either, RESIST and VULNERABLE cancel. */
export const kindOf = (kinds: Kind[]): Kind | null => {
  if (kinds.includes('immune')) return 'immune';
  if (kinds.includes('resist') && kinds.includes('vulnerable')) return null;
  return kinds.includes('resist') ? 'resist' : kinds.includes('vulnerable') ? 'vulnerable' : null;
};

/** The chips of each row: ALL first, where something counts against every type, then each type named, in the game's order. */
export const chipsOf = (view: ResistanceView): { resist: Chip[]; vulnerable: Chip[] } => {
  const worked = view.worked ?? {};
  const chips: Chip[] = [];
  // ALL's sources are on every type alike: read once, from any.
  const all = (Object.values(worked)[0]?.from ?? []).filter((s) => s.all);
  if (all.length) chips.push({ id: ALL, name: 'ALL', kind: kindOf(all.map((s) => s.kind)), from: all });
  for (const t of view.types ?? []) {
    const w = worked[t.id];
    if (!w || !w.from.some((s) => !s.all)) continue;
    chips.push({ ...t, name: t.name.toUpperCase(), kind: w.kind, from: w.from });
  }
  return { resist: chips.filter((c) => c.kind !== 'vulnerable'), vulnerable: chips.filter((c) => c.kind === 'vulnerable') };
};

/** Whether VULNERABILITIES shows: always to the GM, who adds them; to a player only where their character has one. */
export const showVulnerabilities = (view: ResistanceView, vulnerable: Chip[]): boolean => vulnerable.length > 0 || !!view.may?.vulnerable;

/** The row added by hand for a chip's type, if any: one a type. */
export const handRowOf = (view: ResistanceView, chip: Chip): HandRow | undefined => (view.hand ?? []).find((r) => r.type === chip.id);

/** Whether the one looking may take a row added by hand off: the GM any, a player only theirs. */
export const mayTakeOff = (view: ResistanceView, row: HandRow | undefined): boolean =>
  !!row && !!view.may?.add && (view.may.vulnerable || (!!row.by && row.by === view.may.by));

/** What + RESISTANCE or + VULNERABILITY may name: ALL and each type on, but a type with a row by hand already. */
export const pickable = (view: ResistanceView): TypeShown[] => [{ id: ALL, name: 'ALL' }, ...(view.types ?? [])]
  .filter((t) => !(view.hand ?? []).some((r) => r.type === t.id));

/** The list the server keeps, as it is sent: kind and type only. */
const bare = (rows: HandRow[]) => rows.map(({ kind, type }) => ({ kind, type }));
export const withAdded = (view: ResistanceView, kind: Kind, type: string) => [...bare(view.hand ?? []), { kind, type }];
export const withTakenOff = (view: ResistanceView, type: string) => bare((view.hand ?? []).filter((r) => r.type !== type));

/** A chip in words: RESIST FIRE, IMMUNE TO ALL, or what two that cancel come to. */
export const chipWords = (chip: Chip): string => (chip.kind === null
  ? `${chip.name}: RESIST AND VULNERABLE CANCEL`
  : `${KIND_WORDS[chip.kind]} ${chip.id === ALL ? 'TO ALL' : chip.name}`);

/** A source as the open chip lists it: where it comes from, its kind where it differs from the chip's, ALL where it is. */
export const sourceWords = (chip: Chip, s: Source): string =>
  `${s.from}${s.kind !== chip.kind ? ` · ${KIND_WORDS[s.kind]}` : ''}${s.all && chip.id !== ALL ? ' · ALL' : ''}`;
