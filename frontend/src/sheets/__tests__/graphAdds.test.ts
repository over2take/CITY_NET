/**
 * Adding and removing nodes on the graph view (5b4). Approved mockup builder-graph (2026-10-17):
 * + ADD (A) and Delete. Each is the very edit FORMS' own + and × buttons make, the new node placed
 * where the GM is looking; what isn't added from the map yet says when it will be.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { addChoices, matching, withAdded, withRemoved } from '../graphAdds';
import { graphOf } from '../graphModel';
import { notesOf, withNewNote, withoutNote } from '../graphNotes';
import { withNewFormula, withNewStat, withNewGroup, withNewTable, withoutFormula, withoutTable, withoutGroup } from '../statsRules';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] }],
  lookups: { mod: { bands: [{ value: 0 }] } },
  derived: [{ id: 'melee', label: 'Melee', formula: '@str + 1' }],
  house_rules: [{ id: 'magic', name: 'Magic' }],
};
const without = (def: Definition) => { const { graph: _g, ...rest } = def; return rest; };

describe('what can be added', () => {
  it('a formula, a stat in each group, a group, a table and a note now; the rest saying when', () => {
    expect(addChoices(HEARTH).map((c) => `${c.label}${c.soon ? ` (${c.soon})` : ''}`)).toEqual([
      'FORMULA', 'STAT IN ABILITIES', 'STATS GROUP', 'TABLE',
      'CONDITION (With editing conditions on the map)', 'NOTE', 'ROLL (Phase 6)', 'CHOICE · FEATURE (Phase 7)',
    ]);
  });

  it('searched by every word typed', () => {
    expect(matching(addChoices(HEARTH), 'stat').map((c) => c.key)).toEqual(['stat:abilities', 'group']);
    expect(matching(addChoices(HEARTH), 'stat abil').map((c) => c.key)).toEqual(['stat:abilities']);
    expect(matching(addChoices(HEARTH), 'bands').map((c) => c.key)).toEqual(['table']);
    expect(matching(addChoices(HEARTH), '').length).toBe(8);
  });
});

describe('a node added', () => {
  it('is the edit FORMS\' + makes, placed where asked, and opened', () => {
    const f = withAdded(HEARTH, 'formula', { x: 480, y: 240 })!;
    expect(without(f.definition)).toEqual(withNewFormula(HEARTH));
    expect(f.node).toBe('new_formula');
    expect((f.definition.graph as { positions: Record<string, number[]> }).positions.new_formula).toEqual([480, 240]);

    const t = withAdded(HEARTH, 'table', { x: 0, y: 0 })!;
    expect(without(t.definition)).toEqual(withNewTable(HEARTH));
    expect(t.node).toBe('table:new_table');

    const gr = withAdded(HEARTH, 'group', { x: 24, y: 24 })!;
    expect(without(gr.definition)).toEqual(withNewGroup(HEARTH));
    expect(gr.node).toBe('new_group');
  });

  it('a note, pinned to the node picked (never a note), placed where asked', () => {
    expect(withAdded(HEARTH, 'note', { x: 72, y: 96 }, 'melee')).toEqual(withNewNote(HEARTH, { x: 72, y: 96 }, 'melee'));
    expect(notesOf(withAdded(HEARTH, 'note', { x: 0, y: 0 }, 'melee')!.definition)[0].on).toBe('melee');
    expect(notesOf(withAdded(HEARTH, 'note', { x: 0, y: 0 })!.definition)[0].on).toBeUndefined();
    const one = withAdded(HEARTH, 'note', { x: 0, y: 0 })!;
    expect(notesOf(withAdded(one.definition, 'note', { x: 0, y: 0 }, one.node)!.definition)[1].on).toBeUndefined();
  });

  it('a stat as a row of its group, the group\'s list opened and left where it was', () => {
    const s = withAdded(HEARTH, 'stat:abilities', { x: 999, y: 999 })!;
    expect(s.definition).toEqual(withNewStat(HEARTH, 'abilities'));
    expect(s.node).toBe('abilities');
  });

  it('nothing for what can\'t be added yet, or a group that isn\'t there', () => {
    for (const key of ['condition', 'roll', 'choice', 'stat:nowhere']) expect(withAdded(HEARTH, key, { x: 0, y: 0 })).toBeNull();
  });

  it('every one taken by the server\'s check', () => {
    for (const key of ['formula', 'table', 'group', 'stat:abilities', 'note']) {
      const a = withAdded(HEARTH, key, { x: 48, y: 48 })!;
      expect(checkDefinition(a.definition).problems.filter((p: { where: string }) => p.where.startsWith('graph'))).toEqual([]);
      expect(graphOf(a.definition).nodes.some((n) => n.id === a.node)).toBe(true);
    }
  });
});

describe('a node removed', () => {
  it('is the edit FORMS\' × makes', () => {
    expect(withRemoved(HEARTH, 'melee').definition).toEqual(withoutFormula(HEARTH, 'melee'));
    expect(withRemoved(HEARTH, 'table:mod').definition).toEqual(withoutTable(HEARTH, 'mod'));
    const group = withRemoved(HEARTH, 'abilities');
    expect(group.definition).toEqual(withoutGroup(HEARTH, 'abilities'));
    expect(group.message).toBe('Removed ABILITIES and its 1 stats. Undo brings them back.');
  });

  it('a note, with its place', () => {
    const made = withNewNote(HEARTH, { x: 0, y: 0 }, 'melee')!;
    expect(withRemoved(made.definition, made.node)).toEqual({ definition: withoutNote(made.definition, 'n1'), message: 'Removed the note. Undo brings it back.' });
  });

  it('a house rule says where it is removed, and nothing is changed', () => {
    expect(withRemoved(HEARTH, 'rule:magic')).toEqual({ definition: null, message: 'House rules are removed on HOUSE RULES, where removing one says what stays.' });
    expect(withRemoved(HEARTH, 'nowhere').definition).toBeNull();
  });
});
