import type { Definition } from './systemsApi';
import { damageList, KINDS, type Kind } from './damageTypes';

// A RESISTANCE row in the builder (8b3b; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23): on a
// feature (CHOICES, and ITEMS, worn or installed) and on a condition, RESIST, IMMUNE or VULNERABLE to one of the game's
// damage types, or ALL. Mirrors backend/systemBuilder/resistances.js: at most LIMIT, no type twice, a type switched off
// kept and said so. Pure: the rows' component (ResistanceRows.tsx) draws it.

export interface Resistance { kind: Kind; type: string }

/** A row's type for every type the game has on. */
export const ALL = 'all';
/** The most rows one feature or condition has. */
export const LIMIT = 10;
export const KIND_WORDS: Record<Kind, string> = { resist: 'RESIST', immune: 'IMMUNE', vulnerable: 'VULNERABLE' };

/** What a row may name: ALL, then every type that is on; a type switched off only where a row already names it. */
export const typeChoices = (def: Definition, named: string[] = []): { id: string; name: string; off?: true }[] => [
  { id: ALL, name: 'ALL' },
  ...damageList(def).filter((t) => t.on || named.includes(t.id)).map((t) => ({ id: t.id, name: t.name.toUpperCase(), ...(t.on ? {} : { off: true as const }) })),
];

/** The rows well formed enough to show, as written. */
export const resistancesIn = (value: unknown): Resistance[] => (Array.isArray(value) ? value : []).slice(0, LIMIT)
  .filter((r): r is Resistance => !!r && typeof r === 'object' && KINDS.includes((r as Resistance).kind) && typeof (r as Resistance).type === 'string')
  .map((r) => ({ kind: r.kind, type: r.type }));

/** One row changed; a type another row names already is left as it was. */
export const withRow = (rows: Resistance[], i: number, patch: Partial<Resistance>): Resistance[] => {
  if (patch.type !== undefined && rows.some((r, j) => j !== i && r.type === patch.type)) return rows;
  return rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
};

/** + RESISTANCE: RESIST to the first type that is on and no row names, ALL where every one is named; none past LIMIT. */
export const withNewRow = (def: Definition, rows: Resistance[]): Resistance[] => {
  if (rows.length >= LIMIT) return rows;
  const named = new Set(rows.map((r) => r.type));
  const free = typeChoices(def).filter((t) => t.id !== ALL).find((t) => !named.has(t.id));
  const type = free ? free.id : named.has(ALL) ? null : ALL;
  return type === null ? rows : [...rows, { kind: 'resist', type }];
};

export const withoutRow = (rows: Resistance[], i: number): Resistance[] => rows.filter((_, j) => j !== i);

/** A row in words, as the feature's tag and a download's note say it: "RESIST POISON", "IMMUNE TO ALL". */
export const rowWords = (def: Definition, r: Resistance): string => {
  const name = r.type === ALL ? 'ALL' : (damageList(def).find((t) => t.id === r.type)?.name ?? r.type).toUpperCase();
  return `${KIND_WORDS[r.kind]} ${r.type === ALL ? 'TO ALL' : name}`;
};
