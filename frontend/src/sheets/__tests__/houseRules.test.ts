import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import {
  houseRuleList, withNewHouseRule, withHouseRule, withoutHouseRule, waitingOn, withHouseRuleOn, houseRulesIn, changedRules, LIMITS,
} from '../houseRules';
import { withAlternative, formulaList } from '../statsRules';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';
import type { Definition } from '../systemsApi';
import { withPart, withPartOnlyWith, partOnlyWith, partIsOn } from '../wordsFeatures';
import { withCondition } from '../conditions';
import { withSection, sheetOf } from '../sheetDesigner';

/**
 * The builder's HOUSE RULES as logic (4j3a; approved mockup docs/mockups/optional-rules.html,
 * 2026-10-14), held to the server's own checks (backend systemBuilder/houseRules.js through
 * definition.js): every edit here makes a definition the server takes.
 */

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { starterSheet } = req('../../../../backend/systemBuilder/sheet.js');
const backend = req('../../../../backend/systemBuilder/houseRules.js');

const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

const BASE = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
} as Definition;
/** HEARTH as the mockup has it: something of every kind under a rule. */
const hearth = (): Definition => {
  const sheet = starterSheet(BASE);
  sheet.sections[0].only_with = 'magic';
  const npcSheet = starterSheet(BASE);
  npcSheet.sections[0].only_with = 'gritty';
  return {
    ...BASE,
    house_rules: [
      { id: 'magic', name: 'MAGIC', description: 'Characters can learn spells.' },
      { id: 'gritty', name: 'GRITTY WOUNDS' },
      { id: 'markets', name: 'TOWN MARKETS', starts: true },
    ],
    parts: { shops: { on: true, only_with: 'markets' }, vehicles: { on: false } },
    sheet,
    npc: { sheet: npcSheet },
    conditions: { prone: { only_with: 'gritty' }, poisoned: { name: 'Venom', only_with: 'gritty' }, hexed: { name: 'Hexed', only_with: 'magic' } },
    derived: [{ id: 'max_hp', label: 'Max HP', formula: '10 + @con', alternative: { rule: 'gritty', formula: '@con' } }, { id: 'mana', formula: '2' }],
  } as Definition;
};

describe('the list', () => {
  it('is what the server checks, in order, those it can show', () => {
    expect(problems(hearth())).toEqual([]);
    expect(houseRuleList(hearth()).map((r) => r.id)).toEqual(['magic', 'gritty', 'markets']);
    expect(houseRuleList({ ...BASE, house_rules: ['x', { name: 'no id' }, { id: 'nameless' }] } as unknown as Definition)).toEqual([{ id: 'nameless', name: '' }]);
    expect(houseRuleList(BASE)).toEqual([]);
    expect(LIMITS).toEqual(backend.LIMITS);
  });

  it('gains a rule named to be renamed, starting off, up to twenty', () => {
    const one = withNewHouseRule(BASE)!;
    expect(one.id).toBe('new_rule');
    expect(one.definition.house_rules).toEqual([{ id: 'new_rule', name: 'NEW RULE' }]);
    expect(problems(one.definition)).toEqual([]);
    expect(withNewHouseRule(one.definition)!.id).toBe('new_rule_2');
    let def: Definition = BASE;
    for (let i = 0; i < LIMITS.rules; i += 1) def = withNewHouseRule(def)!.definition;
    expect(problems(def)).toEqual([]);
    expect(withNewHouseRule(def)).toBeNull();
  });
});

describe('a rule changed', () => {
  it('keeps its id, so what waits on it stays with it', () => {
    const def = withHouseRule(hearth(), 'magic', { name: 'SORCERY', description: 'Spells.', starts: true });
    expect(houseRuleList(def)[0]).toEqual({ id: 'magic', name: 'SORCERY', description: 'Spells.', starts: true });
    expect(waitingOn(def, 'magic').length).toBe(2);
    expect(problems(def)).toEqual([]);
  });

  it('stores nothing for an empty description or starting off, and keeps a blank name for the server to point at', () => {
    const def = withHouseRule(withHouseRule(hearth(), 'markets', { starts: false }), 'magic', { description: '  ', name: '' });
    expect(houseRuleList(def)[0]).toEqual({ id: 'magic', name: '' });
    expect(houseRuleList(def)[2]).toEqual({ id: 'markets', name: 'TOWN MARKETS' });
    expect(problems(def)).toEqual(['house rule magic, name: Cannot be blank']);
  });

  it('touches no other rule', () => {
    const def = withHouseRule(hearth(), 'gritty', { starts: true });
    expect(houseRuleList(def).filter((r) => r.id !== 'gritty')).toEqual(houseRuleList(hearth()).filter((r) => r.id !== 'gritty'));
  });
});

describe('a rule deleted', () => {
  it('leaves what waited on it always there, and the server takes it', () => {
    const def = withoutHouseRule(hearth(), 'gritty');
    expect(houseRuleList(def).map((r) => r.id)).toEqual(['magic', 'markets']);
    expect(problems(def)).toEqual([]);
    expect(waitingOn(def, 'gritty')).toEqual([]);
    // A standard condition with nothing else changed stores nothing; one renamed keeps its name.
    expect(def.conditions).toEqual({ poisoned: { name: 'Venom' }, hexed: { name: 'Hexed', only_with: 'magic' } });
    expect(def.derived).toEqual([{ id: 'max_hp', label: 'Max HP', formula: '10 + @con' }, { id: 'mana', formula: '2' }]);
    expect((def.npc as { sheet: { sections: object[] } }).sheet.sections[0]).not.toHaveProperty('only_with');
    // The others keep theirs.
    expect(waitingOn(def, 'magic').map((w) => w.kind)).toEqual(['SHEET SECTION', 'CONDITION']);
    expect(def.parts).toEqual({ shops: { on: true, only_with: 'markets' }, vehicles: { on: false } });
  });

  it('every one of them, leaving nothing behind', () => {
    let def = hearth();
    for (const id of ['magic', 'gritty', 'markets']) def = withoutHouseRule(def, id);
    expect(def).not.toHaveProperty('house_rules');
    expect(def.conditions).toEqual({ poisoned: { name: 'Venom' }, hexed: { name: 'Hexed' } });
    expect(def.parts).toEqual({ shops: { on: true }, vehicles: { on: false } });
    expect(JSON.stringify(def)).not.toContain('only_with');
    expect(problems(def)).toEqual([]);
  });

  it('only that rule\'s: another rule\'s alternative stays, and conditions left with nothing go', () => {
    const def = withoutHouseRule({
      ...BASE,
      house_rules: [{ id: 'magic', name: 'MAGIC' }, { id: 'gritty', name: 'GRITTY' }],
      conditions: { prone: { only_with: 'gritty' } },
      derived: [{ id: 'a', formula: '1', alternative: { rule: 'magic', formula: '2' } }, { id: 'b', formula: '1', alternative: { rule: 'gritty', formula: '3' } }],
    } as Definition, 'gritty');
    expect(def.derived).toEqual([{ id: 'a', formula: '1', alternative: { rule: 'magic', formula: '2' } }, { id: 'b', formula: '1' }]);
    expect(def).not.toHaveProperty('conditions');
    expect(problems(def)).toEqual([]);
  });

  it('changes nothing in the definition it was given', () => {
    const def = hearth();
    const before = JSON.stringify(def);
    withoutHouseRule(def, 'gritty');
    withHouseRule(def, 'magic', { name: 'X' });
    expect(JSON.stringify(def)).toBe(before);
  });
});

describe('what waits on a rule', () => {
  it('everything, by the page it lives on, with GO TO\'s page', () => {
    const def = hearth();
    const sheet = def.sheet as { sections: { id: string; label: string }[] };
    expect(waitingOn(def, 'gritty')).toEqual([
      { kind: 'NPC SECTION', id: (def.npc as { sheet: { sections: { id: string }[] } }).sheet.sections[0].id, label: expect.any(String), page: 'npcs' },
      // In the order the CONDITIONS page lists them.
      { kind: 'CONDITION', id: 'poisoned', label: 'Venom', page: 'conditions' },
      { kind: 'CONDITION', id: 'prone', label: 'Prone', page: 'conditions' },
      { kind: 'FORMULA', id: 'max_hp', label: 'Max HP', page: 'rules' },
    ]);
    expect(waitingOn(def, 'magic')).toEqual([
      { kind: 'SHEET SECTION', id: sheet.sections[0].id, label: sheet.sections[0].label, page: 'sheet' },
      { kind: 'CONDITION', id: 'hexed', label: 'Hexed', page: 'conditions' },
    ]);
    expect(waitingOn(def, 'markets')).toEqual([{ kind: 'FEATURES PART', id: 'shops', label: 'SHOPS', page: 'features' }]);
    expect(waitingOn(def, 'nope')).toEqual([]);
  });
});

describe('putting things under a rule (4j4a)', () => {
  const ruled = { ...BASE, house_rules: [{ id: 'magic', name: 'MAGIC' }] } as Definition;

  it('a part, on or off as it was, its rule kept when it is switched', () => {
    let def = withPartOnlyWith(ruled, 'shops', 'magic');
    expect(def.parts).toEqual({ shops: { on: true, only_with: 'magic' } });
    expect(partOnlyWith(def, 'shops')).toBe('magic');
    def = withPart(def, 'shops', false);
    expect(def.parts).toEqual({ shops: { on: false, only_with: 'magic' } });
    expect(partIsOn(def, 'shops')).toBe(false);
    def = withPart(def, 'shops', true);
    expect(def.parts).toEqual({ shops: { on: true, only_with: 'magic' } });
    expect(problems(def)).toEqual([]);
    expect(withPartOnlyWith(def, 'shops', null).parts).toBeUndefined();
    expect(withPartOnlyWith(withPart(ruled, 'vehicles', false), 'vehicles', null).parts).toEqual({ vehicles: { on: false } });
    expect(partOnlyWith(ruled, 'shops')).toBeUndefined();
  });

  it('a condition, standard or the system\'s own, cleared to store nothing', () => {
    let def = withCondition(ruled, 'prone', { only_with: 'magic' });
    expect(def.conditions).toEqual({ prone: { only_with: 'magic' } });
    def = withCondition(def, 'prone', { only_with: null });
    expect(def.conditions).toBeUndefined();
    def = withCondition(ruled, 'hexed', { name: 'Hexed', only_with: 'magic' });
    expect(def.conditions).toEqual({ hexed: { name: 'Hexed', only_with: 'magic' } });
    expect(problems(def)).toEqual([]);
    expect(withCondition(def, 'hexed', { only_with: '' }).conditions).toEqual({ hexed: { name: 'Hexed' } });
  });

  it('a sheet section, cleared to store nothing', () => {
    const custom = { ...ruled, sheet: starterSheet(ruled) } as Definition;
    const id = sheetOf(custom)!.sections[0].id;
    let def = withSection(custom, id, { only_with: 'magic' });
    expect(sheetOf(def)!.sections[0].only_with).toBe('magic');
    expect(problems(def)).toEqual([]);
    // Another setting changed keeps it.
    expect(sheetOf(withSection(def, id, { label: 'X' }))!.sections[0].only_with).toBe('magic');
    def = withSection(def, id, { only_with: null });
    expect(sheetOf(def)!.sections[0]).not.toHaveProperty('only_with');
  });
});

describe('a formula\'s alternative (4j4b)', () => {
  const ruled = { ...BASE, house_rules: [{ id: 'magic', name: 'MAGIC' }, { id: 'gritty', name: 'GRITTY' }],
    derived: [{ id: 'max_hp', formula: '10 + @con' }, { id: 'mana', formula: '2' }, { id: 'hurt', kind: 'condition', when: '1', then: '1', else: '0' }] } as unknown as Definition;

  it('starts from the formula as it stands, then is written, and cleared with its rule', () => {
    let def = withAlternative(ruled, 'max_hp', { rule: 'gritty' });
    expect(formulaList(def)[0]).toEqual({ id: 'max_hp', formula: '10 + @con', alternative: { rule: 'gritty', formula: '10 + @con' } });
    def = withAlternative(def, 'max_hp', { formula: '@con' });
    def = withAlternative(def, 'max_hp', { rule: 'magic' });
    expect(formulaList(def)[0].alternative).toEqual({ rule: 'magic', formula: '@con' });
    expect(problems(def)).toEqual([]);
    expect(formulaList(withAlternative(def, 'max_hp', { rule: null }))[0]).toEqual({ id: 'max_hp', formula: '10 + @con' });
    expect(formulaList(withAlternative(def, 'max_hp', { rule: '' }))[0]).not.toHaveProperty('alternative');
  });

  it('needs a rule first, and never goes on a condition', () => {
    expect(withAlternative(ruled, 'mana', { formula: '4' }).derived).toEqual(ruled.derived);
    expect(withAlternative(ruled, 'hurt', { rule: 'magic' }).derived).toEqual(ruled.derived);
  });

  it('is worked out in its formula\'s place with its rule on, as the server runs it', () => {
    const def = withAlternative(withAlternative(withAlternative(ruled, 'max_hp', { rule: 'gritty' }), 'max_hp', { formula: '@con' }), 'mana', { rule: 'magic' });
    const on = withHouseRuleOn(def, 'gritty');
    expect((on.derived as { formula: string }[]).map((d) => d.formula)).toEqual(['@con', '2', undefined]);
    expect(on.derived).toEqual(backend.withHouseRules(def, new Set(['gritty'])).derived);
    expect(withHouseRuleOn(def, 'nope').derived).toEqual(def.derived);
    expect(withHouseRuleOn(BASE, 'gritty')).toBe(BASE);
  });
});

describe('the rules a running game has on (4j5a)', () => {
  const RUNNING = [
    { id: 'magic', name: 'MAGIC', description: '', starts: false, on: false },
    { id: 'markets', name: 'TOWN MARKETS', description: '', starts: true, on: true },
  ];

  it('are read from a custom system\'s render copy, none for anything else', () => {
    clearCustomTemplates();
    registerCustomTemplate({ id: 'sys_aaaaaaaaaaaaaaaa', name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {}, house_rules: RUNNING });
    registerCustomTemplate({ id: 'sys_bbbbbbbbbbbbbbbb', name: 'Plain', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
    expect(houseRulesIn('sys_aaaaaaaaaaaaaaaa')).toEqual(RUNNING);
    expect(houseRulesIn('sys_bbbbbbbbbbbbbbbb')).toEqual([]);
    expect(houseRulesIn('cities_without_number')).toEqual([]);
    expect(houseRulesIn(null)).toEqual([]);
    clearCustomTemplates();
  });

  it('only the boxes that differ from them are sent', () => {
    expect(changedRules(RUNNING, { magic: true, markets: true })).toEqual({ magic: true });
    expect(changedRules(RUNNING, { magic: false, markets: false, nope: true })).toEqual({ markets: false });
    expect(changedRules(RUNNING, {})).toEqual({});
  });
});