import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemsPage } from '../ItemsPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS, TOPICS } from '../../sheets/builderHelp';
import { BUILDER_PAGES } from '../../sheets/builderSession';
import { forgetBuilderPlaces } from '../../hooks/useBuilderPlace';

/**
 * The builder's ITEMS page (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): SLOTS, each with its name and how
 * many each character has, and ITEMS, each opening to its name, words, what its features need, and its features, the
 * CHOICES form without a level, a list or an increase.
 */

afterEach(() => { cleanup(); forgetBuilderPlaces(); });

const WORN = {
  format: 1, name: 'Worn', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [] }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    list: [{ id: 'ring', label: 'Ring', needs: 'attuned', features: [{ id: 'hardy', label: 'Hardy', modifiers: [{ target: 'con', amount: '2', cap: 20 }] }] }],
  },
} as unknown as Definition;

type ItemsTab = 'TYPES' | 'SLOTS & INSTALLS' | 'ENCUMBRANCE' | 'ITEMS';
const open = (start: Definition = WORN, tab: ItemsTab = 'TYPES') => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <ItemsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  if (tab !== 'TYPES') fireEvent.click(screen.getByRole('tab', { name: tab }));
  return () => edits[edits.length - 1] as unknown as { items?: { slots?: object[]; list?: object[] } };
};
const slot = (id: string) => within(screen.getByTestId(`slot-${id}`));
const ring = () => within(screen.getByRole('region', { name: 'Ring item' }));
/** An item's line in the list (8aL2), by the start of its name. */
const listed = (name: string) => within(screen.getByRole('region', { name: 'Items' })).getByRole('button', { name: new RegExp(`^${name}`) });
const TWO_ITEMS = { ...WORN, items: { ...(WORN as unknown as { items: object }).items, list: [{ id: 'ring', label: 'Ring', needs: 'attuned' }, { id: 'boots', label: 'Boots' }] } } as unknown as Definition;

describe('SLOTS', () => {
  it('each with its name and how many each character has; + SLOT; × removes it', async () => {
    const last = open(WORN, 'SLOTS & INSTALLS');
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

  it('the page is four tabs in the order a system is set up (8aL1, ENCUMBRANCE 8a5c), each with a line saying what it is for', async () => {
    open();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['TYPES', 'SLOTS & INSTALLS', 'ENCUMBRANCE', 'ITEMS']);
    expect(screen.getByRole('tab', { name: 'TYPES' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/^What kinds of thing your game has/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Slots' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'SLOTS & INSTALLS' }));
    expect(screen.getByText(/^For the few games that need them/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Slots' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Installs' })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'ENCUMBRANCE' }));
    expect(screen.getByText(/^What each character carries against what they can/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Encumbrance' })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'ITEMS' }));
    expect(screen.getByText(/^The things a character carries, wears or installs/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Item types' })).toBeNull();
  });

  it('the tab and the open item are where they were left, while the builder is open; another system starts on TYPES', async () => {
    open(TWO_ITEMS, 'ITEMS');
    await userEvent.click(listed('Boots'));
    cleanup();
    open(TWO_ITEMS);
    expect(screen.getByRole('tab', { name: 'ITEMS' }).getAttribute('aria-selected')).toBe('true');
    expect(listed('Boots').getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('region', { name: 'Boots item' })).toBeTruthy();
    cleanup();
    render(<ItemsPage definition={WORN} edit={() => {}} place="items:another" />);
    expect(screen.getByRole('tab', { name: 'TYPES' }).getAttribute('aria-selected')).toBe('true');
    // The open type too.
    cleanup();
    const TWO = { ...WORN, items: { types: [{ id: 'gear', label: 'GEAR', columns: [] }, { id: 'relics', label: 'RELICS', columns: [] }] } } as unknown as Definition;
    render(<ItemsPage definition={TWO} edit={() => {}} place="items:two" />);
    await userEvent.click(within(screen.getByRole('group', { name: 'The item types' })).getByRole('button', { name: 'RELICS' }));
    cleanup();
    render(<ItemsPage definition={TWO} edit={() => {}} place="items:two" />);
    expect(screen.getByRole('region', { name: 'RELICS type' })).toBeTruthy();
  });

  it('none: says what one is for', () => {
    open({ ...WORN, items: { list: [] } } as unknown as Definition, 'SLOTS & INSTALLS');
    expect(screen.getByText(/None: every item counts carried or worn/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Slots' })).queryByRole('table')).toBeNull();
  });
});

describe('ITEMS (beside their list since 8aL2)', () => {
  it('a list grouped by type beside the open item, the first open to start; each line saying what it needs', async () => {
    open(TWO_ITEMS, 'ITEMS');
    const gear = within(screen.getByRole('group', { name: 'GEAR items' }));
    expect(gear.getByText('GEAR · 2')).toBeTruthy();
    expect(listed('Ring').getAttribute('aria-current')).toBe('true');
    expect(listed('Ring').textContent).toBe('RingATTUNED');
    expect(listed('Ring').title).toBe('WORN AND ATTUNED');
    // WORN says nothing in the list.
    expect(listed('Boots').textContent).toBe('Boots');
    expect(screen.getByRole('region', { name: 'Ring item' })).toBeTruthy();
    await userEvent.click(listed('Boots'));
    expect(listed('Boots').getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Ring item' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Boots item' })).toBeTruthy();
  });

  it('the open item: NAME, TYPE and its columns first, then what it needs, its cost and words; each written', async () => {
    const last = open(WORN, 'ITEMS');
    const labels = [...screen.getByRole('region', { name: 'Ring item' }).querySelectorAll('label')].map((l) => l.textContent);
    expect(labels.slice(0, 6)).toEqual(['NAME', 'TYPE', 'WEIGHT', 'PRICE', 'ITS FEATURES NEED', 'WORDS']);
    fireEvent.change(ring().getByLabelText('NAME'), { target: { value: 'Ring of Constitution' } });
    expect(last().items!.list![0]).toMatchObject({ label: 'Ring of Constitution' });
    expect(listed('Ring of Constitution')).toBeTruthy();
    const card = within(screen.getByRole('region', { name: 'Ring of Constitution item' }));
    fireEvent.change(card.getByLabelText('WORDS'), { target: { value: 'A plain band.' } });
    expect(last().items!.list![0]).toMatchObject({ description: 'A plain band.' });
    expect([...(card.getByLabelText('ITS FEATURES NEED') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['CARRIED', 'WORN', 'WORN AND ATTUNED']);
    await userEvent.selectOptions(card.getByLabelText('ITS FEATURES NEED'), 'worn');
    expect(last().items!.list![0]).not.toHaveProperty('needs');
    await userEvent.selectOptions(card.getByLabelText('ITS FEATURES NEED'), 'carried');
    expect(last().items!.list![0]).toMatchObject({ needs: 'carried' });
    expect(listed('Ring of Constitution').textContent).toContain('CARRIED');
  });

  it('a line says a slot or install by its name, not its id', () => {
    open({ ...WORN, items: { slots: [{ id: 'bond', label: 'Bonded', count: 1 }], installs: [{ id: 'cyber', label: 'Cyberware', against: 'con', limit: '1' }],
      list: [{ id: 'ring', label: 'Ring', needs: 'bond' }, { id: 'jack', label: 'Jack', needs: 'cyber', cost: 1 }] } } as unknown as Definition, 'ITEMS');
    expect(listed('Ring').textContent).toBe('RingBONDED');
    expect(listed('Jack').textContent).toBe('JackCYBERWARE');
  });

  it('its features: the CHOICES form without a level, a list or an increase', async () => {
    open(WORN, 'ITEMS');
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

  it('+ beside a type makes one of it, opened with its name selected to type over; + FEATURE; DELETE ITEM asks first', async () => {
    const last = open(WORN, 'ITEMS');
    await userEvent.click(screen.getByRole('button', { name: 'Add a Gear' }));
    // No types of its own: GEAR, unsaid.
    expect(last().items!.list![1]).toEqual({ id: 'new_item', label: 'NEW GEAR' });
    const fresh = within(screen.getByRole('region', { name: 'NEW GEAR item' }));
    const name = fresh.getByLabelText('NAME') as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'NEW GEAR'.length]);
    expect(listed('NEW GEAR').getAttribute('aria-current')).toBe('true');
    await userEvent.click(fresh.getByRole('button', { name: '+ FEATURE' }));
    expect(last().items!.list![1]).toEqual({ id: 'new_item', label: 'NEW GEAR', features: [{ id: 'new_feature', label: 'NEW FEATURE' }] });
    await userEvent.click(fresh.getByRole('button', { name: 'DELETE ITEM' }));
    expect(fresh.getByText(/Delete NEW GEAR\? Its features go with it\./)).toBeTruthy();
    await userEvent.click(fresh.getByRole('button', { name: 'KEEP' }));
    await userEvent.click(fresh.getByRole('button', { name: 'DELETE ITEM' }));
    await userEvent.click(fresh.getByRole('button', { name: 'DELETE' }));
    expect(last().items!.list).toHaveLength(1);
    // Gone, the first opens again.
    expect(screen.getByRole('region', { name: 'Ring item' })).toBeTruthy();
  });

  it('+ beside a type of its own says the type; opening another item leaves nothing selected', async () => {
    const TYPED = { ...WORN, items: { types: [{ id: 'gear', label: 'GEAR', columns: [] }, { id: 'arms', label: 'ARMS', one: 'Arm', columns: [] }], list: [{ id: 'ring', label: 'Ring' }] } } as unknown as Definition;
    const last = open(TYPED, 'ITEMS');
    await userEvent.click(screen.getByRole('button', { name: 'Add a Arm' }));
    // IN SHOPS from the start (8a7a3b1): the GM gives it a price as it is made.
    expect(last().items!.list![1]).toEqual({ id: 'new_item', label: 'NEW ARM', type: 'arms', in_shops: true });
    expect(within(screen.getByRole('group', { name: 'ARMS items' })).getByText('ARMS · 1')).toBeTruthy();
    await userEvent.click(listed('Ring'));
    expect(document.activeElement).not.toBe(ring().getByLabelText('NAME'));
    // Back to the new one: it is no longer new, so nothing is selected.
    await userEvent.click(listed('NEW ARM'));
    expect(document.activeElement).not.toBe(within(screen.getByRole('region', { name: 'NEW ARM item' })).getByLabelText('NAME'));
  });

  it('FIND filters as it is typed into, anywhere in a name; a type with none left folds away; the count said', async () => {
    const MANY = { ...WORN, items: { types: [{ id: 'gear', label: 'GEAR', columns: [] }, { id: 'arms', label: 'ARMS', one: 'Arm', columns: [] }],
      list: [{ id: 'rope', label: 'Rope' }, { id: 'pistol', label: 'Pistol', type: 'arms' }, { id: 'rounds', label: 'Pistol Rounds' }] } } as unknown as Definition;
    open(MANY, 'ITEMS');
    const find = screen.getByRole('searchbox', { name: 'Find an item' });
    await userEvent.type(find, 'pis');
    const items = within(screen.getByRole('region', { name: 'Items' }));
    // Each by its name (unpriced, each says NOT SOLD beside it since 8a7a3b1).
    expect(items.getAllByRole('button').filter((b) => !b.textContent!.startsWith('+')).map((b) => b.firstElementChild?.textContent)).toEqual(['Pistol Rounds', 'Pistol']);
    expect(items.getByRole('status').textContent).toBe('2 OF 3');
    await userEvent.clear(find);
    await userEvent.type(find, 'rounds');
    expect(screen.queryByRole('group', { name: 'ARMS items' })).toBeNull();
    expect(items.getByRole('group', { name: 'GEAR items' })).toBeTruthy();
    await userEvent.clear(find);
    expect(items.queryByRole('status')).toBeNull();
    expect(screen.getByRole('group', { name: 'ARMS items' })).toBeTruthy();
  });

  it('one needing a slot that is gone keeps saying so, to be set again', async () => {
    open({ ...WORN, items: { list: [{ id: 'ring', label: 'Ring', needs: 'bound' }] } } as unknown as Definition, 'ITEMS');
    expect(listed('Ring').textContent).toContain('BOUND');
    const needs = ring().getByLabelText('ITS FEATURES NEED') as HTMLSelectElement;
    expect(needs.value).toBe('bound');
    expect([...needs.options].map((o) => o.textContent)).toEqual(['WORN AND BOUND', 'CARRIED', 'WORN']);
  });

  it('a nameless one says so', async () => {
    open({ ...WORN, items: { list: [{ id: 'x', label: '' }] } } as unknown as Definition, 'ITEMS');
    expect(listed('NEEDS A NAME')).toBeTruthy();
  });

  it('none: says what one is, and the + to make one', () => {
    open({ ...WORN, items: { slots: WORN.items } } as unknown as Definition, 'ITEMS');
    expect(screen.getByText(/^None yet\. \+ beside a type makes one/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a Gear' })).toBeTruthy();
  });

  it('at the most, no + makes another', () => {
    open({ ...WORN, items: { list: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, label: `I${i}` })) } } as unknown as Definition, 'ITEMS');
    expect((screen.getByRole('button', { name: 'Add a Gear' }) as HTMLButtonElement).disabled).toBe(true);
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
    const last = open(WIRED, 'SLOTS & INSTALLS') as unknown as () => Wired;
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
    const last = open(WIRED, 'ITEMS') as unknown as () => Wired;
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
    open(WORN, 'SLOTS & INSTALLS');
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
    expect(type('ARMS').getAllByTestId(/^column-/).map((r) => (within(r).getAllByRole('textbox')[0] as HTMLInputElement).value)).toEqual(['DAMAGE', 'RANGE', 'AMMO', 'WEIGHT', 'PRICE']);
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
    await userEvent.click(screen.getByRole('tab', { name: 'ITEMS' }));
    expect(within(screen.getByRole('group', { name: 'GEAR items' })).getByRole('button', { name: /^Ring/ })).toBeTruthy();
    const typeBox = () => ring().getByLabelText('TYPE', { selector: '#item-ring-type' }) as HTMLSelectElement;
    expect([...typeBox().options].map((o) => o.textContent)).toEqual(['GEAR', 'WEAPONS', 'ARMOR']);
    fireEvent.change(ring().getByLabelText('WEIGHT'), { target: { value: '0.5' } });
    fireEvent.change(ring().getByLabelText('PRICE'), { target: { value: '15' } });
    expect(last().items!.list![0]).toMatchObject({ values: { weight: 0.5, price: 15 } });
    fireEvent.change(typeBox(), { target: { value: 'weapons' } });
    expect(last().items!.list![0]).toMatchObject({ type: 'weapons', values: { weight: 0.5, price: 15 } });
    // Made a WEAPON, it moves to that list.
    expect(within(screen.getByRole('group', { name: 'WEAPONS items' })).getByRole('button', { name: /^Ring/ })).toBeTruthy();
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
    expect([...grade.options].map((o) => o.textContent)).toEqual(['— (it has none)', 'LIGHT', 'MEDIUM', 'HEAVY']);
    fireEvent.change(grade, { target: { value: 'HEAVY' } });
    expect(last().items!.list![0]).toMatchObject({ type: 'armor', values: { price: 15, type: 'HEAVY' } });
  });

  it('the DEFAULT first, said so; MAKE DEFAULT moves one to the top, an item saying nothing kept as it was', async () => {
    const last = open() as unknown as () => Typed;
    expect(tab('GEAR').textContent).toContain('DEFAULT');
    expect(type('GEAR').getByText(/^THE DEFAULT: a line that is no item lands here/)).toBeTruthy();
    expect(type('GEAR').queryByRole('button', { name: 'MAKE DEFAULT' })).toBeNull();
    await userEvent.click(preset('WEAPON'));
    expect(tab('WEAPONS').textContent).not.toContain('DEFAULT');
    await userEvent.click(type('WEAPONS').getByRole('button', { name: 'MAKE DEFAULT' }));
    expect(last().items!.types!.map((t) => t.id)).toEqual(['weapons', 'gear']);
    // The ring said nothing, so it was GEAR: it is said to be, still GEAR.
    expect(last().items!.list![0]).toMatchObject({ id: 'ring', type: 'gear' });
    expect(tab('WEAPONS').textContent).toContain('DEFAULT');
    // How many of each, beside each.
    expect(tab('GEAR').textContent).toMatch(/1$/);
    expect(tab('WEAPONS').textContent).toMatch(/0$/);
  });

  it('ON THE SHEET: the open type\'s table as a player sees it, its first item the line', async () => {
    open({ ...WORN, items: { types: [{ id: 'arms', label: 'ARMS', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] }],
      list: [{ id: 'axe', label: 'Axe', type: 'arms', values: { damage: '1d8' } }] } } as unknown as Definition);
    const sheet = within(screen.getByRole('group', { name: 'ARMS on the sheet' }));
    expect(sheet.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['NAME', 'QTY', 'DAMAGE', 'WEIGHT (LB)', 'WHERE']);
    expect(sheet.getAllByRole('cell').map((c) => c.textContent)).toEqual(['Axe', '1', '1d8', '—', 'STOWED']);
    await userEvent.click(preset('+ BLANK'));
    expect(within(screen.getByRole('group', { name: 'NEW TYPE on the sheet' })).getAllByRole('cell')[0].textContent).toBe('A line by hand');
  });

  it('every hint written', () => {
    for (const k of ['items.types', 'items.typeName', 'items.one', 'items.column', 'items.kind', 'items.and', 'items.type', 'items.onSheet']) expect(HINTS[k], k).toBeTruthy();
  });
});

describe('ENCUMBRANCE (8a5c)', () => {
  type Counted = { items?: { encumbrance?: Record<string, unknown>; installs?: Record<string, unknown>[] } };
  const TYPED = {
    ...(WORN as unknown as object),
    items: {
      types: [
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
        { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
        { id: 'spells', label: 'SPELLS', one: 'Spell', columns: [{ id: 'range', label: 'RANGE', kind: 'text' }] },
      ],
      installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'con', limit: '10' }],
    },
  } as unknown as Definition;
  const COUNTING = { ...TYPED, items: { ...(TYPED as unknown as { items: object }).items,
    encumbrance: { column: 'weight', unit: 'LB', capacity: '@con * 10', bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }], past: 'OVERLOADED' } } } as unknown as Definition;
  const panel = () => within(screen.getByRole('region', { name: 'Encumbrance' }));
  const counted = (last: () => unknown) => (last() as Counted).items!.encumbrance;

  it('not counted, said so; COUNT ENCUMBRANCE starts on WEIGHT in LB, ten times the first stat, LIGHT, ENCUMBERED, OVERLOADED', async () => {
    const last = open(TYPED, 'ENCUMBRANCE');
    expect(panel().getByText(/^Not counted: nothing is weighed/)).toBeTruthy();
    await userEvent.click(panel().getByRole('button', { name: 'COUNT ENCUMBRANCE' }));
    expect(counted(last)).toEqual({ column: 'weight', unit: 'LB', capacity: '@con * 10', bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }], past: 'OVERLOADED' });
    expect(panel().getByText('WEAPONS, ARMOR count WEIGHT, one of each times how many; SPELLS weighs nothing.')).toBeTruthy();
    expect((panel().getByLabelText('Can carry') as HTMLInputElement).value).toBe('@con * 10');
  });

  it('nothing to count: no COUNT, said why', () => {
    const words = { ...TYPED, items: { types: [{ id: 'notes', label: 'NOTES', columns: [{ id: 'text', label: 'TEXT', kind: 'text' }] }] } } as unknown as Definition;
    open(words, 'ENCUMBRANCE');
    expect((panel().getByRole('button', { name: 'COUNT ENCUMBRANCE' }) as HTMLButtonElement).disabled).toBe(true);
    expect(panel().getByText('Give a type a NUMBER column first, like WEIGHT, on TYPES.')).toBeTruthy();
  });

  it('COUNTED BY each NUMBER column once, IN its unit; CAN CARRY typed; a column gone, said', async () => {
    const last = open(COUNTING, 'ENCUMBRANCE');
    const by = within(panel().getByRole('group', { name: 'Counted by' }));
    expect(by.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['WEIGHT', 'true'], ['DEFENSE', 'false']]);
    await userEvent.click(by.getByRole('button', { name: 'DEFENSE' }));
    expect(counted(last)).toMatchObject({ column: 'defense', unit: 'LB' });
    expect(panel().getByText('ARMOR counts DEFENSE, one of each times how many; WEAPONS, SPELLS weigh nothing.')).toBeTruthy();
    fireEvent.change(panel().getByLabelText('IN'), { target: { value: 'PTS' } });
    expect(counted(last)).toMatchObject({ unit: 'PTS' });
    fireEvent.change(panel().getByLabelText('IN'), { target: { value: '' } });
    expect(counted(last)).not.toHaveProperty('unit');
    fireEvent.change(panel().getByLabelText('Can carry'), { target: { value: '@con * 15' } });
    expect(counted(last)).toMatchObject({ capacity: '@con * 15' });
    cleanup();
    open({ ...COUNTING, items: { ...(COUNTING as unknown as { items: object }).items, encumbrance: { column: 'bulk' } } } as unknown as Definition, 'ENCUMBRANCE');
    expect(panel().getByRole('alert').textContent).toBe('No type has a NUMBER column called bulk any more: pick what it counts.');
    // Picking a column brings its unit.
    cleanup();
    const pick = open({ ...COUNTING, items: { ...(COUNTING as unknown as { items: object }).items, encumbrance: { column: 'defense', unit: 'PTS' } } } as unknown as Definition, 'ENCUMBRANCE');
    await userEvent.click(panel().getByRole('button', { name: 'WEIGHT' }));
    expect(counted(pick)).toEqual({ column: 'weight', unit: 'LB' });
  });

  it('BANDS: each word and share the GM\'s, + BAND, ×, the word past them; a share out of order said; none, the number alone', async () => {
    const last = open(COUNTING, 'ENCUMBRANCE');
    expect(panel().getByText('BANDS · 2 OF 5')).toBeTruthy();
    fireEvent.change(panel().getByLabelText('Band 1 word'), { target: { value: 'EASY' } });
    fireEvent.change(panel().getByLabelText('Band 2 up to'), { target: { value: '40' } });
    expect(counted(last)).toMatchObject({ bands: [{ word: 'EASY', upto: 50 }, { word: 'ENCUMBERED', upto: 40 }] });
    expect(panel().getByLabelText('Band 2 up to').getAttribute('aria-invalid')).toBe('true');
    expect(within(panel().getByRole('group', { name: 'Band 2' })).getByText('Each band goes further than the one before')).toBeTruthy();
    fireEvent.change(panel().getByLabelText('Band 2 up to'), { target: { value: '' } });
    expect(counted(last)).toMatchObject({ bands: [{ word: 'EASY', upto: 50 }, { word: 'ENCUMBERED', upto: 40 }] });
    await userEvent.click(panel().getByRole('button', { name: '+ BAND' }));
    expect(counted(last)).toMatchObject({ bands: [{ word: 'EASY' }, { word: 'ENCUMBERED' }, { word: 'NEW BAND', upto: 80 }] });
    fireEvent.change(panel().getByLabelText('Past the last band'), { target: { value: 'CRUSHED' } });
    expect(counted(last)).toMatchObject({ past: 'CRUSHED' });
    for (let i = 0; i < 3; i += 1) await userEvent.click(panel().getByRole('button', { name: 'Remove band 1' }));
    expect(counted(last)).toEqual({ column: 'weight', unit: 'LB', capacity: '@con * 10' });
    expect(panel().getByText(/^None: the sheet says how much is carried/)).toBeTruthy();
    expect(panel().queryByLabelText('Past the last band')).toBeNull();
  });

  it('under each band and past them (8a5d2): WHAT IT MEANS, and a CONDITION, NONE first, the game\'s conditions after', async () => {
    const last = open(COUNTING, 'ENCUMBRANCE');
    const band2 = within(panel().getByRole('group', { name: 'Band 2' }));
    fireEvent.change(band2.getByLabelText('Band 2 means'), { target: { value: 'Speed -10 ft.' } });
    expect(counted(last)).toMatchObject({ bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100, says: 'Speed -10 ft.' }] });
    const pick = band2.getByLabelText('Band 2 condition') as HTMLSelectElement;
    expect(pick.value).toBe('');
    expect([...pick.options].slice(0, 3).map((o) => o.textContent)).toEqual(['NONE', 'BLINDED', 'BLEEDING']);
    expect(band2.queryByText('Make one on CONDITIONS to pick it here.')).toBeNull();
    fireEvent.change(pick, { target: { value: 'exhausted' } });
    expect((counted(last) as { bands: object[] }).bands[1]).toEqual({ word: 'ENCUMBERED', upto: 100, says: 'Speed -10 ft.', condition: 'exhausted' });
    expect(band2.getByText('On the token while in this band, off when lighter.')).toBeTruthy();
    // Back to NONE, and the words wiped: nothing kept of either.
    fireEvent.change(pick, { target: { value: '' } });
    fireEvent.change(band2.getByLabelText('Band 2 means'), { target: { value: ' ' } });
    expect((counted(last) as { bands: object[] }).bands[1]).toEqual({ word: 'ENCUMBERED', upto: 100 });
    const past = within(panel().getByRole('group', { name: 'Past the bands' }));
    fireEvent.change(past.getByLabelText('Past the last band means'), { target: { value: 'Speed -20 ft.' } });
    fireEvent.change(past.getByLabelText('Past the last band condition'), { target: { value: 'exhausted' } });
    expect(counted(last)).toMatchObject({ past: 'OVERLOADED', past_says: 'Speed -20 ft.', past_condition: 'exhausted' });
  });

  it('a band\'s condition no longer made: said gone, to pick again; a game with none: said where to make one', () => {
    const gone = { ...COUNTING, items: { ...(COUNTING as unknown as { items: object }).items,
      encumbrance: { column: 'weight', capacity: '10', bands: [{ word: 'LIGHT', upto: 50, condition: 'webbed' }], past: 'OVER' } } } as unknown as Definition;
    open(gone, 'ENCUMBRANCE');
    const band1 = within(panel().getByRole('group', { name: 'Band 1' }));
    expect((band1.getByLabelText('Band 1 condition') as HTMLSelectElement).selectedOptions[0].textContent).toBe('webbed · GONE');
    expect(band1.getByLabelText('Band 1 condition').getAttribute('aria-invalid')).toBe('true');
    expect(band1.getByRole('alert').textContent).toBe('No condition is called webbed any more: pick another, or NONE.');
    cleanup();
    const STANDARD = ['blinded', 'bleeding', 'poisoned', 'prone', 'stunned', 'grappled', 'frightened', 'unconscious', 'restrained', 'exhausted'];
    const none = { ...gone, conditions: Object.fromEntries(STANDARD.map((id) => [id, { on: false }])) } as unknown as Definition;
    open({ ...none, items: { ...(gone as unknown as { items: object }).items, encumbrance: { column: 'weight', capacity: '10', bands: [{ word: 'LIGHT', upto: 50 }], past: 'OVER' } } } as unknown as Definition, 'ENCUMBRANCE');
    const only = within(panel().getByRole('group', { name: 'Band 1' }));
    expect([...(only.getByLabelText('Band 1 condition') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['NONE']);
    expect(only.getByText('Make one on CONDITIONS to pick it here.')).toBeTruthy();
  });

  it('bands with CAN CARRY blank: said to fill it or take them away; at five, no + BAND', () => {
    open({ ...COUNTING, items: { ...(COUNTING as unknown as { items: object }).items, encumbrance: { column: 'weight', bands: [10, 20, 30, 40, 50].map((upto) => ({ word: 'B', upto })), past: 'X' } } } as unknown as Definition, 'ENCUMBRANCE');
    expect(panel().getByRole('alert').textContent).toBe('A band is a share of CAN CARRY: say what can be carried, or take the bands away.');
    expect((panel().getByRole('button', { name: '+ BAND' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('what counts as carried, the names formulas read; STOP COUNTING asks first', async () => {
    const last = open(COUNTING, 'ENCUMBRANCE');
    expect(panel().getByText(/^READIED and STOWED count; STASHED is not on them/).textContent).toContain('WEIGHS WHILE INSTALLED');
    expect(panel().getAllByText(/^@/).map((t) => t.textContent)).toEqual(['@carried', '@capacity', '@weapons_weight', '@armor_defense', '@armor_weight']);
    await userEvent.click(panel().getByRole('button', { name: 'STOP COUNTING' }));
    await userEvent.click(panel().getByRole('button', { name: 'KEEP' }));
    // KEEP changes nothing.
    expect(last()).toBeUndefined();
    await userEvent.click(panel().getByRole('button', { name: 'STOP COUNTING' }));
    await userEvent.click(panel().getByRole('button', { name: 'STOP' }));
    expect(counted(last)).toBeUndefined();
    expect((last() as Counted).items).not.toHaveProperty('encumbrance');
    expect(panel().getByRole('button', { name: 'COUNT ENCUMBRANCE' })).toBeTruthy();
  });

  it('an install WEIGHS WHILE INSTALLED only while it counts: STILL WEIGHS written, WEIGHS NOTHING unsaid', async () => {
    open(TYPED, 'SLOTS & INSTALLS');
    expect(screen.queryByRole('group', { name: 'CYBERWARE: while installed' })).toBeNull();
    cleanup();
    forgetBuilderPlaces();
    const last = open(COUNTING, 'SLOTS & INSTALLS');
    const weighs = within(screen.getByRole('group', { name: 'CYBERWARE: while installed' }));
    expect(weighs.getByRole('button', { name: 'WEIGHS NOTHING' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(weighs.getByRole('button', { name: 'STILL WEIGHS' }));
    expect((last() as Counted).items!.installs![0]).toMatchObject({ weighs: true });
    await userEvent.click(weighs.getByRole('button', { name: 'WEIGHS NOTHING' }));
    expect((last() as Counted).items!.installs![0]).not.toHaveProperty('weighs');
  });

  it('every hint written', () => {
    for (const k of ['items.encumbrance', 'items.countedBy', 'items.canCarry', 'items.bands', 'items.weighs', 'items.bandMeans', 'items.bandCondition'] as const) expect(HINTS[k], k).toBeTruthy();
  });
});

describe('an item\'s PRICE and IN SHOPS (8a7a3b1)', () => {
  const PRICED = {
    ...WORN,
    items: {
      types: [
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'price', label: 'PRICE', kind: 'number' }] },
        { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }] },
      ],
      list: [
        { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 } },
        { id: 'ring', label: 'Ring of Might', type: 'armor', price: 5000, in_shops: false },
        { id: 'rope', label: 'Rope', type: 'armor' },
      ],
    },
  } as unknown as Definition;
  const panel = (name: string) => within(screen.getByRole('region', { name: `${name} item` }));
  const listOf = (last: ReturnType<typeof open>) => last().items!.list as Record<string, unknown>[];

  it('under TYPE: the PRICE, its type\'s PRICE column shown there once, kept in it', () => {
    const last = open(PRICED, 'ITEMS');
    const names = panel('Pistol').getAllByText(/^[A-Z ]+$/).map((n) => n.textContent).filter((t) => ['NAME', 'TYPE', 'PRICE', 'IN SHOPS', 'DAMAGE'].includes(t ?? ''));
    expect(names).toEqual(['NAME', 'TYPE', 'PRICE', 'IN SHOPS', 'DAMAGE']);
    const price = panel('Pistol').getByLabelText('PRICE') as HTMLInputElement;
    expect(price.value).toBe('200');
    fireEvent.change(price, { target: { value: '180' } });
    expect(listOf(last)[0]).toEqual({ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 180 } });
    // Not a price: kept as it was.
    fireEvent.change(price, { target: { value: '-3' } });
    expect(listOf(last)[0].values).toEqual({ damage: '2d6', price: 180 });
  });

  it('a type without a PRICE column: the item\'s own; blank, none', async () => {
    const last = open(PRICED, 'ITEMS');
    await userEvent.click(listed('Rope'));
    fireEvent.change(panel('Rope').getByLabelText('PRICE'), { target: { value: '3' } });
    expect(listOf(last)[2]).toEqual({ id: 'rope', label: 'Rope', type: 'armor', price: 3 });
    fireEvent.change(panel('Rope').getByLabelText('PRICE'), { target: { value: '' } });
    expect(listOf(last)[2]).toEqual({ id: 'rope', label: 'Rope', type: 'armor' });
  });

  it('IN SHOPS: as switched, said what it means; off, NOT SOLD in the list', async () => {
    const last = open(PRICED, 'ITEMS');
    const on = panel('Pistol').getByRole('switch', { name: 'Pistol in shops' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(panel('Pistol').getByText('Sold at its price, in the shops its type is sold at')).toBeTruthy();
    expect(within(listed('Pistol')).queryByText('NOT SOLD')).toBeNull();
    expect(within(listed('Ring of Might')).getByText('NOT SOLD')).toBeTruthy();
    // Saved before IN SHOPS was, and unpriced: not sold.
    expect(within(listed('Rope')).getByText('NOT SOLD')).toBeTruthy();
    await userEvent.click(on);
    expect(listOf(last)[0].in_shops).toBe(false);
    expect(panel('Pistol').getByText('Never sold in any shop; only given, from GIVE.EXE')).toBeTruthy();
    expect(within(listed('Pistol')).getByText('NOT SOLD')).toBeTruthy();
  });

  it('a new item: IN SHOPS, its price asked for until it has one', async () => {
    const last = open(PRICED, 'ITEMS');
    await userEvent.click(screen.getByRole('button', { name: 'Add a Armor' }));
    expect(listOf(last)[3]).toMatchObject({ label: 'NEW ARMOR', type: 'armor', in_shops: true });
    const box = panel('NEW ARMOR').getByLabelText('PRICE');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(panel('NEW ARMOR').getByText(/A PRICE IS NEEDED: it.s IN SHOPS/)).toBeTruthy();
    fireEvent.change(box, { target: { value: '40' } });
    expect(panel('NEW ARMOR').queryByText(/A PRICE IS NEEDED/)).toBeNull();
    expect(listOf(last)[3]).toMatchObject({ price: 40, in_shops: true });
  });

  it('a game without types of its own, whose shops have no type shelves: no IN SHOPS, no NOT SOLD; GEAR\'s PRICE column as ever', () => {
    open(TWO_ITEMS, 'ITEMS');
    expect(ring().queryByRole('switch', { name: /in shops/ })).toBeNull();
    expect(screen.queryByText('NOT SOLD')).toBeNull();
    expect(ring().getByLabelText('PRICE').id).toBe('item-ring-value-price');
  });

  it('every hint written', () => {
    for (const k of ['items.price', 'items.inShops'] as const) expect(HINTS[k], k).toBeTruthy();
  });
});

describe('ON THE SHEET on a type (G1)', () => {
  it('its band pressed, said what it means; another picked, stored; PACK stores nothing', async () => {
    const TYPED = { ...WORN, items: { types: [{ id: 'gear', label: 'GEAR', columns: [] }, { id: 'arms', label: 'ARMS', one: 'Arm', columns: [], on_sheet: 'equipped' }], list: [] } } as unknown as Definition;
    const last = open(TYPED, 'TYPES');
    const group = () => within(screen.getByRole('group', { name: 'GEAR band' }));
    expect(group().getByRole('button', { name: 'PACK' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('PACK: everything else that is carried.')).toBeTruthy();
    await userEvent.click(group().getByRole('button', { name: 'USABLE' }));
    expect((last().items as unknown as { types: { on_sheet?: string }[] }).types[0].on_sheet).toBe('usable');
    expect(screen.getByText('USABLE: used up or used often, like potions, ammo and kits.')).toBeTruthy();
    expect(group().getByRole('button', { name: 'USABLE' }).getAttribute('aria-pressed')).toBe('true');
    expect(group().getByRole('button', { name: 'PACK' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(group().getByRole('button', { name: 'PACK' }));
    expect((last().items as unknown as { types: object[] }).types[0]).not.toHaveProperty('on_sheet');
  });
});

describe('SOLD AT on a type (8a7b2)', () => {
  type Saved = { items: { types: { id: string; sold_at?: string[] }[] }; buildings?: { types?: object; shops?: object[] } };
  const GAME = { ...WORN, buildings: { types: { gun_shop: { name: 'Blacksmith' }, garage: { on: false } } },
    items: { types: [{ id: 'gear', label: 'GEAR', columns: [] }], list: [] } } as unknown as Definition;
  const says = () => screen.getByText(/^Sold (at|nowhere)/);
  const chips = (type = 'GEAR') => within(screen.getByRole('group', { name: `${type} sold at` }));

  it('the game\'s shops by their names here, one turned off left out; unsaid, the General Store; a tick stored, said', async () => {
    const last = open(GAME, 'TYPES');
    expect(chips().getAllByRole('button').map((b) => b.textContent)).toEqual(['Ripperdoc', 'Blacksmith', 'Clinic', 'Armorer', 'General Store']);
    expect(chips().getByRole('button', { name: 'General Store' }).getAttribute('aria-pressed')).toBe('true');
    expect(says()).toHaveTextContent('Sold at every General Store in this game.');
    await userEvent.click(chips().getByRole('button', { name: 'Blacksmith' }));
    expect((last() as unknown as Saved).items.types[0].sold_at).toEqual(['gun_shop', 'general_store']);
    expect(says()).toHaveTextContent('Sold at every Blacksmith, every General Store in this game.');
    await userEvent.click(chips().getByRole('button', { name: 'Blacksmith' }));
    await userEvent.click(chips().getByRole('button', { name: 'General Store' }));
    expect((last() as unknown as Saved).items.types[0].sold_at).toEqual([]);
    expect(says()).toHaveTextContent('Sold nowhere: only given, from GIVE.EXE.');
  });

  it('+ NEW SHOP: made, dashed, ticked, by ADD or Enter; a name already a shop ticks that one', async () => {
    const last = open(GAME, 'TYPES');
    const box = screen.getByRole('textbox', { name: 'New shop name' });
    expect(screen.getByRole('button', { name: 'ADD' })).toBeDisabled();
    await userEvent.type(box, '  Apothecary ');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
    const saved = last() as unknown as Saved;
    expect(saved.buildings?.shops).toEqual([{ id: 'apothecary', name: 'Apothecary' }]);
    expect(saved.buildings?.types).toEqual({ gun_shop: { name: 'Blacksmith' }, garage: { on: false } });
    expect(saved.items.types[0].sold_at).toEqual(['general_store', 'apothecary']);
    expect(chips().getByRole('button', { name: 'Apothecary' }).style.borderStyle).toBe('dashed');
    expect(chips().getByRole('button', { name: 'Apothecary' }).style.outline).toMatch(/dashed/);
    expect(chips().getByRole('button', { name: 'Clinic' }).style.borderStyle).toBe('solid');
    expect(box).toHaveValue('');
    expect(says()).toHaveTextContent('Sold at every General Store, every Apothecary in this game. Dashed: shops this game made.');
    // By Enter; and a name that is already one of the game's shops ticks it, making nothing.
    await userEvent.type(box, 'blacksmith{Enter}');
    expect((last() as unknown as Saved).items.types[0].sold_at).toEqual(['gun_shop', 'general_store', 'apothecary']);
    expect((last() as unknown as Saved).buildings?.shops).toHaveLength(1);
    // One already ticked stays ticked.
    await userEvent.type(box, 'Apothecary{Enter}');
    expect((last() as unknown as Saved).items.types[0].sold_at).toEqual(['gun_shop', 'general_store', 'apothecary']);
  });

  it('a type from a preset starts at its shop; SPELL at none, a Magic Shop filled in, ready to ADD; another type, an empty box', async () => {
    const last = open(GAME, 'TYPES');
    const presets = within(screen.getByRole('group', { name: 'Add an item type' }));
    await userEvent.click(presets.getByRole('button', { name: 'WEAPON', exact: true }));
    expect(chips('WEAPONS').getByRole('button', { name: 'Blacksmith' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(presets.getByRole('button', { name: 'SPELL', exact: true }));
    expect(chips('SPELLS').getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'New shop name' })).toHaveValue('Magic Shop');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect((last() as unknown as Saved).items.types.find((t) => t.id === 'spells')?.sold_at).toEqual(['magic_shop']);
    await userEvent.click(presets.getByRole('button', { name: 'SPELL', exact: true }));
    await userEvent.click(within(screen.getByRole('group', { name: 'The item types' })).getByRole('button', { name: 'GEAR' }));
    expect(screen.getByRole('textbox', { name: 'New shop name' })).toHaveValue('');
    for (const k of ['items.soldAt'] as const) expect(HINTS[k], k).toBeTruthy();
  });
});
