/**
 * Notes on the graph view (5b5). Approved mockup builder-graph (2026-10-17), decision 5: made on
 * the map, pinned to a node with a dashed line, written, re-pinned, unpinned and removed there,
 * shown under their entry in FORMS. Every one held to the server's own check of the graph section.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { notesOf, pinChoices, withNewNote, withNoteText, withNotePinned, withoutNote, notesOn, spotBeside, NOTE_MAX, NOTES_MAX } from '../graphNotes';
import { graphOf, GRID, SIZE } from '../graphModel';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { LIMITS } = req('../../../../backend/systemBuilder/graph.js');
const graphProblems = (def: Definition) => checkDefinition(def).problems.filter((p: { where: string }) => p.where.startsWith('graph')).map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] }],
  lookups: { mod: { bands: [{ value: 0 }] } },
  derived: [{ id: 'melee', label: 'Melee', formula: '@str + 1' }],
  house_rules: [{ id: 'magic', name: 'Magic' }],
};

describe('notes', () => {
  it('match the server\'s limits', () => {
    expect(NOTE_MAX).toBe(LIMITS.note);
    expect(NOTES_MAX).toBe(LIMITS.notes);
  });

  it('a new one, pinned to the node picked, placed where asked, on the map', () => {
    const made = withNewNote(HEARTH, { x: 480, y: 96 }, 'melee')!;
    expect(made.node).toBe('note:n1');
    expect(notesOf(made.definition)).toEqual([{ id: 'n1', on: 'melee', text: 'A note.' }]);
    expect((made.definition.graph as { positions: Record<string, number[]> }).positions['note:n1']).toEqual([480, 96]);
    const g = graphOf(made.definition);
    expect(g.wires.some((w) => w.from === 'note:n1' && w.to === 'melee')).toBe(true);
    expect(graphProblems(made.definition)).toEqual([]);
  });

  it('a new one pinned to nothing, with the next free id', () => {
    const one = withNewNote(HEARTH, { x: 0, y: 0 })!.definition;
    const two = withNewNote(one, { x: 0, y: 0 })!;
    expect(notesOf(two.definition).map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(notesOf(two.definition)[1].on).toBeUndefined();
    const gap = withNewNote(withoutNote(two.definition, 'n1'), { x: 0, y: 0 })!;
    expect(notesOf(gap.definition).map((n) => n.id)).toEqual(['n2', 'n3']);
  });

  it('none past the most there may be', () => {
    const full = { ...HEARTH, graph: { notes: Array.from({ length: NOTES_MAX }, (_, i) => ({ id: `n${i + 1}`, text: '' })) } };
    expect(withNewNote(full, { x: 0, y: 0 })).toBeNull();
  });

  it('written, kept to the most a note may hold', () => {
    const made = withNewNote(HEARTH, { x: 0, y: 0 })!.definition;
    expect(notesOf(withNoteText(made, 'n1', 'Half level, rounded down.'))[0].text).toBe('Half level, rounded down.');
    expect(notesOf(withNoteText(made, 'n1', 'x'.repeat(NOTE_MAX + 50)))[0].text.length).toBe(NOTE_MAX);
    expect(graphProblems(withNoteText(made, 'n1', 'x'.repeat(NOTE_MAX + 50)))).toEqual([]);
  });

  it('pinned, re-pinned and unpinned, never to a note', () => {
    const made = withNewNote(HEARTH, { x: 0, y: 0 })!.definition;
    expect(notesOf(withNotePinned(made, 'n1', 'table:mod'))[0].on).toBe('table:mod');
    expect(notesOf(withNotePinned(made, 'n1', 'abilities'))[0].on).toBe('abilities');
    expect(notesOf(withNotePinned(withNotePinned(made, 'n1', 'melee'), 'n1', null))[0].on).toBeUndefined();
    expect(notesOf(withNotePinned(made, 'n1', 'note:n1'))[0].on).toBeUndefined();
    for (const on of pinChoices(HEARTH).map((c) => c.id)) expect(graphProblems(withNotePinned(made, 'n1', on)), on).toEqual([]);
  });

  it('what can be pinned to, in players\' names', () => {
    expect(pinChoices(HEARTH)).toEqual([
      { id: 'abilities', label: 'STATS ABILITIES' }, { id: 'melee', label: 'MELEE' },
      { id: 'table:mod', label: 'TABLE MOD' }, { id: 'rule:magic', label: 'HOUSE RULE MAGIC' },
    ]);
  });

  it('removed with its place, and the layout left tidy', () => {
    const made = withNewNote(HEARTH, { x: 0, y: 0 }, 'melee')!.definition;
    const gone = withoutNote(made, 'n1');
    expect(notesOf(gone)).toEqual([]);
    expect((gone.graph as { positions: Record<string, unknown> }).positions['note:n1']).toBeUndefined();
    expect((gone.graph as Record<string, unknown>).notes).toBeUndefined();
  });

  it('a new one goes just right of its node, or the nearest clear place up or down from there', () => {
    const g = graphOf(HEARTH);
    const melee = { x: 480, y: 240 };
    const right = melee.x + SIZE.width + 2 * GRID;
    expect(spotBeside(g, { melee }, 'melee')).toEqual({ x: right, y: 240 });
    // A table where it would go: below it, or above, whichever is nearer.
    const tall = g.nodes.find((n) => n.id === 'table:mod')!;
    const under = spotBeside(g, { melee, 'table:mod': { x: right, y: 216 } }, 'melee')!;
    // Whole cells from the node's own row: the first a cell clear below the table.
    expect(under).toEqual({ x: right, y: 240 + Math.ceil((216 + tall.height + GRID - 240) / GRID) * GRID });
    const over = spotBeside(g, { melee, 'table:mod': { x: right + 120, y: 264 } }, 'melee')!;
    // Room for four lines of words.
    const noteTall = SIZE.noteHeader + 4 * SIZE.noteLine + 8 + SIZE.border;
    expect(over).toEqual({ x: right, y: 240 - Math.ceil((240 + noteTall + GRID - 264) / GRID) * GRID });
    // Nothing to go beside.
    expect(spotBeside(g, {}, 'melee')).toBeNull();
    expect(spotBeside(g, { melee }, 'nowhere')).toBeNull();
  });

  it('shown under their entry in FORMS: a formula, a table, a group (and its stats)', () => {
    const def = { ...HEARTH, graph: { notes: [
      { id: 'a', on: 'melee', text: 'On melee.' }, { id: 'b', on: 'str', text: 'On a stat.' }, { id: 'c', on: 'abilities', text: 'On the group.' },
      { id: 'd', on: 'table:mod', text: 'On the table.' }, { id: 'e', text: 'On nothing.' },
    ] } };
    expect(notesOn(def, 'melee').map((n) => n.id)).toEqual(['a']);
    expect(notesOn(def, 'abilities').map((n) => n.id)).toEqual(['b', 'c']);
    expect(notesOn(def, 'table:mod').map((n) => n.id)).toEqual(['d']);
  });
});
