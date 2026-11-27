import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

/**
 * When a character's health runs out (8c1a; approved mockup docs/mockups/rule-library.html, 2026-11-26): the four ways
 * (SAVES COUNTED, ONE FAIL IS DEATH, TURNS LEFT, NO ROLL), the death save and its naturals, the turns going by, being hurt
 * while down and healed back up; checked as strictly as the rest of an untrusted file, and carried beside the system in
 * its file and its zip.
 */

const require_ = createRequire(import.meta.url);
const {
  WAYS, HURT, NATURALS, LIMITS, START, checkDying, dyingRuleOf, startState, afterHealth, aTurn, deathSave, stateOf,
} = require_('../systemBuilder/dying');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const zip = require_('../systemBuilder/citysysZip');
const { versionChanges } = require_('../systemBuilder/versionDiff');

const OWN = {
  format: 1, name: 'Ashfall',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'body', label: 'Body' }, { id: 'wis', label: 'Wisdom' }] }],
};
const problemsOf = (dying, extra = {}) => { const p = []; checkDying({ ...OWN, ...extra, dying }, p); return p.map((x) => `${x.where}: ${x.message}`); };
const ruleOf = (dying) => dyingRuleOf({ ...OWN, dying });
/** Dice that land on these faces, in turn, whatever their size. */
const faces = (sides, ...shown) => { let i = 0; return () => (shown[Math.min(i++, shown.length - 1)] - 0.5) / sides; };
const DND = { word: 'Dying', way: 'count', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, naturals: [{ face: 20, then: 'back_up' }, { face: 1, then: 'two_failures' }], hurt: 'failure' };
const CPR = { word: 'Mortally Wounded', way: 'once', save: { dice: '1d10', way: 'under', target: '@body' }, harder: 1, naturals: [{ face: 10, then: 'dead' }], hurt: 'nothing' };
const CWN = { word: 'Mortally Wounded', way: 'turns', turns: 6, hurt: 'dead' };
const save = (rule, st, shown, extra = {}) => deathSave(rule, st, { definition: OWN, values: { body: 7, wis: 2 }, rng: faces(Number(rule.save.dice.split('d')[1].split(' ')[0]), ...shown), ...extra });

describe('the dying section, checked', () => {
  it('the four presets drawn are fine, as is a section left empty', () => {
    for (const d of [DND, CPR, CWN, { word: 'Taken Out', way: 'none' }, {}]) expect(problemsOf(d)).toEqual([]);
    expect(checkDefinition({ ...OWN, dying: DND }).problems).toEqual([]);
    expect(WAYS).toEqual(['count', 'once', 'turns', 'none']);
    expect(HURT).toEqual(['nothing', 'failure', 'dead']);
    expect(NATURALS).toEqual(['back_up', 'stable', 'two_failures', 'dead']);
  });

  it('refuses what is not part of it, and each key out of its range', () => {
    expect(problemsOf('dying')).toEqual(['dying: Must say what happens when health runs out']);
    expect(problemsOf([])).toEqual(['dying: Must say what happens when health runs out']);
    expect(problemsOf({ stabilize: {} })).toEqual(['dying, stabilize: Not part of dying']);
    expect(problemsOf({ way: 'twice', hurt: 'ouch' })).toEqual(['dying, way: One of count, once, turns, none', 'dying, hurt: One of nothing, failure, dead']);
    for (const key of ['to_live', 'to_die']) {
      expect(problemsOf({ [key]: 0 })).toEqual([`dying, ${key}: A whole number from 1 to ${LIMITS.count}`]);
      expect(problemsOf({ [key]: LIMITS.count + 1 })).toHaveLength(1);
      expect(problemsOf({ [key]: 1.5 })).toHaveLength(1);
      expect(problemsOf({ [key]: LIMITS.count })).toEqual([]);
      expect(problemsOf({ [key]: 1 })).toEqual([]);
    }
    expect(problemsOf({ turns: 0 })).toEqual([`dying, turns: A whole number from 1 to ${LIMITS.turns}`]);
    expect(problemsOf({ turns: LIMITS.turns })).toEqual([]);
    expect(problemsOf({ turns: LIMITS.turns + 1 })).toHaveLength(1);
    expect(problemsOf({ harder: -LIMITS.harder })).toEqual([]);
    expect(problemsOf({ harder: LIMITS.harder })).toEqual([]);
    expect(problemsOf({ harder: LIMITS.harder + 1 })).toEqual([`dying, harder: A whole number from -${LIMITS.harder} to ${LIMITS.harder}`]);
    expect(problemsOf({ harder: '1' })).toHaveLength(1);
  });

  it('the word: as the sheet says it, letters and the like, not too long', () => {
    for (const ok of ['DYING', 'Mortally Wounded', "Death's Door", 'Out-cold 2']) expect(problemsOf({ word: ok })).toEqual([]);
    expect(problemsOf({ word: ' ' })).toEqual(['dying, word: Needs a word, as DYING']);
    expect(problemsOf({ word: 3 })).toEqual(['dying, word: Needs a word, as DYING']);
    expect(problemsOf({ word: '<b>' })).toEqual(['dying, word: Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter']);
    expect(problemsOf({ word: 'x'.repeat(LIMITS.word + 1) })).toEqual([`dying, word: Longer than ${LIMITS.word} characters`]);
    expect(problemsOf({ word: 'x'.repeat(LIMITS.word) })).toEqual([]);
  });

  it('the save: dice to roll, AT LEAST or UNDER, and a number or formula of the system\'s names, never dice', () => {
    expect(problemsOf({ save: { dice: '1d20 + @wis', target: '@body + 2' } })).toEqual([]);
    expect(problemsOf({ save: { target: 12 } })).toEqual([]);
    expect(problemsOf({ save: 'd20' })).toEqual(['dying, save: Must be the dice, the way and the target']);
    expect(problemsOf({ save: { roll: 'd20' } })).toEqual(['dying, save, roll: Only the dice, the way and the target']);
    expect(problemsOf({ save: { way: 'over' } })).toEqual(['dying, save, way: at_least or under']);
    expect(problemsOf({ save: { dice: '10' } })).toEqual(['dying, save, dice: Needs dice to roll, as 1d20']);
    expect(problemsOf({ save: { dice: '' } })).toEqual(['dying, save, dice: Needs dice to roll, as 1d20']);
    expect(problemsOf({ save: { dice: 20 } })).toEqual(['dying, save, dice: Dice, as 1d20']);
    expect(problemsOf({ save: { dice: '1d20 + @luck' } })).toEqual(["dying, save, dice: @luck isn't one of this system's names"]);
    expect(problemsOf({ save: { dice: `1d20${' '.repeat(LIMITS.text)}` } })).toEqual(['dying, save, dice: Dice, as 1d20']);
    expect(problemsOf({ save: { target: '@nope' } })).toEqual(["dying, save, target: @nope isn't one of this system's names"]);
    expect(problemsOf({ save: { target: '1d6' } })).toEqual(['dying, save, target: A number or a formula, not dice']);
    expect(problemsOf({ save: { target: ' ' } })).toEqual(['dying, save, target: Needs a number or a formula to beat']);
    expect(problemsOf({ save: { target: true } })).toEqual(['dying, save, target: A number or a formula']);
  });

  it('naturals: a face the dice can show, once each, doing one of the four', () => {
    expect(problemsOf({ naturals: [{ face: 20, then: 'stable' }, { face: 1, then: 'dead' }] })).toEqual([]);
    expect(problemsOf({ naturals: {} })).toEqual(['dying, naturals: Must be a list']);
    expect(problemsOf({ naturals: [7] })).toEqual(['dying, natural 1: Must be a number and what it does']);
    expect(problemsOf({ naturals: [{ face: 20, then: 'stable', why: 1 }] })).toEqual(['dying, natural 1, why: Only the number and what it does']);
    expect(problemsOf({ naturals: [{ face: 0, then: 'dead' }] })).toEqual([`dying, natural 1, face: A whole number from 1 to ${LIMITS.face}`]);
    expect(problemsOf({ naturals: [{ face: 21, then: 'dead' }] })).toEqual(['dying, natural 1, face: 1d20 never shows 21']);
    expect(problemsOf({ save: { dice: '2d6' }, naturals: [{ face: 12, then: 'dead' }, { face: 13, then: 'dead' }] })).toEqual(['dying, natural 2, face: 2d6 never shows 13']);
    // A count of dice from a name can't be known here, so any face is let be.
    expect(problemsOf({ save: { dice: '@wis d6' }, naturals: [{ face: 40, then: 'dead' }] })).toEqual([]);
    expect(problemsOf({ naturals: [{ face: 20, then: 'dead' }, { face: 20, then: 'stable' }] })).toEqual(['dying, natural 2, face: 20 is already one']);
    expect(problemsOf({ naturals: [{ face: 20, then: 'win' }] })).toEqual(['dying, natural 1, then: One of back_up, stable, two_failures, dead']);
    expect(problemsOf({ naturals: Array.from({ length: LIMITS.naturals + 1 }, (_, i) => ({ face: i + 1, then: 'dead' })) })).toEqual([`dying, naturals: At most ${LIMITS.naturals}`]);
  });

  it('a game with no health has nothing to start it, unless DEATH SAVES is off', () => {
    const none = { core: { health: { model: 'none' } } };
    expect(problemsOf(DND, none)).toEqual(['dying: This game has no health to run out (SETUP: NO HEALTH), so nothing would start it']);
    expect(problemsOf(DND, { ...none, parts: { death: { on: false } } })).toEqual([]);
    expect(problemsOf(DND, { core: { health: { model: 'harm', levels: [] } } })).not.toContain('dying: This game has no health to run out (SETUP: NO HEALTH), so nothing would start it');
  });
});

describe('the rule a game plays by', () => {
  it('none without the section, or with DEATH SAVES off on PARTS', () => {
    expect(dyingRuleOf(OWN)).toBeNull();
    expect(dyingRuleOf({ ...OWN, dying: DND, parts: { death: { on: false } } })).toBeNull();
    expect(dyingRuleOf(null)).toBeNull();
    expect(dyingRuleOf({ ...OWN, dying: 'yes' })).toBeNull();
  });

  it('every key filled in: as written, or as a game starts', () => {
    expect(ruleOf({})).toEqual(START);
    expect(START).toEqual({ word: 'DYING', way: 'count', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, harder: 0, naturals: [], turns: 6, hurt: 'nothing' });
    expect(ruleOf(CPR)).toEqual({ ...START, word: 'MORTALLY WOUNDED', way: 'once', save: { dice: '1d10', way: 'under', target: '@body' }, harder: 1, naturals: [{ face: 10, then: 'dead' }] });
    expect(ruleOf({ save: { target: 12 }, to_live: 0, naturals: [{ face: 0, then: 'dead' }, { face: 3, then: 'dead' }] })).toEqual({ ...START, save: { ...START.save, target: '12' }, naturals: [{ face: 3, then: 'dead' }] });
  });

  it('a state stored read back, or nothing for what isn\'t one', () => {
    expect(stateOf(JSON.stringify({ state: 'dying', saves: 1, fails: 2, made: 0, turns: 3, due: true }))).toEqual({ state: 'dying', saves: 1, fails: 2, made: 0, turns: 3, due: true });
    expect(stateOf({ state: 'stable', saves: -1, fails: 'x' })).toEqual({ state: 'stable', saves: 0, fails: 0, made: 0, turns: 0, due: false });
    expect(stateOf({ state: 'dead', turns: 99999 }).turns).toBe(1000);
    // Due only when stored as due, never from a word that looks like it.
    expect(stateOf({ state: 'dying', due: 'yes' }).due).toBe(false);
    for (const bad of [null, '', '{', 'null', { state: 'asleep' }, []]) expect(stateOf(bad)).toBeNull();
  });
});

describe('health running out, hurt while down, healed back', () => {
  const rule = ruleOf(DND);
  it('down: the word said, the count from nothing', () => {
    expect(afterHealth(rule, null, { wasOut: false, isOut: true, hurt: true })).toEqual({ st: startState(), said: 'DYING' });
    expect(startState()).toEqual({ state: 'dying', saves: 0, fails: 0, made: 0, turns: 0, due: false });
    // Already at 0 with nothing kept (the rule switched on since): a hit starts it, anything else doesn't.
    expect(afterHealth(rule, null, { wasOut: true, isOut: true, hurt: true }).st).toEqual(startState());
    expect(afterHealth(rule, null, { wasOut: true, isOut: true, hurt: false })).toEqual({ st: null, said: null });
    expect(afterHealth(rule, null, { wasOut: false, isOut: false, hurt: true })).toEqual({ st: null, said: null });
  });

  it('healed above 0: all of it cleared, DEAD too', () => {
    for (const state of ['dying', 'stable', 'dead']) {
      expect(afterHealth(rule, { ...startState(), state, fails: 2 }, { wasOut: true, isOut: false, hurt: false })).toEqual({ st: null, said: 'BACK UP' });
    }
    // A heal that leaves them at 0 changes nothing.
    const st = { ...startState(), fails: 1 };
    expect(afterHealth(rule, st, { wasOut: true, isOut: true, hurt: false })).toEqual({ st, said: null });
  });

  it('HURT WHILE DOWN: A FAILURE counts one, and a stable one is dying again; enough and they are dead', () => {
    const one = afterHealth(rule, startState(), { wasOut: true, isOut: true, hurt: true });
    expect(one).toEqual({ st: { ...startState(), fails: 1 }, said: 'HURT WHILE DOWN · A FAILURE · 0 OF 3 SAVES · 1 OF 3 FAILS' });
    expect(afterHealth(rule, { ...startState(), state: 'stable', saves: 3 }, { wasOut: true, isOut: true, hurt: true }).st).toEqual({ ...startState(), saves: 3, fails: 1 });
    expect(afterHealth(rule, { ...startState(), fails: 2 }, { wasOut: true, isOut: true, hurt: true })).toEqual({ st: { ...startState(), fails: 3, state: 'dead' }, said: 'HURT WHILE DOWN · A FAILURE · DEAD' });
    // Where one fail is death, a failure is death.
    expect(afterHealth(ruleOf({ ...CPR, hurt: 'failure' }), startState(), { wasOut: true, isOut: true, hurt: true })).toEqual({ st: { ...startState(), state: 'dead' }, said: 'HURT WHILE DOWN · A FAILURE · DEAD' });
  });

  it('HURT WHILE DOWN: DEAD, NOTHING MORE, and the ways with nothing to count', () => {
    expect(afterHealth(ruleOf(CWN), { ...startState(), state: 'stable' }, { wasOut: true, isOut: true, hurt: true })).toEqual({ st: { ...startState(), state: 'dead' }, said: 'HURT WHILE DOWN · DEAD' });
    const st = { ...startState(), saves: 1 };
    expect(afterHealth(ruleOf(CPR), st, { wasOut: true, isOut: true, hurt: true })).toEqual({ st, said: null });
    expect(afterHealth(ruleOf({ way: 'none', hurt: 'failure' }), st, { wasOut: true, isOut: true, hurt: true })).toEqual({ st, said: null });
    expect(afterHealth(ruleOf({ way: 'none', hurt: 'dead' }), st, { wasOut: true, isOut: true, hurt: true }).said).toBe('HURT WHILE DOWN · DEAD');
    // TURNS LEFT: a failure is a turn gone.
    const turns = ruleOf({ ...CWN, hurt: 'failure', turns: 2 });
    expect(afterHealth(turns, startState(), { wasOut: true, isOut: true, hurt: true })).toEqual({ st: { ...startState(), turns: 1 }, said: 'HURT WHILE DOWN · A TURN GONE · 1 TURN LEFT' });
    expect(afterHealth(turns, { ...startState(), turns: 1 }, { wasOut: true, isOut: true, hurt: true })).toEqual({ st: { ...startState(), turns: 2, state: 'dead' }, said: 'HURT WHILE DOWN · A TURN GONE · DEAD' });
    // The dead are hurt no more.
    const dead = { ...startState(), state: 'dead' };
    expect(afterHealth(rule, dead, { wasOut: true, isOut: true, hurt: true })).toEqual({ st: dead, said: null });
  });
});

describe('a turn going by', () => {
  it('TURNS LEFT runs down to DEAD', () => {
    const rule = ruleOf({ ...CWN, turns: 2 });
    const one = aTurn(rule, startState());
    expect(one).toEqual({ st: { ...startState(), turns: 1 }, said: '1 TURN LEFT' });
    expect(aTurn(ruleOf(CWN), startState()).said).toBe('5 TURNS LEFT');
    expect(aTurn(rule, one.st)).toEqual({ st: { ...startState(), turns: 2, state: 'dead' }, said: 'OUT OF TURNS · DEAD' });
  });

  it('a save comes due where saves are rolled; counted where none are; nothing for the stable, the dead or the well', () => {
    expect(aTurn(ruleOf(DND), startState())).toEqual({ st: { ...startState(), turns: 1, due: true }, said: 'DEATH SAVE' });
    expect(aTurn(ruleOf(CPR), startState()).st.due).toBe(true);
    expect(aTurn(ruleOf({ way: 'none' }), startState())).toEqual({ st: { ...startState(), turns: 1 }, said: null });
    for (const state of ['stable', 'dead']) {
      const st = { ...startState(), state };
      expect(aTurn(ruleOf(CWN), st)).toEqual({ st, said: null });
    }
    expect(aTurn(ruleOf(CWN), null)).toEqual({ st: null, said: null });
  });
});

describe('the death save', () => {
  const dnd = ruleOf(DND);
  it('SAVES COUNTED: a success or a failure each, said with the dice and the target', () => {
    const made = save(dnd, startState(), [14]);
    expect(made).toEqual({ ok: true, st: { ...startState(), saves: 1, turns: 1 }, heal: 0, total: 14, natural: 14, words: 'DEATH SAVE 1d20 [14 = 14] · 10 OR MORE · SUCCESS · 1 OF 3 SAVES · 0 OF 3 FAILS' });
    expect(save(dnd, startState(), [10]).st.saves).toBe(1);
    const missed = save(dnd, startState(), [9]);
    expect(missed.st).toEqual({ ...startState(), fails: 1, turns: 1 });
    expect(missed.words).toBe('DEATH SAVE 1d20 [9 = 9] · 10 OR MORE · FAILURE · 0 OF 3 SAVES · 1 OF 3 FAILS');
  });

  it('SAVES COUNTED: enough successes and they are stable, enough failures and they are dead', () => {
    expect(save(dnd, { ...startState(), saves: 2 }, [12])).toMatchObject({ st: { state: 'stable', saves: 3 }, words: 'DEATH SAVE 1d20 [12 = 12] · 10 OR MORE · SUCCESS · STABLE' });
    expect(save(dnd, { ...startState(), fails: 2 }, [3])).toMatchObject({ st: { state: 'dead', fails: 3 }, words: 'DEATH SAVE 1d20 [3 = 3] · 10 OR MORE · FAILURE · DEAD' });
  });

  it('naturals: back with 1 HP, two failures, stable or dead, before the target is looked at', () => {
    expect(save(dnd, startState(), [20])).toMatchObject({ heal: 1, st: { state: 'dying' }, words: 'DEATH SAVE 1d20 [20 = 20] · 10 OR MORE · NATURAL 20 · BACK WITH 1 HP' });
    expect(save(dnd, startState(), [1])).toMatchObject({ heal: 0, st: { fails: 2, state: 'dying' }, words: 'DEATH SAVE 1d20 [1 = 1] · 10 OR MORE · NATURAL 1 · TWO FAILURES · 0 OF 3 SAVES · 2 OF 3 FAILS' });
    expect(save(dnd, { ...startState(), fails: 1 }, [1])).toMatchObject({ st: { fails: 3, state: 'dead' }, words: 'DEATH SAVE 1d20 [1 = 1] · 10 OR MORE · NATURAL 1 · TWO FAILURES · DEAD' });
    const own = ruleOf({ ...DND, naturals: [{ face: 19, then: 'stable' }, { face: 2, then: 'dead' }] });
    expect(save(own, startState(), [19]).st.state).toBe('stable');
    expect(save(own, startState(), [2]).st.state).toBe('dead');
    expect(save(own, startState(), [2]).words).toBe('DEATH SAVE 1d20 [2 = 2] · 10 OR MORE · NATURAL 2 · DEAD');
    // Where one fail is death, two failures are.
    expect(save(ruleOf({ ...CPR, naturals: [{ face: 1, then: 'two_failures' }] }), startState(), [1])).toMatchObject({ st: { state: 'dead' }, words: 'DEATH SAVE 1d10 [1 = 1] · UNDER 7 · NATURAL 1 · TWO FAILURES · DEAD' });
  });

  it('ONE FAIL IS DEATH: UNDER the character\'s BODY, each save made harder, a miss the end', () => {
    const cpr = ruleOf(CPR);
    const first = save(cpr, startState(), [6]);
    expect(first).toMatchObject({ st: { state: 'dying', made: 1 }, total: 6, words: 'DEATH SAVE 1d10 [6 = 6] · UNDER 7 · HOLDS ON' });
    // The next one adds 1 for the save made: 6 + 1 = 7 is not under 7.
    const second = save(cpr, first.st, [6]);
    expect(second).toMatchObject({ st: { state: 'dead' }, total: 7, words: 'DEATH SAVE 1d10 + 1 [6 + 1 = 7] · UNDER 7 · DEAD' });
    expect(save(cpr, first.st, [5]).st.made).toBe(2);
    expect(save(cpr, startState(), [10]).words).toBe('DEATH SAVE 1d10 [10 = 10] · UNDER 7 · NATURAL 10 · DEAD');
    // Harder the other way, for a game that rolls AT LEAST.
    const at = ruleOf({ ...CPR, save: { dice: '1d10', way: 'at_least', target: '5' }, harder: -2, naturals: [] });
    expect(save(at, { ...startState(), made: 1 }, [6]).words).toBe('DEATH SAVE 1d10 - 2 [6 - 2 = 4] · 5 OR MORE · DEAD');
    // SAVES COUNTED is never made harder.
    expect(save(ruleOf({ ...DND, harder: 5 }), { ...startState(), made: 3 }, [10]).total).toBe(10);
  });

  it('the dice and target as formulas, read on this character', () => {
    const own = ruleOf({ ...DND, save: { dice: '2d6 + @wis', way: 'at_least', target: '@body + 3' }, naturals: [{ face: 12, then: 'stable' }] });
    const made = save(own, startState(), [4, 5]);
    expect(made).toMatchObject({ total: 11, natural: 9, words: 'DEATH SAVE 2d6 + @wis [(4, 5) + 2 = 11] · 10 OR MORE · SUCCESS · 1 OF 3 SAVES · 0 OF 3 FAILS' });
    // The natural is the dice alone, before what is added.
    expect(save(own, startState(), [6, 6]).st.state).toBe('stable');
  });

  it('out of a fight each save is a turn; in one it waits for theirs (the GM\'s needn\'t), and is spent', () => {
    expect(save(dnd, startState(), [14], { inFight: true })).toEqual({ ok: false, error: 'A death save waits for their turn' });
    const due = { ...startState(), turns: 2, due: true };
    expect(save(dnd, due, [14], { inFight: true }).st).toEqual({ ...startState(), turns: 2, saves: 1, due: false });
    expect(save(dnd, startState(), [14], { inFight: true, byGm: true }).ok).toBe(true);
    expect(save(dnd, due, [14]).st.turns).toBe(3);
  });

  it('refused where there is nothing to roll', () => {
    expect(save(dnd, { ...startState(), state: 'stable' }, [14])).toEqual({ ok: false, error: 'Already stable' });
    expect(save(dnd, { ...startState(), state: 'dead' }, [14])).toEqual({ ok: false, error: 'Already dead' });
    expect(save(dnd, null, [14])).toEqual({ ok: false, error: 'Not dying' });
    for (const way of [CWN, { way: 'none' }]) expect(save(ruleOf(way), startState(), [14])).toEqual({ ok: false, error: 'This game has no death saves' });
    expect(deathSave(null, startState(), {})).toEqual({ ok: false, error: 'This game has no death saves' });
  });
});

describe('carried with the system', () => {
  const DEF = { ...OWN, dying: DND };
  it('in its file beside the definition, for a builder from before, and read back unchanged', () => {
    const file = citysys.buildFile({ definition: DEF, version: 2, origin: 'org_ash' });
    expect(file.definition.dying).toBeUndefined();
    expect(file.dying).toEqual(DND);
    const read = citysys.readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.dying).toEqual(DND);
  });

  it('in its zip too, beside a picture (without one a system is the plain file), and said as a change in a new version', () => {
    expect(zip.buildZip({ definition: DEF, version: 3, origin: 'org_ash', root: os.tmpdir() })).toBeNull();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dying-zip-'));
    const bytes = crypto.randomBytes(200);
    const name = `${crypto.createHash('sha256').update(bytes).digest('hex')}.png`;
    fs.mkdirSync(path.join(root, 'condition_icons'));
    fs.writeFileSync(path.join(root, 'condition_icons', name), bytes);
    try {
      const pictured = { ...DEF, damage: { types: { acid: { icon: `/uploads/condition_icons/${name}` } } } };
      const made = zip.buildZip({ definition: pictured, version: 3, origin: 'org_ash', root });
      const read = citysys.readFile(zip.readZip(made.bytes).text);
      expect(read.problems).toEqual([]);
      expect(read.file.definition.dying).toEqual(DND);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
    expect(versionChanges(OWN, DEF)).toContainEqual({ kind: 'other', change: 'changed', id: 'dying' });
    expect(versionChanges(DEF, DEF).filter((c) => c.id === 'dying')).toEqual([]);
  });

  it('a system\'s problems name it, so it can\'t be published with any', () => {
    expect(checkDefinition({ ...OWN, dying: { way: 'twice' } }).problems.map((p) => p.where)).toEqual(['dying, way']);
  });
});
