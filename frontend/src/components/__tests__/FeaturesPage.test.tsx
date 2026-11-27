import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FeaturesPage } from '../FeaturesPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';

/**
 * The builder's PARTS page (FEATURES until 7a2a), parts and shops (4b1c1). Approved mockup builder-words-features
 * (2026-10-06): a switch per part; SHOPS opens out to building types and catalogues; renames blank =
 * the app's; XP awards, death saves and luck off and greyed for custom systems (SHEET IMPORT usable since 4h2c).
 */

afterEach(() => cleanup());

const open = (start: Definition = { format: 1, name: 'Hearth' }, onGoTo?: (page: string) => void) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <FeaturesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} onGoTo={onGoTo} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const part = (id: string) => screen.getByTestId(`part-${id}`);
const sw = (label: string) => screen.getByRole('switch', { name: label }) as HTMLButtonElement;
const openShops = () => userEvent.click(within(part('shops')).getByText(/SETTINGS/));

describe('the parts', () => {
  it('lists every part with what it does, all on to start', () => {
    open();
    expect(screen.getAllByTestId(/^part-/)).toHaveLength(13);
    expect(part('vehicles').textContent).toContain('VEHICLES.EXE and vehicle sheets.');
    for (const p of ['BANK', 'SHOPS', 'GIVE ITEM', 'VEHICLES', 'CYBERWARE', 'INITIATIVE', 'COMBAT', 'TOKEN HEALTH', 'NPC TIERS']) {
      expect(sw(p).getAttribute('aria-checked'), p).toBe('true');
    }
  });

  it('turns one off, and on again stores nothing', async () => {
    const { last } = open();
    await userEvent.click(sw('VEHICLES'));
    expect(last().parts).toEqual({ vehicles: { on: false } });
    expect(sw('VEHICLES').getAttribute('aria-checked')).toBe('false');
    await userEvent.click(sw('VEHICLES'));
    expect(last()).toEqual({ format: 1, name: 'Hearth' });
  });

  it('turns GIVE ITEM off on its own, shops on or off (4g3)', async () => {
    const { last } = open();
    expect(part('give_items').textContent).toContain('The GM handing out items from the catalogues, free.');
    await userEvent.click(sw('SHOPS'));
    expect(sw('GIVE ITEM').getAttribute('aria-checked')).toBe('true');
    expect(sw('GIVE ITEM').disabled).toBe(false);
    await userEvent.click(sw('GIVE ITEM'));
    expect(last().parts).toEqual({ shops: { on: false }, give_items: { on: false } });
    await userEvent.click(sw('SHOPS'));
    expect(last().parts).toEqual({ give_items: { on: false } });
    expect(sw('GIVE ITEM').getAttribute('aria-checked')).toBe('false');
  });

  it('turns SHEET IMPORT off and on, a part like the others since 4h2c', async () => {
    const { last } = open();
    expect(part('sheet_import').textContent).toContain('Filling a character sheet from a PDF form or JSON file through IMPORT.');
    expect(sw('SHEET IMPORT').disabled).toBe(false);
    expect(sw('SHEET IMPORT').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sw('SHEET IMPORT'));
    expect(last().parts).toEqual({ sheet_import: { on: false } });
  });

  it('DEATH SAVES is the RULE LIBRARY card\'s switch (8c2): off until the rule is written, on writes D&D 5E, off keeps it', async () => {
    const went: string[] = [];
    const { last } = open({ format: 1, name: 'Hearth', house_rules: [{ id: 'magic', name: 'MAGIC' }] } as unknown as Definition, (p) => went.push(p));
    expect(sw('DEATH SAVES').getAttribute('aria-checked')).toBe('false');
    expect(sw('DEATH SAVES').disabled).toBe(false);
    expect(part('death').textContent).toContain('Set up on RULE LIBRARY.');
    await userEvent.click(sw('DEATH SAVES'));
    expect((last().dying as { way: string }).way).toBe('count');
    expect(last().parts ?? {}).toEqual({});
    expect(sw('DEATH SAVES').getAttribute('aria-checked')).toBe('true');
    // No WITH A RULE: a house rule doesn't reach the server's dying.
    expect(within(part('death')).queryByRole('combobox', { name: 'ONLY WITH' })).toBeNull();
    expect(within(part('shops')).getByRole('combobox', { name: 'ONLY WITH' })).toBeTruthy();
    await userEvent.click(sw('DEATH SAVES'));
    expect(last().parts).toEqual({ death: { on: false } });
    expect(last().dying).toBeTruthy();
    await userEvent.click(within(part('death')).getByRole('button', { name: 'RULE LIBRARY ▸' }));
    expect(went).toEqual(['rule_library']);
  });

  it('shows the two a custom system can\'t use yet as off and greyed', () => {
    open({ format: 1, name: 'Hearth' });
    for (const p of ['XP AWARDS', 'LUCK']) {
      expect(sw(p).getAttribute('aria-checked'), p).toBe('false');
      expect(sw(p).disabled, p).toBe(true);
    }
    expect(part('luck').textContent).toContain('Not used by custom systems yet.');
  });

  it('opens SHOPS\' settings only while shops are on', async () => {
    open();
    expect(within(part('vehicles')).queryByText(/SETTINGS/)).toBeNull();
    await openShops();
    expect(screen.getByRole('region', { name: 'Shop buildings' })).toBeTruthy();
    await userEvent.click(within(part('shops')).getByText(/SETTINGS/));
    expect(screen.queryByRole('region', { name: 'Shop buildings' })).toBeNull();
    await openShops();
    await userEvent.click(sw('SHOPS'));
    expect(within(part('shops')).queryByText(/SETTINGS/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shop buildings' })).toBeNull();
  });
});

describe('BANK', () => {
  it('opens out to the currencies and celebrations', async () => {
    open();
    await userEvent.click(within(part('bank')).getByText(/SETTINGS/));
    expect(screen.getByRole('region', { name: 'Currencies' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Celebrations' })).toBeTruthy();
  });
});

describe('SHOPS', () => {
  it('renames a building type, blank going back to the app\'s', async () => {
    const { last } = open();
    await openShops();
    const ripperdoc = screen.getByLabelText('Ripperdoc called') as HTMLInputElement;
    expect(ripperdoc.placeholder).toBe('Ripperdoc');
    await userEvent.type(ripperdoc, 'Temple');
    expect(last().buildings).toEqual({ types: { ripperdoc: { name: 'Temple' } } });
    await userEvent.clear(ripperdoc);
    expect(last()).toEqual({ format: 1, name: 'Hearth' });
  });

  it('turns off a shop, a catalogue and another building', async () => {
    const { last } = open();
    await openShops();
    await userEvent.click(sw('Garage on'));
    await userEvent.click(sw('Weapons on'));
    await userEvent.click(sw('Corporate on'));
    expect(last().buildings).toEqual({ types: { garage: { on: false }, corp: { on: false } }, catalogues: { weapons: { on: false } } });
    expect(within(screen.getByRole('region', { name: 'Other buildings' })).getByTestId('types-bar')).toBeTruthy();
  });

  it('shows one already off as off, and turning it on stores nothing', async () => {
    const { last } = open({ format: 1, name: 'Hearth', buildings: { types: { clinic: { on: false } } } });
    await openShops();
    expect(sw('Clinic on').getAttribute('aria-checked')).toBe('false');
    expect(sw('Gun Shop on').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sw('Clinic on'));
    expect(last()).toEqual({ format: 1, name: 'Hearth' });
  });

  it('greys a catalogue whose part is off', async () => {
    open({ format: 1, name: 'Hearth', parts: { cyberware: { on: false } } });
    await openShops();
    const relics = screen.getByTestId('catalogues-cyberware');
    expect(relics.textContent).toContain('its part is off');
    expect((within(relics).getByLabelText('Cyberware called') as HTMLInputElement).disabled).toBe(true);
    expect(sw('Cyberware on').disabled).toBe(true);
    expect((screen.getByLabelText('Weapons called') as HTMLInputElement).disabled).toBe(false);
  });

  it('prices catalogues in the app\'s money until the system has currencies, then in any of them', async () => {
    open();
    await openShops();
    expect(screen.queryByLabelText('Weapons priced in')).toBeNull();
    expect(screen.getByText(/priced in the app's money/)).toBeTruthy();
    cleanup();
    const { last } = open({ format: 1, name: 'Hearth', currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }] });
    await openShops();
    const select = screen.getByLabelText('Weapons priced in') as HTMLSelectElement;
    expect(select.value).toBe('gold');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Gold (main)', 'Favor']);
    await userEvent.selectOptions(select, 'favor');
    expect(last().buildings).toEqual({ catalogues: { weapons: { currency: 'favor' } } });
    await userEvent.selectOptions(select, 'gold');
    expect('buildings' in last()).toBe(false);
  });
});

describe('ONLY WITH (4j4a)', () => {
  it('puts a part under a house rule, shown only while the part is on', async () => {
    const { last } = open({ format: 1, name: 'Hearth', house_rules: [{ id: 'magic', name: 'MAGIC' }] } as unknown as Definition);
    const shops = within(screen.getByTestId('part-shops'));
    fireEvent.change(shops.getByRole('combobox', { name: 'ONLY WITH' }), { target: { value: 'magic' } });
    expect(last().parts).toEqual({ shops: { on: true, only_with: 'magic' } });
    await userEvent.click(shops.getByRole('switch', { name: 'SHOPS' }));
    expect(last().parts).toEqual({ shops: { on: false, only_with: 'magic' } });
    expect(shops.queryByRole('combobox', { name: 'ONLY WITH' })).toBeNull();
    expect(within(screen.getByTestId('part-bank')).getByRole('note', { name: HINTS['only.with'] })).toBeTruthy();
  });

  it('isn\'t there in a system with no house rules', () => {
    open();
    expect(screen.queryByRole('combobox', { name: 'ONLY WITH' })).toBeNull();
  });
});

describe('the game\'s own shops and BUYS on SHOP BUILDINGS (8a7b3b)', () => {
  const HERBAL = { format: 1, name: 'Herbal', buildings: { shops: [{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', buys: 'anything' }] },
    items: { types: [{ id: 'potions', label: 'POTIONS', columns: [], sold_at: ['apothecary'] }] } } as unknown as Definition;
  const withApi = (start: Definition, counts: Record<string, number>) => {
    const edits: Definition[] = [];
    const api = { shopBuildings: async () => ({ ok: true, value: { counts } }) } as never;
    const Harness = () => {
      const [d, setD] = useState(start);
      return <FeaturesPage definition={d} edit={(next) => { edits.push(next); setD(next); }} api={api} systemId="sys_herbalherbalherb" />;
    };
    render(<Harness />);
    return () => edits[edits.length - 1] as unknown as { buildings?: { types?: object; shops?: object[] }; items?: { types: { sold_at?: string[] }[] } };
  };
  const row = (id: string) => within(screen.getByTestId(`own-shop-${id}`));

  it('BUYS on each of the app\'s shops: WHAT IT SELLS to start, ANYTHING stored, back stores nothing', async () => {
    const { last } = open();
    await openShops();
    const buys = screen.getByRole('combobox', { name: 'General Store buys' }) as HTMLSelectElement;
    expect(buys.value).toBe('sells');
    await userEvent.selectOptions(buys, 'anything');
    expect(last().buildings).toEqual({ types: { general_store: { buys: 'anything' } } });
    expect(buys.value).toBe('anything');
    await userEvent.selectOptions(buys, 'sells');
    expect(last()).not.toHaveProperty('buildings');
  });

  it('the game\'s own at the foot, each saying what it sells and how many buildings it is; renamed, set, switched', async () => {
    const last = withApi(HERBAL, { apothecary: 2 });
    await openShops();
    expect(await row('apothecary').findByText('sells POTIONS · 2 buildings')).toBeTruthy();
    expect(row('fence').getByText('sells nothing · buys anything · no building')).toBeTruthy();
    fireEvent.change(row('apothecary').getByRole('textbox', { name: 'Apothecary called' }), { target: { value: 'Herbalist' } });
    expect(last().buildings?.shops?.[0]).toEqual({ id: 'apothecary', name: 'Herbalist' });
    await userEvent.selectOptions(row('apothecary').getByRole('combobox', { name: 'Herbalist buys' }), 'anything');
    await userEvent.click(row('apothecary').getByRole('switch', { name: 'Herbalist on' }));
    expect(last().buildings?.shops?.[0]).toEqual({ id: 'apothecary', name: 'Herbalist', buys: 'anything', on: false });
    fireEvent.change(row('apothecary').getByRole('textbox', { name: 'Herbalist called' }), { target: { value: '' } });
    expect(row('apothecary').getByRole('textbox', { name: 'apothecary called' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('DELETE asks once, naming the buildings that go back to their ordinary type; KEEP keeps it', async () => {
    const last = withApi(HERBAL, { apothecary: 2 });
    await openShops();
    await row('apothecary').findByText(/2 buildings/);
    await userEvent.click(row('apothecary').getByRole('button', { name: 'Delete Apothecary' }));
    const ask = screen.getByRole('group', { name: 'Delete Apothecary?' });
    expect(ask.textContent).toContain('Delete Apothecary? 2 buildings are one in this game: they go back to their ordinary type once you publish.');
    await userEvent.click(within(ask).getByRole('button', { name: 'KEEP' }));
    expect(screen.queryByRole('group', { name: 'Delete Apothecary?' })).toBeNull();
    await userEvent.click(row('fence').getByRole('button', { name: 'Delete Fence' }));
    expect(screen.getByRole('group', { name: 'Delete Fence?' }).textContent).toContain('No building is one in this game.');
    await userEvent.click(row('apothecary').getByRole('button', { name: 'Delete Apothecary' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Delete Apothecary?' })).getByRole('button', { name: 'DELETE' }));
    expect(last().buildings?.shops).toEqual([{ id: 'fence', name: 'Fence', buys: 'anything' }]);
    expect(last().items?.types[0].sold_at).toEqual([]);
    expect(screen.queryByTestId('own-shop-apothecary')).toBeNull();
  });

  it('1 building said in the singular', async () => {
    withApi(HERBAL, { apothecary: 1 });
    await openShops();
    await row('apothecary').findByText('sells POTIONS · 1 building');
    await userEvent.click(row('apothecary').getByRole('button', { name: 'Delete Apothecary' }));
    expect(screen.getByRole('group', { name: 'Delete Apothecary?' }).textContent).toContain('1 building is one in this game: it goes back to its ordinary type once you publish.');
  });

  it('+ NEW SHOP here too: made by ADD or Enter, listed at the foot; none of its own, no rows', async () => {
    const { last } = open();
    await openShops();
    expect(screen.queryByTestId(/^own-shop-/)).toBeNull();
    expect(screen.getByRole('button', { name: 'ADD' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'New shop name' }), 'Fence{Enter}');
    expect(last().buildings).toEqual({ shops: [{ id: 'fence', name: 'Fence' }] });
    expect(screen.getByTestId('own-shop-fence')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'New shop name' }), 'Apothecary');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect((last().buildings as { shops: object[] }).shops).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'New shop name' })).toHaveValue('');
  });
});
