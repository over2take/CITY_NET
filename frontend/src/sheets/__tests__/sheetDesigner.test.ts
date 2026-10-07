/**
 * The CHARACTER SHEET page as logic (4b3b). Approved mockup builder-sheet (2026-10-07): automatic
 * until CUSTOMIZE copies the starter; stats, formulas and starter fields not placed wait in a tray;
 * removing a tab moves its sections, the last one makes one page; attack numbers never EVERYONE.
 * Every step is held to the server's own check (backend/systemBuilder/definition.js, sheet.js).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  sheetOf, fieldsOn, withCustomized, withAutomatic, fieldKind, tray, pagesOf, sectionsOn,
  tabNameProblem, withNewTab, withTabName, withTabMoved, withoutTab,
  withNewSection, withSection, withSectionMoved, sectionRemoveProblem, withoutSection,
  withNewField, optionsFrom, optionsText, withField, withFieldMoved, withFieldIn, withoutField, withPlaced,
  sheetProblems, LIMITS,
} from '../sheetDesigner';
import { takenIds, withNewStat } from '../statsRules';
import type { Definition } from '../systemsApi';
import type { CustomRenderSheet } from '../customTemplates';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { starterSheet, effectiveSheet } = req('../../../../backend/systemBuilder/sheet.js');

/** Hearth: two abilities, a formula, the default HP pool. */
const H: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'dex', label: 'Dexterity' }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - @str' }],
};
const STARTER: CustomRenderSheet = starterSheet(H);
const custom = (def: Definition = H) => withCustomized(def, starterSheet(def));
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const ids = (def: Definition) => fieldsOn(sheetOf(def)).map((f) => f.id);
const sections = (def: Definition) => sheetOf(def)!.sections.map((s) => `${s.tab ?? '-'}/${s.id}`);

describe('automatic and customized', () => {
  it('copies the starter in, which the server accepts and draws as it was', () => {
    expect(sheetOf(H)).toBeNull();
    const def = custom();
    expect(sheetOf(def)).toEqual(STARTER);
    expect(problems(def)).toEqual([]);
    expect(effectiveSheet(def)).toEqual(effectiveSheet(H));
  });

  it('goes back to automatic by dropping it', () => {
    expect(withAutomatic(custom())).toEqual(H);
    expect('sheet' in withAutomatic(custom())).toBe(false);
  });

  it('says what each field is', () => {
    const def = custom();
    const kind = (id: string) => fieldKind(def, fieldsOn(sheetOf(def)).find((f) => f.id === id)!);
    expect(['save', 'cash', 'str', 'concept'].map(kind)).toEqual(['formula', 'linked', 'stat', 'plain']);
  });

  it('has nothing in the tray until something comes off, nor while automatic', () => {
    expect(tray(H, STARTER)).toEqual([]);
    expect(tray(custom(), STARTER)).toEqual([]);
    expect(tray(custom(), null)).toEqual([]);
    const def = withoutField(withoutField(custom(), 'save'), 'str');
    expect(tray(def, STARTER).map((f) => f.id)).toEqual(['str', 'save']);
  });

  it('lists a stat added after customizing in the tray, not on the sheet', () => {
    const def = withNewStat(custom(), 'abilities', 'Grit');
    expect(ids(def)).not.toContain('grit');
    expect(tray(def, starterSheet(def)).map((f) => f.id)).toEqual(['grit']);
  });

  it('never gives a new stat the id of one of the sheet\'s own fields', () => {
    const def = withNewField(custom(), 'identity', 'Grit');
    expect(takenIds(def)).toContain('grit');
    expect(withNewStat(def, 'abilities', 'Grit').stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ stats: expect.arrayContaining([expect.objectContaining({ id: 'grit_2' })]) }),
    ]));
  });
});

describe('tabs', () => {
  it('adds TAB 4, TAB 5... and stops at the server\'s limit', () => {
    let def = withNewTab(custom());
    expect(sheetOf(def)!.tabs).toEqual(['STATS', 'GEAR', 'NOTES', 'TAB 4']);
    expect(problems(def)).toEqual([]);
    for (let i = 0; i < 20; i += 1) def = withNewTab(def);
    expect(sheetOf(def)!.tabs).toHaveLength(LIMITS.tabs);
    expect(problems(def)).toEqual([]);
  });

  it('skips a TAB name already taken', () => {
    const def = withNewTab(withTabName(custom(), 'NOTES', 'Tab 4'));
    expect(sheetOf(def)!.tabs).toEqual(['STATS', 'GEAR', 'Tab 4', 'TAB 5']);
  });

  it('refuses a blank, long or repeated name, and renames its sections with it', () => {
    const def = custom();
    expect(tabNameProblem(def, 'GEAR', '  ')).toBe('A tab needs a name.');
    expect(tabNameProblem(def, 'GEAR', 'x'.repeat(21))).toBe('At most 20 characters.');
    expect(tabNameProblem(def, 'GEAR', 'stats')).toBe('There is already a tab called stats.');
    expect(tabNameProblem(def, 'GEAR', 'gear')).toBeNull();
    expect(withTabName(def, 'GEAR', 'stats')).toBe(def);
    expect(withTabName(def, 'MISSING', 'X')).toBe(def);
    const renamed = withTabName(def, 'GEAR', ' KIT ');
    expect(sheetOf(renamed)!.tabs).toEqual(['STATS', 'KIT', 'NOTES']);
    expect(sections(renamed).filter((s) => s.startsWith('KIT/'))).toEqual(['KIT/inventory', 'KIT/money']);
    expect(problems(renamed)).toEqual([]);
  });

  it('moves a tab, staying put at either end', () => {
    expect(sheetOf(withTabMoved(custom(), 'GEAR', -1))!.tabs).toEqual(['GEAR', 'STATS', 'NOTES']);
    expect(sheetOf(withTabMoved(custom(), 'NOTES', 1))!.tabs).toEqual(['STATS', 'GEAR', 'NOTES']);
    expect(sheetOf(withTabMoved(custom(), 'STATS', -1))!.tabs).toEqual(['STATS', 'GEAR', 'NOTES']);
  });

  it('moves a removed tab\'s sections where asked, else to the first other tab', () => {
    const toNotes = withoutTab(custom(), 'STATS', 'NOTES');
    expect(sheetOf(toNotes)!.tabs).toEqual(['GEAR', 'NOTES']);
    expect(sectionsOn(sheetOf(toNotes)!, 'NOTES').map((s) => s.id)).toEqual(['identity', 'health', 'stats_abilities', 'derived', 'notes']);
    expect(problems(toNotes)).toEqual([]);
    const toFirst = withoutTab(custom(), 'STATS', 'STATS');
    expect(sectionsOn(sheetOf(toFirst)!, 'GEAR').map((s) => s.id)).toEqual(['identity', 'health', 'stats_abilities', 'derived', 'inventory', 'money']);
  });

  it('makes one page of the last tab, and a new tab gathers that page again', () => {
    let def = withoutTab(withoutTab(custom(), 'STATS'), 'GEAR');
    def = withoutTab(def, 'NOTES');
    const sheet = sheetOf(def)!;
    expect('tabs' in sheet).toBe(false);
    expect(sheet.sections.every((s) => !('tab' in s))).toBe(true);
    expect(pagesOf(sheet)).toEqual([null]);
    expect(sectionsOn(sheet, null)).toHaveLength(7);
    expect(problems(def)).toEqual([]);
    def = withNewTab(def);
    expect(sheetOf(def)!.tabs).toEqual(['TAB 1']);
    expect(sheetOf(def)!.sections.every((s) => s.tab === 'TAB 1')).toBe(true);
    expect(problems(def)).toEqual([]);
  });

  it('leaves an automatic sheet alone', () => {
    for (const change of [withNewTab, (d: Definition) => withTabName(d, 'STATS', 'X'), (d: Definition) => withoutTab(d, 'STATS'), (d: Definition) => withTabMoved(d, 'STATS', 1)]) {
      expect(change(H)).toBe(H);
    }
  });
});

describe('sections', () => {
  it('adds an empty list on a tab, ids never repeating, on the first tab when the tab isn\'t one', () => {
    let def = withNewSection(withNewSection(custom(), 'GEAR'), 'GEAR');
    expect(sections(def).slice(-2)).toEqual(['GEAR/new_section', 'GEAR/new_section_2']);
    def = withNewSection(def, 'NOPE', 'Skills');
    expect(sections(def).slice(-1)).toEqual(['STATS/skills']);
    expect(problems(def)).toEqual([]);
    const page = withNewSection(withoutTab(withoutTab(withoutTab(custom(), 'STATS'), 'GEAR'), 'NOTES'), 'GEAR');
    expect(sheetOf(page)!.sections.at(-1)).toEqual({ id: 'new_section', label: 'NEW SECTION', layout: 'list', fields: [] });
  });

  it('changes a name, tab, look and columns, refusing what the server would', () => {
    let def = withSection(custom(), 'derived', { label: 'WORKED OUT', tab: 'GEAR', layout: 'list', columns: 12 });
    expect(sheetOf(def)!.sections.find((s) => s.id === 'derived')).toMatchObject({ label: 'WORKED OUT', tab: 'GEAR', layout: 'list', columns: 8 });
    def = withSection(def, 'derived', { label: ' ', tab: 'NOPE', layout: 'cards' as never, columns: 0 });
    expect(sheetOf(def)!.sections.find((s) => s.id === 'derived')).toMatchObject({ label: 'WORKED OUT', tab: 'GEAR', layout: 'list', columns: 1 });
    expect(withSection(def, 'derived', { columns: 2.6 }).sheet).toMatchObject({ sections: expect.arrayContaining([expect.objectContaining({ id: 'derived', columns: 3 })]) });
    expect(sheetOf(withSection(def, 'derived', { label: 'x'.repeat(80) }))!.sections.find((s) => s.id === 'derived')!.label).toHaveLength(60);
    expect(problems(def)).toEqual([]);
  });

  it('moves among the sections on its own tab only', () => {
    const def = custom();
    expect(sections(withSectionMoved(def, 'inventory', -1))).toEqual(sections(def));
    expect(sections(withSectionMoved(def, 'money', -1)).slice(4, 6)).toEqual(['GEAR/money', 'GEAR/inventory']);
    expect(sections(withSectionMoved(def, 'derived', 1))).toEqual(sections(def));
    expect(sections(withSectionMoved(def, 'identity', 1)).slice(0, 2)).toEqual(['STATS/health', 'STATS/identity']);
    expect(withSectionMoved(def, 'gone', 1)).toEqual(def);
  });

  it('refuses to remove the name\'s section; another goes, its fields back to the tray', () => {
    const def = custom();
    expect(sectionRemoveProblem(def, 'identity')).toBe('It holds the character\'s name. Move Name to another section first.');
    expect(withoutSection(def, 'identity')).toBe(def);
    const noStats = withoutSection(withNewField(def, 'stats_abilities', 'Grit'), 'stats_abilities');
    expect(sectionRemoveProblem(def, 'stats_abilities')).toBeNull();
    expect(ids(noStats)).not.toContain('grit');
    expect(tray(noStats, STARTER).map((f) => f.id)).toEqual(['str', 'dex']);
    expect(problems(noStats)).toEqual([]);
  });

  it('takes a removed section\'s fields out of the header too', () => {
    const def = withoutSection(custom(), 'health');
    expect(sheetOf(custom())!.header).toMatchObject({ hpField: 'hp', hpMaxField: 'hp_max' });
    expect(sheetOf(def)!.header).toEqual({ nameField: 'name', subtitleFields: ['concept'] });
    expect(problems(def)).toEqual([]);
  });
});

describe('fields', () => {
  it('adds a text field with an id nothing else has', () => {
    let def = withNewField(custom(), 'identity', 'HP');
    def = withNewField(def, 'identity', 'Strength');
    def = withNewField(def, 'identity');
    expect(sheetOf(def)!.sections[0].fields.slice(-3)).toEqual([
      { id: 'hp_2', label: 'HP', type: 'text' }, { id: 'strength', label: 'Strength', type: 'text' }, { id: 'new_field', label: 'New field', type: 'text' },
    ]);
    expect(fieldsOn(sheetOf(withNewField(def, 'notes'))).at(-1)!.id).toBe('new_field_2');
    // A starter field off the sheet keeps its id, for when it is placed again.
    expect(ids(withNewField(withoutField(custom(), 'concept'), 'identity', 'Concept'))).toContain('concept_2');
    expect(problems(def)).toEqual([]);
  });

  it('reads choices one per line or by commas, without blanks or repeats', () => {
    expect(optionsFrom('Street, Corp\n\n street \nNomad')).toEqual([
      { value: 'Street', label: 'Street' }, { value: 'Corp', label: 'Corp' }, { value: 'Nomad', label: 'Nomad' },
    ]);
    expect(optionsFrom(Array.from({ length: 150 }, (_, i) => `o${i}`).join('\n'))).toHaveLength(100);
    expect(optionsText({ id: 'x', label: 'X', type: 'select', options: optionsFrom('A,B') })).toBe('A\nB');
    expect(optionsText({ id: 'x', label: 'X', type: 'text' })).toBe('');
  });

  it('turns a field into a pick-one with choices, and back', () => {
    let def = withField(custom(), 'concept', { type: 'select' });
    const concept = () => fieldsOn(sheetOf(def)).find((f) => f.id === 'concept')!;
    expect(concept().options).toEqual(optionsFrom('Option 1\nOption 2'));
    expect(problems(def)).toEqual([]);
    def = withField(def, 'concept', { options: 'Courier\nFixer' });
    expect(optionsText(concept())).toBe('Courier\nFixer');
    def = withField(def, 'concept', { options: ' , ' });
    expect(optionsText(concept())).toBe('Courier\nFixer');
    def = withField(def, 'concept', { type: 'textarea' });
    expect(concept()).toEqual({ id: 'concept', label: 'Concept', type: 'textarea' });
    expect(withField(def, 'concept', { options: 'A' })).toEqual(def);
    expect(problems(def)).toEqual([]);
  });

  it('keeps a formula\'s and a linked field\'s kind, and a formula from being edited', () => {
    const def = withField(withField(custom(), 'save', { type: 'text', gmOnly: true, label: 'Physical save' }), 'cash', { type: 'text', gmOnly: true });
    const f = (id: string) => fieldsOn(sheetOf(def)).find((x) => x.id === id)!;
    expect(f('save')).toEqual({ id: 'save', label: 'Physical save', type: 'number' });
    expect(f('cash')).toMatchObject({ type: 'number', edit: 'gm' });
    expect(problems(def)).toEqual([]);
  });

  it('shows a field to everyone, never an attack number, and only the GM may change it', () => {
    let def = withField(custom(), 'str', { everyone: true, gmOnly: true, hint: ' Rolled at creation ' });
    const str = () => fieldsOn(sheetOf(def)).find((f) => f.id === 'str')!;
    expect(str()).toMatchObject({ visibility: 'public', edit: 'gm', hint: ' Rolled at creation ' });
    def = withField(def, 'str', { attack: true });
    expect(str().visibility).toBeUndefined();
    expect(str().sensitivity).toBe('combat');
    def = withField(def, 'str', { everyone: true });
    expect(str().visibility).toBeUndefined();
    expect(problems(def)).toEqual([]);
    def = withField(def, 'str', { attack: false, everyone: true, gmOnly: false, hint: '  ' });
    expect(str()).toEqual({ id: 'str', label: 'Strength', type: 'number', visibility: 'public' });
    def = withField(def, 'str', { everyone: false, label: '  ' });
    expect(str()).toEqual({ id: 'str', label: 'Strength', type: 'number' });
    expect(problems(def)).toEqual([]);
  });

  it('cuts text to what the server takes', () => {
    const def = withField(custom(), 'concept', { label: 'x'.repeat(99), hint: 'y'.repeat(999) });
    const concept = fieldsOn(sheetOf(def)).find((f) => f.id === 'concept')!;
    expect([concept.label.length, concept.hint!.length]).toEqual([60, 300]);
    expect(problems(def)).toEqual([]);
  });

  it('moves within its section and to another', () => {
    let def = withFieldMoved(custom(), 'dex', -1);
    expect(sheetOf(def)!.sections.find((s) => s.id === 'stats_abilities')!.fields.map((f) => f.id)).toEqual(['dex', 'str']);
    expect(withFieldMoved(def, 'dex', -1)).toEqual(def);
    def = withFieldIn(def, 'name', 'notes');
    expect(sheetOf(def)!.sections.find((s) => s.id === 'notes')!.fields.map((f) => f.id)).toEqual(['notes', 'name']);
    expect(sheetOf(def)!.sections[0].fields.map((f) => f.id)).toEqual(['concept', 'description']);
    expect(withFieldIn(def, 'name', 'notes')).toBe(def);
    expect(withFieldIn(def, 'name', 'gone')).toBe(def);
    expect(withFieldIn(def, 'gone', 'notes')).toBe(def);
    expect(sectionRemoveProblem(def, 'identity')).toBeNull();
    expect(problems(def)).toEqual([]);
  });

  it('keeps the name, and takes a max\'s pair and the header with a field that goes', () => {
    expect(withoutField(custom(), 'name')).toEqual(custom());
    const hp = fieldsOn(sheetOf(custom())).find((f) => f.id === 'hp')!;
    expect(hp.maxField).toBe('hp_max');
    const def = withoutField(withoutField(custom(), 'hp_max'), 'concept');
    expect(fieldsOn(sheetOf(def)).find((f) => f.id === 'hp')!.maxField).toBeUndefined();
    expect(sheetOf(def)!.header).toEqual({ nameField: 'name', hpField: 'hp' });
    expect(problems(def)).toEqual([]);
    expect(sheetOf(withoutField(custom(), 'hp'))!.header).toEqual({ nameField: 'name', subtitleFields: ['concept'] });
  });

  it('places from the tray at the end of a section, or of a new one', () => {
    let def = withoutField(custom(), 'save');
    const save = tray(def, STARTER)[0];
    def = withPlaced(def, save, 'identity');
    expect(sheetOf(def)!.sections[0].fields.at(-1)).toEqual(save);
    expect(tray(def, STARTER)).toEqual([]);
    expect(withPlaced(def, save, 'identity')).toBe(def);
    expect(problems(def)).toEqual([]);
    // Every section gone: placing makes one, on the first tab.
    let empty = custom();
    for (const s of sheetOf(empty)!.sections.map((x) => x.id).filter((id) => id !== 'identity')) empty = withoutSection(empty, s);
    empty = withoutSection(withFieldIn(withNewSection(empty, 'NOTES'), 'name', 'new_section'), 'identity');
    const placed = withPlaced(empty, tray(empty, STARTER).find((f) => f.id === 'str')!, 'gone', 'GEAR');
    expect(sheetOf(placed)!.sections.at(-1)).toMatchObject({ id: 'new_section_2', tab: 'GEAR', fields: [{ id: 'str' }] });
    expect(problems(placed)).toEqual([]);
  });
});

describe('problems', () => {
  it('pins the server\'s problems to their field or section', () => {
    expect(sheetProblems([
      { where: 'sheet field str, label', message: 'Cannot be blank' },
      { where: 'sheet field str', message: 'second' },
      { where: 'sheet section derived, columns', message: 'A whole number from 1 to 8' },
      { where: 'sheet tabs', message: 'Must be a list of tab names' },
      { where: 'derived save', message: 'not the sheet' },
    ])).toEqual({
      fields: { str: 'Cannot be blank' },
      sections: { derived: 'A whole number from 1 to 8' },
      other: ['sheet tabs: Must be a list of tab names'],
    });
  });
});
