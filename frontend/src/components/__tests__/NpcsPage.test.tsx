import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { NpcsPage, TRY_DELAY_MS } from '../NpcsPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { tierList } from '../../sheets/npcs';

/**
 * The builder's NPCS page, TIERS (4b4c). Approved mockup builder-npcs (2026-10-07): tiers are
 * difficulties; HP, defense and each number are a number, a formula with @level, or dice; TRY IT
 * rolls a sample. The sheet and the rolls come from the server's own code.
 */

const req = createRequire(import.meta.url);
const { starterSheet, effectiveSheet, fieldsOf } = req('../../../../backend/systemBuilder/sheet.js');
const { npcSheetOf } = req('../../../../backend/systemBuilder/npc.js');
const { rollTier } = req('../../../../backend/systemBuilder/tierRolls.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { previewDerived } = req('../../../../backend/systemBuilder/derived.js');

afterEach(() => { cleanup(); vi.useRealTimers(); });

const H: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'level', label: 'Level' }, { id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - @str' }],
};
const WITH_TIERS: Definition = { ...H, npc: { tiers: [
  { id: 'mook', label: 'MOOK', hp: '@level d6', defense: 10, values: { level: '@level', str: '2d6 + 3' } },
  { id: 'boss', label: 'BOSS', hp: '@level d10 + 10', defense: '14 + floor(@level / 2)', values: { level: '@level', str: '4d6', concept: 'Warlord' } },
] } };

type Api = ReturnType<typeof systemsApi>;
/** The server's answers, by its own code; the dice are real, so only their shape is checked. */
const serverApi = () => ({
  previewSheet: vi.fn(async (def: Definition) => ({ ok: true as const, value: { sheet: effectiveSheet(def), starter: starterSheet(def) } })),
  previewValues: vi.fn(async (def: Definition) => ({ ok: true as const, value: previewDerived({ lookups: def.lookups, derived: def.derived }, (def.samples ?? {}) as object) })),
  tryTier: vi.fn(async (def: Definition, tier: string, level: number) => {
    const t = tierList(def).find((x) => x.id === tier);
    if (!t) return { ok: false as const, error: 'No such tier', status: 404 };
    const fields = new Map(fieldsOf(npcSheetOf(def)).map((f: { id: string }) => [f.id, f]));
    return { ok: true as const, value: rollTier(t, level, fields, { hp: 9999, defense: 99 }) };
  }),
});

const open = (start: Definition = WITH_TIERS, api: ReturnType<typeof serverApi> | null = serverApi()) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <NpcsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={(api ?? undefined) as unknown as Api | undefined} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1], api };
};
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const tiers = () => within(screen.getByRole('table', { name: 'Tiers' })).getAllByRole('button', { name: / tier$/ }).map((b) => b.textContent);
const settings = () => within(screen.getByRole('region', { name: /settings$/ }));
const ready = () => screen.findByLabelText('Strength starts with');

describe('the page', () => {
  it('opens on TIERS, with STAT BLOCK beside it', async () => {
    open();
    expect(screen.getByRole('tab', { name: 'TIERS' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('tab', { name: 'STAT BLOCK' }));
    expect(screen.getByRole('tab', { name: 'STAT BLOCK' }).getAttribute('aria-selected')).toBe('true');
  });

  it('lists the tiers with HP and defense as written, the first the default, and opens the first', async () => {
    open();
    await ready();
    expect(tiers()).toEqual(['MOOK', 'BOSS']);
    const mook = screen.getByTestId('tier-mook');
    expect(within(mook).getByText('DEFAULT')).toBeTruthy();
    expect(mook.textContent).toContain('@level d6');
    expect(within(screen.getByTestId('tier-boss')).queryByText('DEFAULT')).toBeNull();
    expect(screen.getByRole('button', { name: 'MOOK tier' }).getAttribute('aria-current')).toBe('true');
    expect((settings().getByLabelText('HP') as HTMLInputElement).value).toBe('@level d6');
    expect((settings().getByLabelText('Defense') as HTMLInputElement).value).toBe('10');
    expect(screen.getByText('2 of 20')).toBeTruthy();
  });

  it('says what no tiers means', async () => {
    open(H);
    expect(screen.getByText(/No tiers: GENERATE_SHEET makes an empty stat block/)).toBeTruthy();
    expect(screen.getByText('+ TIER makes the first one.')).toBeTruthy();
  });
});

describe('tiers', () => {
  it('adds one, opened, starting the stat block\'s Level at the level', async () => {
    const { last } = open(H);
    await screen.findByText('+ TIER makes the first one.');
    await waitFor(() => expect(screen.getByRole('button', { name: '+ TIER' })).toBeTruthy());
    // The character sheet arrives first, so the new tier knows there is a Level field.
    await waitFor(() => expect(screen.queryByText('LOADING…')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: '+ TIER' }));
    expect(tierList(last())).toEqual([{ id: 'new_tier', label: 'NEW TIER', values: { level: '@level' } }]);
    expect(screen.getByRole('button', { name: 'NEW TIER tier' }).getAttribute('aria-current')).toBe('true');
    expect((await screen.findByLabelText('Level starts with') as HTMLInputElement).value).toBe('@level');
    expect(problems(last())).toEqual([]);
  });

  it('stops adding at twenty', () => {
    const many = { ...H, npc: { tiers: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, label: `T${i}` })) } };
    open(many);
    expect((screen.getByRole('button', { name: '+ TIER' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('20 of 20')).toBeTruthy();
  });

  it('renames the open tier, refusing a blank name in place', async () => {
    const { last } = open();
    await ready();
    const name = settings().getByLabelText('Tier name') as HTMLInputElement;
    await userEvent.clear(name);
    expect(screen.getByRole('alert').textContent).toBe('A tier needs a name.');
    expect(tierList(last())[0].label).toBe('MOOK');
    await userEvent.type(name, 'GRUNT');
    expect(tierList(last())[0]).toMatchObject({ id: 'mook', label: 'GRUNT' });
    expect(tiers()).toEqual(['GRUNT', 'BOSS']);
  });

  it('opens another tier to edit it', async () => {
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'BOSS tier' }));
    expect((settings().getByLabelText('Tier name') as HTMLInputElement).value).toBe('BOSS');
    expect((settings().getByLabelText('HP') as HTMLInputElement).value).toBe('@level d10 + 10');
    expect((settings().getByLabelText('Concept starts with') as HTMLInputElement).value).toBe('Warlord');
  });

  it('never carries a half-typed box over to another tier', async () => {
    const same = { ...H, npc: { tiers: [{ id: 'a', label: 'A', hp: 5 }, { id: 'b', label: 'B', hp: 5 }] } };
    open(same);
    await ready();
    const hp = settings().getByLabelText('HP') as HTMLInputElement;
    await userEvent.type(hp, ' ');
    expect(hp.value).toBe('5 ');
    await userEvent.click(screen.getByRole('button', { name: 'B tier' }));
    expect((settings().getByLabelText('HP') as HTMLInputElement).value).toBe('5');
  });

  it('moves a tier, the top one becoming the default', async () => {
    const { last } = open();
    await ready();
    expect((screen.getByRole('button', { name: 'Move MOOK up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move BOSS down' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Move BOSS up' }));
    expect(tierList(last()).map((t) => t.id)).toEqual(['boss', 'mook']);
    expect(within(screen.getByTestId('tier-boss')).getByText('DEFAULT')).toBeTruthy();
  });

  it('asks before removing one, then opens the first left', async () => {
    const { last, edits } = open();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TIER' }));
    expect(screen.getByText('Remove MOOK? NPCs made from it keep their sheets.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'KEEP IT' }));
    expect(edits).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TIER' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE MOOK' }));
    expect(tierList(last()).map((t) => t.id)).toEqual(['boss']);
    expect(screen.getByRole('button', { name: 'BOSS tier' }).getAttribute('aria-current')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TIER' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE BOSS' }));
    expect('npc' in last()).toBe(false);
    expect(screen.getByText('+ TIER makes the first one.')).toBeTruthy();
  });

  it('starts a new tier\'s boxes empty, even one taking a removed tier\'s id', async () => {
    open(H);
    await waitFor(() => expect(screen.queryByText('LOADING…')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: '+ TIER' }));
    await userEvent.type(settings().getByLabelText('HP'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TIER' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE NEW TIER' }));
    await userEvent.click(screen.getByRole('button', { name: '+ TIER' }));
    expect((settings().getByLabelText('HP') as HTMLInputElement).value).toBe('');
  });

  it('shows a box changed underneath it, as when the builder reloads the draft', async () => {
    const Harness = () => {
      const [def, setDef] = useState<Definition>(WITH_TIERS);
      return (
        <>
          <button type="button" onClick={() => setDef({ ...WITH_TIERS, npc: { tiers: [{ ...tierList(WITH_TIERS)[0], hp: '@level d12' }] } })}>RELOAD</button>
          <NpcsPage definition={def} edit={setDef} api={serverApi() as unknown as Api} />
        </>
      );
    };
    render(<Harness />);
    await ready();
    expect((settings().getByLabelText('HP') as HTMLInputElement).value).toBe('@level d6');
    await userEvent.click(screen.getByText('RELOAD'));
    expect((settings().getByLabelText('HP') as HTMLInputElement).value).toBe('@level d12');
  });

  it('forgets an open question when another tier is opened', async () => {
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TIER' }));
    await userEvent.click(screen.getByRole('button', { name: 'BOSS tier' }));
    await userEvent.click(screen.getByRole('button', { name: 'MOOK tier' }));
    expect(screen.queryByRole('group', { name: 'Remove MOOK' })).toBeNull();
  });
});

describe('the boxes', () => {
  it('sets HP and defense to a number, formula or dice, blank back to the token\'s own', async () => {
    const { last } = open();
    await ready();
    const hp = settings().getByLabelText('HP');
    await userEvent.clear(hp);
    expect(hp.getAttribute('placeholder')).toBe("the token's own");
    expect('hp' in tierList(last())[0]).toBe(false);
    await userEvent.type(hp, '@level d8 + 4');
    expect(tierList(last())[0].hp).toBe('@level d8 + 4');
    const def = settings().getByLabelText('Defense');
    await userEvent.clear(def);
    await userEvent.type(def, '13');
    expect(tierList(last())[0].defense).toBe(13);
    expect(screen.getByTestId('tier-mook').textContent).toContain('@level d8 + 4');
    expect(problems(last())).toEqual([]);
  });

  it('offers only fields a GM fills in, each by its kind', async () => {
    open();
    await ready();
    const offered = settings().getAllByLabelText(/ starts with$/).map((el) => el.getAttribute('aria-label'));
    expect(offered).toEqual(expect.arrayContaining(['Name starts with', 'Concept starts with', 'Level starts with', 'Strength starts with', 'Notes starts with']));
    for (const never of ['HP starts with', 'Cash starts with', 'Save starts with']) expect(offered).not.toContain(never);
  });

  it('sets a number, text and a pick-one, blank leaving the field empty', async () => {
    const own = { ...WITH_TIERS, sheet: { sections: [{ id: 'who', label: 'WHO', layout: 'list' as const, fields: [
      { id: 'name', label: 'Name', type: 'text' as const },
      { id: 'str', label: 'Strength', type: 'number' as const },
      { id: 'morale', label: 'Morale', type: 'select' as const, options: [{ value: 'Steady', label: 'Steady' }, { value: 'Shaky', label: 'Shaky' }] },
    ] }] } };
    const { last } = open(own);
    const str = await screen.findByLabelText('Strength starts with');
    await userEvent.clear(str);
    await userEvent.type(str, '10 + @level');
    await userEvent.selectOptions(settings().getByLabelText('Morale starts with'), 'Shaky');
    await userEvent.type(settings().getByLabelText('Name starts with'), 'Bruiser');
    expect(tierList(last())[0].values).toEqual({ level: '@level', str: '10 + @level', morale: 'Shaky', name: 'Bruiser' });
    await userEvent.selectOptions(settings().getByLabelText('Morale starts with'), '');
    await userEvent.clear(settings().getByLabelText('Name starts with'));
    expect(tierList(last())[0].values).toEqual({ level: '@level', str: '10 + @level' });
  });

  it('shows what the server can\'t read, under its box, a moment after typing', async () => {
    open();
    await ready();
    const def = settings().getByLabelText('Defense');
    await userEvent.clear(def);
    await userEvent.type(def, '3d1');
    expect(await screen.findByText('A die has 2 to 1000 sides')).toBeTruthy();
    expect(def.getAttribute('aria-invalid')).toBe('true');
    const str = settings().getByLabelText('Strength starts with');
    await userEvent.clear(str);
    await userEvent.type(str, '@might');
    expect(await screen.findByText('Only @level can be used here, not @might')).toBeTruthy();
    await userEvent.clear(def);
    await userEvent.type(def, '12');
    await waitFor(() => expect(screen.queryByText('A die has 2 to 1000 sides')).toBeNull());
    expect(def.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('TRY IT', () => {
  it('rolls the open tier at a level, showing each result and its dice, saving nothing', async () => {
    const { edits, api } = open();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'BOSS tier' }));
    const level = screen.getByLabelText('Level') as HTMLInputElement;
    fireEvent.change(level, { target: { value: '6' } });
    await userEvent.click(screen.getByRole('button', { name: 'ROLL A BOSS' }));
    const tried = await screen.findByTestId('tried');
    expect(api!.tryTier).toHaveBeenLastCalledWith(expect.anything(), 'boss', 6);
    expect(tried.textContent).toMatch(/HP\d+ 6d10 \[(\d+ ){5}\d+\]/);
    expect(tried.textContent).toContain('DEFENSE17');
    expect(tried.textContent).toContain('LEVEL6');
    expect(tried.textContent).toMatch(/STRENGTH\d+ 4d6/);
    expect(tried.textContent).toContain('CONCEPTWarlord');
    expect(edits).toEqual([]);
  });

  it('keeps the level between 0 and 99, and clears the result when another tier is opened', async () => {
    open();
    await ready();
    const level = screen.getByLabelText('Level') as HTMLInputElement;
    fireEvent.change(level, { target: { value: '250' } });
    expect(level.value).toBe('99');
    fireEvent.change(level, { target: { value: '' } });
    expect(level.value).toBe('99');
    await userEvent.click(screen.getByRole('button', { name: 'ROLL A MOOK' }));
    expect(await screen.findByTestId('tried')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'BOSS tier' }));
    expect(screen.queryByTestId('tried')).toBeNull();
  });

  it('tries a tier only a moment after the last change', async () => {
    vi.useFakeTimers();
    const { api } = open();
    await act(async () => { await vi.advanceTimersByTimeAsync(TRY_DELAY_MS + 1); });
    const ask = api!.tryTier;
    const before = ask.mock.calls.length;
    const hp = screen.getByLabelText('HP');
    fireEvent.change(hp, { target: { value: '1' } });
    fireEvent.change(hp, { target: { value: '12' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(TRY_DELAY_MS - 1); });
    expect(ask.mock.calls.length).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(ask.mock.calls.length).toBe(before + 1);
    expect(tierList(ask.mock.calls.at(-1)![0])[0].hp).toBe(12);
  });

  it('needs the server', () => {
    open(WITH_TIERS, null);
    expect((screen.getByRole('button', { name: 'ROLL A MOOK' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('STAT BLOCK (4b4d)', () => {
  const toBlock = async () => {
    await userEvent.click(screen.getByRole('tab', { name: 'STAT BLOCK' }));
    return within(screen.getByRole('group', { name: 'NPC stat block' }));
  };
  const own = () => (last: Definition) => (last.npc as { sheet?: { sections: { id: string; label: string; fields: { id: string }[] }[] } }).sheet;

  it('uses the character sheet until given a stat block of their own, a copy of it as drawn', async () => {
    const { last } = open();
    const cards = await toBlock();
    const same = cards.getByRole('button', { name: /SAME AS THE CHARACTER SHEET/ });
    const ownCard = cards.getByRole('button', { name: /A STAT BLOCK OF THEIR OWN/ });
    expect(same.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('sheet-page')).toBeNull();
    await waitFor(() => expect((ownCard as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(ownCard);
    expect(own()(last())).toEqual(effectiveSheet(WITH_TIERS));
    expect('sheet' in last()).toBe(false);
    expect(tierList(last())).toHaveLength(2);
    expect(problems(last())).toEqual([]);
    expect(ownCard.getAttribute('aria-pressed')).toBe('true');
    expect((ownCard as HTMLButtonElement).disabled).toBe(true);
    expect((same as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText('A STAT BLOCK OF THEIR OWN', { selector: 'span' })).toBeTruthy();
  });

  it('can\'t be made before the character sheet has arrived', async () => {
    open(WITH_TIERS, null);
    const cards = await toBlock();
    expect((cards.getByRole('button', { name: /A STAT BLOCK OF THEIR OWN/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is edited with the CHARACTER SHEET designer, written to the stat block', async () => {
    const { last } = open({ ...WITH_TIERS, npc: { ...(WITH_TIERS.npc as object), sheet: effectiveSheet(WITH_TIERS) } });
    await toBlock();
    const page = within(await screen.findByTestId('sheet-page'));
    await userEvent.click(page.getByRole('button', { name: 'IDENTITY section' }));
    const name = page.getByLabelText('Section name');
    await userEvent.clear(name);
    await userEvent.type(name, 'THREAT');
    expect(own()(last())!.sections[0].label).toBe('THREAT');
    expect('sheet' in last()).toBe(false);
    expect(problems(last())).toEqual([]);
  });

  it('has no WHO SEES IT or WHO CHANGES IT, and shows the block as the GM sees it', async () => {
    open({ ...WITH_TIERS, npc: { ...(WITH_TIERS.npc as object), sheet: effectiveSheet(WITH_TIERS) } });
    await toBlock();
    const page = within(await screen.findByTestId('sheet-page'));
    await userEvent.click(page.getByRole('button', { name: 'Strength field' }));
    expect(page.queryByRole('group', { name: 'Who sees it' })).toBeNull();
    expect(page.queryByRole('group', { name: 'Who changes it' })).toBeNull();
    expect(page.queryByRole('checkbox', { name: /Decides whether attacks hit/ })).toBeNull();
    expect(page.getByText("Only the GM sees and changes an NPC's stat block.")).toBeTruthy();
    await page.findByTestId('sheet-preview');
    expect(page.getByText('AS THE GM SEES IT')).toBeTruthy();
    expect(page.queryByRole('group', { name: 'Seen by' })).toBeNull();
  });

  it('asks before going back to the character sheet, keeping the tiers', async () => {
    const { last, edits } = open({ ...WITH_TIERS, npc: { ...(WITH_TIERS.npc as object), sheet: effectiveSheet(WITH_TIERS) } });
    await toBlock();
    const page = within(await screen.findByTestId('sheet-page'));
    await userEvent.click(page.getByRole('button', { name: 'BACK TO THE CHARACTER SHEET' }));
    expect(page.getByText('Throw the stat block away? NPCs go back to the character sheet; the tiers stay.')).toBeTruthy();
    await userEvent.click(page.getByRole('button', { name: 'KEEP MINE' }));
    expect(edits).toEqual([]);
    await userEvent.click(page.getByRole('button', { name: 'BACK TO THE CHARACTER SHEET' }));
    await userEvent.click(page.getByRole('button', { name: 'BACK TO THE CHARACTER SHEET' }));
    expect(last().npc).toEqual({ tiers: (WITH_TIERS.npc as { tiers: unknown }).tiers });
    expect(screen.queryByTestId('sheet-page')).toBeNull();
  });

  it('gives the tiers the stat block\'s fields', async () => {
    open({ ...WITH_TIERS, npc: { ...(WITH_TIERS.npc as object), sheet: effectiveSheet(WITH_TIERS) } });
    await toBlock();
    const page = within(await screen.findByTestId('sheet-page'));
    await userEvent.click(page.getByRole('button', { name: 'IDENTITY section' }));
    await userEvent.click(page.getByRole('button', { name: '+ FIELD' }));
    const label = page.getByLabelText('Field label');
    await userEvent.clear(label);
    await userEvent.type(label, 'Tactics');
    await userEvent.click(page.getByRole('button', { name: 'Concept field' }));
    await userEvent.click(page.getByRole('button', { name: 'TAKE OFF THE SHEET' }));
    await userEvent.click(screen.getByRole('tab', { name: 'TIERS' }));
    expect(await screen.findByLabelText('Tactics starts with')).toBeTruthy();
    expect(screen.queryByLabelText('Concept starts with')).toBeNull();
  });

  it('previews the block as the GM, so a field only the GM changes stays open', async () => {
    const sheet = effectiveSheet(WITH_TIERS);
    const locked = { ...sheet, sections: sheet.sections.map((s: { fields: { id: string }[] }) => ({ ...s, fields: s.fields.map((f) => (f.id === 'str' ? { ...f, edit: 'gm' } : f)) })) };
    open({ ...WITH_TIERS, samples: { str: 10 }, npc: { ...(WITH_TIERS.npc as object), sheet: locked } });
    await userEvent.click(screen.getByRole('tab', { name: 'STAT BLOCK' }));
    const preview = within(await screen.findByTestId('sheet-preview'));
    await waitFor(() => expect((preview.getByDisplayValue('10') as HTMLInputElement).readOnly).toBe(false));
  });
});
