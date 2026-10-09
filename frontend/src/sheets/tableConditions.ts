// The GAME tab's CONDITIONS panel as logic (4e2c2; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09, stage 3). Under a built-in game the table adds conditions of its own beside the
// standard set: a name, icon and description, no modifiers or rounds, so the game's rules don't
// change. The panel reads the game's list (GET /api/systems/conditions/:system) and writes the whole
// of the table's own back (PUT /api/systems/table-conditions/:system); the server checks and stores
// them (backend/systemBuilder/tableConditions.js).

import type { GameCondition } from './tokenConditions';
import { LIMITS, STANDARD } from './conditions';
import { idFor } from './setup';

/** One of the table's own as the server stores it: no modifiers or rounds. */
export interface TableEntry { name: string; icon: string; description?: string }
/** What the panel's form holds while one is being added. */
export interface Draft { name: string; icon: string; description: string }

export const EMPTY_DRAFT: Draft = { name: '', icon: 'target', description: '' };

/** The table's own, from the game's list: everything that isn't standard, in the order stored. */
export const ownOf = (list: GameCondition[]) => list.filter((c) => !c.standard);

/** The game's standard conditions, from its list. */
export const standardOf = (list: GameCondition[]) => list.filter((c) => c.standard);

/** The table's own as the server takes them back, keyed by id. A blank description isn't sent. */
export const entriesOf = (own: GameCondition[]): Record<string, TableEntry> => Object.fromEntries(own.map((c) => [
  c.id, { name: c.name, icon: c.icon, ...(c.description ? { description: c.description } : {}) },
]));

/** Whether another fits: the standard set counts against the limit of 60, as in the builder. */
export const canAdd = (own: GameCondition[]) => STANDARD.length + own.length < LIMITS.conditions;

/** What stops a draft being added, or null. */
export const draftProblem = (draft: Draft): string | null => (draft.name.trim() ? null : 'Needs a name');

/**
 * The table's own with a draft added at the end, under an id made from its name that no standard
 * condition or other one of the table's own has.
 */
export const withAdded = (own: GameCondition[], draft: Draft): Record<string, TableEntry> => {
  const id = idFor(draft.name, [...STANDARD.map((s) => s.id), ...own.map((c) => c.id)]);
  const description = draft.description.trim();
  return {
    ...entriesOf(own),
    [id]: { name: draft.name.trim(), icon: draft.icon, ...(description ? { description } : {}) },
  };
};

/** The table's own without one. */
export const withRemoved = (own: GameCondition[], id: string) => entriesOf(own.filter((c) => c.id !== id));
