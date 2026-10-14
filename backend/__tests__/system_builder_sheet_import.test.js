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
const { INVENTORY, sheetFields, customImporter, jsonTemplate } = require_('../systemBuilder/sheetImport');

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
