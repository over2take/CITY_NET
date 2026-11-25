import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  LIMITS, KINDS, MEANS, STANDARD, damageList, damageCount, withDamageType, withNewDamageType, withoutDamageType,
  meaningsOf, meaningTyped, withMeaning, nameTrouble,
  WORKS_OUT, WORKS_OUT_START, APPLY, worksOutOf, withWorksOut, workOutOf, withWorkOut, applyOf, withApply, unpublishedOf,
} from '../damageTypes';
import { BLANK_DRAWN, withSquare } from '../drawings';
import type { Definition } from '../systemsApi';

/**
 * The builder's DAMAGE TYPES page as logic (8b1b). Approved mockup damage-pipeline (2026-11-23): the starter set renamed,
 * switched off or added to, a picture each, what the three words mean; every edit held to the server's own checks (backend
 * damageTypes.js), and a name's trouble said as the server says it.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/damageTypes.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const BLANK: Definition = { format: 1, name: 'Hearth' };
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const made = (r: { definition: Definition } | null): { definition: Definition; id: string } => { if (!r) throw new Error('not made'); return r as { definition: Definition; id: string }; };
const DRAWN = withSquare(BLANK_DRAWN, 3, 3, true);
const type = (def: Definition, id: string) => damageList(def).find((t) => t.id === id)!;

describe('as the server has them', () => {
  it('the starter set, the limits and the app\'s words', () => {
    expect(STANDARD).toEqual(backend.STANDARD);
    expect(LIMITS).toEqual(backend.LIMITS);
    expect(KINDS).toEqual(backend.KINDS);
    expect(MEANS).toEqual(backend.MEANS);
  });

  it('listed: every starter one with whether it is on, then its own; those on as the server gives them', () => {
    const def = made(withNewDamageType(withDamageType(withDamageType(BLANK, 'fire', { name: 'Flame' }), 'physical', { on: true }))).definition;
    const list = damageList(def);
    expect(list.map((t) => [t.id, t.on])).toEqual([...STANDARD.map((s) => [s.id, s.id === 'physical' ? true : s.on !== false]), ['new_type', true]]);
    const on = list.filter((t) => t.on).map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'on')));
    expect(on).toEqual(backend.damageTypesOf(def));
    expect(problems(def)).toEqual([]);
  });
});

describe('a type changed', () => {
  it('a starter one stores only what differs, and back to the starter, nothing', () => {
    let def = withDamageType(BLANK, 'fire', { name: 'Flame', description: 'Hot.', icon: 'wave' });
    expect(def.damage).toEqual({ types: { fire: { name: 'Flame', description: 'Hot.', icon: 'wave' } } });
    def = withDamageType(def, 'fire', { name: 'Fire', description: 'Burns.', icon: 'flame' });
    expect(def).toEqual(BLANK);
    // A name or icon left blank keeps the starter's; a description emptied on purpose is kept.
    expect(withDamageType(BLANK, 'fire', { name: '  ', icon: '' }).damage).toBeUndefined();
    expect(withDamageType(BLANK, 'fire', { description: '' }).damage).toEqual({ types: { fire: { description: '' } } });
  });

  it('switched off or on: only where it differs from how it starts', () => {
    expect(withDamageType(BLANK, 'fire', { on: false }).damage).toEqual({ types: { fire: { on: false } } });
    expect(withDamageType(withDamageType(BLANK, 'fire', { on: false }), 'fire', { on: true })).toEqual(BLANK);
    // PHYSICAL starts off.
    expect(withDamageType(BLANK, 'physical', { on: true }).damage).toEqual({ types: { physical: { on: true } } });
    expect(withDamageType(withDamageType(BLANK, 'physical', { on: true }), 'physical', { on: false })).toEqual(BLANK);
    expect(type(withDamageType(BLANK, 'physical', { on: true }), 'physical').on).toBe(true);
  });

  it('an icon and a drawing are one picture: setting one takes the other off', () => {
    const drawn = withDamageType(withDamageType(BLANK, 'fire', { icon: 'wave' }), 'fire', { drawn: DRAWN });
    expect(drawn.damage).toEqual({ types: { fire: { drawn: DRAWN } } });
    expect(type(drawn, 'fire')).toMatchObject({ drawn: DRAWN });
    expect(type(drawn, 'fire').icon).toBeUndefined();
    const back = withDamageType(drawn, 'fire', { icon: 'blade' });
    expect(back.damage).toEqual({ types: { fire: { icon: 'blade' } } });
    expect(problems(drawn)).toEqual([]);
    expect(problems(back)).toEqual([]);
  });

  it('one of its own keeps its name as typed, blank a problem to fix; its words and icon only when said', () => {
    const { definition, id } = made(withNewDamageType(BLANK));
    expect(id).toBe('new_type');
    expect(definition.damage).toEqual({ types: { new_type: { name: 'New type' } } });
    const blank = withDamageType(definition, id, { name: '', on: false, description: '', icon: '' });
    expect(blank.damage).toEqual({ types: { new_type: { name: '' } } });
    expect(problems(blank)).toEqual(['damage type new_type, name: Needs a name']);
    expect(type(blank, id)).toMatchObject({ name: '', icon: 'target', on: true, standard: false });
    expect(type(withDamageType(definition, id, { icon: 'wave', description: 'Loud.' }), id)).toMatchObject({ icon: 'wave', description: 'Loud.' });
  });
});

describe('+ TYPE and DELETE', () => {
  it('a new one named to be renamed, never a name already on; at 40, none', () => {
    const one = made(withNewDamageType(BLANK));
    const two = made(withNewDamageType(one.definition));
    expect(two.id).toBe('new_type_2');
    expect(type(two.definition, two.id).name).toBe('New type 2');
    expect(problems(two.definition)).toEqual([]);
    let def = two.definition;
    while (damageCount(def) < LIMITS.types) def = made(withNewDamageType(def)).definition;
    expect(damageCount(def)).toBe(LIMITS.types);
    expect(problems(def)).toEqual([]);
    expect(withNewDamageType(def)).toBeNull();
  });

  it('one of its own deleted, and nothing left behind; a starter one only switched off', () => {
    const { definition, id } = made(withNewDamageType(BLANK));
    expect(withoutDamageType(definition, id)).toEqual(BLANK);
    expect(withoutDamageType(BLANK, 'fire')).toBe(BLANK);
    // The rest of damage kept.
    const meant = withMeaning(definition, 'resist', 'Half.');
    expect(withoutDamageType(meant, id).damage).toEqual({ resist: { means: 'Half.' } });
  });
});

describe('what each word means', () => {
  it('the system\'s words or the app\'s, as the server reads them; blank or the app\'s own stores nothing', () => {
    expect(meaningsOf(BLANK)).toEqual(backend.meaningsOf(BLANK));
    const def = withMeaning(BLANK, 'resist', 'Takes half.');
    expect(def.damage).toEqual({ resist: { means: 'Takes half.' } });
    expect(meaningsOf(def)).toEqual(backend.meaningsOf(def));
    expect(meaningTyped(def, 'resist')).toBe('Takes half.');
    expect(meaningTyped(def, 'immune')).toBe('');
    expect(withMeaning(def, 'resist', '  ')).toEqual(BLANK);
    expect(withMeaning(def, 'resist', MEANS.resist)).toEqual(BLANK);
    expect(problems(def)).toEqual([]);
  });
});

describe('a name\'s trouble, as the server says it', () => {
  const said = (def: Definition, id: string) => problems(def).filter((p) => p.startsWith(`damage type ${id}, name: `)).map((p) => p.replace(/^.*?name: /, ''))[0] ?? null;
  it('blank, bad letters, DMG, the same as another on; fine otherwise', () => {
    const own = made(withNewDamageType(BLANK));
    const cases: Definition[] = [
      own.definition,
      withDamageType(own.definition, own.id, { name: '' }),
      withDamageType(own.definition, own.id, { name: 'Fire+Ice' }),
      withDamageType(own.definition, own.id, { name: 'dmg' }),
      withDamageType(own.definition, own.id, { name: 'fire' }),
      withDamageType(own.definition, own.id, { name: 'Kinetic' }),
      withDamageType(withDamageType(own.definition, own.id, { name: 'Kinetic' }), 'kinetic', { on: true }),
    ];
    for (const def of cases) expect(nameTrouble(def, own.id)).toBe(said(def, own.id));
    expect(cases.map((def) => nameTrouble(def, own.id))).toEqual([
      null, 'Needs a name', 'Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter', 'DMG is the word after a hit, so not a type\'s name',
      'FIRE is already the name of damage type fire; a hit names its type, so each needs its own', null,
      'KINETIC is already the name of damage type kinetic; a hit names its type, so each needs its own',
    ]);
    // The first of the two is told too (the server names only the second); a type off isn't checked against the rest;
    // nothing for no type.
    expect(nameTrouble(cases[4], 'fire')).toBe('FIRE is also the name of damage type new_type; a hit names its type, so each needs its own');
    const fireOff = withDamageType(cases[4], 'fire', { on: false });
    expect(nameTrouble(fireOff, own.id)).toBeNull();
    expect(nameTrouble(fireOff, 'fire')).toBeNull();
    expect(problems(fireOff)).toEqual([]);
    // A type that is off is never in trouble for its name, even with two on sharing it.
    const offToo = withDamageType(cases[4], 'physical', { name: 'Fire' });
    expect(nameTrouble(offToo, 'physical')).toBeNull();
    expect(said(offToo, 'physical')).toBeNull();
    // Spacing inside a name counts as one space, as the server reads it.
    const spaced = withDamageType(withDamageType(own.definition, 'cold', { name: 'Hell Fire' }), own.id, { name: 'hell  fire' });
    expect(nameTrouble(spaced, own.id)).toBe(said(spaced, own.id));
    expect(nameTrouble(spaced, own.id)).toMatch(/^HELL {2}FIRE is already the name of damage type cold/);
    expect(nameTrouble(BLANK, 'nothing')).toBeNull();
  });
});

describe('what a hit does (8b5b)', () => {
  it('the same words and starts as the server', () => {
    expect(WORKS_OUT).toEqual(backend.WORKS_OUT);
    expect(APPLY).toEqual(backend.APPLY);
    expect(KINDS.map((k) => worksOutOf(BLANK, k))).toEqual(KINDS.map((k) => backend.worksOutOf(BLANK)[k]));
    expect(WORKS_OUT_START).toEqual(backend.worksOutOf(BLANK));
  });

  it('WORKS OUT AS set, its start storing nothing; read back as the server reads it; the words kept beside it', () => {
    const words = withWorksOut(withMeaning(BLANK, 'resist', 'Half.'), 'resist', 'words');
    expect(words.damage).toEqual({ resist: { means: 'Half.', works_out: 'words' } });
    expect(worksOutOf(words, 'resist')).toBe('words');
    expect(backend.worksOutOf(words).resist).toBe('words');
    expect(problems(words)).toEqual([]);
    // Its words blanked: what it works out as stays (it was lost with them before 8b5b).
    expect(withMeaning(words, 'resist', '').damage).toEqual({ resist: { works_out: 'words' } });
    expect(withMeaning(words, 'resist', MEANS.resist).damage).toEqual({ resist: { works_out: 'words' } });
    // Back to its start: nothing, and nothing at all once the words go too.
    expect(withWorksOut(words, 'resist', 'half').damage).toEqual({ resist: { means: 'Half.' } });
    expect(withWorksOut(withMeaning(words, 'resist', ''), 'resist', 'half').damage).toBeUndefined();
    expect(withWorksOut(BLANK, 'immune', 'none')).toEqual(BLANK);
    // An ill-formed one read as its start.
    expect(worksOutOf({ ...BLANK, damage: { vulnerable: { works_out: 'triple' } } }, 'vulnerable')).toBe('double');
    expect(worksOutOf({ ...BLANK, damage: { vulnerable: 'double' } }, 'vulnerable')).toBe('double');
  });

  it('WORK IT OUT and APPLY DAMAGE: on and CONFIRM to start, storing nothing; the others kept as the server reads them', () => {
    expect(workOutOf(BLANK)).toBe(true);
    expect(applyOf(BLANK)).toBe('confirm');
    const set = withApply(withWorkOut(BLANK, false), 'off');
    expect(set.damage).toEqual({ work_out: false, apply: 'off' });
    expect(backend.damageRulesOf(set)).toEqual({ apply: 'off', workOut: false });
    expect(workOutOf(set)).toBe(false);
    expect(applyOf(set)).toBe('off');
    expect(problems(set)).toEqual([]);
    expect(withApply(withWorkOut(set, true), 'confirm')).toEqual(BLANK);
    expect(applyOf({ ...BLANK, damage: { apply: 'later' } })).toBe('confirm');
    expect(withApply(BLANK, 'auto').damage).toEqual({ apply: 'auto' });
  });

  it('NOT PUBLISHED: what the table still uses where the draft differs; nothing where they agree or it was never published', () => {
    const published = withApply(BLANK, 'auto');
    expect(unpublishedOf(withWorkOut(BLANK, false), published)).toEqual({
      apply: 'NOT PUBLISHED: the table still uses AUTO',
      workOut: 'NOT PUBLISHED: the table still works them out',
    });
    expect(unpublishedOf(BLANK, withWorkOut(published, false))).toEqual({
      apply: 'NOT PUBLISHED: the table still uses AUTO',
      workOut: 'NOT PUBLISHED: the table still takes every hit as rolled',
    });
    expect(unpublishedOf(published, published)).toEqual({});
    expect(unpublishedOf(withApply(BLANK, 'off'), null)).toEqual({});
    expect(unpublishedOf(withApply(BLANK, 'off'), undefined)).toEqual({});
  });
});
