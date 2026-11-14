import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemsPage } from '../ItemsPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS, TOPICS } from '../../sheets/builderHelp';
import { BUILDER_PAGES } from '../../sheets/builderSession';

/**
 * The builder's ITEMS page (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): SLOTS, each with its name and how
 * many each character has, and ITEMS, each opening to its name, words, what its features need, and its features, the
 * CHOICES form without a level, a list or an increase.
 */

afterEach(() => cleanup());

const WORN = {
  format: 1, name: 'Worn', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [] }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    list: [{ id: 'ring', label: 'Ring', needs: 'attuned', features: [{ id: 'hardy', label: 'Hardy', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] }],
  },
} as unknown as Definition;

const open = (start: Definition = WORN) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <ItemsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return () => edits[edits.length - 1] as unknown as { items?: { slots?: object[]; list?: object[] } };
};
const slot = (id: string) => within(screen.getByTestId(`slot-${id}`));
const ring = () => within(screen.getByRole('region', { name: 'Ring item' }));

describe('SLOTS', () => {
  it('each with its name and how many each character has; + SLOT; × removes it', async () => {
    const last = open();
    expect((slot('attuned').getByLabelText('ATTUNED slot name') as HTMLInputElement).value).toBe('ATTUNED');
    expect((slot('attuned').getByLabelText('ATTUNED each character has') as HTMLInputElement).value).toBe('3');
    expect(screen.getByText('SLOTS · 1 OF 10')).toBeTruthy();
    fireEvent.change(slot('attuned').getByLabelText('ATTUNED each character has'), { target: { value: '2' } });
    expect(last().items!.slots).toEqual([{ id: 'attuned', label: 'ATTUNED', count: 2 }]);
    // Emptied, it keeps what it had until a number is typed.
    fireEvent.change(slot('attuned').getByLabelText('ATTUNED each character has'), { target: { value: '' } });
    expect(last().items!.slots).toEqual([{ id: 'attuned', label: 'ATTUNED', count: 2 }]);
    fireEvent.change(slot('attuned').getByLabelText('ATTUNED slot name'), { target: { value: 'BOUND' } });
    expect(last().items!.slots).toEqual([{ id: 'attuned', label: 'BOUND', count: 2 }]);
    await userEvent.click(screen.getByRole('button', { name: '+ SLOT' }));
    expect(last().items!.slots).toEqual([{ id: 'attuned', label: 'BOUND', count: 2 }, { id: 'new_slot', label: 'NEW SLOT', count: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove the BOUND slot' }));
    expect(last().items!.slots).toEqual([{ id: 'new_slot', label: 'NEW SLOT', count: 1 }]);
    // The ring needed it: back to worn.
    expect(last().items!.list![0]).not.toHaveProperty('needs');
  });

  it('the page says what slots are, at the top', () => {
    open();
    expect(screen.getByText(/^SLOTS limit how many items can work at once, like D&D's attunement/)).toBeTruthy();
  });

  it('none: says what one is for', () => {
    open({ ...WORN, items: { list: [] } } as unknown as Definition);
    expect(screen.getByText(/None: every item counts carried or worn/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Slots' })).queryByRole('table')).toBeNull();
  });
});

describe('ITEMS', () => {
  it('each a line saying what it needs; opened, its name, words and needs', async () => {
    const last = open();
    const line = screen.getByRole('button', { name: /RING/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(line.textContent).toContain('WORN AND ATTUNED');
    expect(line.textContent).toContain('1 FEATURE');
    await userEvent.click(line);
    fireEvent.change(ring().getByLabelText('NAME'), { target: { value: 'Ring of Constitution' } });
    expect(last().items!.list![0]).toMatchObject({ label: 'Ring of Constitution' });
    const card = within(screen.getByRole('region', { name: 'Ring of Constitution item' }));
    fireEvent.change(card.getByLabelText('WORDS'), { target: { value: 'A plain band.' } });
    expect(last().items!.list![0]).toMatchObject({ description: 'A plain band.' });
    expect([...(card.getByLabelText('ITS FEATURES NEED') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['CARRIED', 'WORN', 'WORN AND ATTUNED']);
    await userEvent.selectOptions(card.getByLabelText('ITS FEATURES NEED'), 'worn');
    expect(last().items!.list![0]).not.toHaveProperty('needs');
    await userEvent.selectOptions(card.getByLabelText('ITS FEATURES NEED'), 'carried');
    expect(last().items!.list![0]).toMatchObject({ needs: 'carried' });
  });

  it('its features: the CHOICES form without a level, a list or an increase', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /RING/ }));
    await userEvent.click(ring().getByRole('button', { name: /HARDY/ }));
    const form = within(ring().getByRole('group', { name: 'Feature Hardy' }));
    expect(form.getByRole('group', { name: 'Modifiers' })).toBeTruthy();
    expect(form.queryByText('INCREASE')).toBeNull();
    expect(form.queryByText('OPENS A LIST')).toBeNull();
    expect(form.queryByText('AT LEVEL')).toBeNull();
    expect(form.getByText('USES')).toBeTruthy();
    // An item's own limit, not a class's.
    expect(ring().getByText('FEATURES · 1 OF 20')).toBeTruthy();
  });

  it('+ ITEM opens a new one; + FEATURE on it; DELETE ITEM asks first', async () => {
    const last = open();
    await userEvent.click(screen.getByRole('button', { name: '+ ITEM' }));
    expect(last().items!.list![1]).toEqual({ id: 'new_item', label: 'NEW ITEM' });
    const fresh = within(screen.getByRole('region', { name: 'NEW ITEM item' }));
    expect(fresh.getByRole('button', { name: /NEW ITEM/ }).getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(fresh.getByRole('button', { name: '+ FEATURE' }));
    expect(last().items!.list![1]).toEqual({ id: 'new_item', label: 'NEW ITEM', features: [{ id: 'new_feature', label: 'NEW FEATURE' }] });
    await userEvent.click(fresh.getByRole('button', { name: 'DELETE ITEM' }));
    expect(fresh.getByText(/Delete NEW ITEM\? Its features go with it\./)).toBeTruthy();
    await userEvent.click(fresh.getByRole('button', { name: 'KEEP' }));
    await userEvent.click(fresh.getByRole('button', { name: 'DELETE ITEM' }));
    await userEvent.click(fresh.getByRole('button', { name: 'DELETE' }));
    expect(last().items!.list).toHaveLength(1);
  });

  it('one needing a slot that is gone keeps saying so, to be set again', async () => {
    open({ ...WORN, items: { list: [{ id: 'ring', label: 'Ring', needs: 'bound' }] } } as unknown as Definition);
    await userEvent.click(screen.getByRole('button', { name: /RING/ }));
    const needs = ring().getByLabelText('ITS FEATURES NEED') as HTMLSelectElement;
    expect(needs.value).toBe('bound');
    expect([...needs.options].map((o) => o.textContent)).toEqual(['WORN AND BOUND', 'CARRIED', 'WORN']);
  });

  it('a nameless one says so, in the danger color', async () => {
    open({ ...WORN, items: { list: [{ id: 'x', label: '' }] } } as unknown as Definition);
    expect(screen.getByRole('button', { name: /NEEDS A NAME/ })).toBeTruthy();
  });

  it('none: says what one is', () => {
    open({ ...WORN, items: { slots: WORN.items } } as unknown as Definition);
    expect(screen.getByText(/None yet\. An item here is one that does something/)).toBeTruthy();
  });
});

describe('on the rail, in HELP and the "?"s', () => {
  it('ITEMS comes after CHOICES, with a HELP topic and a hint for each name', () => {
    const ids = BUILDER_PAGES.map((p) => p.id);
    expect(ids.indexOf('items')).toBe(ids.indexOf('choices') + 1);
    expect(TOPICS.find((t) => t.id === 'items')?.title).toBe('ITEMS');
    for (const k of ['items.slots', 'items.count', 'items.items', 'items.name', 'items.words', 'items.needs'] as const) expect(HINTS[k], k).toBeTruthy();
  });
});

describe('INSTALLS (7e4b)', () => {
  const WIRED = {
    ...(WORN as unknown as object),
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }, { id: 'strain', label: 'Strain' }] }],
    items: { ...(WORN as unknown as { items: object }).items, installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'strain', limit: '@con' }] },
  } as unknown as Definition;
  type Wired = { items?: { installs?: object[]; list?: { id: string; needs?: string; cost?: number }[] } };
  const cyber = () => within(screen.getByTestId('install-cyberware'));

  it('each with its name, what it costs against, which way and its limit; + INSTALL; × removes it', async () => {
    const last = open(WIRED) as unknown as () => Wired;
    expect(screen.getByText('INSTALLS · 1 OF 10')).toBeTruthy();
    expect((cyber().getByLabelText('NAME') as HTMLInputElement).value).toBe('CYBERWARE');
    const against = cyber().getByLabelText('COSTS AGAINST') as HTMLSelectElement;
    expect(against.value).toBe('strain');
    // The token's maximum is never offered: its bonuses live on the token.
    expect([...against.options].map((o) => o.value)).not.toContain('hp_max');
    fireEvent.change(against, { target: { value: 'con' } });
    expect(last().items!.installs).toEqual([{ id: 'cyberware', label: 'CYBERWARE', against: 'con', limit: '@con' }]);
    expect(cyber().getByText('NEVER PAST')).toBeTruthy();
    await userEvent.click(cyber().getByRole('button', { name: 'TAKES FROM IT' }));
    expect(last().items!.installs![0]).toMatchObject({ way: 'takes' });
    expect(cyber().getByText('NEVER BELOW')).toBeTruthy();
    expect(cyber().getByRole('button', { name: 'TAKES FROM IT' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(cyber().getByLabelText('CYBERWARE limit'), { target: { value: '0' } });
    expect(last().items!.installs![0]).toMatchObject({ limit: '0' });
    fireEvent.change(cyber().getByLabelText('NAME'), { target: { value: 'BIOWARE' } });
    expect(last().items!.installs![0]).toMatchObject({ label: 'BIOWARE' });
    await userEvent.click(screen.getByRole('button', { name: '+ INSTALL' }));
    expect(screen.getByText('INSTALLS · 2 OF 10')).toBeTruthy();
    expect((within(screen.getByTestId('install-new_install')).getByLabelText('COSTS AGAINST') as HTMLSelectElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Remove the BIOWARE install' }));
    expect(last().items!.installs!.map((s) => (s as { id: string }).id)).toEqual(['new_install']);
  });

  it('an item INSTALLED AS one gets a COST, naming what it counts on; worn again, none', async () => {
    const last = open(WIRED) as unknown as () => Wired;
    await userEvent.click(screen.getByRole('button', { name: /RING/ }));
    expect(ring().queryByLabelText('COST')).toBeNull();
    fireEvent.change(ring().getByLabelText('ITS FEATURES NEED'), { target: { value: 'cyberware' } });
    expect(last().items!.list![0]).toMatchObject({ needs: 'cyberware', cost: 1 });
    expect(ring().getByText('STRAIN · FRACTIONS ARE FINE: 0.25')).toBeTruthy();
    fireEvent.change(ring().getByLabelText('COST'), { target: { value: '0.25' } });
    expect(last().items!.list![0].cost).toBe(0.25);
    // Emptied, it keeps what it had until a number is typed.
    fireEvent.change(ring().getByLabelText('COST'), { target: { value: '' } });
    expect(last().items!.list![0].cost).toBe(0.25);
    fireEvent.change(ring().getByLabelText('ITS FEATURES NEED'), { target: { value: 'worn' } });
    expect(last().items!.list![0]).not.toHaveProperty('cost');
    expect(ring().queryByLabelText('COST')).toBeNull();
  });

  it('none: said what one is; every hint written', () => {
    open();
    expect(screen.getByText(/^None: no item can need installing/)).toBeTruthy();
    for (const k of ['items.installs', 'items.against', 'items.way', 'items.limit', 'items.cost']) expect(HINTS[k], k).toBeTruthy();
  });
});

describe('ITEM TYPES (8a2)', () => {
  type Typed = { items?: { types?: { id: string; label: string; one?: string; columns: Record<string, unknown>[] }[]; list?: Record<string, unknown>[] } };
  const section = () => within(screen.getByRole('region', { name: 'Item types' }));
  const type = (name: string) => within(screen.getByRole('region', { name: `${name} type` }));
  const tab = (name: string) => within(section().getByRole('group', { name: 'The item types' })).getByRole('button', { name });
  const preset = (name: string) => within(section().getByRole('group', { name: 'Add an item type' })).getByRole('button', { name });

  it('GEAR to start, said so; a preset beside it, opened; its name, ONE and columns', async () => {
    const last = open() as unknown as () => Typed;
    expect(section().getByText('ITEM TYPES · 1 OF 10')).toBeTruthy();
    expect(section().getByText(/^Every system starts with GEAR/)).toBeTruthy();
    expect(tab('GEAR').getAttribute('aria-pressed')).toBe('true');
    expect((type('GEAR').getByLabelText('WEIGHT column name') as HTMLInputElement).value).toBe('WEIGHT');
    await userEvent.click(preset('WEAPON'));
    expect(last().items!.types!.map((t) => t.id)).toEqual(['gear', 'weapons']);
    expect(tab('WEAPONS').getAttribute('aria-pressed')).toBe('true');
    expect(section().queryByText(/^Every system starts with GEAR/)).toBeNull();
    fireEvent.change(type('WEAPONS').getByLabelText('NAME'), { target: { value: 'ARMS' } });
    fireEvent.change(type('ARMS').getByLabelText('ONE'), { target: { value: 'Arm' } });
    expect(last().items!.types![1]).toMatchObject({ id: 'weapons', label: 'ARMS', one: 'Arm' });
    expect(type('ARMS').getAllByRole('row').slice(1).map((r) => (within(r).getAllByRole('textbox')[0] as HTMLInputElement).value)).toEqual(['DAMAGE', 'RANGE', 'AMMO', 'WEIGHT', 'PRICE']);
    // GEAR again, by its tab.
    await userEvent.click(tab('GEAR'));
    expect(type('GEAR').getByLabelText('PRICE kind')).toBeTruthy();
  });

  it('each column: its name, its kind (what it is said under), what its kind has, ×; + COLUMN', async () => {
    const last = open() as unknown as () => Typed;
    const gear = () => type('GEAR');
    fireEvent.change(gear().getByLabelText('WEIGHT unit'), { target: { value: 'KG' } });
    expect(last().items!.types![0].columns[0]).toEqual({ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'KG' });
    await userEvent.click(gear().getByRole('button', { name: '+ COLUMN' }));
    expect(last().items!.types![0].columns[2]).toEqual({ id: 'new_column', label: 'NEW COLUMN', kind: 'number' });
    expect(gear().getByRole('status').textContent).toMatch(/^NUMBER: a value/);
    fireEvent.change(gear().getByLabelText('NEW COLUMN column name'), { target: { value: 'GRADE' } });
    fireEvent.change(gear().getByLabelText('GRADE kind'), { target: { value: 'pick' } });
    expect(gear().getByRole('status').textContent).toMatch(/^PICK ONE: one of the words you list/);
    const words = gear().getByLabelText('GRADE words') as HTMLInputElement;
    expect(words.getAttribute('aria-invalid')).toBe('true');
    // Typed with commas, what is typed stays while typing.
    await userEvent.click(words);
    await userEvent.type(words, 'LIGHT, ');
    expect(words.value).toBe('LIGHT, ');
    await userEvent.type(words, 'HEAVY');
    expect(last().items!.types![0].columns[2]).toEqual({ id: 'new_column', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] });
    fireEvent.change(gear().getByLabelText('GRADE kind'), { target: { value: 'count' } });
    fireEvent.change(gear().getByLabelText('GRADE button'), { target: { value: 'FIRE' } });
    fireEvent.change(gear().getByLabelText('GRADE refilled by'), { target: { value: 'long_rest' } });
    expect(last().items!.types![0].columns[2]).toEqual({ id: 'new_column', label: 'GRADE', kind: 'count', button: 'FIRE', refill: 'long_rest' });
    expect([...(gear().getByLabelText('GRADE refilled by') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['NO REST', 'SHORT REST', 'LONG REST', 'END OF SCENE', 'END OF SESSION']);
    fireEvent.change(gear().getByLabelText('GRADE: reload from an item'), { target: { value: 'ring' } });
    expect(last().items!.types![0].columns[2]).toMatchObject({ reload: ['ring'] });
    // Every item is one it reloads from: no more to add.
    expect((gear().getByLabelText('GRADE: reload from an item') as HTMLSelectElement).disabled).toBe(true);
    await userEvent.click(gear().getByRole('button', { name: 'GRADE no longer reloads from Ring' }));
    expect(last().items!.types![0].columns[2]).not.toHaveProperty('reload');
    // What a kind is, said for the column changed, wherever it is; + COLUMN says NUMBER again.
    fireEvent.change(gear().getByLabelText('WEIGHT kind'), { target: { value: 'dice' } });
    expect(gear().getByRole('status').textContent).toMatch(/^DICE: any other roll/);
    await userEvent.click(gear().getByRole('button', { name: '+ COLUMN' }));
    expect(gear().getByRole('status').textContent).toMatch(/^NUMBER: a value/);
    await userEvent.click(gear().getByRole('button', { name: 'Remove the GRADE column' }));
    expect(last().items!.types![0].columns.map((c) => c.id)).toEqual(['weight', 'price', 'new_column_2']);
  });

  it('DELETE TYPE asks, saying what its items become; never the last', async () => {
    const last = open({ ...WORN, items: { ...(WORN as unknown as { items: object }).items, types: [
      { id: 'gear', label: 'GEAR', columns: [] }, { id: 'relics', label: 'RELICS', columns: [{ id: 'age', label: 'AGE', kind: 'number' }] }] } } as unknown as Definition) as unknown as () => Typed;
    expect(type('GEAR').getByText('No columns: its items have only a name and how many.')).toBeTruthy();
    await userEvent.click(tab('RELICS'));
    await userEvent.click(type('RELICS').getByRole('button', { name: 'DELETE TYPE' }));
    expect(type('RELICS').getByText('Delete RELICS? No item is one.')).toBeTruthy();
    await userEvent.click(type('RELICS').getByRole('button', { name: 'KEEP' }));
    await userEvent.click(tab('GEAR'));
    await userEvent.click(type('GEAR').getByRole('button', { name: 'DELETE TYPE' }));
    expect(type('GEAR').getByText('Delete GEAR? Its item becomes RELICS, with nothing filled in.')).toBeTruthy();
    await userEvent.click(type('GEAR').getByRole('button', { name: 'DELETE' }));
    expect(last().items!.types!.map((t) => t.id)).toEqual(['relics']);
    expect(type('RELICS').queryByRole('button', { name: 'DELETE TYPE' })).toBeNull();
  });

  it('at the most, no preset and no BLANK', async () => {
    open();
    for (let i = 1; i < 10; i += 1) await userEvent.click(preset('+ BLANK'));
    expect(section().getByText('ITEM TYPES · 10 OF 10')).toBeTruthy();
    expect((preset('+ BLANK') as HTMLButtonElement).disabled).toBe(true);
    expect((preset('SPELL') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an item: its TYPE, said on its line, and a field for each column by its kind', async () => {
    const last = open() as unknown as () => Typed;
    await userEvent.click(preset('WEAPON'));
    await userEvent.click(preset('ARMOR'));
    await userEvent.click(screen.getByRole('button', { name: /RING/ }));
    expect(screen.getByRole('button', { name: /RING/ }).textContent).toContain('GEAR');
    const typeBox = () => ring().getByLabelText('TYPE', { selector: '#item-ring-type' }) as HTMLSelectElement;
    expect([...typeBox().options].map((o) => o.textContent)).toEqual(['GEAR', 'WEAPONS', 'ARMOR']);
    fireEvent.change(ring().getByLabelText('WEIGHT'), { target: { value: '0.5' } });
    fireEvent.change(ring().getByLabelText('PRICE'), { target: { value: '15' } });
    expect(last().items!.list![0]).toMatchObject({ values: { weight: 0.5, price: 15 } });
    fireEvent.change(typeBox(), { target: { value: 'weapons' } });
    expect(last().items!.list![0]).toMatchObject({ type: 'weapons', values: { weight: 0.5, price: 15 } });
    expect(screen.getByRole('button', { name: /RING/ }).textContent).toContain('WEAPON');
    fireEvent.change(ring().getByLabelText('DAMAGE'), { target: { value: '1d8 + @con' } });
    fireEvent.change(ring().getByLabelText('RANGE'), { target: { value: 'melee' } });
    fireEvent.change(ring().getByLabelText('AMMO'), { target: { value: '6.7' } });
    expect(ring().getByText('IT HOLDS · FIRE SPENDS ONE')).toBeTruthy();
    expect(last().items!.list![0].values).toEqual({ weight: 0.5, price: 15, damage: '1d8 + @con', range: 'melee', ammo: 6 });
    fireEvent.change(ring().getByLabelText('AMMO'), { target: { value: '5000' } });
    expect((last().items!.list![0].values as { ammo: number }).ammo).toBe(1000);
    fireEvent.change(ring().getByLabelText('RANGE'), { target: { value: '' } });
    fireEvent.change(ring().getByLabelText('WEIGHT'), { target: { value: '' } });
    expect(last().items!.list![0].values).toEqual({ price: 15, damage: '1d8 + @con', ammo: 1000 });
    fireEvent.change(typeBox(), { target: { value: 'armor' } });
    const grade = ring().getByLabelText('TYPE', { selector: '#item-ring-value-type' }) as HTMLSelectElement;
    expect([...grade.options].map((o) => o.textContent)).toEqual(['—', 'LIGHT', 'MEDIUM', 'HEAVY']);
    fireEvent.change(grade, { target: { value: 'HEAVY' } });
    expect(last().items!.list![0]).toMatchObject({ type: 'armor', values: { price: 15, type: 'HEAVY' } });
  });

  it('every hint written', () => {
    for (const k of ['items.types', 'items.typeName', 'items.one', 'items.column', 'items.kind', 'items.and', 'items.type']) expect(HINTS[k], k).toBeTruthy();
  });
});
