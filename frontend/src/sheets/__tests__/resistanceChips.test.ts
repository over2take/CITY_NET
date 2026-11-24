import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  ALL, kindOf, chipsOf, showVulnerabilities, handRowOf, mayTakeOff, pickable, withAdded, withTakenOff, chipWords, sourceWords,
  type ResistanceView,
} from '../resistanceChips';

/**
 * RESISTANCES and VULNERABILITIES as logic (8b3c2b): a chip a type, ALL as one, each in its row by what counts; who may take
 * a row by hand off; what may be added; the list sent back. Read from what the server really sends (resistancesShown.js).
 */

const req = createRequire(import.meta.url);
const { resistancesShown } = req('../../../../backend/systemBuilder/resistancesShown.js');
const { kindOf: serverKindOf } = req('../../../../backend/systemBuilder/resistances.js');

const DEF = {
  format: 1, name: 'Chips', damage: { types: { sonic: { name: 'Sonic' } } },
  conditions: { soaked: { name: 'Soaked', resistances: [{ kind: 'vulnerable', type: 'lightning' }, { kind: 'vulnerable', type: 'fire' }] } },
};
const view = (hand: object[], conditions: string[] = [], who: string | null = null): ResistanceView =>
  ({ on: true, ...resistancesShown(DEF, { _resistances: hand }, conditions, who) });

describe('the chips', () => {
  it('one a type, in the game\'s order, each in the row of what counts; two that cancel with the resistances', () => {
    const v = view([{ kind: 'resist', type: 'fire' }, { kind: 'immune', type: 'sonic' }], ['soaked']);
    const { resist, vulnerable } = chipsOf(v);
    expect(resist.map((c) => [c.id, c.kind])).toEqual([['fire', null], ['sonic', 'immune']]);
    expect(vulnerable.map((c) => [c.id, c.kind])).toEqual([['lightning', 'vulnerable']]);
    expect(resist[1]).toMatchObject({ name: 'SONIC', icon: 'target' });
    // As the server lists them: the token's conditions, then by hand.
    expect(resist[0].from).toEqual([{ kind: 'vulnerable', from: 'Soaked' }, { kind: 'resist', from: 'the GM, by hand', hand: true }]);
  });

  it('ALL as one chip, first, not one a type; a type with a source of its own a chip too, ALL counted there', () => {
    const v = view([{ kind: 'resist', type: ALL }], ['soaked']);
    const { resist, vulnerable } = chipsOf(v);
    expect(resist.map((c) => [c.id, c.kind])).toEqual([['all', 'resist'], ['fire', null], ['lightning', null]]);
    expect(resist[0]).toMatchObject({ name: 'ALL', from: [{ kind: 'resist', from: 'the GM, by hand', all: true, hand: true }] });
    expect(vulnerable.map((c) => c.id)).toEqual([]);
    expect(chipsOf(view([{ kind: 'vulnerable', type: ALL }])).vulnerable.map((c) => c.id)).toEqual(['all']);
  });

  it('none at all, or nothing sent: no chips', () => {
    expect(chipsOf(view([]))).toEqual({ resist: [], vulnerable: [] });
    expect(chipsOf({ on: true })).toEqual({ resist: [], vulnerable: [] });
  });

  it('the kinds worked out as the server does', () => {
    for (const kinds of [['resist'], ['immune', 'vulnerable'], ['resist', 'vulnerable'], ['vulnerable'], [], ['resist', 'resist']] as const) {
      expect(kindOf([...kinds]), kinds.join()).toBe(serverKindOf([...kinds]));
    }
  });
});

describe('who sees and does what', () => {
  it('VULNERABILITIES: always the GM\'s; a player\'s only where their character has one', () => {
    const gm = view([]);
    expect(showVulnerabilities(gm, [])).toBe(true);
    const player = view([], [], 'vex');
    expect(showVulnerabilities(player, [])).toBe(false);
    expect(showVulnerabilities(player, chipsOf(view([], ['soaked'], 'vex')).vulnerable)).toBe(true);
  });

  it('TAKE OFF BY HAND: the GM any row by hand; a player only theirs; never a chip with no row by hand', () => {
    const v = (who: string | null) => view([{ kind: 'resist', type: 'fire', by: 'vex' }, { kind: 'immune', type: 'sonic' }], ['soaked'], who);
    const chip = (vv: ResistanceView, id: string) => [...chipsOf(vv).resist, ...chipsOf(vv).vulnerable].find((c) => c.id === id)!;
    const gm = v(null);
    expect(mayTakeOff(gm, handRowOf(gm, chip(gm, 'fire')))).toBe(true);
    expect(mayTakeOff(gm, handRowOf(gm, chip(gm, 'sonic')))).toBe(true);
    expect(handRowOf(gm, chip(gm, 'lightning'))).toBeUndefined();
    expect(mayTakeOff(gm, undefined)).toBe(false);
    const vex = v('vex');
    expect(mayTakeOff(vex, handRowOf(vex, chip(vex, 'fire')))).toBe(true);
    expect(mayTakeOff(vex, handRowOf(vex, chip(vex, 'sonic')))).toBe(false);
    const ash = v('ash');
    expect(mayTakeOff(ash, handRowOf(ash, chip(ash, 'fire')))).toBe(false);
    // No sheet: nothing by hand at all.
    expect(mayTakeOff({ ...gm, may: { add: false, vulnerable: false } }, handRowOf(gm, chip(gm, 'fire')))).toBe(false);
    expect(mayTakeOff({ ...gm, may: { add: false, vulnerable: false } }, handRowOf(gm, chip(gm, 'sonic')))).toBe(false);
  });

  it('what may be added: ALL and each type on, but one with a row by hand already', () => {
    const v = view([{ kind: 'resist', type: 'fire' }, { kind: 'immune', type: ALL }]);
    const ids = pickable(v).map((t) => t.id);
    expect(ids[0]).toBe('cold');
    expect(ids).not.toContain('fire');
    expect(ids).not.toContain(ALL);
    expect(ids.at(-1)).toBe('sonic');
    expect(pickable(view([])).map((t) => t.id).slice(0, 2)).toEqual([ALL, 'fire']);
  });

  it('the list sent back: kind and type only, one added or one taken off, who added the rest left to the server', () => {
    const v = view([{ kind: 'resist', type: 'fire', by: 'vex' }, { kind: 'immune', type: 'sonic' }]);
    expect(withAdded(v, 'vulnerable', 'cold')).toEqual([{ kind: 'resist', type: 'fire' }, { kind: 'immune', type: 'sonic' }, { kind: 'vulnerable', type: 'cold' }]);
    expect(withTakenOff(v, 'fire')).toEqual([{ kind: 'immune', type: 'sonic' }]);
    expect(withAdded({ on: true }, 'resist', ALL)).toEqual([{ kind: 'resist', type: ALL }]);
  });
});

describe('in words', () => {
  it('RESIST FIRE, IMMUNE TO ALL, two that cancel; each source with its kind where it differs, ALL where it is', () => {
    const v = view([{ kind: 'resist', type: 'fire' }, { kind: 'immune', type: ALL }], ['soaked']);
    const [all, fire] = chipsOf(v).resist;
    expect(chipWords(all)).toBe('IMMUNE TO ALL');
    expect(chipWords(fire)).toBe('IMMUNE FIRE');
    const lightning = chipsOf(v).resist.find((c) => c.id === 'lightning')!;
    expect(chipWords(lightning)).toBe('IMMUNE LIGHTNING');
    expect(lightning.from.map((s) => sourceWords(lightning, s))).toEqual(['Soaked · VULNERABLE', 'the GM, by hand · ALL']);
    const cancel = chipsOf(view([{ kind: 'resist', type: 'fire' }], ['soaked'])).resist[0];
    expect(chipWords(cancel)).toBe('FIRE: RESIST AND VULNERABLE CANCEL');
    expect(all.from.map((s) => sourceWords(all, s))).toEqual(['the GM, by hand']);
  });
});
