/**
 * The choices import's reader (choices import 1). Approved mockup choices-import (2026-10-28): a
 * file of options and features read against one of a draft's lists, matched by name, nothing
 * deleted; an empty cell leaves things as they are and `-` clears; a feature found by level too only
 * when its name repeats; a row with a mistake skipped and named by its line, the rest going in; only
 * words, levels, requirements and uses read. Nothing saved: the builder puts the list into the draft.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { readChoicesFile, MAX_BYTES } = require_('../systemBuilder/choicesImport');
const { checkDefinition } = require_('../systemBuilder/definition');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: ['str', 'dex', 'int', 'wis'].map((id) => ({ id, label: id.toUpperCase() })) }],
  derived: [{ id: 'guard', label: 'Guard', formula: '@dex + 10' }],
  rests: { end_of_scene: { on: false }, dawn_prayer: { name: 'Dawn prayer' } },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', description: 'Trained to hold a line.', features: [
        { id: 'second_wind', label: 'Second Wind', at: 1, text: 'Catch your breath.', uses: { count: '1', refill: 'short_rest' } },
        { id: 'guard_stance', label: 'Guard Stance', at: 2, modifiers: [{ target: 'guard', amount: '1' }] },
        { id: 'asi', label: 'Ability Score Improvement', at: 4, text: 'Raise one stat by 2.' },
      ] },
      { id: 'mage', label: 'Mage', description: 'Reads the weave.', requires: '@int >= 13', features: [] },
    ] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [
      { id: 'sailor', label: 'Sailor', features: [{ id: 'sea_legs', label: 'Sea Legs', text: 'Never thrown by a deck.' }] },
    ] },
  ],
};

const read = (text, list = 'classes', definition = HEARTH) => readChoicesFile(definition, list, text);
const optionIn = (r, label) => r.list.options.find((o) => o.label === label);
const featureIn = (r, option, label) => optionIn(r, option).features.filter((f) => f.label === label);
const withList = (r, id = 'classes', definition = HEARTH) => ({ ...definition, choices: definition.choices.map((c) => (c.id === id ? r.list : c)) });

const FILE = (...lines) => lines.join('\n');

describe('a file read against a list', () => {
  it('is a system the builder checks clean', () => {
    expect(checkDefinition(HEARTH).problems).toEqual([]);
  });

  it('adds options and features, ids from their names, a new class\'s level readable in the same file', () => {
    const r = read(FILE(
      '[options]', 'name, description, requires',
      'Ranger, "At home past the last road.", @dex >= 13',
      '[features]', 'option, feature, level, words, uses, refill',
      'Ranger, Favored Foe, 1, "Mark a quarry, and hunt it.", @ranger_level + 1, Long rest',
      'Ranger, Second Wind, 3, Breathe., ,',
    ));
    expect(r.ok).toBe(true);
    expect(r.skipped).toEqual([]);
    expect(optionIn(r, 'Ranger')).toEqual({ id: 'ranger', label: 'Ranger', description: 'At home past the last road.', requires: '@dex >= 13', features: [
      { id: 'favored_foe', label: 'Favored Foe', at: 1, text: 'Mark a quarry, and hunt it.', uses: { count: '@ranger_level + 1', refill: 'long_rest' } },
      // Second Wind is the soldier's id already: ids are one set across the system.
      { id: 'second_wind_2', label: 'Second Wind', at: 3, text: 'Breathe.' },
    ] });
    expect(r.added).toEqual({
      options: [{ line: 3, option: 'Ranger', requires: '@dex >= 13' }],
      features: [
        { line: 6, option: 'Ranger', feature: 'Favored Foe', level: 1, uses: '@ranger_level + 1', refill: 'long_rest' },
        { line: 7, option: 'Ranger', feature: 'Second Wind', level: 3 },
      ],
    });
    expect(r.changes).toBe(3);
    expect(checkDefinition(withList(r)).problems).toEqual([]);
  });

  it('updates what is there by name, whatever the capitals, each part from and to', () => {
    const r = read(FILE(
      '[options]', 'name, description, requires',
      '  mage , "Reads the weave, and bends it.", @int >= 14',
      'SOLDIER, Trained to hold a line., ',
      '[features]', 'option, feature, level, words, uses, refill',
      'soldier, second wind, 5, , @str, dawn PRAYER',
    ));
    expect(r.changed.options).toEqual([{ line: 3, option: 'Mage', parts: [
      { part: 'description', from: 'Reads the weave.', to: 'Reads the weave, and bends it.' },
      { part: 'requires', from: '@int >= 13', to: '@int >= 14' },
    ] }]);
    expect(r.changed.features).toEqual([{ line: 7, option: 'Soldier', feature: 'Second Wind', parts: [
      { part: 'level', from: 1, to: 5 },
      { part: 'uses', from: '1', to: '@str' },
      { part: 'refill', from: 'short_rest', to: 'dawn_prayer' },
    ] }]);
    expect(r.same).toBe(1);
    expect(r.changes).toBe(2);
    // Moved, the option's features kept in level order; the words left as they were.
    expect(optionIn(r, 'Soldier').features.map((f) => [f.id, f.at])).toEqual([['guard_stance', 2], ['asi', 4], ['second_wind', 5]]);
    expect(featureIn(r, 'Soldier', 'Second Wind')[0]).toMatchObject({ text: 'Catch your breath.', uses: { count: '@str', refill: 'dawn_prayer' } });
  });

  it('leaves a part alone for an empty cell and clears it for -', () => {
    const r = read(FILE(
      '[options]', 'name, description, requires',
      'Mage, -, -',
      'Soldier, , ',
      '[features]', 'option, feature, level, words, uses, refill',
      'Soldier, Second Wind, , -, -, ',
      'Soldier, Ability Score Improvement, , , , ',
    ));
    expect(optionIn(r, 'Mage')).toEqual({ id: 'mage', label: 'Mage', features: [] });
    expect(optionIn(r, 'Soldier').description).toBe('Trained to hold a line.');
    expect(featureIn(r, 'Soldier', 'Second Wind')[0]).toEqual({ id: 'second_wind', label: 'Second Wind', at: 1 });
    expect(r.changed.features[0].parts).toEqual([{ part: 'words', from: 'Catch your breath.', to: '' }, { part: 'uses', from: '1', to: '' }]);
    expect(r.same).toBe(2);
  });

  it('clears a refill alone, keeping the uses, and refuses a refill with no uses', () => {
    const r = read(FILE(
      '[features]', 'option, feature, level, words, uses, refill',
      'Soldier, Second Wind, , , , -',
      'Soldier, Guard Stance, , , , Short rest',
      'Mage, Arcane Recovery, 2, , , long_rest',
    ));
    expect(featureIn(r, 'Soldier', 'Second Wind')[0].uses).toEqual({ count: '1' });
    expect(r.changed.features).toEqual([{ line: 3, option: 'Soldier', feature: 'Second Wind', parts: [{ part: 'refill', from: 'short_rest', to: '' }] }]);
    expect(r.skipped).toEqual([
      { line: 4, message: 'Guard Stance: a refill needs uses' },
      { line: 5, message: 'Arcane Recovery: a refill needs uses' },
    ]);
  });

  it('finds a feature by level only when its name repeats, and says when one is added beside another', () => {
    const r = read(FILE(
      '[features]', 'option, feature, level, words, uses, refill',
      'Soldier, Ability Score Improvement, 8, Raise one stat by 2., ,',
      'Soldier, Ability Score Improvement, 4, Raise one stat by 2 or two by 1., ,',
      'Soldier, Ability Score Improvement, , Anything., ,',
    ));
    expect(featureIn(r, 'Soldier', 'Ability Score Improvement').map((f) => [f.id, f.at, f.text])).toEqual([
      ['asi', 4, 'Raise one stat by 2 or two by 1.'],
      ['ability_score_improvement', 8, 'Raise one stat by 2.'],
    ]);
    expect(r.notes).toContainEqual({ line: 3, message: 'Soldier already has Ability Score Improvement at level 4: this one is added beside it, at level 8, not moved' });
    expect(r.skipped).toEqual([{ line: 5, message: 'Ability Score Improvement: Soldier has more than one, so say which level' }]);
  });

  it('finds by level a name the list has twice, even when the file names it once', () => {
    const twice = { ...HEARTH, choices: [{ ...HEARTH.choices[0], options: HEARTH.choices[0].options.map((o) => (o.id === 'soldier'
      ? { ...o, features: [...o.features, { id: 'asi_8', label: 'Ability Score Improvement', at: 8 }] } : o)) }, HEARTH.choices[1]] };
    const r = read(FILE('[features]', 'option, feature, level, words', 'Soldier, Ability Score Improvement, 8, Or a feat.'), 'classes', twice);
    expect(featureIn(r, 'Soldier', 'Ability Score Improvement').map((f) => [f.id, f.at, f.text])).toEqual([['asi', 4, 'Raise one stat by 2.'], ['asi_8', 8, 'Or a feat.']]);
  });

  it('moves a name that is once in the list and once in the file', () => {
    const r = read(FILE('[features]', 'option, feature, level', 'Soldier, Ability Score Improvement, 8'));
    expect(featureIn(r, 'Soldier', 'Ability Score Improvement').map((f) => [f.id, f.at])).toEqual([['asi', 8]]);
    expect(r.notes).toEqual([]);
  });

  it('says nothing of features the same file added side by side', () => {
    const r = read(FILE(
      '[features]', 'option, feature, level, words, uses, refill',
      'Mage, Arcane Tradition, 2, , ,',
      'Mage, Arcane Tradition, 6, , ,',
    ));
    expect(featureIn(r, 'Mage', 'Arcane Tradition').map((f) => f.at)).toEqual([2, 6]);
    expect(r.notes).toEqual([]);
  });

  it('reads the options before the features, wherever they are in the file', () => {
    const r = read(FILE('[features]', 'option, feature, level', 'Bard, Inspiration, 1', '[options]', 'name', 'Bard'));
    expect(r.skipped).toEqual([]);
    expect(featureIn(r, 'Bard', 'Inspiration')).toHaveLength(1);
  });

  it('keeps what a feature also does, and says so', () => {
    const r = read(FILE('[features]', 'option, feature, level, words', 'Soldier, Guard Stance, 2, Plant your feet.'));
    expect(featureIn(r, 'Soldier', 'Guard Stance')[0]).toEqual({ id: 'guard_stance', label: 'Guard Stance', at: 2, text: 'Plant your feet.', modifiers: [{ target: 'guard', amount: '1' }] });
    expect(r.notes).toEqual([{ line: 3, message: 'Soldier · Guard Stance keeps its modifiers, set in the builder' }]);
  });

  it('reads a list that isn\'t levelled without levels, and says the column is ignored', () => {
    const r = read(FILE(
      '[options]', 'name, description',
      'Acolyte, Raised in a temple.',
      '[features]', 'option, feature, level, words, uses, refill',
      'Acolyte, Shelter of the Faithful, 3, Temples take you in., 1, Long rest',
      'Sailor, Sea Legs, 9, Never thrown by a moving deck., ,',
    ), 'backgrounds');
    expect(r.notes).toEqual([{ line: 5, message: 'BACKGROUNDS isn\'t levelled, so the level column is ignored' }]);
    expect(featureIn(r, 'Acolyte', 'Shelter of the Faithful')[0]).toEqual({ id: 'shelter_of_the_faithful', label: 'Shelter of the Faithful', text: 'Temples take you in.', uses: { count: '1', refill: 'long_rest' } });
    expect(r.changed.features).toEqual([{ line: 7, option: 'Sailor', feature: 'Sea Legs', parts: [{ part: 'words', from: 'Never thrown by a deck.', to: 'Never thrown by a moving deck.' }] }]);
    expect(checkDefinition(withList(r, 'backgrounds')).problems).toEqual([]);
  });

  it('takes a rest by its name or its id, one turned off by its id', () => {
    const r = read(FILE('[features]', 'option, feature, uses, refill', 'Mage, A, 1, Short rest', 'Mage, B, 1, LONG_REST', 'Mage, C, 1, end_of_scene', 'Mage, D, 1, End of scene'));
    expect(optionIn(r, 'Mage').features.map((f) => f.uses.refill)).toEqual(['short_rest', 'long_rest', 'end_of_scene']);
    expect(r.skipped).toEqual([{ line: 6, message: 'D: refill: "End of scene" isn\'t one of this system\'s rests (Short rest, Long rest, End of session, Dawn prayer)' }]);
  });
});

describe('a line with a mistake is skipped, named by its line, and the rest goes in', () => {
  it('names each mistake', () => {
    const long = 'x'.repeat(41);
    const r = read(FILE(
      'Orphan, row',
      '[options]', 'name, description, requires',
      'Bard, Sings., @chr >= 13',
      'Knight, Sworn., @str >= (',
      `${long}, Too long.,`,
      '-, Nameless.,',
      `Monk, ${'w'.repeat(1001)},`,
      '[features]', 'option, feature, level, words, uses, refill',
      'Paladin, Lay on Hands, 1, Heal., 5, Long rest',
      'Mage, Spell, 0, , ,',
      'Mage, Spell, 31, , ,',
      'Mage, Spell, two, , ,',
      'Mage, Spell, 1, , @wiz,',
      'Mage, Spell, 1, , 1, Dawn',
      'Mage, , 1, , ,',
      'Mage, "Spell, 1',
      'Mage, Spellbook, 1, Your spells., ,',
    ));
    expect(r.skipped).toEqual([
      { line: 1, message: 'Before [options] or [features], so nothing knows what it is' },
      { line: 4, message: 'Bard: requires: @chr isn\'t one of this system\'s names' },
      { line: 5, message: expect.stringMatching(/^Knight: requires: .+/) },
      { line: 6, message: `${'x'.repeat(20)}…: a name is 40 characters at most` },
      { line: 7, message: 'No name' },
      { line: 8, message: 'Monk: the description is longer than 1000 characters' },
      { line: 11, message: 'Paladin: no option of that name in CLASSES or in [options]' },
      { line: 12, message: 'Spell: level: a whole number from 1 to 30' },
      { line: 13, message: 'Spell: level: a whole number from 1 to 30' },
      { line: 14, message: 'Spell: level: a whole number from 1 to 30' },
      { line: 15, message: 'Spell: uses: @wiz isn\'t one of this system\'s names' },
      { line: 16, message: 'Spell: refill: "Dawn" isn\'t one of this system\'s rests (Short rest, Long rest, End of session, Dawn prayer)' },
      { line: 17, message: 'Needs an option and a feature' },
      { line: 18, message: 'A quote is opened and never closed' },
    ]);
    expect(r.list.options.map((o) => o.label)).toEqual(['Soldier', 'Mage']);
    expect(featureIn(r, 'Mage', 'Spellbook')).toHaveLength(1);
    expect(r.changes).toBe(1);
  });

  it('skips a part it doesn\'t read once, and a part without its columns', () => {
    const r = read(FILE(
      '[spells]', 'name, level', 'Fire Bolt, 0',
      '[options]', 'description', 'Nobody.',
      '[features]', 'option, feature, cost', 'Mage, Spellbook, 3',
    ));
    expect(r.skipped).toEqual([
      { line: 1, message: '[spells] isn\'t read here: a file has [options] and [features]' },
      { line: 5, message: '[options] needs a name column: its first line names the columns (name, description, requires)' },
    ]);
    expect(r.notes).toEqual([{ line: 8, message: 'The cost column isn\'t read: only option, feature, level, words, uses, refill' }]);
    expect(featureIn(r, 'Mage', 'Spellbook')).toHaveLength(1);
  });

  it('won\'t guess between two options of one name', () => {
    const twins = { ...HEARTH, choices: [{ ...HEARTH.choices[0], options: [...HEARTH.choices[0].options, { id: 'mage_2', label: 'MAGE', features: [] }] }, HEARTH.choices[1]] };
    const r = read(FILE('[options]', 'name, description', 'Mage, Two of them.', '[features]', 'option, feature', 'mage, Spellbook'), 'classes', twins);
    expect(r.skipped).toEqual([
      { line: 3, message: 'Mage: CLASSES has 2 options called that; rename one in the builder first' },
      { line: 6, message: 'mage: CLASSES has 2 options called that; rename one in the builder first' },
    ]);
  });

  it('holds the list\'s limits', () => {
    const full = { ...HEARTH, choices: [{ ...HEARTH.choices[0], options: [
      ...HEARTH.choices[0].options,
      ...Array.from({ length: 98 }, (_, i) => ({ id: `o${i}`, label: `O${i}`, features: i ? [] : Array.from({ length: 40 }, (__, j) => ({ id: `f${j}`, label: `F${j}`, at: 1 })) })),
    ] }, HEARTH.choices[1]] };
    const r = read(FILE('[options]', 'name', 'Ranger', '[features]', 'option, feature', 'O0, One more'), 'classes', full);
    expect(r.skipped).toEqual([
      { line: 3, message: 'Ranger: CLASSES has 100 options, the most a list holds' },
      { line: 6, message: 'One more: O0 has 40 features, the most an option holds' },
    ]);
  });
});

describe('what it reads', () => {
  it('reads quotes, semicolons, tabs and a byte-order mark as the catalogue import does', () => {
    const semis = read('﻿[options]\nname; description\nBard; "Songs; stories, and nerve."\n');
    expect(optionIn(semis, 'Bard').description).toBe('Songs; stories, and nerve.');
    const tabs = read('[options]\nname\tdescription\nBard\tSongs, stories.\n');
    expect(optionIn(tabs, 'Bard').description).toBe('Songs, stories.');
    const quotes = read('[options]\r\nname, description\r\nBard, "He said ""sing""."\r\n');
    expect(optionIn(quotes, 'Bard').description).toBe('He said "sing".');
  });

  it('refuses no list, nothing, and too much, and changes nothing it was given', () => {
    const before = JSON.parse(JSON.stringify(HEARTH));
    expect(read('[options]\nname\nBard', 'spells')).toEqual({ ok: false, error: 'No such list' });
    expect(read('   ')).toEqual({ ok: false, error: 'Nothing to read' });
    expect(read(undefined)).toEqual({ ok: false, error: 'Nothing to read' });
    expect(read(`[options]\nname\n${'a'.repeat(MAX_BYTES)}`)).toEqual({ ok: false, error: 'That is more than 200 KB. Split it into smaller files.' });
    read(FILE('[options]', 'name, description', 'Mage, -', '[features]', 'option, feature, level, uses', 'Soldier, Second Wind, 3, -'));
    expect(HEARTH).toEqual(before);
  });

  it('counts nothing for a file that changes nothing', () => {
    const r = read(FILE('# Just notes', '[options]', 'name, description', 'Soldier, Trained to hold a line.'));
    expect(r).toMatchObject({ changes: 0, same: 1, skipped: [], notes: [] });
  });
});

describe('the route', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
  const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    const db = await makeTestDb();
    app = express();
    app.use(express.json());
    app.use('/api/systems', systemsRoute(db));
  });
  afterEach(() => elevatedUsers.delete('ghost'));
  const post = (body, token = GM) => request(app).post('/api/systems/import-choices').set({ Authorization: `Bearer ${token}` }).send(body);

  it('reads the draft as sent', async () => {
    const res = await post({ definition: HEARTH, list: 'classes', text: '[options]\nname\nBard' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changes: 1, added: { options: [{ line: 3, option: 'Bard' }] } });
    expect(res.body.ok).toBeUndefined();
    expect(res.body.list.options.map((o) => o.id)).toEqual(['soldier', 'mage', 'bard']);
  });

  it('refuses what can\'t be read, and is the main admin\'s alone', async () => {
    expect(await post({ definition: HEARTH, list: 'spells', text: 'x' })).toMatchObject({ status: 400, body: { error: 'No such list' } });
    expect(await post({ definition: 'nope', list: 'classes', text: 'x' })).toMatchObject({ status: 400, body: { error: 'A system definition must be an object' } });
    expect((await post({ definition: HEARTH, list: 'classes', text: 'x' }, EDITOR)).status).toBe(403);
    expect((await post({ definition: HEARTH, list: 'classes', text: 'x' }, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/import-choices').send({ definition: HEARTH })).status).toBe(401);
  });
});
