/**
 * A system's own house rules (4j; approved mockup docs/mockups/optional-rules.html, 2026-10-14):
 * the list, and the four kinds of thing that wait on one (a part, a sheet section, a condition, a
 * formula's alternative), as the definition checks see them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { starterSheet } = require_('../systemBuilder/sheet');
const { houseRuleIdsOf, houseRulesOn, withHouseRules, choicesFrom, houseRuleKey, LIMITS } = require_('../systemBuilder/houseRules');
const runtime = require_('../systemBuilder/runtime');
const { conditionsOf } = require_('../systemBuilder/conditions');

const RULES = [
  { id: 'magic', name: 'MAGIC', description: 'Characters can learn spells.', starts: false },
  { id: 'gritty', name: 'GRITTY WOUNDS', starts: false },
  { id: 'markets', name: 'TOWN MARKETS', starts: true },
];
const BASE = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }, { id: 'wis', label: 'Wisdom' }] }],
  derived: [{ id: 'max_hp', formula: '10 + @con' }, { id: 'mana', formula: '2 * @wis' }],
};
/** HEARTH with every kind of thing under a house rule, as the mockup has it. */
const hearth = (over = {}) => {
  const sheet = starterSheet(BASE);
  sheet.sections[0].only_with = 'magic';
  const npcSheet = starterSheet(BASE);
  npcSheet.sections[0].only_with = 'gritty';
  return {
    ...BASE,
    house_rules: RULES,
    derived: [{ ...BASE.derived[0], alternative: { rule: 'gritty', formula: '@con' } }, BASE.derived[1]],
    parts: { shops: { on: true, only_with: 'markets' } },
    sheet,
    npc: { sheet: npcSheet },
    conditions: { prone: { only_with: 'gritty' }, hexed: { name: 'Hexed', only_with: 'magic' } },
    ...over,
  };
};
const problems = (def) => checkDefinition(def).problems.map((p) => `${p.where}: ${p.message}`);

describe('a system with house rules', () => {
  it('has no problems with every kind of thing under one', () => {
    expect(problems(hearth())).toEqual([]);
    expect([...houseRuleIdsOf(hearth())]).toEqual(['magic', 'gritty', 'markets']);
  });

  it('and none without any', () => {
    expect(problems(BASE)).toEqual([]);
    expect([...houseRuleIdsOf(BASE)]).toEqual([]);
  });
});

describe('the list', () => {
  it('is a list of rules, each well formed', () => {
    expect(problems(hearth({ house_rules: { magic: {} } }))).toContain('house_rules: Must be a list of house rules');
    const list = [
      'nope',
      { id: 'Magic', name: 'X' },
      { id: 'twice', name: 'A' }, { id: 'twice', name: 'B' },
      { id: 'quiet' },
      { id: 'blank', name: '  ' },
      { id: 'long', name: 'X'.repeat(LIMITS.name + 1), description: 'Y'.repeat(LIMITS.description + 1) },
      { id: 'odd', name: 'Odd', starts: 'yes', colour: 'red' },
    ];
    expect(problems({ ...BASE, house_rules: list })).toEqual([
      'house rule 1: Must be a house rule',
      'house rule Magic: Ids use lowercase letters, digits and _, starting with a letter',
      'house rule twice: Defined twice',
      'house rule quiet, name: Required',
      'house rule blank, name: Cannot be blank',
      `house rule long, name: Longer than ${LIMITS.name} characters`,
      `house rule long, description: Longer than ${LIMITS.description} characters`,
      'house rule odd, colour: Not part of a house rule',
      'house rule odd, starts: Must say starts: true or starts: false',
    ]);
  });

  it('holds at most twenty', () => {
    const many = Array.from({ length: LIMITS.rules + 1 }, (_, i) => ({ id: `r${i}`, name: `R${i}` }));
    expect(problems({ ...BASE, house_rules: many })).toEqual([`house_rules: At most ${LIMITS.rules} house rules`]);
    expect(problems({ ...BASE, house_rules: many.slice(0, LIMITS.rules) })).toEqual([]);
  });
});

describe('what waits on a rule', () => {
  it('names one of the system\'s house rules, wherever it is', () => {
    const def = hearth();
    def.parts.shops.only_with = 'nope';
    def.sheet.sections[1].only_with = 'nope';
    def.npc.sheet.sections[0].only_with = 3;
    def.conditions.hexed.only_with = 'MAGIC';
    expect(problems(def)).toEqual([
      'parts shops, only_with: Not one of this system\'s house rules',
      `sheet section ${def.sheet.sections[1].id}, only_with: Not one of this system's house rules`,
      `npc sheet section ${def.npc.sheet.sections[0].id}, only_with: Not one of this system's house rules`,
      'condition hexed, only_with: Not one of this system\'s house rules',
    ]);
  });

  it('can\'t wait on a rule a system doesn\'t have', () => {
    const def = hearth();
    delete def.house_rules;
    expect(problems(def).length).toBe(6);
    expect(problems(def).every((p) => p.endsWith('Not one of this system\'s house rules'))).toBe(true);
  });

  it('is still refused elsewhere: only the four places take it', () => {
    const def = hearth({ rests: { long_rest: { only_with: 'magic' } }, words: { hp: { singular: 'Wound', only_with: 'magic' } } });
    expect(problems(def)).toEqual(['words hp, only_with: Only singular, plural and short', 'rest long_rest, only_with: Not part of a rest']);
  });
});

describe('a formula\'s alternative', () => {
  const withDerived = (derived) => hearth({ derived });

  it('is a house rule and a formula, on a formula', () => {
    expect(problems(withDerived([
      { id: 'a', formula: '1', alternative: 'magic' },
      { id: 'b', formula: '1', alternative: { rule: 'nope', formula: '' } },
      { id: 'c', formula: '1', alternative: { rule: 'magic', formula: '2', when: 'x' } },
      { id: 'd', kind: 'condition', when: '1', then: '1', else: '0', alternative: { rule: 'magic', formula: '2' } },
    ]))).toEqual([
      'derived a, alternative: Must say a house rule and a formula',
      'derived b, alternative, rule: Not one of this system\'s house rules',
      'derived b, alternative, formula: Cannot be blank',
      'derived c, alternative, when: Only a house rule and a formula',
      'derived d, alternative: Only a formula has an alternative',
    ]);
  });

  it('is read as the engine reads it, its mistakes said where it is', () => {
    expect(problems(withDerived([{ id: 'a', formula: '1', alternative: { rule: 'magic', formula: 'mod(' } }])))
      .toEqual([expect.stringMatching(/^derived a, alternative, formula: /)]);
  });

  it('can\'t make a loop with its rule on', () => {
    expect(problems(withDerived([{ id: 'a', formula: '1', alternative: { rule: 'magic', formula: '@a + 1' } }])))
      .toEqual([expect.stringMatching(/^derived a: .* \(with magic on\)$/)]);
  });

  it('nor with every rule on, where only two together make one', () => {
    const got = problems(withDerived([
      { id: 'a', formula: '1', alternative: { rule: 'magic', formula: '@b' } },
      { id: 'b', formula: '2', alternative: { rule: 'gritty', formula: '@a' } },
    ]));
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((p) => p.endsWith('(with magic, gritty on)'))).toBe(true);
  });

  it('nor with one rule on, where turning another on as well would undo it', () => {
    const got = problems(withDerived([
      { id: 'a', formula: '1', alternative: { rule: 'magic', formula: '@b' } },
      { id: 'b', formula: '@a', alternative: { rule: 'gritty', formula: '1' } },
    ]));
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((p) => p.endsWith('(with magic on)'))).toBe(true);
  });
  it('doesn\'t say a formula\'s own mistake twice', () => {
    const got = problems(withDerived([
      { id: 'a', formula: '1', alternative: { rule: 'magic', formula: '2' } },
      { id: 'broken', formula: 'mod(' },
    ]));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^derived broken, formula: /);
  });

  it('a fine alternative, with or without its rule, adds nothing', () => {
    expect(problems(withDerived([
      { id: 'a', formula: '1', alternative: { rule: 'magic', formula: '@con + 2' } },
      { id: 'b', formula: '@a * 2', alternative: { rule: 'gritty', formula: '@a' } },
    ]))).toEqual([]);
  });
});

describe('which are on', () => {
  it('as each starts, until the table chooses', () => {
    expect([...houseRulesOn(hearth())]).toEqual(['markets']);
    expect([...houseRulesOn(hearth(), { magic: true, markets: false })]).toEqual(['magic']);
    expect([...houseRulesOn(hearth(), { nope: true, gritty: 'yes' })]).toEqual(['markets']);
    expect([...houseRulesOn(BASE)]).toEqual([]);
  });

  it('the table\'s choices for one system, from the settings', () => {
    const rows = [
      { key: houseRuleKey('sys_a', 'magic'), value: '1' }, { key: 'house_rule:sys_a:gritty', value: '0' },
      { key: 'house_rule:sys_a:odd', value: 'yes' }, { key: 'house_rule:sys_b:magic', value: '0' }, { key: 'game_system', value: 'sys_a' },
    ];
    expect(houseRuleKey('sys_a', 'magic')).toBe('house_rule:sys_a:magic');
    expect(choicesFrom(rows, 'sys_a')).toEqual({ magic: true, gritty: false });
    expect(choicesFrom(rows, 'sys_b')).toEqual({ magic: false });
    expect(choicesFrom(null, 'sys_a')).toEqual({});
  });
});

describe('the game, with its house rules applied', () => {
  /** HEARTH on two tabs: SPELLS (and its tab) waits on MAGIC. */
  const tabbed = () => {
    const def = hearth();
    def.sheet = { ...def.sheet, tabs: ['STATS', 'MAGIC'], header: { nameField: 'name', subtitleFields: ['concept', 'spell'] },
      sections: [...def.sheet.sections.map(({ only_with, ...s }) => ({ ...s, tab: 'STATS' })),
        { id: 'spells', label: 'SPELLS', layout: 'list', tab: 'MAGIC', only_with: 'magic', fields: [{ id: 'spell', label: 'Spell', type: 'text' }] }] };
    return def;
  };

  it('hides what waits on a rule that is off, never deleting it', () => {
    const def = tabbed();
    const stored = JSON.stringify(def);
    const off = withHouseRules(def, new Set());
    expect(JSON.stringify(def)).toBe(stored);
    expect(off.parts.shops).toEqual({ on: false, only_with: 'markets' });
    expect(off.sheet.sections.map((s) => s.id)).not.toContain('spells');
    expect(off.sheet.tabs).toEqual(['STATS']);
    expect(off.sheet.header.subtitleFields).toEqual(['concept']);
    expect(off.npc.sheet.sections).toHaveLength(def.npc.sheet.sections.length - 1);
    expect(conditionsOf(off).map((c) => c.id)).not.toContain('hexed');
    expect(conditionsOf(off).map((c) => c.id)).not.toContain('prone');
    expect(off.conditions.prone).toEqual({ only_with: 'gritty', on: false });
    expect(off.derived[0].formula).toBe('10 + @con');
  });

  it('and shows it all again with the rules on, alternatives in their formulas\' place', () => {
    const def = tabbed();
    const on = withHouseRules(def, new Set(['magic', 'gritty', 'markets']));
    expect(on.parts.shops).toEqual({ on: true, only_with: 'markets' });
    expect(on.sheet).toBe(def.sheet);
    expect(on.npc.sheet).toBe(def.npc.sheet);
    expect(conditionsOf(on).map((c) => c.id)).toEqual(conditionsOf(def).map((c) => c.id));
    expect(on.derived[0].formula).toBe('@con');
    expect(on.derived[1]).toBe(def.derived[1]);
  });

  it('drops every tab when nothing is left on any, and leaves a system with no rules as it is', () => {
    const def = tabbed();
    def.sheet.sections = def.sheet.sections.map((s) => ({ ...s, only_with: 'magic' }));
    const off = withHouseRules(def, new Set());
    expect(off.sheet.sections).toEqual([]);
    expect(off.sheet).not.toHaveProperty('tabs');
    expect(withHouseRules(BASE, new Set())).toEqual(BASE);
    expect(withHouseRules(null, new Set())).toBeNull();
  });

  describe('as the running game loads it', () => {
    const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
    let db;
    beforeEach(async () => {
      db = await makeTestDb();
      const def = JSON.stringify(tabbed());
      await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', def, def]);
    });
    const choose = (rule, value) => run(db, 'INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)', [houseRuleKey(HEARTH, rule), value]);
    const load = () => new Promise((resolve) => runtime.load(db, resolve));
    const refresh = () => new Promise((resolve) => runtime.refresh(db, HEARTH, resolve));

    it('runs each rule as it starts, and says so', async () => {
      await load();
      expect(runtime.houseRulesIn(HEARTH)).toEqual([
        { id: 'magic', name: 'MAGIC', description: 'Characters can learn spells.', starts: false, on: false },
        { id: 'gritty', name: 'GRITTY WOUNDS', description: '', starts: false, on: false },
        { id: 'markets', name: 'TOWN MARKETS', description: '', starts: true, on: true },
      ]);
      expect(runtime.render(HEARTH).house_rules).toEqual(runtime.houseRulesIn(HEARTH));
      expect(runtime.partIn(HEARTH, 'shops')).toBe(true);
      expect(runtime.render(HEARTH).sheet.tabs).toEqual(['STATS']);
      expect(runtime.conditionsIn(HEARTH).map((c) => c.id)).not.toContain('hexed');
      const data = { con: 3 };
      runtime.meta(HEARTH).recompute(data);
      expect(data.max_hp).toBe(13);
    });

    it('runs the table\'s choice, read again when one changes', async () => {
      await choose('magic', '1');
      await choose('markets', '0');
      await load();
      expect(runtime.houseRulesIn(HEARTH).filter((r) => r.on).map((r) => r.id)).toEqual(['magic']);
      expect(runtime.partIn(HEARTH, 'shops')).toBe(false);
      expect(runtime.render(HEARTH).sheet.tabs).toEqual(['STATS', 'MAGIC']);
      expect(runtime.conditionsIn(HEARTH).map((c) => c.id)).toContain('hexed');
      await choose('gritty', '1');
      await refresh();
      const data = { con: 3 };
      runtime.meta(HEARTH).recompute(data);
      expect(data.max_hp).toBe(3);
      expect(runtime.conditionsIn(HEARTH).map((c) => c.id)).toContain('prone');
      await choose('gritty', '0');
      await refresh();
      const again = { con: 3 };
      runtime.meta(HEARTH).recompute(again);
      expect(again.max_hp).toBe(13);
    });

    it('has none for a built-in game or a system it hasn\'t loaded', async () => {
      await load();
      expect(runtime.houseRulesIn('cities_without_number')).toEqual([]);
      expect(runtime.houseRulesIn('sys_zzzzzzzzzzzzzzzz')).toEqual([]);
    });
  });
});