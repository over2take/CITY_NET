// Notes on the graph view (5b5; approved mockup docs/mockups/builder-graph.html, 2026-10-17,
// decision 5): words for the GM, pinned to a node with a dashed line. Only the map makes them; they
// live in the definition's `graph` section (backend graph.js checks them: an id, up to 1000
// characters, pinned to a stat, formula, table or house rule, or nothing) and travel in a .citysys
// file beside the system. FORMS shows them under what they are pinned to, read only.

import type { Definition } from './systemsApi';
import { statGroups, formulaList, tableList } from './statsRules';
import { houseRuleList } from './houseRules';
import { graphOf, withPositions, heightOf, takenBoxes, clearOf, GRID, SIZE, type Graph, type Point, type Positions } from './graphModel';

export interface Note { id: string; on?: string; text: string }

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The longest a note may be (backend graph.js LIMITS.note). */
export const NOTE_MAX = 1000;
/** The most notes a system may have (backend graph.js LIMITS.notes). */
export const NOTES_MAX = 200;

/** A system's notes, as stored. */
export const notesOf = (def: Definition): Note[] => {
  const layout = isObject(def.graph) ? def.graph : {};
  return (Array.isArray(layout.notes) ? layout.notes : [])
    .filter((n): n is Note => isObject(n) && typeof n.id === 'string')
    .map((n) => ({ id: n.id, ...(typeof n.on === 'string' ? { on: n.on } : {}), text: typeof n.text === 'string' ? n.text : '' }));
};

const withNotes = (def: Definition, notes: Note[]): Definition => {
  const layout: Obj = { ...(isObject(def.graph) ? def.graph : {}) };
  if (notes.length) layout.notes = notes; else delete layout.notes;
  const next: Definition = { ...def, graph: layout };
  if (!Object.keys(layout).length) delete next.graph;
  return next;
};

/** What a note can be pinned to, by node, in the names players see. */
export const pinChoices = (def: Definition): { id: string; label: string }[] => [
  ...statGroups(def).map((g) => ({ id: g.id, label: `STATS ${(g.label || g.id).toUpperCase()}` })),
  ...formulaList(def).map((f) => ({ id: f.id, label: (f.label || f.id).toUpperCase() })),
  ...tableList(def).map((t) => ({ id: `table:${t.id}`, label: `TABLE ${(t.label || t.id).toUpperCase()}` })),
  ...houseRuleList(def).map((r) => ({ id: `rule:${r.id}`, label: `HOUSE RULE ${(r.name || r.id).toUpperCase()}` })),
];

/** A new note at `at`, pinned to `on` if given: the system after, and the note's node; null at the most notes there can be. */
export const withNewNote = (def: Definition, at: Point, on?: string): { definition: Definition; node: string } | null => {
  const notes = notesOf(def);
  if (notes.length >= NOTES_MAX) return null;
  let n = notes.length + 1;
  while (notes.some((x) => x.id === `n${n}`)) n += 1;
  const id = `n${n}`;
  const next = withNotes(def, [...notes, { id, ...(on ? { on } : {}), text: 'A note.' }]);
  return { definition: withPositions(next, graphOf(next), { [`note:${id}`]: at }), node: `note:${id}` };
};

/**
 * Where a new note goes beside node `id`: just to its right, where its line is short, moved up or
 * down a cell at a time to the nearest place that covers no node or group (a cell clear all round), with
 * room for it to grow to four lines as it is written.
 */
export const spotBeside = (graph: Graph, positions: Positions, id: string): Point | null => {
  const node = graph.nodes.find((n) => n.id === id);
  const at = positions[id];
  if (!node || !at) return null;
  const width = SIZE.noteWidth;
  const height = heightOf({ kind: 'note', inputs: [], text: 'x'.repeat(ROOM_LINES * 30) });
  const x = at.x + node.width + GRID * 2;
  const taken = takenBoxes(graph, positions);
  const clear = (y: number) => clearOf(taken, { x, y }, { width, height });
  for (let k = 0; k <= 200; k += 1) {
    for (const y of k ? [at.y + k * GRID, at.y - k * GRID] : [at.y]) if (clear(y)) return { x, y };
  }
  return { x, y: at.y };
};

/** How many lines of words a new note is given room for. */
const ROOM_LINES = 4;

/** A note's words changed, kept to the most a note may hold. */
export const withNoteText = (def: Definition, id: string, text: string): Definition =>
  withNotes(def, notesOf(def).map((n) => (n.id === id ? { ...n, text: text.slice(0, NOTE_MAX) } : n)));

/** A note pinned to a node, or unpinned with null. A note can't be pinned to a note. */
export const withNotePinned = (def: Definition, id: string, on: string | null): Definition =>
  withNotes(def, notesOf(def).map((n) => {
    if (n.id !== id) return n;
    const rest: Note = { id: n.id, text: n.text };
    return on && !on.startsWith('note:') ? { ...rest, on } : rest;
  }));

/** A note removed, with its place. */
export const withoutNote = (def: Definition, id: string): Definition => {
  const next = withNotes(def, notesOf(def).filter((n) => n.id !== id));
  const layout = isObject(next.graph) ? next.graph : null;
  if (!layout || !isObject(layout.positions)) return next;
  const positions = { ...layout.positions };
  delete positions[`note:${id}`];
  return { ...next, graph: { ...layout, positions } };
};

/**
 * The notes FORMS shows under an entry (a formula, a table as `table:<id>`, a stats group): those
 * pinned to it, and for a stats group those pinned to any of its stats, as the map shows them on its list.
 */
export const notesOn = (def: Definition, id: string): Note[] => {
  const stats = new Set(statGroups(def).find((g) => g.id === id)?.stats.map((s) => s.id) ?? []);
  return notesOf(def).filter((n) => n.on === id || (n.on !== undefined && stats.has(n.on)));
};
