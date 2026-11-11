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

  it('none: says what one is for', () => {
    open({ ...WORN, items: { list: [] } } as unknown as Definition);
    expect(screen.getByText(/None: every item counts carried or worn/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
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
