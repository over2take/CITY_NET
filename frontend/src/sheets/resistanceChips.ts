import type { Kind } from './damageTypes';

// The RESISTANCES and VULNERABILITIES rows of a token's HEALTH as logic (8b3c2b; the user, 2026-11-24: below CONDITIONS,
// built like it, two rows, every source; draft 2 approved). From what the server sends (backend/systemBuilder/
// resistancesShown.js): a chip for each type the character has something for, in the game's order, and one ALL chip for
// what counts against every type, so RESIST ALL is one chip and not one per type. A chip sits in VULNERABILITIES when
// VULNERABLE is what counts, otherwise in RESISTANCES, two that cancel there too. Adding by hand and taking off build the
// whole list the server keeps (PUT /api/locations/:id/resistances): rows as kind and type only, the server keeping who
// added each.
//
// REVEAL (8b4b; the user, 2026-11-24): an NPC's, the GM sees which chips players see, unrevealed ones drawn apart, and
// reveals or hides them chip by chip or all at once (PUT /api/locations/:id/revealed, the whole list). A player looking at
// an NPC gets only the revealed, with no sources named; one looking at another player's character reads it all. Where the
// one looking may add nothing, an empty row isn't drawn, and nothing at all where there is nothing to show.

/** `from` names where it comes from; a player looking at an NPC isn't told (8b4a). */
export interface Source { kind: Kind; from?: string; all?: true; hand?: true; by?: string }
export interface Worked { kind: Kind | null; from: Source[] }
export interface HandRow { kind: Kind; type: string; by?: string }
export interface TypeShown { id: string; name: string; icon?: string; drawn?: string[]; description?: string }
export interface ResistanceView {
  on: boolean;
  types?: TypeShown[];
  means?: Record<Kind, string>;
  worked?: Record<string, Worked>;
  hand?: HandRow[];
  /** What the one looking may add: anything (the GM), RESIST and IMMUNE (a player, `by`), or nothing (no sheet). */
  may?: { add: boolean; vulnerable: boolean; by?: string };
  /** The GM's view of an NPC (8b4a): which chips its players see, by type id or ALL. */
  npc?: boolean;
  revealed?: string[];
  /** A player's view of an NPC: only what the GM revealed, no sources named. */
  revealedOnly?: boolean;
}
export interface Chip { id: string; name: string; icon?: string; drawn?: string[]; description?: string; kind: Kind | null; from: Source[] }

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

/** Whether RESISTANCES shows: where there is one, or the one looking may add one; never an empty row only to read. */
export const showResistances = (view: ResistanceView, resist: Chip[]): boolean => resist.length > 0 || !!view.may?.add;

/** Whether the GM is choosing what an NPC's players see (8b4b): the server marks the GM's view of an NPC only. */
export const revealing = (view: ResistanceView): boolean => !!view.npc;

/** Whether a chip is one an NPC's players see: always so but where the GM is choosing. */
export const isRevealed = (view: ResistanceView, chip: Pick<Chip, 'id'>): boolean => !revealing(view) || (view.revealed ?? []).includes(chip.id);

/** The revealed list with one chip shown or hidden again, the rest as kept. */
export const withRevealed = (view: ResistanceView, id: string, on: boolean): string[] => {
  const kept = (view.revealed ?? []).filter((r) => r !== id);
  return on ? [...kept, id] : kept;
};

/** REVEAL ALL: every chip shown now added to what is revealed already. */
export const withAllRevealed = (view: ResistanceView, chips: Chip[]): string[] => [...new Set([...(view.revealed ?? []), ...chips.map((c) => c.id)])];

/** Where it comes from, in the words the open chip and its helper use, or null where the one looking isn't told (the
 * server names every source or none). */
export const fromWords = (chip: Chip): string | null => (chip.from.some((s) => s.from)
  ? chip.from.map((s) => sourceWords(chip, s)).join(' · ')
  : null);

/** What a chip's helper says, line by line (hover, keyboard focus, a tap): kind and type, its meaning here, where from,
 * the type's own words, and the GM's note on an NPC's when players don't see it yet. */
export const helperLines = (view: ResistanceView, chip: Chip): string[] => {
  const from = fromWords(chip);
  return [
    chipWords(chip),
    chip.kind === null ? 'Taken as rolled.' : (view.means?.[chip.kind] ?? ''),
    ...(from ? [`From ${from}.`] : []),
    ...(chip.description ? [`${chip.name}: ${chip.description}`] : []),
    ...(revealing(view) ? [isRevealed(view, chip) ? 'Players see it.' : "Players don't see it yet: REVEAL shows it."] : []),
  ].filter(Boolean);
};

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
