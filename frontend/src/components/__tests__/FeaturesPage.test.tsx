import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FeaturesPage } from '../FeaturesPage';
import type { Definition } from '../../sheets/systemsApi';

/**
 * The builder's FEATURES page, parts and shops (4b1c1). Approved mockup builder-words-features
 * (2026-10-06): a switch per part; SHOPS opens out to building types and catalogues; renames blank =
 * the app's; XP awards, death saves, luck and PDF import off and greyed for custom systems.
 */

afterEach(() => cleanup());

const open = (start: Definition = { format: 1, name: 'Hearth' }) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <FeaturesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
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
    expect(screen.getAllByTestId(/^part-/)).toHaveLength(12);
    expect(part('vehicles').textContent).toContain('VEHICLES.EXE and vehicle sheets.');
    for (const p of ['BANK', 'SHOPS', 'VEHICLES', 'CYBERWARE', 'INITIATIVE', 'COMBAT', 'TOKEN HEALTH', 'NPC TIERS']) {
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

  it('shows the four a custom system can\'t use yet as off and greyed', () => {
    open({ format: 1, name: 'Hearth' });
    for (const p of ['XP AWARDS', 'DEATH SAVES', 'LUCK', 'PDF IMPORT']) {
      expect(sw(p).getAttribute('aria-checked'), p).toBe('false');
      expect(sw(p).disabled, p).toBe(true);
    }
    expect(part('luck').textContent).toContain('Not used by custom systems yet.');
  });

  it('opens SHOPS\' settings only while shops are on', async () => {
    open();
    expect(within(part('bank')).queryByText(/SETTINGS/)).toBeNull();
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
