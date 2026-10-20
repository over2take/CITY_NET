/**
 * The map's own groups of formulas (5c2). Approved mockup builder-graph (2026-10-17): "you can also
 * group formulas, which only the map has". Every change held to the server's own check of the
 * graph section.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { mapGroupsOf, groupOf, withFormulaInGroup, withMapGroupLabel, withoutMapGroup, GROUP_NAME_MAX, GROUPS_MAX } from '../graphGroups';
import { graphOf } from '../graphModel';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { LIMITS } = req('../../../../backend/systemBuilder/graph.js');
const graphProblems = (def: Definition) => checkDefinition(def).problems.filter((p: { where: string }) => p.where.startsWith('graph'));

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] }],
  derived: [
    { id: 'melee', label: 'Melee', formula: '@str + 1' },
    { id: 'shoot', label: 'Shoot', formula: '@str' },
    { id: 'save', label: 'Save', formula: '16 - @str' },
  ],
};
const put = (def: Definition, formula: string, to: string | 'new' | null) => withFormulaInGroup(def, formula, to)!;

describe('the map\'s own groups', () => {
  it('match the server\'s limits', () => {
    expect(GROUP_NAME_MAX).toBe(LIMITS.label);
    expect(GROUPS_MAX).toBe(LIMITS.groups);
  });

  it('a formula put in a new group, then another joining it, drawn as one group on the map', () => {
    const one = put(HEARTH, 'melee', 'new');
    expect(one.group).toBe('group_1');
    const two = put(one.definition, 'shoot', 'group_1');
    expect(mapGroupsOf(two.definition)).toEqual([{ id: 'group_1', label: 'NEW GROUP', members: ['melee', 'shoot'] }]);
    expect(graphOf(two.definition).groups.map((g) => [g.id, g.members])).toEqual([['group_1', ['melee', 'shoot']]]);
    expect(groupOf(two.definition, 'shoot')!.id).toBe('group_1');
    expect(groupOf(two.definition, 'save')).toBeUndefined();
    expect(graphProblems(two.definition)).toEqual([]);
  });

  it('moved from one group to another, never in two; a group left empty is gone, with its folding', () => {
    let def = put(put(HEARTH, 'melee', 'new').definition, 'shoot', 'new').definition;
    def = { ...def, graph: { ...(def.graph as object), collapsed: ['group_1', 'group_2'] } };
    const moved = put(def, 'melee', 'group_2');
    expect(mapGroupsOf(moved.definition)).toEqual([{ id: 'group_2', label: 'NEW GROUP', members: ['shoot', 'melee'] }]);
    expect((moved.definition.graph as { collapsed: string[] }).collapsed).toEqual(['group_2']);
    expect(graphProblems(moved.definition)).toEqual([]);
  });

  it('taken out of any group; the last out leaves no graph section behind', () => {
    const one = put(HEARTH, 'melee', 'new').definition;
    const out = put(one, 'melee', null);
    expect(out.group).toBeNull();
    expect(out.definition).toEqual(HEARTH);
  });

  it('a new group\'s id is the next free one, never past the most there may be', () => {
    const one = put(put(HEARTH, 'melee', 'new').definition, 'shoot', 'new').definition;
    expect(mapGroupsOf(one).map((g) => g.id)).toEqual(['group_1', 'group_2']);
    const gap = put(put(one, 'melee', null).definition, 'save', 'new');
    expect(gap.group).toBe('group_1');
    const full = { ...HEARTH, graph: { groups: Array.from({ length: GROUPS_MAX }, (_, i) => ({ id: `g${i}`, label: 'G', members: [`f${i}`] })) } };
    expect(withFormulaInGroup(full, 'melee', 'new')).toBeNull();
  });

  it('nothing for a formula or a group that isn\'t there', () => {
    expect(withFormulaInGroup(HEARTH, 'nowhere', 'new')).toBeNull();
    expect(withFormulaInGroup(HEARTH, 'melee', 'no_such_group')).toBeNull();
  });

  it('named, to the most a name may hold; ungrouped, its formulas kept', () => {
    const one = put(put(HEARTH, 'melee', 'new').definition, 'shoot', 'group_1').definition;
    expect(mapGroupsOf(withMapGroupLabel(one, 'group_1', 'ATTACKS'))[0].label).toBe('ATTACKS');
    const long = withMapGroupLabel(one, 'group_1', 'x'.repeat(GROUP_NAME_MAX + 9));
    expect(mapGroupsOf(long)[0].label).toHaveLength(GROUP_NAME_MAX);
    expect(graphProblems(long)).toEqual([]);
    const gone = withoutMapGroup(one, 'group_1');
    expect(gone).toEqual(HEARTH);
    expect(graphOf(gone).nodes.filter((n) => n.kind === 'formula').map((n) => n.id)).toEqual(['melee', 'shoot', 'save']);
  });
});
