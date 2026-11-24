import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { conditionList, withCondition, withNewCondition } from '../conditions';
import { entriesOf, withAdded, EMPTY_DRAFT } from '../tableConditions';
import { BLANK_DRAWN, withSquare } from '../drawings';
import type { Definition } from '../systemsApi';
import type { GameCondition } from '../tokenConditions';

// A condition drawn on the 16 x 16 pad (8b1b; the user, 2026-11-23: "add it here just to get it done"): in the builder,
// one picture with the icon, as the server keeps it; on the GAME tab, a table's own sent back with its drawing.

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { conditionsOf } = req('../../../../backend/systemBuilder/conditions.js');
const { checkTableConditions } = req('../../../../backend/systemBuilder/tableConditions.js');

const BLANK: Definition = { format: 1, name: 'Hearth' };
const DRAWN = withSquare(BLANK_DRAWN, 4, 4, true);
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const stored = (def: Definition, id: string) => (def.conditions as Record<string, Record<string, unknown>>)[id];

describe('a builder condition drawn', () => {
  it('one picture: drawing takes the icon off, an icon the drawing; kept as the server takes it', () => {
    const drawn = withCondition(withCondition(BLANK, 'prone', { icon: 'star' }), 'prone', { drawn: DRAWN });
    expect(stored(drawn, 'prone')).toEqual({ drawn: DRAWN });
    expect(problems(drawn)).toEqual([]);
    const back = withCondition(drawn, 'prone', { icon: 'skull' });
    expect(stored(back, 'prone')).toEqual({ icon: 'skull' });
    // The starter's own icon picked: nothing left to store.
    expect(withCondition(drawn, 'prone', { icon: 'down' }).conditions).toBeUndefined();
  });

  it('listed with its drawing, and its icon still, as the game has it', () => {
    const made = withNewCondition(BLANK)!;
    const def = withCondition(made.definition, made.id, { drawn: DRAWN });
    const listed = conditionList(def).find((c) => c.id === made.id)!;
    expect(listed.drawn).toEqual(DRAWN);
    expect(listed.icon).toBe('target');
    expect(conditionsOf(def).find((c: { id: string }) => c.id === made.id)).toMatchObject({ drawn: DRAWN, icon: 'target' });
    expect(problems(def)).toEqual([]);
    // Not a drawing: none listed.
    expect(conditionList({ ...BLANK, conditions: { prone: { drawn: ['zz'] } } }).find((c) => c.id === 'prone')!.drawn).toBeUndefined();
    expect(conditionList({ ...BLANK, conditions: { prone: { drawn: DRAWN.slice(1) } } }).find((c) => c.id === 'prone')!.drawn).toBeUndefined();
  });
});

describe('a table\'s own, drawn', () => {
  it('added with its drawing in place of an icon, and sent back so, as the server takes it', () => {
    const added = withAdded([], { ...EMPTY_DRAFT, name: 'Hacked', drawn: DRAWN });
    expect(added).toEqual({ hacked: { name: 'Hacked', drawn: DRAWN } });
    expect(checkTableConditions(added)).toEqual([]);
    const game: GameCondition[] = conditionsOf({ conditions: { ...added, wired: { name: 'Wired', icon: 'bolt' } } }).filter((c: GameCondition) => !c.standard);
    expect(entriesOf(game)).toEqual({ hacked: { name: 'Hacked', drawn: DRAWN }, wired: { name: 'Wired', icon: 'bolt' } });
    expect(checkTableConditions(entriesOf(game))).toEqual([]);
    // No drawing: its icon, as before.
    expect(withAdded([], { ...EMPTY_DRAFT, name: 'Marked' })).toEqual({ marked: { name: 'Marked', icon: 'target' } });
  });
});
