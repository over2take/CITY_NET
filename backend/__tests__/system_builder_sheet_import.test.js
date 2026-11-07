/**
 * A custom system's sheet brought in through IMPORT (4h2a; approved mockup
 * docs/mockups/sheet-import.html, 2026-10-13): the importer and JSON template made from the
 * system's own sheet. Every field a player fills in, by id or label; worked-out values, what lives
 * elsewhere and GM-only fields left out and said; a choice one of its options; the inventory as
 * lines or a list.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { INVENTORY, sheetFields, pickLines, withImportedPicks, customImporter, jsonTemplate } = require_('../systemBuilder/sheetImport');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'might', label: 'Might', min: 3, max: 20 }, { id: 'luck', label: 'Luck', min: 0 }, { id: 'grit', label: 'Grit', max: 5 }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @might' }],
  sheet: {
    tabs: ['MAIN', 'GEAR'],
    sections: [
      { id: 'who', label: 'IDENTITY', tab: 'MAIN', layout: 'list', fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'calling', label: 'Calling', type: 'select', options: [{ value: 'knight', label: 'Knight' }, { value: 'hedge', label: 'Hedge mage' }, { label: 'Bard' }] },
        { id: 'background', label: 'Background', type: 'textarea' },
      ] },
      { id: 'attrs', label: 'ATTRIBUTES', tab: 'MAIN', layout: 'grid', fields: [
        { id: 'might', label: 'Might', type: 'number' }, { id: 'luck', label: 'Luck', type: 'number' }, { id: 'grit', label: 'Grit', type: 'number' },
        { id: 'speed', label: '', type: 'number' },
        { id: 'nickname', label: 'Nickname' },
        // Its label is another field's id: the id wins.
        { id: 'fortune', label: 'Might', type: 'number' },
        { id: 'defense', label: 'Defense', type: 'number' },
      ] },
      { id: 'health', label: 'HEALTH', tab: 'MAIN', layout: 'list', fields: [{ id: 'hp', label: 'HP', type: 'number', source: 'token_hp' }] },
      { id: 'gear', label: 'GEAR', tab: 'GEAR', layout: 'inventory', fields: [] },
      { id: 'more_gear', label: 'MORE GEAR', tab: 'GEAR', layout: 'inventory', fields: [] },
      { id: 'money', label: 'MONEY', tab: 'GEAR', layout: 'list', fields: [{ id: 'cash', label: 'Gold', type: 'number', source: 'bank_balance' }] },
      { id: 'gm', label: 'GM', layout: 'notes', fields: [{ id: 'wound_notes', label: 'Wound notes', type: 'textarea', edit: 'gm' }, { id: 'wound', label: 'Wound', type: 'text' }] },
    ],
  },
};

describe('what the form asks for', () => {
  it('every field a player fills in, in order, with tabs, sections, choices and ranges', () => {
    const { ask } = sheetFields(HEARTH);
    expect(ask).toEqual([
      { id: 'name', label: 'Name', type: 'text', tab: 'MAIN', section: 'IDENTITY' },
      { id: 'calling', label: 'Calling', type: 'select', tab: 'MAIN', section: 'IDENTITY', options: [{ value: 'knight', label: 'Knight' }, { value: 'hedge', label: 'Hedge mage' }, { value: 'Bard', label: 'Bard' }] },
      { id: 'background', label: 'Background', type: 'textarea', tab: 'MAIN', section: 'IDENTITY' },
      { id: 'might', label: 'Might', type: 'number', tab: 'MAIN', section: 'ATTRIBUTES', min: 3, max: 20 },
      { id: 'luck', label: 'Luck', type: 'number', tab: 'MAIN', section: 'ATTRIBUTES', min: 0 },
      { id: 'grit', label: 'Grit', type: 'number', tab: 'MAIN', section: 'ATTRIBUTES', max: 5 },
      { id: 'speed', label: 'speed', type: 'number', tab: 'MAIN', section: 'ATTRIBUTES' },
      { id: 'nickname', label: 'Nickname', type: 'text', tab: 'MAIN', section: 'ATTRIBUTES' },
      { id: 'fortune', label: 'Might', type: 'number', tab: 'MAIN', section: 'ATTRIBUTES' },
      { id: INVENTORY, label: 'Inventory', type: 'inventory', tab: 'GEAR', section: 'GEAR' },
      { id: 'wound', label: 'Wound', type: 'text', tab: null, section: 'GM' },
    ]);
  });

  it('leaves out worked-out values, what lives elsewhere and GM-only fields, and says why', () => {
    expect(sheetFields(HEARTH).left).toEqual([
      { id: 'defense', label: 'Defense', why: 'worked_out' },
      { id: 'hp', label: 'HP', why: 'elsewhere' },
      { id: 'cash', label: 'Gold', why: 'elsewhere' },
      { id: 'wound_notes', label: 'Wound notes', why: 'gm_only' },
    ]);
  });

  it('reads a system with no sheet of its own off the starter sheet', () => {
    const { ask, left } = sheetFields({ format: 1, name: 'Bare' });
    expect(ask.map((f) => f.id)).toEqual(expect.arrayContaining(['name', INVENTORY, 'notes']));
    expect(left.map((f) => f.why)).toContain('elsewhere');
  });
});

describe('the importer', () => {
  const { mapFields, parseText } = customImporter(HEARTH);

  it('takes each field by its id or its label, in any case and spacing', () => {
    expect(mapFields({ fortune: 3 }).mapped).toEqual({ fortune: 3 });
    expect(mapFields({ name: 'Vex Marrow', MIGHT: '14', 'Back ground': 'Raised by wolves', luck: 2 })).toEqual({
      mapped: { name: 'Vex Marrow', might: 14, background: 'Raised by wolves', luck: 2 },
      unmapped: {}, skipped: {}, workedOut: {}, gmOnly: {}, notAChoice: {},
    });
  });

  it('takes a choice by its value or its label, and says when it is none of them', () => {
    expect(mapFields({ calling: 'Hedge Mage' }).mapped).toEqual({ calling: 'hedge' });
    expect(mapFields({ calling: 'knight' }).mapped).toEqual({ calling: 'knight' });
    expect(mapFields({ calling: 'hedge' }).mapped).toEqual({ calling: 'hedge' });
    expect(mapFields({ calling: 'bard' }).mapped).toEqual({ calling: 'Bard' });
    expect(mapFields({ Calling: 'Paladin' })).toMatchObject({ mapped: {}, notAChoice: { Calling: 'Paladin' } });
  });

  it('says what it left: worked out, kept elsewhere, GM-only, and not on this sheet', () => {
    expect(mapFields({ Defense: 18, HP: 12, gold: 40, 'wound notes': 'Arm', 'Favourite colour': 'Teal', might: 'lots', luck: true })).toEqual({
      mapped: {},
      unmapped: { 'Favourite colour': 'Teal', might: 'lots', luck: true },
      skipped: { HP: 12, gold: 40 },
      workedOut: { Defense: 18 },
      gmOnly: { 'wound notes': 'Arm' },
      notAChoice: {},
    });
  });

  it('skips what is blank, and reads nothing from what isn\'t an object', () => {
    expect(mapFields({ name: '', might: null, luck: undefined }).mapped).toEqual({});
    expect(mapFields(null).mapped).toEqual({});
    expect(mapFields(['name']).mapped).toEqual({});
  });

  it('reads the inventory as lines or as a list, leaving out blank rows and an empty one', () => {
    expect(JSON.parse(mapFields({ inventory: '2x Rope, Lantern' }).mapped.inventory).map((i) => [i.name, i.qty])).toEqual([['Rope', 2], ['Lantern', 1]]);
    expect(JSON.parse(mapFields({ Inventory: [{ name: 'Rope', qty: 2 }, { name: ' ', qty: 1 }, 'junk'] }).mapped.inventory)).toEqual([{ name: 'Rope', qty: 2 }]);
    expect(mapFields({ inventory: [] }).mapped).toEqual({});
    expect(mapFields({ inventory: '  ' }).mapped).toEqual({});
  });

  it('gathers the PDF form\'s numbered inventory lines, in order, unless the inventory came whole', () => {
    const lines = { inventory_10_name: 'Rations', inventory_10_qty: '3', inventory_2_name: 'Rope', inventory_2_qty: 'x', inventory_3_qty: '4' };
    expect(JSON.parse(mapFields(lines).mapped.inventory)).toEqual([{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }]);
    expect(mapFields({ ...lines, inventory: 'Lantern' }).mapped.inventory).toBe(JSON.stringify([{ name: 'Lantern', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' }]));
    expect(mapFields({ inventory_3_qty: '4' }).mapped).toEqual({});
    expect(mapFields({ inventory_3_qty: '4' }).unmapped).toEqual({});
  });
  it('unwraps its own JSON template once filled in, and reads any other object as it is', () => {
    const filled = jsonTemplate(HEARTH, { name: 'Hearth', version: 3 });
    filled.fields.name = 'Vex';
    filled.fields.might = 14;
    filled.fields.calling = 'Knight';
    filled.fields.inventory = [{ name: 'Rope', qty: 1 }];
    expect(mapFields(filled).mapped).toMatchObject({ name: 'Vex', might: 14, calling: 'knight', inventory: JSON.stringify([{ name: 'Rope', qty: 1 }]) });
    // A sheet with a field of its own called "fields" is not a template.
    expect(mapFields({ fields: { name: 'Vex' }, name: 'Ash' }).mapped).toEqual({ name: 'Ash' });
    expect(mapFields({ system: 'Hearth', fields: { name: 'Vex' } }).mapped).toEqual({ name: 'Vex' });
    expect(mapFields({ instructions: [], fields: { name: 'Vex' } }).mapped).toEqual({ name: 'Vex' });
  });

  it('reads a pasted stat block, a line or two spaces apart, with or without a colon', () => {
    expect(parseText('Name: Vex Marrow\nMight 14  Calling Knight;Luck=2\nWound Scar\nWound notes Bad arm\nnonsense here\n\n')).toEqual({
      name: 'Vex Marrow', might: '14', calling: 'Knight', luck: '2', wound_notes: 'Bad arm', wound: 'Scar',
    });
    expect(mapFields(parseText('Might 14  Calling Paladin  Defense 18'))).toMatchObject({ mapped: { might: 14 }, notAChoice: { calling: 'Paladin' }, workedOut: { defense: '18' } });
    expect(parseText('Might')).toEqual({});
    expect(parseText('Might:')).toEqual({});
  });
});

describe('the JSON template', () => {
  it('holds the fields empty, a help line each, and instructions', () => {
    expect(jsonTemplate(HEARTH, { name: 'Hearth Fire', version: 3 })).toEqual({
      system: 'Hearth Fire', version: 3,
      instructions: [
        'Fill in the values under fields. Leave out anything you don\'t know.',
        'Keep the keys as they are: they are the sheet\'s own.',
        'Upload this file in CITY_NET: your sheet -> IMPORT.',
      ],
      fields: { name: '', calling: '', background: '', might: null, luck: null, grit: null, speed: null, nickname: '', fortune: null, inventory: [], wound: '' },
      help: {
        name: 'Name, any text',
        calling: 'Calling, one of Knight, Hedge mage, Bard',
        background: 'Background, any text',
        might: 'Might, a number 3 to 20',
        luck: 'Luck, a number, at least 0',
        grit: 'Grit, a number, at most 5',
        speed: 'speed, a number',
        nickname: 'Nickname, any text',
        fortune: 'Might, a number',
        inventory: 'Inventory: a list of { "name", "qty" }, one per item',
        wound: 'Wound, any text',
      },
    });
  });

  it('is named for the system when it isn\'t told, with no version', () => {
    expect(jsonTemplate(HEARTH)).toMatchObject({ system: 'Hearth', version: null });
  });
});

describe('picks on the form (7c6)', () => {
  const PICKS = {
    format: 1, name: 'Picks',
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'wits', label: 'Wits', min: 1, max: 20 }] }],
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
        { id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage', requires: '@wits >= 13' },
      ] },
      { id: 'feats', one: 'Feat', many: 'Feats', picks: 2, options: [
        { id: 'tough', label: 'Tough' }, { id: 'quick', label: 'Quick' }, { id: 'keen', label: 'Keen' },
      ] },
      { id: 'skills', one: 'Skill', many: 'Skills', again: true, levelled: true, options: [
        { id: 'cook', label: 'Cook' }, { id: 'rank2', label: 'Rank 2' }, { id: 'sail', label: 'Sail' },
      ] },
      { id: 'specs', one: 'Specialty', many: 'Specialties', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }] },
      { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [{ id: 'breath', label: 'Breath' }] },
      { id: 'empty', one: 'Nothing', many: 'Nothings', options: [] },
    ],
  };
  const { mapFields, parseText } = customImporter(PICKS);

  describe('the lines it asks', () => {
    const lines = pickLines(PICKS);
    const shape = (id) => lines.find((l) => l.id === id);

    it('one per list picked on its own: not those under features, everyone\'s, or an empty one', () => {
      expect(lines.map((l) => l.id)).toEqual(['pick_classes', 'pick_classes_level', 'pick_feats', 'pick_skills']);
    });

    it('where one is picked: a choice of its options, and a level box if it has levels', () => {
      expect(shape('pick_classes')).toMatchObject({ label: 'Class', type: 'select', options: [{ value: 'soldier', label: 'Soldier' }, { value: 'mage', label: 'Mage' }] });
      expect(shape('pick_classes_level')).toMatchObject({ label: 'Class level', type: 'number', min: 1, max: 30 });
    });

    it('where more can be: names with commas, by the list\'s plural, and how to write levels if it has them', () => {
      expect(shape('pick_feats')).toMatchObject({ label: 'Feats', type: 'text', hint: 'Names, commas between: Tough, Quick, Keen' });
      expect(shape('pick_skills').hint).toBe('Names and levels, commas between: Cook 2, Rank 2 1');
      expect(lines.find((l) => l.id === 'pick_feats_level')).toBeUndefined();
    });

    it('one picked with no levels has no level box', () => {
      const plain = { format: 1, name: 'P', choices: [{ id: 'jobs', one: 'Job', options: [{ id: 'dock', label: 'Dock' }] }] };
      expect(pickLines(plain).map((l) => l.id)).toEqual(['pick_jobs']);
    });

    it('a system with no lists asks nothing', () => {
      expect(pickLines({ format: 1, name: 'None' })).toEqual([]);
    });

    it('a list picked both ways is asked; one with a name only reads by its id', () => {
      const both = { format: 1, name: 'B', choices: [{ id: 'jobs', picked: 'both', options: [{ id: 'dock' }] }] };
      expect(pickLines(both)[0]).toMatchObject({ id: 'pick_jobs', label: 'jobs', options: [{ value: 'dock', label: 'dock' }] });
    });
  });

  describe('reading them', () => {
    it('by the form\'s own name, the list\'s one and many, and an option by its label or id', () => {
      const soldier = { classes: [{ option: 'soldier', level: 1 }] };
      for (const key of ['pick_classes', 'Class', 'classes', 'CLASS']) expect(mapFields({ [key]: 'Soldier' }).picks, key).toEqual(soldier);
      expect(mapFields({ Class: 'soldier' }).picks).toEqual(soldier);
      expect(mapFields({ Class: ' SOLDIER ' }).picks).toEqual(soldier);
    });

    it('an option whose id and label differ reads by either', () => {
      const named = { format: 1, name: 'N', choices: [{ id: 'jobs', one: 'Job', options: [{ id: 'dk', label: 'Dockhand' }] }] };
      for (const name of ['dk', 'Dockhand']) expect(customImporter(named).mapFields({ Job: name }).picks, name).toEqual({ jobs: [{ option: 'dk' }] });
    });

    it('leaves the sheet\'s fields as they were, and adds no words when there are no picks', () => {
      const plain = mapFields({ wits: 12 });
      expect(Object.keys(plain).sort()).toEqual(['gmOnly', 'mapped', 'notAChoice', 'skipped', 'unmapped', 'workedOut']);
      expect(mapFields({ wits: 12, Class: 'Soldier' }).mapped).toEqual({ wits: 12 });
    });

    it('a sheet\'s own field of that name is the field', () => {
      const own = { ...PICKS, sheet: { sections: [{ id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'class', label: 'Class', type: 'text' }] }] } };
      const read = customImporter(own).mapFields({ Class: 'Soldier', pick_classes: 'Mage' });
      expect(read.mapped).toEqual({ class: 'Soldier' });
      expect(read.picks.classes[0].option).toBe('mage');
    });

    it('its level from the level line, or 1, and from the name where more can be picked', () => {
      expect(mapFields({ Class: 'Soldier', 'Class level': 3 }).picks.classes).toEqual([{ option: 'soldier', level: 3 }]);
      expect(mapFields({ Class: 'Soldier 3' }).picks.classes).toEqual([{ option: 'soldier', level: 3 }]);
      expect(mapFields({ Class: 'Soldier 3', 'Class level': 5 }).picks.classes).toEqual([{ option: 'soldier', level: 3 }]);
      expect(mapFields({ Skills: 'Cook 2, Sail' }).picks.skills).toEqual([{ option: 'cook', level: 2 }, { option: 'sail', level: 1 }]);
    });

    it('a name with a number in it is that name first', () => {
      expect(mapFields({ Skills: 'Rank 2' }).picks.skills).toEqual([{ option: 'rank2', level: 1 }]);
      expect(mapFields({ Skills: 'Rank 2 4' }).picks.skills).toEqual([{ option: 'rank2', level: 4 }]);
    });

    it('a number on a list with no levels is part of the name, so isn\'t found', () => {
      expect(mapFields({ Feats: 'Tough 2' }).picksNotFound).toEqual({ Feats: ['Tough 2'] });
    });

    it('a level that doesn\'t read is said, and the pick stays at 1', () => {
      for (const bad of ['high', 0, -1, 31, 1.5]) {
        const read = mapFields({ Class: 'Soldier', 'Class level': bad });
        expect(read.picks.classes, String(bad)).toEqual([{ option: 'soldier', level: 1 }]);
        expect(read.unmapped, String(bad)).toEqual({ 'Class level': bad });
      }
    });

    it('a level with nothing to go with it is said', () => {
      expect(mapFields({ 'Class level': 3 }).unmapped).toEqual({ 'Class level': 3 });
      expect(mapFields({ 'Class level': 3 }).picks).toBeUndefined();
    });

    it('one it can\'t find is said by its line, with what it did find kept', () => {
      const read = mapFields({ Feats: 'Tough, Wizardry' });
      expect(read.picksNotFound).toEqual({ Feats: ['Wizardry'] });
      expect(read.picks.feats).toEqual([{ option: 'tough' }]);
      expect(mapFields({ Class: 'Wizard' })).toMatchObject({ picksNotFound: { Class: ['Wizard'] } });
      expect(mapFields({ Class: 'Wizard' }).picks).toBeUndefined();
    });

    it('past what the list allows is said; the same one twice is once', () => {
      const read = mapFields({ Feats: 'Tough, Quick, Keen' });
      expect(read.picks.feats.map((p) => p.option)).toEqual(['tough', 'quick']);
      expect(read.picksTooMany).toEqual({ Feats: ['Keen'] });
      const twice = mapFields({ Feats: 'Tough, tough' });
      expect(twice.picks.feats).toEqual([{ option: 'tough' }]);
      expect(twice.picksTooMany).toBeUndefined();
      expect(mapFields({ Skills: 'Cook, Sail, Rank 2' }).picks.skills).toHaveLength(3);
    });

    it('a JSON list of names reads as the commas do', () => {
      expect(mapFields({ Feats: ['Tough', 'Quick'] }).picks.feats).toEqual([{ option: 'tough' }, { option: 'quick' }]);
    });

    it('blank says nothing', () => {
      const read = mapFields({ Class: '', Feats: ' , ' });
      expect(read.picks).toBeUndefined();
      expect(read.picksNotFound).toBeUndefined();
    });

    it('a list under features or everyone\'s isn\'t read', () => {
      expect(mapFields({ Specialty: 'Duelist', Common: 'Breath' }).unmapped).toEqual({ Specialty: 'Duelist', Common: 'Breath' });
    });

    it('says what each comes to, and what one not met needs, against the numbers in the same file', () => {
      expect(mapFields({ Class: 'Soldier', 'Class level': 2 }).picksSaid).toEqual([{ list: 'classes', one: 'Class', option: 'Soldier', level: 2 }]);
      expect(mapFields({ Class: 'Mage', wits: 5 }).picksSaid).toEqual([{ list: 'classes', one: 'Class', option: 'Mage', level: 1, unmet: 'WITS >= 13' }]);
      expect(mapFields({ Class: 'Mage', wits: 13 }).picksSaid[0].unmet).toBeUndefined();
      expect(mapFields({ Class: 'Mage', wits: 5 }).picks.classes).toEqual([{ option: 'mage', level: 1 }]);
      expect(mapFields({ Feats: 'Tough' }).picksSaid[0]).toEqual({ list: 'feats', one: 'Feat', option: 'Tough' });
    });

    it('says an inventory adds, only when one is named', () => {
      const withBag = { ...PICKS, sheet: { sections: [{ id: 'bag', label: 'BAG', layout: 'inventory', fields: [] }] } };
      expect(customImporter(withBag).mapFields({ inventory: '2x Rope' }).inventoryAdds).toBe(true);
      expect(customImporter(withBag).mapFields({ Class: 'Soldier' })).not.toHaveProperty('inventoryAdds');
    });

    it('from a pasted stat block', () => {
      expect(mapFields(parseText('Class: Soldier\nClass level: 4')).picks.classes).toEqual([{ option: 'soldier', level: 4 }]);
    });

    it('from its own JSON template, filled in', () => {
      const template = jsonTemplate(PICKS);
      expect(template.fields).toMatchObject({ pick_classes: '', pick_classes_level: null, pick_feats: '', pick_skills: '' });
      expect(template.help.pick_classes).toBe('Class, one of Soldier, Mage');
      expect(template.help.pick_classes_level).toBe('Class level, a number 1 to 30');
      expect(template.help.pick_feats).toBe('Feats. Names, commas between: Tough, Quick, Keen');
      template.fields.pick_classes = 'Soldier';
      template.fields.pick_classes_level = 2;
      expect(mapFields(template).picks).toEqual({ classes: [{ option: 'soldier', level: 2 }] });
    });
  });

  describe('writing them', () => {
    const write = (data, sent) => withImportedPicks(PICKS, data, sent)._choices;

    it('a list named takes them; one not named stays', () => {
      const data = { _choices: { classes: [{ option: 'mage', level: 2 }], feats: [{ option: 'quick' }] } };
      expect(write(data, { classes: [{ option: 'soldier', level: 3 }] })).toEqual({ classes: [{ option: 'soldier', level: 3 }], feats: [{ option: 'quick' }] });
    });

    it('checks what was sent again: lists, options, room and levels', () => {
      expect(write({}, { nope: [{ option: 'x' }], specs: [{ option: 'duelist' }], commons: [{ option: 'breath' }] })).toEqual({});
      expect(write({}, { classes: 'soldier' })).toEqual({});
      expect(write({}, { classes: [{ option: 'wizard' }, 'soldier'] })).toEqual({ classes: [] });
      expect(write({}, { feats: [{ option: 'tough' }, { option: 'tough' }, { option: 'quick' }, { option: 'keen' }] })).toEqual({ feats: [{ option: 'tough' }, { option: 'quick' }] });
      expect(write({}, { classes: [{ option: 'soldier', level: 99 }] })).toEqual({ classes: [{ option: 'soldier', level: 1 }] });
      expect(write({}, { feats: [{ option: 'tough', level: 3, locked: true, roll: 6 }] })).toEqual({ feats: [{ option: 'tough' }] });
    });

    it('an upload is king: a pick locked by a roll or the GM is replaced, and the new one isn\'t locked', () => {
      const data = { _choices: { classes: [{ option: 'mage', level: 1, locked: true, roll: 4 }] } };
      expect(write(data, { classes: [{ option: 'soldier', level: 2 }] })).toEqual({ classes: [{ option: 'soldier', level: 2 }] });
    });

    it('as a whole upload, a list it doesn\'t name is cleared, and any roll waiting goes', () => {
      const data = { _rolled: { classes: { option: 'mage', roll: 4 } }, _choices: { classes: [{ option: 'mage', level: 1 }], feats: [{ option: 'quick' }] } };
      const whole = withImportedPicks(PICKS, data, { feats: [{ option: 'tough' }] }, { whole: true });
      expect(whole._choices).toEqual({ classes: [], feats: [{ option: 'tough' }], skills: [] });
      expect(whole).not.toHaveProperty('_rolled');
      expect(withImportedPicks(PICKS, data, undefined, { whole: true })._choices).toEqual({ classes: [], feats: [], skills: [] });
    });

    it('not as a whole upload, a list it doesn\'t name stays, and a roll waiting too', () => {
      const data = { _rolled: { classes: { option: 'mage', roll: 4 } }, _choices: { classes: [{ option: 'mage', level: 1 }] } };
      const part = withImportedPicks(PICKS, data, { feats: [{ option: 'tough' }] });
      expect(part._choices.classes).toEqual([{ option: 'mage', level: 1 }]);
      expect(part._rolled).toEqual(data._rolled);
    });

    it('nothing sent, or no system, is the sheet as it was', () => {
      const data = { name: 'W' };
      expect(withImportedPicks(PICKS, data, null)).toBe(data);
      expect(withImportedPicks(null, data, { classes: [] })).toBe(data);
    });
  });
});

describe('a list under a feature, on the form (2026-11-07)', () => {
  const NESTED = {
    format: 1, name: 'Nested',
    choices: [
      { id: 'jobs', one: 'Job', many: 'Jobs', options: [
        { id: 'dock', label: 'Dockhand', features: [{ id: 'brawler', label: 'Dock Brawler', choice: 'weapons' }] },
        { id: 'scribe', label: 'Scribe' },
      ] },
      { id: 'weapons', one: 'Weapon', many: 'Weapons', picked: 'features', options: [
        { id: 'cudgel', label: 'Cudgel', features: [{ id: 'trained', label: 'Trained', choice: 'moves', choice_count: 2 }] },
        { id: 'hook', label: 'Boat hook' },
      ] },
      { id: 'moves', one: 'Move', many: 'Moves', picked: 'features', options: [{ id: 'jab', label: 'Jab' }, { id: 'feint', label: 'Feint' }, { id: 'sweep', label: 'Sweep' }] },
      { id: 'orphans', one: 'Orphan', many: 'Orphans', picked: 'features', options: [{ id: 'lost', label: 'Lost' }] },
    ],
  };
  const { mapFields } = customImporter(NESTED);
  const line = (id) => pickLines(NESTED).find((l) => l.id === id);

  it('is asked: a dropdown where one feature opens it once, names where more can be; one nothing opens isn\'t', () => {
    expect(pickLines(NESTED).map((l) => l.id)).toEqual(['pick_jobs', 'pick_weapons', 'pick_moves']);
    expect(line('pick_weapons').type).toBe('select');
    expect(line('pick_moves').type).toBe('text');
  });

  it('is placed under what opens it, down the lists', () => {
    const read = mapFields({ Job: 'Dockhand', Weapon: 'Cudgel', Moves: 'Jab, Feint' });
    const data = withImportedPicks(NESTED, {}, read.picks);
    expect(data._choices).toEqual({
      jobs: [{ option: 'dock' }],
      weapons: [{ option: 'cudgel', from: 'brawler' }],
      moves: [{ option: 'jab', from: 'trained' }, { option: 'feint', from: 'trained' }],
    });
    expect(read.picksSaid.map((p) => p.option)).toEqual(['Dockhand', 'Cudgel', 'Jab', 'Feint']);
    expect(read.picksUnopened).toBeUndefined();
  });

  it('whatever order the lists come in', () => {
    const backwards = { ...NESTED, choices: [...NESTED.choices].reverse() };
    const data = withImportedPicks(backwards, {}, { moves: [{ option: 'jab' }], weapons: [{ option: 'cudgel' }], jobs: [{ option: 'dock' }] });
    expect(data._choices.moves).toEqual([{ option: 'jab', from: 'trained' }]);
  });

  it('with nothing opening it is left out, said by its line, and the rest stands', () => {
    const read = mapFields({ Job: 'Scribe', Weapon: 'Cudgel', Moves: 'Jab' });
    expect(read.picksUnopened).toEqual({ Weapon: ['Cudgel'], Moves: ['Jab'] });
    expect(read.picks).toEqual({ jobs: [{ option: 'scribe' }] });
    expect(read.picksSaid.map((p) => p.option)).toEqual(['Scribe']);
  });

  it('past what the features give is said, by the line', () => {
    expect(mapFields({ Job: 'Dockhand', Weapon: 'Cudgel', Moves: 'Jab, Feint, Sweep' }).picksTooMany).toEqual({ Moves: ['Sweep'] });
  });

  it('applying places them against the sheet as it stands, and replaces what the list held', () => {
    const data = { _choices: { jobs: [{ option: 'dock' }], weapons: [{ option: 'hook', from: 'brawler', locked: true, roll: 5 }] } };
    expect(withImportedPicks(NESTED, data, { weapons: [{ option: 'cudgel' }] })._choices.weapons).toEqual([{ option: 'cudgel', from: 'brawler' }]);
    expect(withImportedPicks(NESTED, {}, { weapons: [{ option: 'cudgel' }] })._choices.weapons).toEqual([]);
  });

  it('two features opening one list share them out, one each', () => {
    const two = { format: 1, name: 'T', choices: [
      { id: 'jobs', one: 'Job', picks: 2, options: [{ id: 'a', label: 'A', features: [{ id: 'fa', label: 'FA', choice: 'kit' }] }, { id: 'b', label: 'B', features: [{ id: 'fb', label: 'FB', choice: 'kit' }] }] },
      { id: 'kit', one: 'Kit', many: 'Kits', picked: 'features', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },
    ] };
    const data = withImportedPicks(two, {}, { jobs: [{ option: 'a' }, { option: 'b' }], kit: [{ option: 'x' }, { option: 'y' }] });
    expect(data._choices.kit).toEqual([{ option: 'x', from: 'fa' }, { option: 'y', from: 'fb' }]);
  });

  it('a feature open for another list doesn\'t take it', () => {
    expect(mapFields({ Job: 'Dockhand', Moves: 'Jab' }).picksUnopened).toEqual({ Moves: ['Jab'] });
  });

  it('a pick that doesn\'t count opens nothing', () => {
    const waiting = { _choices: { weapons: [{ option: 'cudgel', from: 'gone' }] } };
    expect(withImportedPicks(NESTED, waiting, { moves: [{ option: 'jab' }] })._choices.moves).toEqual([]);
  });

  it('what one needs is read against the picks as placed, those under features too', () => {
    const needing = { ...NESTED, choices: [...NESTED.choices, { id: 'perks', one: 'Perk', options: [{ id: 'picky', label: 'Picky', requires: 'has(cudgel)' }] }] };
    const said = customImporter(needing).mapFields({ Job: 'Dockhand', Weapon: 'Cudgel', Perk: 'Picky' }).picksSaid;
    expect(said.find((p) => p.option === 'Picky').unmet).toBeUndefined();
    expect(customImporter(needing).mapFields({ Job: 'Dockhand', Weapon: 'Boat hook', Perk: 'Picky' }).picksSaid.find((p) => p.option === 'Picky').unmet).toBeTruthy();
  });

  it('a from sent by the browser is not believed', () => {
    const data = withImportedPicks(NESTED, {}, { jobs: [{ option: 'dock' }], weapons: [{ option: 'cudgel', from: 'nope', locked: true }] });
    expect(data._choices.weapons).toEqual([{ option: 'cudgel', from: 'brawler' }]);
  });
});
