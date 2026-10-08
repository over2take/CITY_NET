/**
 * The NPCS page as logic (4b4b). Approved mockup builder-npcs (2026-10-07): NPCs use the character
 * sheet until given a stat block of their own (a copy of it, edited by the same designer); tiers
 * are difficulties whose boxes are numbers, formulas with @level, or dice. Every step is held to
 * the server's own check (backend/systemBuilder/definition.js) and worked out by its tierRolls.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  ownBlock, withOwnBlock, withSharedBlock, asBlockDraft, fromBlockDraft, blockFields, settableFields,
  tierList, withNewTier, withTierLabel, withTierBox, withTierValue, boxText, withTierMoved, withoutTier,
  boxErrors, triedText, LIMITS,
} from '../npcs';
import { withNewField, withSection, sheetOf } from '../sheetDesigner';
import type { Definition } from '../systemsApi';
import type { CustomRenderSheet } from '../customTemplates';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { effectiveSheet } = req('../../../../backend/systemBuilder/sheet.js');
const { rollTier } = req('../../../../backend/systemBuilder/tierRolls.js');

const H: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'level', label: 'Level' }, { id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - @str' }],
};
const SHEET: CustomRenderSheet = effectiveSheet(H);
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const fieldsOf = (def: Definition) => blockFields(def, SHEET);
const field = (def: Definition, id: string) => fieldsOf(def).find((f) => f.id === id)!;

describe('the stat block', () => {
  it('is the character sheet until given one of their own, a copy of it', () => {
    expect(ownBlock(H)).toBeNull();
    const own = withOwnBlock(H, SHEET);
    expect(ownBlock(own)).toEqual(SHEET);
    expect(problems(own)).toEqual([]);
    expect(withSharedBlock(own)).toEqual(H);
    expect('npc' in withSharedBlock(own)).toBe(false);
  });

  it('keeps the tiers when going back to the character sheet', () => {
    const def = withSharedBlock(withNewTier(withOwnBlock(H, SHEET), fieldsOf(H)));
    expect(def.npc).toEqual({ tiers: [{ id: 'new_tier', label: 'NEW TIER', values: { level: '@level' } }] });
  });

  it('is edited by the CHARACTER SHEET designer, put back where it belongs', () => {
    const own = withOwnBlock(H, SHEET);
    const draft = asBlockDraft(own);
    expect(sheetOf(draft)).toEqual(SHEET);
    const edited = withSection(withNewField(draft, 'identity', 'Tactics'), 'identity', { label: 'THREAT' });
    const back = fromBlockDraft(own, edited);
    expect(ownBlock(back)!.sections[0]).toMatchObject({ label: 'THREAT', fields: expect.arrayContaining([{ id: 'tactics', label: 'Tactics', type: 'text' }]) });
    expect('sheet' in back).toBe(false);
    expect(problems(back)).toEqual([]);
    // The designer's BACK TO AUTOMATIC is back to the character sheet here.
    const { sheet: _s, ...noSheet } = edited;
    expect(ownBlock(fromBlockDraft(own, noSheet as Definition))).toBeNull();
    // And with no block of their own, the designer sees the definition as it is.
    expect(asBlockDraft(H)).toBe(H);
  });

  it('offers a tier only what a GM fills in: never a linked value or a formula', () => {
    expect(fieldsOf(H).map((f) => f.id)).toEqual(expect.arrayContaining(['hp', 'cash', 'save', 'str']));
    const ids = settableFields(H, SHEET).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['name', 'concept', 'level', 'str', 'notes']));
    for (const never of ['hp', 'hp_max', 'cash', 'save']) expect(ids).not.toContain(never);
    expect(settableFields(H, null)).toEqual([]);
  });
});

describe('tiers', () => {
  it('adds tiers with ids from their first names, the stat block\'s Level starting at the level', () => {
    let def = withNewTier(H, fieldsOf(H), 'MOOK');
    def = withNewTier(def, fieldsOf(H), 'Mook');
    expect(tierList(def)).toEqual([
      { id: 'mook', label: 'MOOK', values: { level: '@level' } },
      { id: 'mook_2', label: 'Mook', values: { level: '@level' } },
    ]);
    expect(problems(def)).toEqual([]);
    // No Level field: nothing to start.
    expect(tierList(withNewTier({ format: 1, name: 'X' }, []))).toEqual([{ id: 'new_tier', label: 'NEW TIER' }]);
  });

  it('stops at twenty', () => {
    let def = H;
    for (let i = 0; i < 25; i += 1) def = withNewTier(def, []);
    expect(tierList(def)).toHaveLength(LIMITS.tiers);
    expect(problems(def)).toEqual([]);
  });

  it('renames one, keeping its id, never blank or too long', () => {
    let def = withTierLabel(withNewTier(H, []), 'new_tier', 'BOSS');
    expect(tierList(def)[0]).toEqual({ id: 'new_tier', label: 'BOSS' });
    expect(withTierLabel(def, 'new_tier', '  ')).toBe(def);
    def = withTierLabel(def, 'new_tier', 'x'.repeat(50));
    expect(tierList(def)[0].label).toHaveLength(30);
    expect(problems(def)).toEqual([]);
  });

  it('sets HP and defense to a number, a formula or dice, and blank back to the token\'s own', () => {
    let def = withTierBox(withTierBox(withNewTier(H, []), 'new_tier', 'hp', '@level d8 + 4'), 'new_tier', 'defense', ' 13 ');
    expect(tierList(def)[0]).toMatchObject({ hp: '@level d8 + 4', defense: 13 });
    expect(problems(def)).toEqual([]);
    expect([boxText(tierList(def)[0].hp), boxText(tierList(def)[0].defense), boxText(undefined)]).toEqual(['@level d8 + 4', '13', '']);
    def = withTierBox(def, 'new_tier', 'hp', ' ');
    expect('hp' in tierList(def)[0]).toBe(false);
    def = withTierBox(def, 'new_tier', 'defense', '3d1');
    expect(problems(def)).toEqual(['npc tier new_tier, defense: A die has 2 to 1000 sides']);
  });

  it('starts a field with a number, formula or dice, or text as written, blank leaving it empty', () => {
    let def = withNewTier(H, fieldsOf(H), 'BOSS');
    def = withTierValue(def, 'boss', field(def, 'str'), '4d6');
    def = withTierValue(def, 'boss', field(def, 'concept'), 'Warlord ');
    expect(tierList(def)[0].values).toEqual({ level: '@level', str: '4d6', concept: 'Warlord ' });
    expect(problems(def)).toEqual([]);
    def = withTierValue(def, 'boss', field(def, 'str'), '14');
    expect(tierList(def)[0].values!.str).toBe(14);
    def = withTierValue(def, 'boss', field(def, 'concept'), '');
    def = withTierValue(def, 'boss', field(def, 'level'), '');
    def = withTierValue(def, 'boss', field(def, 'str'), '');
    expect('values' in tierList(def)[0]).toBe(false);
    // A text field keeps digits as text.
    expect(tierList(withTierValue(def, 'boss', field(def, 'concept'), '42'))[0].values).toEqual({ concept: '42' });
  });

  it('is worked out by the server as the page wrote it', () => {
    let def = withNewTier(H, fieldsOf(H), 'BOSS');
    def = withTierBox(withTierBox(def, 'boss', 'hp', '@level d10 + 10'), 'boss', 'defense', '14 + floor(@level / 2)');
    def = withTierValue(def, 'boss', field(def, 'str'), '10 + @level');
    const fields = new Map(fieldsOf(def).map((f) => [f.id, f]));
    const r = rollTier(tierList(def)[0], 6, fields, { hp: 9999, defense: 99 });
    expect([r.defense.value, r.values.str.value, r.values.level.value, r.hp.dice[0].count]).toEqual([17, 16, 6, 6]);
  });

  it('moves one up and down, the top one being the default, and removes one', () => {
    let def = withNewTier(withNewTier(withNewTier(H, [], 'A'), [], 'B'), [], 'C');
    def = withTierMoved(def, 'c', -1);
    expect(tierList(def).map((t) => t.id)).toEqual(['a', 'c', 'b']);
    expect(withTierMoved(def, 'a', -1)).toBe(def);
    expect(withTierMoved(def, 'b', 1)).toBe(def);
    expect(withTierMoved(def, 'zzz', 1)).toBe(def);
    def = withoutTier(def, 'c');
    expect(tierList(def).map((t) => t.id)).toEqual(['a', 'b']);
    expect('npc' in withoutTier(withoutTier(def, 'a'), 'b')).toBe(false);
  });

  it('keeps a stat block of their own when the last tier goes', () => {
    const def = withoutTier(withNewTier(withOwnBlock(H, SHEET), []), 'new_tier');
    expect(def.npc).toEqual({ sheet: SHEET });
  });
});

describe('TRY IT', () => {
  const TRIED = {
    level: 6,
    hp: { value: 34, dice: [{ count: 6, sides: 8, rolls: [3, 8, 6, 7, 4, 2] }] },
    defense: { error: 'A die has 2 to 1000 sides' },
    values: { str: { value: 10, dice: [{ count: 3, sides: 6, rolls: [4, 3, 3] }] }, level: { value: 6, dice: [] }, bad: { error: 'Only @level can be used here, not @x' }, nothing: { blank: true as const } },
  };

  it('pins each mistake to its box', () => {
    expect(boxErrors(TRIED)).toEqual({ defense: 'A die has 2 to 1000 sides', values: { bad: 'Only @level can be used here, not @x' } });
    expect(boxErrors(null)).toEqual({ values: {} });
    expect(boxErrors({ ...TRIED, hp: { error: 'x' } }).hp).toBe('x');
  });

  it('shows each result with what the dice came up', () => {
    expect(triedText(TRIED.hp)).toEqual({ value: '34', dice: '6d8 [3 8 6 7 4 2]' });
    expect(triedText(TRIED.values.level)).toEqual({ value: '6', dice: '' });
    expect(triedText(TRIED.defense)).toEqual({ value: '—', dice: '' });
    expect(triedText(TRIED.values.nothing)).toEqual({ value: '—', dice: '' });
    expect(triedText(undefined)).toEqual({ value: '—', dice: '' });
  });
});
