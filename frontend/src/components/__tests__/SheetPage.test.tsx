import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { SheetPage, SHEET_PREVIEW_DELAY_MS } from '../SheetPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import type { CustomRenderSheet } from '../../sheets/customTemplates';

/**
 * The builder's CHARACTER SHEET page: automatic or customized, the tree of tabs, sections and
 * fields, and tab and section settings (4b3c). Approved mockup builder-sheet (2026-10-07),
 * including the tab removal path the user walked: sections move to a tab you choose, the last tab
 * makes one page, + TAB splits it again. The starter comes from the server's own code.
 */

const req = createRequire(import.meta.url);
const { starterSheet, effectiveSheet } = req('../../../../backend/systemBuilder/sheet.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

afterEach(() => { cleanup(); vi.useRealTimers(); });

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }, { id: 'dex', label: 'Dexterity' }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - @str' }],
};
const STARTER: CustomRenderSheet = starterSheet(HEARTH);

type Api = ReturnType<typeof systemsApi>;
/** The server's preview, answered by its own code. */
const serverApi = () => ({
  previewSheet: vi.fn(async (def: Definition) => ({ ok: true as const, value: { sheet: effectiveSheet(def), starter: starterSheet(def) } })),
});

const open = (start: Definition = HEARTH, api: { previewSheet: unknown } | null = serverApi()) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <SheetPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={(api ?? undefined) as Api | undefined} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1], api };
};
const customized = async (start: Definition = HEARTH) => {
  const opened = open({ ...start, sheet: starterSheet(start) });
  await screen.findByText('CUSTOMIZED');
  return opened;
};
const tree = () => screen.getByTestId('sheet-tree');
const node = (name: string) => within(tree()).getByRole('button', { name });
const tabs = (def: Definition) => (def.sheet as CustomRenderSheet).tabs;
const placement = (def: Definition) => (def.sheet as CustomRenderSheet).sections.map((s) => `${s.tab ?? '-'}/${s.id}`);
const problems = (def: Definition) => checkDefinition(def).problems;
const groupNames = () => within(tree()).getAllByRole('group').map((g) => g.getAttribute('aria-label'));

describe('automatic', () => {
  it('shows the starter sheet as the server draws it, read-only, until CUSTOMIZE', async () => {
    const { edits } = open();
    expect(screen.getByText('AUTOMATIC')).toBeTruthy();
    expect(await screen.findByTestId('sheet-tree')).toBeTruthy();
    expect(groupNames()).toEqual(['STATS tab', 'GEAR tab', 'NOTES tab']);
    const stats = within(screen.getByRole('group', { name: 'STATS tab' }));
    expect(stats.getByText('IDENTITY')).toBeTruthy();
    expect(stats.getByText('ABILITIES')).toBeTruthy();
    expect(stats.getByText('Strength')).toBeTruthy();
    expect(stats.getByText('WORKED OUT')).toBeTruthy();
    expect(within(tree()).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByText('+ TAB')).toBeNull();
    expect(edits).toEqual([]);
  });

  it('shows the sheet without the parts the system turned off', async () => {
    open({ ...HEARTH, parts: { bank: { on: false } } });
    await screen.findByTestId('sheet-tree');
    expect(within(tree()).queryByText('MONEY')).toBeNull();
    expect(within(tree()).queryByText('Cash')).toBeNull();
  });

  it('can\'t be customized before the starter has arrived, nor without the server', async () => {
    let answer!: (v: unknown) => void;
    const api = { previewSheet: vi.fn(() => new Promise((r) => { answer = r; })) };
    open(HEARTH, api);
    const customize = screen.getByRole('button', { name: 'CUSTOMIZE THIS SHEET' }) as HTMLButtonElement;
    expect(customize.disabled).toBe(true);
    expect(screen.getByText('LOADING…')).toBeTruthy();
    await waitFor(() => expect(api.previewSheet).toHaveBeenCalled());
    await act(async () => { answer({ ok: true, value: { sheet: effectiveSheet(HEARTH), starter: STARTER } }); });
    expect(customize.disabled).toBe(false);
    cleanup();
    open(HEARTH, null);
    expect((screen.getByRole('button', { name: 'CUSTOMIZE THIS SHEET' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('CUSTOMIZE copies the starter in and picks its first section', async () => {
    const { last } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'CUSTOMIZE THIS SHEET' }));
    expect(last().sheet).toEqual(STARTER);
    expect(problems(last())).toEqual([]);
    expect(screen.getByText('CUSTOMIZED')).toBeTruthy();
    expect(node('IDENTITY section').getAttribute('aria-current')).toBe('true');
    expect((within(screen.getByTestId('section-settings')).getByLabelText('Section name') as HTMLInputElement).value).toBe('IDENTITY');
  });
});

describe('back to automatic', () => {
  it('asks first, and keeps the layout unless told', async () => {
    const { last, edits } = await customized();
    await userEvent.click(screen.getByRole('button', { name: 'BACK TO AUTOMATIC' }));
    expect(screen.getByText('Throw your layout away and go back to the automatic sheet?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'KEEP MINE' }));
    expect(edits).toEqual([]);
    expect(screen.getByText('CUSTOMIZED')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'BACK TO AUTOMATIC' }));
    await userEvent.click(screen.getByRole('button', { name: 'BACK TO AUTOMATIC' }));
    expect(last()).toEqual(HEARTH);
    expect(await screen.findByText('AUTOMATIC')).toBeTruthy();
  });
});

describe('tabs', () => {
  it('adds a tab, picked to name it', async () => {
    const { last } = await customized();
    await userEvent.click(screen.getByRole('button', { name: '+ TAB' }));
    expect(tabs(last())).toEqual(['STATS', 'GEAR', 'NOTES', 'TAB 4']);
    expect(node('TAB 4 tab').getAttribute('aria-current')).toBe('true');
    expect((screen.getByLabelText('Tab name') as HTMLInputElement).value).toBe('TAB 4');
    expect(screen.getByText('0 sections.')).toBeTruthy();
  });

  it('stops adding at twelve tabs', async () => {
    const sheet = { ...STARTER, tabs: [...STARTER.tabs!, ...Array.from({ length: 9 }, (_, i) => `T${i}`)] };
    open({ ...HEARTH, sheet });
    expect((await screen.findByRole('button', { name: '+ TAB' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a tab with its sections, showing why a name is refused and keeping what was typed', async () => {
    const { last, edits } = await customized();
    await userEvent.click(node('GEAR tab'));
    const name = screen.getByLabelText('Tab name') as HTMLInputElement;
    await userEvent.clear(name);
    expect(screen.getByRole('alert').textContent).toBe('A tab needs a name.');
    expect(name.value).toBe('');
    await userEvent.type(name, 'Stats');
    expect(screen.getByRole('alert').textContent).toBe('There is already a tab called Stats.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(edits.every((d) => tabs(d)!.join() !== 'STATS,Stats,NOTES')).toBe(true);
    await userEvent.type(name, 'h');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(tabs(last())).toEqual(['STATS', 'Statsh', 'NOTES']);
    expect(placement(last()).filter((p) => p.startsWith('Statsh/'))).toEqual(['Statsh/inventory', 'Statsh/money']);
    expect(document.activeElement).toBe(screen.getByLabelText('Tab name'));
    expect(node('Statsh tab').getAttribute('aria-current')).toBe('true');
    expect(problems(last())).toEqual([]);
  });

  it('shows the picked tab\'s own name when another is picked', async () => {
    await customized();
    await userEvent.click(node('GEAR tab'));
    expect((screen.getByLabelText('Tab name') as HTMLInputElement).value).toBe('GEAR');
    await userEvent.click(node('NOTES tab'));
    expect((screen.getByLabelText('Tab name') as HTMLInputElement).value).toBe('NOTES');
  });

  it('moves a tab up and down, not past either end', async () => {
    const { last } = await customized();
    expect((within(tree()).getByLabelText('Move the STATS tab up') as HTMLButtonElement).disabled).toBe(true);
    expect((within(tree()).getByLabelText('Move the NOTES tab down') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(tree()).getByLabelText('Move the NOTES tab up'));
    expect(tabs(last())).toEqual(['STATS', 'NOTES', 'GEAR']);
    await userEvent.click(within(tree()).getByLabelText('Move the STATS tab down'));
    expect(tabs(last())).toEqual(['NOTES', 'STATS', 'GEAR']);
    expect(groupNames()).toEqual(['NOTES tab', 'STATS tab', 'GEAR tab']);
  });

  it('asks where a removed tab\'s sections go, and KEEP IT keeps it', async () => {
    const { last, edits } = await customized();
    await userEvent.click(node('STATS tab'));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TAB' }));
    const ask = within(screen.getByRole('group', { name: 'Remove STATS' }));
    expect(ask.getByText(/Its 4 sections \(IDENTITY, HEALTH, ABILITIES, DERIVED\) move to:/)).toBeTruthy();
    expect([...(ask.getByLabelText('Move its sections to') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['GEAR', 'NOTES']);
    await userEvent.click(ask.getByRole('button', { name: 'KEEP IT' }));
    expect(edits).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TAB' }));
    await userEvent.selectOptions(screen.getByLabelText('Move its sections to'), 'NOTES');
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE STATS' }));
    expect(tabs(last())).toEqual(['GEAR', 'NOTES']);
    expect(placement(last()).filter((p) => p.startsWith('NOTES/'))).toEqual(['NOTES/identity', 'NOTES/health', 'NOTES/stats_abilities', 'NOTES/derived', 'NOTES/notes']);
    expect(node('NOTES tab').getAttribute('aria-current')).toBe('true');
    expect(problems(last())).toEqual([]);
  });

  it('makes one page of the last tab, and + TAB splits it again (the path the user walked)', async () => {
    const { last } = await customized();
    for (const tab of ['STATS', 'GEAR']) {
      await userEvent.click(node(`${tab} tab`));
      await userEvent.click(screen.getByRole('button', { name: 'REMOVE TAB' }));
      await userEvent.click(screen.getByRole('button', { name: `REMOVE ${tab}` }));
    }
    await userEvent.click(node('NOTES tab'));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TAB' }));
    expect(screen.getByText('NOTES is the last tab. Removed, the sheet becomes one page with no tabs, its 7 sections staying in order.')).toBeTruthy();
    expect(screen.queryByLabelText('Move its sections to')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'MAKE IT ONE PAGE' }));
    expect('tabs' in (last().sheet as object)).toBe(false);
    expect(problems(last())).toEqual([]);
    expect(groupNames()).toEqual(['One page, no tabs']);
    expect(screen.getByText('ONE PAGE · NO TABS')).toBeTruthy();
    expect(screen.getByText('Pick a tab, section or field on the left, or add one.')).toBeTruthy();
    // A section on one page has no tab to pick.
    await userEvent.click(node('IDENTITY section'));
    expect(screen.queryByLabelText('On tab')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ TAB' }));
    expect(tabs(last())).toEqual(['TAB 1']);
    expect(placement(last()).every((p) => p.startsWith('TAB 1/'))).toBe(true);
    expect(groupNames()).toEqual(['TAB 1 tab']);
    expect(problems(last())).toEqual([]);
  });

  it('says when a tab has no sections to move', async () => {
    await customized();
    await userEvent.click(screen.getByRole('button', { name: '+ TAB' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE TAB' }));
    expect(screen.getByText('Remove TAB 4? It has no sections.')).toBeTruthy();
    expect(screen.queryByLabelText('Move its sections to')).toBeNull();
  });
});

describe('sections', () => {
  it('adds a section to a tab, picked to name it', async () => {
    const { last } = await customized();
    await userEvent.click(within(tree()).getByRole('button', { name: 'Add a section to GEAR' }));
    expect(placement(last()).at(-1)).toBe('GEAR/new_section');
    const name = screen.getByLabelText('Section name') as HTMLInputElement;
    expect(name.value).toBe('NEW SECTION');
    await userEvent.clear(name);
    expect(screen.getByRole('alert').textContent).toBe('A section needs a name.');
    await userEvent.type(name, 'CYBERWARE');
    expect((last().sheet as CustomRenderSheet).sections.at(-1)!.label).toBe('CYBERWARE');
    expect(node('CYBERWARE section').getAttribute('aria-current')).toBe('true');
    expect(problems(last())).toEqual([]);
  });

  it('adds a section on a sheet of one page', async () => {
    const { last } = await customized({ ...HEARTH });
    for (const tab of ['STATS', 'GEAR', 'NOTES']) {
      await userEvent.click(node(`${tab} tab`));
      await userEvent.click(screen.getByRole('button', { name: 'REMOVE TAB' }));
      await userEvent.click(screen.getByRole('button', { name: tab === 'NOTES' ? 'MAKE IT ONE PAGE' : `REMOVE ${tab}` }));
    }
    await userEvent.click(within(tree()).getByRole('button', { name: 'Add a section' }));
    expect(placement(last()).at(-1)).toBe('-/new_section');
  });

  it('moves a section to another tab, and changes how it looks', async () => {
    const { last } = await customized();
    await userEvent.click(node('DERIVED section'));
    await userEvent.selectOptions(screen.getByLabelText('On tab'), 'GEAR');
    expect(placement(last())).toContain('GEAR/derived');
    expect(within(screen.getByRole('group', { name: 'GEAR tab' })).getByText('DERIVED')).toBeTruthy();
    const looks = within(screen.getByRole('group', { name: 'Looks like' }));
    expect(looks.getByRole('button', { name: 'GRID' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Columns') as HTMLInputElement).value).toBe('4');
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '12' } });
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'derived')!.columns).toBe(8);
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '' } });
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'derived')!.columns).toBe(8);
    await userEvent.click(looks.getByRole('button', { name: 'ITEMS' }));
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'derived')!.layout).toBe('inventory');
    expect(screen.queryByLabelText('Columns')).toBeNull();
    expect(within(node('DERIVED section').parentElement!).getByText('ITEMS')).toBeTruthy();
    expect(problems(last())).toEqual([]);
  });

  it('moves a section up and down among its own tab\'s', async () => {
    const { last } = await customized();
    expect((within(tree()).getByLabelText('Move INVENTORY up') as HTMLButtonElement).disabled).toBe(true);
    expect((within(tree()).getByLabelText('Move DERIVED down') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(tree()).getByLabelText('Move MONEY up'));
    expect(placement(last()).slice(4, 6)).toEqual(['GEAR/money', 'GEAR/inventory']);
    await userEvent.click(within(tree()).getByLabelText('Move IDENTITY down'));
    expect(placement(last()).slice(0, 2)).toEqual(['STATS/health', 'STATS/identity']);
  });

  it('won\'t remove the section holding the name, saying why', async () => {
    const { edits } = await customized();
    await userEvent.click(node('IDENTITY section'));
    const remove = screen.getByRole('button', { name: 'REMOVE SECTION' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(screen.getByText('It holds the character\'s name. Move Name to another section first.')).toBeTruthy();
    expect(edits).toEqual([]);
  });

  it('asks before removing a section with fields, naming its own that go with it', async () => {
    const own = { ...STARTER, sections: STARTER.sections.map((s) => (s.id === 'stats_abilities'
      ? { ...s, fields: [...s.fields, { id: 'grit', label: 'Grit', type: 'number' as const }] } : s)) };
    const { last, edits } = open({ ...HEARTH, sheet: own });
    await userEvent.click(await screen.findByRole('button', { name: 'ABILITIES section' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE SECTION' }));
    expect(screen.getByText(/Remove ABILITIES\? Stats, formulas and the starter's fields on it go back to NOT ON THE SHEET YET; its own fields \(Grit\) go with it\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'KEEP IT' }));
    expect(edits).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE SECTION' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE ABILITIES' }));
    expect(placement(last())).not.toContain('STATS/stats_abilities');
    expect(node('STATS tab').getAttribute('aria-current')).toBe('true');
    expect(problems(last())).toEqual([]);
  });

  it('says only what goes back when a section has none of its own, and removes an empty one at once', async () => {
    const { last } = await customized();
    // The starter's own Notes field goes back to the tray, so nothing is said to go with it.
    await userEvent.click(within(screen.getByRole('group', { name: 'NOTES tab' })).getByRole('button', { name: 'NOTES section' }));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE SECTION' }));
    expect(screen.getByText(/go back to NOT ON THE SHEET YET\.$/)).toBeTruthy();
    await userEvent.click(node('DERIVED section'));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE SECTION' }));
    expect(screen.getByText(/go back to NOT ON THE SHEET YET\.$/)).toBeTruthy();
    // Picking something else drops the question, so coming back doesn't find it still open.
    await userEvent.click(node('INVENTORY section'));
    expect(screen.queryByRole('group', { name: 'Remove DERIVED' })).toBeNull();
    await userEvent.click(node('DERIVED section'));
    expect(screen.queryByRole('group', { name: 'Remove DERIVED' })).toBeNull();
    await userEvent.click(node('INVENTORY section'));
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE SECTION' }));
    expect(placement(last())).not.toContain('GEAR/inventory');
  });
});

describe('fields', () => {
  it('lists each field with what it is, and moves it within its section', async () => {
    const { last } = await customized();
    expect(within(node('Save field').parentElement!).getByText('WORKED OUT')).toBeTruthy();
    expect(within(node('Cash field').parentElement!).getByText('LINKED')).toBeTruthy();
    expect(within(node('Description field').parentElement!).getByText('LONG TEXT')).toBeTruthy();
    expect((within(tree()).getByLabelText('Move Strength up') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(tree()).getByLabelText('Move Strength down'));
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'stats_abilities')!.fields.map((f) => f.id)).toEqual(['dex', 'str']);
    await userEvent.click(node('Dexterity field'));
    expect(within(screen.getByTestId('field-settings')).getByText('@dex')).toBeTruthy();
  });
});

const fieldOf = (def: Definition, id: string) => (def.sheet as CustomRenderSheet).sections.flatMap((s) => s.fields).find((f) => f.id === id);
const pressed = (group: string) => within(screen.getByRole('group', { name: group })).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

describe('field settings', () => {
  it('adds a field to a section, picked to name it', async () => {
    const { last } = await customized();
    await userEvent.click(node('IDENTITY section'));
    await userEvent.click(screen.getByRole('button', { name: '+ FIELD' }));
    expect(fieldOf(last(), 'new_field')).toEqual({ id: 'new_field', label: 'New field', type: 'text' });
    expect(node('New field field').getAttribute('aria-current')).toBe('true');
    const label = screen.getByLabelText('Field label') as HTMLInputElement;
    await userEvent.clear(label);
    expect(screen.getByRole('alert').textContent).toBe('A field needs a name.');
    expect(fieldOf(last(), 'new_field')!.label).toBe('New field');
    await userEvent.type(label, 'Reputation');
    expect(fieldOf(last(), 'new_field')!.label).toBe('Reputation');
    expect(problems(last())).toEqual([]);
  });

  it('makes a field a pick-one, typing its choices a line at a time', async () => {
    const { last } = await customized();
    await userEvent.click(node('Concept field'));
    expect(pressed('Kind')).toEqual(['TEXT']);
    await userEvent.click(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'PICK ONE' }));
    const choices = screen.getByLabelText('Choices') as HTMLTextAreaElement;
    expect(choices.value).toBe('Option 1\nOption 2');
    await userEvent.clear(choices);
    expect(screen.getByRole('alert').textContent).toBe('A pick-one field needs at least one choice.');
    await userEvent.type(choices, 'Courier{Enter}');
    expect(choices.value).toBe('Courier\n');
    await userEvent.type(choices, 'Fixer');
    expect(fieldOf(last(), 'concept')!.options).toEqual([{ value: 'Courier', label: 'Courier' }, { value: 'Fixer', label: 'Fixer' }]);
    expect(problems(last())).toEqual([]);
    await userEvent.click(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: 'LONG TEXT' }));
    expect(fieldOf(last(), 'concept')).toEqual({ id: 'concept', label: 'Concept', type: 'textarea' });
    expect(screen.queryByLabelText('Choices')).toBeNull();
  });

  it('shows the choices of the field picked, not the last one\'s', async () => {
    const sheet = { ...STARTER, sections: STARTER.sections.map((s) => (s.id === 'identity' ? { ...s, fields: [...s.fields,
      { id: 'origin', label: 'Origin', type: 'select' as const, options: [{ value: 'Street', label: 'Street' }] },
      { id: 'faction', label: 'Faction', type: 'select' as const, options: [{ value: 'Corp', label: 'Corp' }] }] } : s)) };
    open({ ...HEARTH, sheet });
    await userEvent.click(await screen.findByRole('button', { name: 'Origin field' }));
    expect((screen.getByLabelText('Choices') as HTMLTextAreaElement).value).toBe('Street');
    await userEvent.click(node('Faction field'));
    expect((screen.getByLabelText('Choices') as HTMLTextAreaElement).value).toBe('Corp');
  });

  it('says what a formula, linked field and stat are, without a kind to change', async () => {
    await customized();
    await userEvent.click(node('Save field'));
    expect(screen.getByText('A formula from STATS & RULES: worked out, so nobody edits it.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Kind' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Who changes it' })).toBeNull();
    await userEvent.click(node('Cash field'));
    expect(screen.getByText('Linked to the bank balance: the same number everywhere.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Who changes it' })).toBeTruthy();
    await userEvent.click(node('HP field'));
    expect(screen.getByText("Linked to the token's HP: the same number everywhere.")).toBeTruthy();
    await userEvent.click(node('Strength field'));
    expect(screen.getByText('A stat from STATS & RULES: a number players fill in.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Kind' })).toBeNull();
  });

  it('shows a field to everyone or the owner and GM, never an attack number', async () => {
    const { last } = await customized();
    await userEvent.click(node('Strength field'));
    expect(pressed('Who sees it')).toEqual(['OWNER AND GM']);
    const everyone = within(screen.getByRole('group', { name: 'Who sees it' })).getByRole('button', { name: 'EVERYONE' }) as HTMLButtonElement;
    await userEvent.click(everyone);
    expect(fieldOf(last(), 'str')!.visibility).toBe('public');
    expect(pressed('Who sees it')).toEqual(['EVERYONE']);
    await userEvent.click(screen.getByRole('checkbox', { name: /Decides whether attacks hit/ }));
    expect(fieldOf(last(), 'str')).toEqual({ id: 'str', label: 'Strength', type: 'number', sensitivity: 'combat' });
    expect(pressed('Who sees it')).toEqual(['OWNER AND GM']);
    expect(everyone.disabled).toBe(true);
    expect(everyone.title).toBe('A number that decides whether attacks hit is never shown to anyone else.');
    await userEvent.click(screen.getByRole('checkbox', { name: /Decides whether attacks hit/ }));
    expect(everyone.disabled).toBe(false);
    expect(fieldOf(last(), 'str')).toEqual({ id: 'str', label: 'Strength', type: 'number' });
    await userEvent.click(everyone);
    await userEvent.click(within(screen.getByRole('group', { name: 'Who sees it' })).getByRole('button', { name: 'OWNER AND GM' }));
    expect(fieldOf(last(), 'str')!.visibility).toBeUndefined();
    expect(problems(last())).toEqual([]);
  });

  it('lets only the GM change a field, and sets a hint', async () => {
    const { last } = await customized();
    await userEvent.click(node('Strength field'));
    expect(pressed('Who changes it')).toEqual(['THE PLAYER']);
    await userEvent.click(within(screen.getByRole('group', { name: 'Who changes it' })).getByRole('button', { name: 'ONLY THE GM' }));
    expect(fieldOf(last(), 'str')!.edit).toBe('gm');
    expect(pressed('Who changes it')).toEqual(['ONLY THE GM']);
    await userEvent.click(within(screen.getByRole('group', { name: 'Who changes it' })).getByRole('button', { name: 'THE PLAYER' }));
    expect('edit' in fieldOf(last(), 'str')!).toBe(false);
    await userEvent.type(screen.getByLabelText('Hint'), 'Rolled at creation');
    expect(fieldOf(last(), 'str')!.hint).toBe('Rolled at creation');
    await userEvent.clear(screen.getByLabelText('Hint'));
    expect('hint' in fieldOf(last(), 'str')!).toBe(false);
    expect(problems(last())).toEqual([]);
  });

  it('moves a field to another section, on another tab', async () => {
    const { last } = await customized();
    await userEvent.click(node('Concept field'));
    const to = screen.getByLabelText('Move to') as HTMLSelectElement;
    expect(to.value).toBe('identity');
    expect([...to.options].map((o) => o.textContent)).toContain('NOTES · NOTES');
    await userEvent.selectOptions(to, 'notes');
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'notes')!.fields.map((f) => f.id)).toEqual(['notes', 'concept']);
    expect(within(screen.getByRole('group', { name: 'NOTES tab' })).getByRole('button', { name: 'Concept field' })).toBeTruthy();
    expect((screen.getByLabelText('Move to') as HTMLSelectElement).value).toBe('notes');
    expect(problems(last())).toEqual([]);
  });

  it('keeps the name on the sheet, saying why', async () => {
    const { edits } = await customized();
    await userEvent.click(node('Name field'));
    expect((screen.getByRole('button', { name: 'TAKE OFF THE SHEET' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Every sheet keeps the character\'s name.')).toBeTruthy();
    expect(edits).toEqual([]);
  });

  it('says what happens to a field taken off: back to the tray, or gone', async () => {
    const own = { ...STARTER, sections: STARTER.sections.map((s) => (s.id === 'identity'
      ? { ...s, fields: [...s.fields, { id: 'grit', label: 'Grit', type: 'number' as const }] } : s)) };
    const { last } = open({ ...HEARTH, sheet: own });
    await userEvent.click(await screen.findByRole('button', { name: 'Grit field' }));
    expect(screen.getByText('Taken off, it is gone.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'TAKE OFF THE SHEET' }));
    expect(fieldOf(last(), 'grit')).toBeUndefined();
    expect(node('IDENTITY section').getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Not on the sheet yet' })).toBeNull();
    for (const name of ['Concept field', 'Save field', 'Strength field', 'Cash field']) {
      await userEvent.click(node(name));
      expect(screen.getByText('Taken off, it waits in NOT ON THE SHEET YET.')).toBeTruthy();
    }
  });
});

describe('not on the sheet yet', () => {
  const tray = () => screen.getByRole('region', { name: 'Not on the sheet yet' });

  it('holds what was taken off, in the starter\'s order, until placed', async () => {
    const { last } = await customized();
    for (const name of ['Save field', 'Concept field']) {
      await userEvent.click(node(name));
      await userEvent.click(screen.getByRole('button', { name: 'TAKE OFF THE SHEET' }));
    }
    expect(within(tray()).getByText('Concept')).toBeTruthy();
    expect(within(tray()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Place Concept', 'Place Save']);
    expect(within(tray()).getByText('WORKED OUT')).toBeTruthy();
    // DERIVED was picked when Save came off; Concept's section (IDENTITY) is picked now.
    await userEvent.click(within(tray()).getByRole('button', { name: 'Place Save' }));
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'identity')!.fields.map((f) => f.id)).toEqual(['name', 'description', 'save']);
    expect(node('Save field').getAttribute('aria-current')).toBe('true');
    await userEvent.click(within(tray()).getByRole('button', { name: 'Place Concept' }));
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'identity')!.fields.at(-1)!.id).toBe('concept');
    expect(screen.queryByRole('region', { name: 'Not on the sheet yet' })).toBeNull();
    expect(problems(last())).toEqual([]);
  });

  it('places into the picked tab\'s first section, or a new section when it has none', async () => {
    const { last } = await customized();
    await userEvent.click(node('Save field'));
    await userEvent.click(screen.getByRole('button', { name: 'TAKE OFF THE SHEET' }));
    await userEvent.click(node('GEAR tab'));
    await userEvent.click(within(tray()).getByRole('button', { name: 'Place Save' }));
    expect((last().sheet as CustomRenderSheet).sections.find((s) => s.id === 'inventory')!.fields.map((f) => f.id)).toEqual(['save']);
    await userEvent.click(screen.getByRole('button', { name: 'TAKE OFF THE SHEET' }));
    await userEvent.click(screen.getByRole('button', { name: '+ TAB' }));
    await userEvent.click(within(tray()).getByRole('button', { name: 'Place Save' }));
    expect(placement(last()).at(-1)).toBe('TAB 4/new_section');
    expect(fieldOf(last(), 'save')).toBeTruthy();
    expect(problems(last())).toEqual([]);
  });

  it('lists a stat added in STATS & RULES after customizing', async () => {
    const withGrit: Definition = { ...HEARTH, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }, { id: 'dex', label: 'Dexterity' }, { id: 'grit', label: 'Grit' }] }] };
    open({ ...withGrit, sheet: STARTER });
    expect(await screen.findByRole('button', { name: 'Place Grit' })).toBeTruthy();
    expect(within(tray()).getByText('NUMBER')).toBeTruthy();
  });

  it('isn\'t shown while the sheet is automatic', async () => {
    open();
    await screen.findByTestId('sheet-tree');
    expect(screen.queryByRole('region', { name: 'Not on the sheet yet' })).toBeNull();
  });
});

describe('asking the server', () => {
  it('asks at once, then only a moment after the last change', async () => {
    vi.useFakeTimers();
    const { api } = open({ ...HEARTH, sheet: STARTER });
    const ask = (api as ReturnType<typeof serverApi>).previewSheet;
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(ask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '+ TAB' }));
    fireEvent.click(screen.getByRole('button', { name: '+ TAB' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEET_PREVIEW_DELAY_MS - 1); });
    expect(ask).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(tabs(ask.mock.calls[1][0])).toEqual(['STATS', 'GEAR', 'NOTES', 'TAB 4', 'TAB 5']);
  });

  it('never lets a late answer replace a newer one', async () => {
    const answers: ((v: unknown) => void)[] = [];
    const api = { previewSheet: vi.fn(() => new Promise((r) => { answers.push(r); })) };
    const Harness = () => {
      const [def, setDef] = useState<Definition>(HEARTH);
      return (
        <>
          <button type="button" onClick={() => setDef({ ...HEARTH, parts: { bank: { on: false } } })}>BANK OFF</button>
          <SheetPage definition={def} edit={setDef} api={api as unknown as Api} />
        </>
      );
    };
    render(<Harness />);
    await waitFor(() => expect(answers).toHaveLength(1));
    await userEvent.click(screen.getByText('BANK OFF'));
    await waitFor(() => expect(answers).toHaveLength(2), { timeout: 2000 });
    const noBank = { ...HEARTH, parts: { bank: { on: false } } };
    await act(async () => { answers[1]({ ok: true, value: { sheet: effectiveSheet(noBank), starter: starterSheet(noBank) } }); });
    await act(async () => { answers[0]({ ok: true, value: { sheet: effectiveSheet(HEARTH), starter: STARTER } }); });
    expect(within(tree()).queryByText('MONEY')).toBeNull();
  });
});
