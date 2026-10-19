// Adding and removing nodes on the graph view (5b4; approved mockup docs/mockups/builder-graph.html,
// 2026-10-17: "+ ADD (A)" and Delete). Pure: each is the very edit FORMS' own + and × buttons make
// (statsRules.ts), with the new node placed where the GM is looking. A stat is a row of its group's
// list, so a new one goes in a group; a note (5b5) is pinned to the node picked, if any; a
// condition (5b6a) is FORMS' + CONDITION; a house rule is made and removed on HOUSE RULES.

import type { Definition } from './systemsApi';
import {
  statGroups, allStats, formulaList, tableList,
  withNewGroup, withNewStat, withNewFormula, withNewCondition, withNewTable, withoutGroup, withoutFormula, withoutTable,
} from './statsRules';
import { graphOf, withPositions, positionsOf, clearSpot, type Point } from './graphModel';
import { withNewNote, withoutNote } from './graphNotes';

/** What can be added from the map now, and what is still to come. */
export interface AddChoice { key: string; label: string; what: string; soon?: string; group?: string }

export const addChoices = (def: Definition): AddChoice[] => [
  { key: 'formula', label: 'FORMULA', what: 'A number worked out from others: STR MOD + FIGHT.' },
  ...statGroups(def).map((g): AddChoice => ({ key: `stat:${g.id}`, label: `STAT IN ${(g.label || g.id).toUpperCase()}`, what: 'A number the player fills in, a row of that group.', group: g.id })),
  { key: 'group', label: 'STATS GROUP', what: 'A new group of stats: a list on the map, a section of the sheet.' },
  { key: 'table', label: 'TABLE', what: 'A number in, a number out, by bands read top to bottom.' },
  { key: 'condition', label: 'CONDITION', what: 'IF something THEN one number ELSE another.' },
  { key: 'note', label: 'NOTE', what: 'Words for you, pinned to the node picked.' },
  { key: 'roll', label: 'ROLL', what: 'A roll and its dice.', soon: 'Phase 6' },
  { key: 'choice', label: 'CHOICE · FEATURE', what: 'Classes, backgrounds and what they give.', soon: 'Phase 7' },
];

/** The choices whose name or what-it-is holds every word typed. */
export const matching = (choices: AddChoice[], query: string): AddChoice[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return choices.filter((c) => words.every((w) => `${c.label} ${c.what}`.toLowerCase().includes(w)));
};

/** Something new: the system with it, and its node (a stat's is its group's list), or null. */
const made = (def: Definition, key: string, picked?: string): { definition: Definition; node: string } | null => {
  if (key === 'note') return withNewNote(def, { x: 0, y: 0 }, picked && !picked.startsWith('note:') ? picked : undefined);
  const ids = (d: Definition) => new Set([...allStats(d).map((s) => s.id), ...formulaList(d).map((f) => f.id), ...tableList(d).map((t) => `table:${t.id}`), ...statGroups(d).map((g) => `group:${g.id}`)]);
  const before = ids(def);
  let next: Definition;
  if (key === 'formula') next = withNewFormula(def);
  else if (key === 'condition') next = withNewCondition(def);
  else if (key === 'group') next = withNewGroup(def);
  else if (key === 'table') next = withNewTable(def);
  else if (key.startsWith('stat:') && statGroups(def).some((g) => g.id === key.slice(5))) next = withNewStat(def, key.slice(5));
  else return null;
  const added = [...ids(next)].find((id) => !before.has(id));
  if (!added) return null;
  // A new group's list is its own node; a new stat is a row of its group's.
  return { definition: next, node: key.startsWith('stat:') ? key.slice(5) : added.replace(/^group:/, '') };
};

/**
 * Something added at `at` (a note pinned to `picked`): the system after, and the node to open. It
 * goes where asked, or the nearest place there clear of what is already on the map (5b6a), and
 * everything else stays where it was drawn (a map never moved isn't laid out again round it); a new
 * stat is a row of its group's list, which stays where it is.
 */
export const withAdded = (def: Definition, key: string, at: Point, picked?: string): { definition: Definition; node: string } | null => {
  const r = made(def, key, picked);
  if (!r || key.startsWith('stat:')) return r;
  const before = positionsOf(def, graphOf(def));
  const graph = graphOf(r.definition);
  const node = graph.nodes.find((n) => n.id === r.node)!;
  return { definition: withPositions(r.definition, graph, { ...before, [r.node]: clearSpot(graph, before, at, node, r.node) }), node: r.node };
};

/** A node removed, as FORMS' × does: a formula, a table, a stats group with its stats, or a note. House rules say where they go. */
export const withRemoved = (def: Definition, node: string): { definition: Definition | null; message: string } => {
  const graph = graphOf(def);
  const n = graph.nodes.find((x) => x.id === node);
  if (!n) return { definition: null, message: '' };
  if (n.kind === 'formula' || n.kind === 'condition') return { definition: withoutFormula(def, n.id), message: `Removed ${n.label}. Anything that read it shows the problem.` };
  if (n.kind === 'table') return { definition: withoutTable(def, n.id.slice('table:'.length)), message: `Removed the table ${n.label}. Anything that read it shows the problem.` };
  if (n.kind === 'list') return { definition: withoutGroup(def, n.id), message: `Removed ${n.label} and its ${n.rows?.length ?? 0} stats. Undo brings them back.` };
  if (n.kind === 'rule') return { definition: null, message: 'House rules are removed on HOUSE RULES, where removing one says what stays.' };
  return { definition: withoutNote(def, n.id.slice('note:'.length)), message: 'Removed the note. Undo brings it back.' };
};
