import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import {
  GROUPS, OTHER_NAMES, valueText, changeLine, characterLine, byChange, byCharacter, otherLine, changesCharacters,
  headline, subline, type Change, type PublishPreview,
} from '../versionPreview';
import { systemsApi } from '../systemsApi';

/**
 * What PUBLISH would change, as the builder says it (4h3; approved mockup
 * docs/mockups/version-preview.html). The answers here are made by the server's own comparison
 * (backend/systemBuilder/versionDiff.js), so every change it can name has words here.
 */

const req = createRequire(import.meta.url);
const { OTHER, versionChanges, characterChanges, sampleChanges } = req('../../../../backend/systemBuilder/versionDiff.js');

type Preview = Extract<PublishPreview, { first: false }>;

const sheet = (fields: object[]) => ({ tabs: ['MAIN'], sections: [{ id: 'main', label: 'MAIN', layout: 'list', fields }] });
const CALLING = { id: 'calling', label: 'Calling', type: 'select', options: [{ value: 'knight', label: 'Knight' }, { value: 'hedge', label: 'Hedge mage' }] };
const V2 = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'attrs', label: 'A', stats: [{ id: 'might', label: 'Might', min: 3, max: 20 }, { id: 'agility', label: 'Agility', min: 3, max: 18 }] }],
  samples: { might: 12, agility: 14 },
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility' }, { id: 'guard', label: 'Guard', formula: '@defense + 1' }, { id: 'old_bonus', label: 'Old bonus', formula: '@might' }],
  sheet: sheet([{ id: 'grit', label: 'Grit', type: 'number' }, { id: 'reputation', label: 'Reputation', type: 'number' }, { id: 'notes', label: 'Wound notes', type: 'textarea' }, { id: 'secret', label: 'Secret', type: 'text', edit: 'gm' }, CALLING]),
  currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }],
  conditions: { cursed: { name: 'Cursed' } },
  parts: { xp: { on: false } },
};
const V3 = {
  ...V2,
  words: { gm: { singular: 'Keeper' } },
  rests: { short_rest: { name: 'Breather' } },
  stats: [{ id: 'attrs', label: 'A', stats: [{ id: 'might', label: 'Might', min: 3, max: 18 }, { id: 'agility', label: 'Agility', min: 3, max: 18 }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility + 2' }, { id: 'guard', label: 'Guard', formula: '@defense + 1' }, { id: 'carry', label: 'Carry limit', formula: '@might - 4' }],
  sheet: sheet([{ id: 'grit', label: 'Resolve', type: 'number', edit: 'gm' }, { id: 'notes', label: 'Wound notes', type: 'textarea' }, { id: 'secret', label: 'Secret', type: 'text' }, { ...CALLING, options: [CALLING.options[0]] }, { id: 'oath', label: 'Oath', type: 'text' }]),
  currencies: [{ id: 'gold', name: 'Gold' }, { id: 'coin', name: 'Coin' }],
  conditions: { glitch: { name: 'Glitching' } },
  parts: { vehicles: { on: false } },
  core: { health: { model: 'tracks' } },
};

/** The server's answer for these two versions, as publishPreview.js builds it. */
const preview = (characters: { name: string; kind?: 'player' | 'npc'; data: object; extra?: Change[] }[]): Preview => ({
  first: false, from: 2, to: 3, problems: 0,
  changes: versionChanges(V2, V3),
  characters: characters.map((c) => ({ kind: c.kind ?? 'player', username: c.name.toLowerCase(), name: c.name, changes: [...characterChanges(V2, V3, c.data), ...(c.extra ?? [])] })),
  sample: characters.length ? null : sampleChanges(V2, V3),
});
const VEX = { name: 'Vex', data: { might: 19, agility: 14, reputation: 3, calling: 'hedge' }, extra: [
  { kind: 'currency', change: 'held', id: 'favor', label: 'Favor', balance: 12, debt: 2 } as Change,
  { kind: 'condition', change: 'on_token', id: 'cursed', label: 'Cursed' } as Change,
] };
const ROOK = { name: 'Rook', data: { might: 10, agility: 12, calling: 'knight' } };

describe('held to the server', () => {
  it('has words for every change the server names, and one line for the rest', () => {
    const all = [...versionChanges(V2, V3), ...versionChanges(V3, V2)];
    for (const c of all.filter((x: Change) => x.kind !== 'other')) expect(changeLine(c), `${c.kind} ${c.change}`).not.toBeNull();
    expect(Object.keys(OTHER_NAMES).sort()).toEqual([...OTHER].sort());
  });

  it('has words for everything one character can have', () => {
    for (const c of preview([VEX]).characters[0].changes) expect(characterLine(c), `${c.kind} ${c.change}`).not.toBe('');
  });

  it('has a group for every kind but the one-line ones', () => {
    expect(GROUPS.flatMap((g) => g.kinds).sort()).toEqual(['condition', 'currency', 'formula', 'health', 'house_rule', 'part', 'sheet', 'stat']);
  });
});

describe('each change, in words', () => {
  const line = (c: Partial<Change>) => changeLine({ id: 'x', ...c } as Change);

  it('on the sheet', () => {
    expect(line({ kind: 'sheet', change: 'removed', label: 'Reputation' })).toMatchObject({ what: 'REPUTATION', kept: true, how: expect.stringMatching(/^No longer on the sheet/) });
    expect(line({ kind: 'sheet', change: 'added', label: 'Oath' })).toMatchObject({ what: 'OATH', how: 'New on the sheet.' });
    expect(line({ kind: 'sheet', change: 'renamed', from: 'Grit', to: 'Resolve' })).toMatchObject({ what: 'GRIT → RESOLVE' });
    expect(line({ kind: 'sheet', change: 'gm_only', label: 'Wound notes' })!.how).toMatch(/^Now GM-only/);
    expect(line({ kind: 'sheet', change: 'player_edit', label: 'Secret' })!.how).toBe('Players can change it again.');
    expect(line({ kind: 'sheet', change: 'options_removed', label: 'Calling', options: [{ value: 'a', label: 'Hedge mage' }, { value: 'b', label: 'Bard' }] }))
      .toMatchObject({ kept: true, how: 'No longer a choice: Hedge mage, Bard. Anyone who picked it keeps it until it is changed.' });
  });

  it('formulas, stats and health', () => {
    expect(line({ kind: 'formula', change: 'changed', label: 'Defense', from: '10 + @agility', to: '12 + @agility' })!.how).toBe('Its formula is now 12 + @agility (was 10 + @agility).');
    expect(line({ kind: 'formula', change: 'added', label: 'Carry', to: '@might' })!.how).toBe('New: @might.');
    expect(line({ kind: 'formula', change: 'removed', label: 'Old' })).toMatchObject({ kept: true });
    expect(line({ kind: 'stat', change: 'range', label: 'Might', from: { min: 3, max: 20 }, to: { min: 3, max: 18 } })!.how).toBe('Now 3 to 18 (was 3 to 20). A value outside it is kept as it is.');
    expect(line({ kind: 'stat', change: 'range', label: 'Might', from: { min: 1, max: null }, to: { min: null, max: 5 } })!.how).toMatch(/^Now at most 5 \(was at least 1\)/);
    expect(line({ kind: 'stat', change: 'range', label: 'Might', from: { min: null, max: null }, to: { min: 0, max: null } })!.how).toMatch(/^Now at least 0 \(was any number\)/);
    expect(line({ kind: 'health', change: 'changed', from: 'pool', to: 'tracks' })!.what).toBe('ONE POOL → TWO TRACKS');
    expect(line({ kind: 'health', change: 'changed', from: 'pool', to: 'mystery' })!.what).toBe('ONE POOL → MYSTERY');
  });

  it('money, features and conditions', () => {
    expect(line({ kind: 'currency', change: 'removed', label: 'Favor' })).toMatchObject({ what: 'FAVOR', kept: true });
    expect(line({ kind: 'currency', change: 'added', label: 'Coin' })!.how).toBe('A new currency: everyone starts with none.');
    expect(line({ kind: 'part', change: 'off', id: 'vehicles' })).toMatchObject({ what: 'VEHICLES OFF', kept: true });
    expect(line({ kind: 'part', change: 'on', id: 'give_items' })!.what).toBe('GIVE ITEM ON');
    expect(line({ kind: 'part', change: 'on', id: 'some_new_part' })!.what).toBe('SOME NEW PART ON');
    expect(line({ kind: 'condition', change: 'removed', label: 'Cursed' })).toMatchObject({ kept: true });
    expect(line({ kind: 'condition', change: 'added', label: 'Glitching' })!.how).toBe('A new condition.');
    expect(line({ kind: 'other', change: 'changed', id: 'words' })).toBeNull();
  });

  it('one character\'s own', () => {
    const own = (c: Partial<Change>) => characterLine({ id: 'x', ...c } as Change);
    expect(own({ kind: 'formula', change: 'value', from: 24, to: 26 })).toBe('24 → 26');
    expect(own({ kind: 'formula', change: 'value', from: null, to: 8 })).toBe('8 (new)');
    expect(own({ kind: 'sheet', change: 'removed', value: 3 })).toBe('has 3, kept');
    expect(own({ kind: 'sheet', change: 'options_removed', value: 'hedge', options: [{ value: 'hedge', label: 'Hedge mage' }] })).toBe('picked Hedge mage, kept');
    expect(own({ kind: 'sheet', change: 'options_removed', value: 'gone', options: [] })).toBe('picked gone, kept');
    expect(own({ kind: 'stat', change: 'outside', value: 19, min: 3, max: 18 })).toBe('has 19, outside 3 to 18, kept');
    expect(own({ kind: 'currency', change: 'held', balance: 12, debt: 0 })).toBe('holds 12, kept');
    expect(own({ kind: 'currency', change: 'held', balance: 0, debt: 4 })).toBe('holds 0, owes 4, kept');
    expect(own({ kind: 'condition', change: 'on_token' })).toBe('on their token, kept');
    expect(own({ kind: 'sheet', change: 'renamed' })).toBe('');
    expect([valueText(null), valueText(undefined), valueText(''), valueText(0)]).toEqual(['nothing', 'nothing', 'nothing', '0']);
  });
});

describe('BY CHANGE', () => {
  it('groups the changes in the page\'s order, each with who it reaches and their own value', () => {
    const groups = byChange(preview([VEX, ROOK]));
    expect(groups.map((g) => g.label)).toEqual(['ON THE SHEET', 'NUMBERS THAT WILL WORK OUT DIFFERENTLY', 'STATS', 'HEALTH', 'MONEY', 'PARTS', 'CONDITIONS']);
    const sheetLines = groups[0].lines;
    // Renamed and made GM-only: one field, two lines.
    expect(sheetLines.map((l) => l.what)).toEqual(['GRIT → RESOLVE', 'RESOLVE', 'REPUTATION', 'SECRET', 'CALLING', 'OATH']);
    expect(sheetLines.find((l) => l.key === 'sheet:gm_only:grit')).toBeTruthy();
    expect(sheetLines.find((l) => l.key === 'sheet:renamed:grit')).toBeTruthy();
    expect(sheetLines.find((l) => l.what === 'REPUTATION')!.who).toEqual([{ name: 'Vex', text: 'has 3, kept' }]);
    expect(sheetLines.find((l) => l.what === 'CALLING')!.who).toEqual([{ name: 'Vex', text: 'picked Hedge mage, kept' }]);
    const numbers = groups[1].lines;
    expect(numbers.find((l) => l.what === 'DEFENSE')!.who).toEqual([{ name: 'Vex', text: '24 → 26' }, { name: 'Rook', text: '22 → 24' }]);
    expect(numbers.find((l) => l.what === 'CARRY LIMIT')!.who).toEqual([{ name: 'Vex', text: '15 (new)' }, { name: 'Rook', text: '6 (new)' }]);
    expect(groups.find((g) => g.id === 'stats')!.lines[0].who).toEqual([{ name: 'Vex', text: 'has 19, outside 3 to 18, kept' }]);
    expect(groups.find((g) => g.id === 'money')!.lines.find((l) => l.what === 'FAVOR')!.who).toEqual([{ name: 'Vex', text: 'holds 12, owes 2, kept' }]);
    expect(groups.find((g) => g.id === 'conditions')!.lines.find((l) => l.what === 'CURSED')!.who).toEqual([{ name: 'Vex', text: 'on their token, kept' }]);
    expect(groups.find((g) => g.id === 'features')!.lines.map((l) => l.what)).toEqual(['VEHICLES OFF', 'XP AWARDS ON']);
  });

  it('gives a number that moves because a formula it reads changed a line of its own', () => {
    const guard = byChange(preview([ROOK]))[1].lines.find((l) => l.what === 'GUARD')!;
    expect(guard).toMatchObject({ key: 'formula:value:guard', how: 'Reads a value that changes.', who: [{ name: 'Rook', text: '23 → 25' }] });
  });

  it('shows the numbers on the SAMPLE when nobody plays it', () => {
    const numbers = byChange(preview([])).find((g) => g.id === 'numbers')!;
    expect(numbers.lines.find((l) => l.what === 'DEFENSE')!.who).toEqual([{ name: 'SAMPLE', text: '24 → 26' }]);
    expect(byChange({ ...preview([]), sample: null }).find((g) => g.id === 'numbers')!.lines.every((l) => l.who.length === 0)).toBe(true);
  });

  it('is nothing for a version that changes nothing a character would see', () => {
    const quiet: Preview = { first: false, from: 2, to: 3, problems: 0, changes: versionChanges(V2, { ...V2, words: { gm: { singular: 'Keeper' } } }), characters: [], sample: [] };
    expect(byChange(quiet)).toEqual([]);
    expect(changesCharacters(quiet)).toBe(false);
    expect(changesCharacters(preview([]))).toBe(true);
  });
});

describe('BY CHARACTER', () => {
  it('lists each character\'s own changes, numbers not marked kept', () => {
    const [vex, rook] = byCharacter(preview([VEX, { ...ROOK, kind: 'npc' }]));
    expect(vex.name).toBe('Vex');
    expect(vex.lines.map((l) => [l.what, l.text, l.kept])).toEqual([
      ['REPUTATION', 'has 3, kept', true],
      ['CALLING', 'picked Hedge mage, kept', true],
      ['MIGHT', 'has 19, outside 3 to 18, kept', true],
      ['DEFENSE', '24 → 26', false],
      ['GUARD', '25 → 27', false],
      ['CARRY LIMIT', '15 (new)', false],
      ['FAVOR', 'holds 12, owes 2, kept', true],
      ['CURSED', 'on their token, kept', true],
    ]);
    expect(rook.kind).toBe('npc');
    expect(byCharacter(preview([]))).toEqual([]);
  });
});

describe('the words around it', () => {
  it('one line for what changes nothing on a character', () => {
    expect(otherLine(preview([]))).toBe('Also in v3, changing nothing on a character: words and rests.');
    const one: Preview = { ...preview([]), changes: [{ kind: 'other', change: 'changed', id: 'npc' }] };
    expect(otherLine(one)).toBe('Also in v3, changing nothing on a character: NPC tiers.');
    expect(otherLine({ ...one, changes: [{ kind: 'other', change: 'changed', id: 'lookups' }, { kind: 'other', change: 'changed', id: 'bank' }, { kind: 'other', change: 'changed', id: 'novel' }] }))
      .toBe('Also in v3, changing nothing on a character: tables, bank settings and novel.');
    expect(otherLine({ ...one, changes: [] })).toBeNull();
  });

  it('the heading, with who plays it when someone does', () => {
    expect(headline(preview([VEX, ROOK]), 'Hearth')).toBe('PUBLISH v3 · WHAT CHANGES FROM v2 FOR THE 2 CHARACTERS PLAYING HEARTH');
    expect(headline(preview([VEX]), 'Hearth')).toBe('PUBLISH v3 · WHAT CHANGES FROM v2 FOR THE 1 CHARACTER PLAYING HEARTH');
    expect(headline(preview([]), 'Hearth')).toBe('PUBLISH v3 · WHAT CHANGES FROM v2');
  });

  it('the line under it: who plays it, and where the numbers come from', () => {
    expect(subline(preview([VEX, ROOK, { ...ROOK, name: 'Juno' }]), 'Hearth')).toBe('Vex, Rook and Juno play Hearth v2 now. This is what v3 changes, worked out from their own sheets. Nothing is deleted: anything that stops showing is kept and comes back if you put it back.');
    expect(subline(preview([VEX]), 'Hearth')).toMatch(/^Vex plays Hearth v2 now\./);
    expect(subline(preview([]), 'Hearth')).toBe('Nobody plays Hearth yet. This is what v3 changes, with numbers worked out on the SAMPLE values from STATS & RULES. Nothing is deleted: anything that stops showing is kept and comes back if you put it back.');
    const quiet: Preview = { first: false, from: 2, to: 3, problems: 0, changes: [], characters: [], sample: [] };
    expect(subline(quiet, 'Hearth')).toBe('Nobody plays Hearth yet.');
  });
});

describe('asking the server', () => {
  it('reads the preview for the stored draft', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ first: true, problems: 0 }) })) as unknown as typeof fetch;
    expect(await systemsApi('tok', fetcher).publishPreview('sys_aaaaaaaaaaaaaaaa')).toEqual({ ok: true, value: { first: true, problems: 0 } });
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/systems/sys_aaaaaaaaaaaaaaaa/publish-preview');
  });
});

describe('house rules and alternatives (4j5c)', () => {
  // Made by the server's own comparison, as the rest of this file is.
  const R2 = { ...V2, house_rules: [{ id: 'magic', name: 'Magic' }, { id: 'gritty', name: 'Gritty', starts: true }],
    derived: [...V2.derived, { id: 'mana', label: 'Mana', formula: '2', alternative: { rule: 'magic', formula: '4' } }] };
  const R3 = { ...V2, house_rules: [{ id: 'gritty', name: 'Grim' }, { id: 'markets', name: 'Markets', starts: true }],
    derived: [...V2.derived.map((d) => (d.id === 'defense' ? { ...d, alternative: { rule: 'gritty', formula: '@agility' } } : d)), { id: 'mana', label: 'Mana', formula: '2' }] };
  const changes: Change[] = versionChanges(R2, R3);
  const line = (kind: string, change: string, id: string) => changeLine(changes.find((c) => c.kind === kind && c.change === change && c.id === id)!)!;

  it('says each in words', () => {
    expect(line('house_rule', 'added', 'markets')).toMatchObject({ what: 'MARKETS', how: 'A new house rule, starting on. The GM switches it in the GAME tab.' });
    expect(line('house_rule', 'removed', 'magic')).toMatchObject({ what: 'MAGIC', how: 'No longer a house rule. What waited on it is always there now.' });
    expect(line('house_rule', 'renamed', 'gritty')).toMatchObject({ what: 'GRITTY → GRIM', how: 'Renamed. Whether the table has it on stays as it is.' });
    expect(line('house_rule', 'starts', 'gritty')).toMatchObject({ what: 'GRIM', how: 'A game starting from now begins with it off. A table that already chose keeps its choice.' });
    expect(line('formula', 'alternative', 'defense')).toMatchObject({ what: 'DEFENSE', how: 'With GRIM on, worked out as @agility.' });
    expect(line('formula', 'alternative', 'mana')).toMatchObject({ what: 'MANA', how: 'No longer worked out another way with MAGIC on.' });
    expect(changeLine({ kind: 'formula', change: 'alternative', id: 'x', label: 'X', from: { rule: 'Magic', formula: '4' }, to: { rule: 'Magic', formula: '5' } })!.how)
      .toBe('With MAGIC on, worked out as 5 (was 4 with MAGIC).');
  });

  it('a group of their own, an alternative apart from its formula\'s own change, a value it moves under it', () => {
    const p: Preview = {
      first: false, from: 2, to: 3, problems: 0, sample: null,
      changes: [...changes, { kind: 'formula', change: 'changed', id: 'defense', label: 'Defense', from: '10 + @agility', to: '11 + @agility' }],
      characters: [{ kind: 'player', username: 'vex', name: 'Vex', changes: [{ kind: 'formula', change: 'value', id: 'mana', label: 'Mana', from: 4, to: 2 }] }],
    };
    const groups = byChange(p);
    expect(groups.find((g) => g.id === 'house_rules')!.lines.map((l) => l.what)).toEqual(['MAGIC', 'GRITTY → GRIM', 'GRIM', 'MARKETS']);
    const numbers = groups.find((g) => g.id === 'numbers')!.lines;
    expect(numbers.filter((l) => l.what === 'DEFENSE').map((l) => l.how)).toEqual(['With GRIM on, worked out as @agility.', 'Its formula is now 11 + @agility (was 10 + @agility).']);
    expect(numbers.find((l) => l.what === 'MANA')!.who).toEqual([{ name: 'Vex', text: '4 → 2' }]);
    expect(numbers.some((l) => l.how === 'Reads a value that changes.')).toBe(false);
    expect(GROUPS.map((g) => g.id).at(-1)).toBe('house_rules');
  });
});