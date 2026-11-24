import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// A condition drawn on the 16 x 16 pad (8b1b; the user, 2026-11-23: "add it here just to get it done"): a system's own or a
// standard one, its picture a drawing instead of an icon, checked as a damage type's, kept with the icon for what draws
// icons only, carried in the system's file and left in place when its zip goes without uploads.

const require_ = createRequire(import.meta.url);
const { checkConditions, conditionsOf } = require_('../systemBuilder/conditions');
const { checkDefinition } = require_('../systemBuilder/definition');
const { tableConditionsOf, saveTableConditions } = require_('../systemBuilder/tableConditions');
const citysys = require_('../systemBuilder/citysys');
const zip = require_('../systemBuilder/citysysZip');

const DRAWN = [...Array(15).fill('0000'), '0ff0'];
const problemsOf = (conditions) => { const p = []; checkConditions(conditions, new Set(), p); return p.map((x) => `${x.where}: ${x.message}`); };
const DEF = { format: 1, name: 'Drawfall', conditions: { hacked: { name: 'Hacked', drawn: DRAWN }, prone: { drawn: DRAWN } } };

describe('a condition drawn', () => {
  it('a drawing of 16 rows, one picture with the icon', () => {
    expect(problemsOf({ hacked: { name: 'Hacked', drawn: DRAWN }, prone: { drawn: DRAWN } })).toEqual([]);
    expect(problemsOf({ hacked: { name: 'Hacked', drawn: ['zz'] } })).toEqual(['condition hacked, drawn: A drawing of 16 rows, each 4 hex digits']);
    expect(problemsOf({ hacked: { name: 'Hacked', drawn: DRAWN, icon: 'bolt' } })).toEqual(['condition hacked, drawn: An icon or a drawing, not both']);
    expect(checkDefinition(DEF).problems).toEqual([]);
  });

  it('as the game has it: the drawing, and its icon still there for what draws icons only', () => {
    const list = conditionsOf(DEF);
    expect(list.find((c) => c.id === 'hacked')).toMatchObject({ name: 'Hacked', icon: 'target', drawn: DRAWN });
    expect(list.find((c) => c.id === 'prone')).toMatchObject({ icon: 'down', drawn: DRAWN });
    // A copy, never the definition's own rows.
    expect(list.find((c) => c.id === 'hacked').drawn).not.toBe(DEF.conditions.hacked.drawn);
    // Not a drawing: none.
    expect(conditionsOf({ ...DEF, conditions: { hacked: { name: 'Hacked', drawn: ['zz'] } } }).find((c) => c.id === 'hacked').drawn).toBeUndefined();
    expect(conditionsOf({ format: 1, name: 'Plain' })[0].drawn).toBeUndefined();
  });

  it('carried in the system\'s file, and kept when its zip goes without uploads', () => {
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: DEF, version: 1, origin: 'org_draw' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.conditions).toEqual(DEF.conditions);
    expect(zip.withoutUploads(DEF).conditions).toEqual(DEF.conditions);
    expect(zip.uploadsIn(DEF)).toEqual([]);
  });

  it('a built-in game\'s own, drawn, as the game lists it', async () => {
    const db = { run: (_sql, _params, cb) => cb(null) };
    await new Promise((done) => saveTableConditions(db, 'generic', { hacked: { name: 'Hacked', drawn: DRAWN } }, done));
    expect(tableConditionsOf('generic')).toEqual({ hacked: { name: 'Hacked', drawn: DRAWN } });
    expect(conditionsOf({ conditions: tableConditionsOf('generic') }).find((c) => c.id === 'hacked')).toMatchObject({ drawn: DRAWN, icon: 'target' });
  });
});
