import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BuildingWindow } from '../BuildingWindow';
import { ShopWindow } from '../ShopWindow';
import { emptyShelves } from '../EmptyShopSteps';
import { resetRender3dCheck } from '../BuildingPreview';
import {
  typeLabel, catalogueLabel, typeOn, catalogueOn, isShopIn, shelvedIn, BUILDING_TYPES, CATALOGUES,
} from '../../data/buildingTypes';
import { shopsSelling, writeCatalogueFile } from '../../sheets/catalogueSchema';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * A custom system's own building types and shop catalogues, in the windows (3b3b2): renamed,
 * or turned off, never new (decided with the user, 2026-10-01). The built-in systems name
 * every type and catalogue as today, Shadowrun's Street Doc and CWN's Operator Gear included.
 * The admin's type picker is tested with the rest of the editor, in AdminPanel.test.tsx.
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';

beforeEach(() => {
  resetRender3dCheck();
  clearCustomTemplates();
  registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {},
    buildings: {
      types: { ripperdoc: { name: 'Temple' }, gun_shop: { on: false } },
      catalogues: { cyberware: { name: 'Relics' }, armor: { on: false }, vehicles: { name: 'Wagons' }, vehicle_weapons: { on: false } },
    } });
  registerCustomTemplate({ id: PLAIN, name: 'Plain', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ notes: '' }) })));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('the names and what a game has', () => {
  it('are as today under the built-ins and a custom system that changed nothing', () => {
    for (const s of [...BUILT_INS, PLAIN]) {
      expect(BUILDING_TYPES.every((t) => typeOn(s, t.id)), s).toBe(true);
      expect(CATALOGUES.every((c) => catalogueOn(s, c.id)), s).toBe(true);
      expect(shelvedIn('armorer', s), s).toEqual(['armor', 'armor_mods']);
      expect(isShopIn(s, 'gun_shop'), s).toBe(true);
    }
    expect(typeLabel('ripperdoc', 'shadowrun_6e')).toBe('Street Doc');
    expect(typeLabel('ripperdoc', 'cyberpunk_red')).toBe('Ripperdoc');
    expect(typeLabel('ripperdoc', PLAIN)).toBe('Ripperdoc');
    expect(catalogueLabel('gear', 'cities_without_number')).toBe('Operator Gear');
    expect(catalogueLabel('gear', PLAIN)).toBe('Gear');
  });

  it('are a custom system\'s own, without what it turned off', () => {
    expect(typeLabel('ripperdoc', HEARTH)).toBe('Temple');
    expect(typeLabel('bar', HEARTH)).toBe('Bar');
    expect(catalogueLabel('cyberware', HEARTH)).toBe('Relics');
    expect(catalogueLabel('gear', HEARTH)).toBe('Gear');
    expect(typeOn(HEARTH, 'gun_shop')).toBe(false);
    expect(catalogueOn(HEARTH, 'armor')).toBe(false);
    expect(isShopIn(HEARTH, 'gun_shop')).toBe(false);
    expect(isShopIn(HEARTH, 'ripperdoc')).toBe(true);
    expect(isShopIn(HEARTH, 'bar')).toBe(false);
    expect(shelvedIn('armorer', HEARTH)).toEqual(['armor_mods']);
  });
});

describe('the catalogue file', () => {
  const headings = (system: string) => writeCatalogueFile(system, () => []).split('\n')
    .filter((l) => /^# [A-Z]/.test(l) && !l.startsWith('# CITY_NET'));

  it('leaves out what a custom system turned off, and uses its names', () => {
    expect(shopsSelling('weapons', 'cyberpunk_red')).toEqual(['Gun Shop']);
    expect(shopsSelling('weapons', HEARTH)).toEqual([]);
    expect(shopsSelling('cyberware', HEARTH)).toEqual(['Temple']);
    expect(headings(HEARTH)).toContain('# RELICS');
    expect(headings(HEARTH)).toContain('# WAGONS');
    expect(headings(HEARTH)).not.toContain('# ARMOR');
    expect(headings(HEARTH)).not.toContain('# VEHICLE WEAPONS');
    expect(headings(PLAIN)).toContain('# ARMOR');
    expect(headings(PLAIN)).toContain('# CYBERWARE');
  });
});

describe('the building window', () => {
  const header = (gameSystem: string, buildingType: string) => {
    render(<BuildingWindow location={{ id: 7, name: 'X', building_type: buildingType, x: 0, y: 0, z: 0, width: 4, height: 6, depth: 4 }}
      title="X" gameSystem={gameSystem} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} actions={[]} isPrimaryAdmin={false} token="" />);
    const out = ['RIPPERDOC', 'TEMPLE', 'GUN SHOP', 'BUILDING'].filter((n) => screen.queryAllByText(n).length > 0).join();
    cleanup();
    return out;
  };

  it('names the type by the game\'s name, and an off type as a plain building', () => {
    expect(header('cyberpunk_red', 'ripperdoc')).toBe('RIPPERDOC');
    expect(header('cyberpunk_red', 'gun_shop')).toBe('GUN SHOP');
    expect(header(HEARTH, 'ripperdoc')).toBe('TEMPLE');
    expect(header(HEARTH, 'gun_shop')).toBe('BUILDING');
  });
});

describe('the shop', () => {
  // The garage: three shelves, so the window draws a tab for each.
  const tabs = (system: string) => {
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    render(<ShopWindow name="Stall" locationId={7} buildingType="garage" system={system} buybackPct={45}
      socket={socket} userName="JADE" onClose={vi.fn()} />);
    const names = screen.queryAllByRole('tab').map((t) => t.textContent).filter((t) => /VEHICLE|WAGON/.test(t ?? ''));
    cleanup();
    return names;
  };

  it('puts only the catalogues the game kept on its shelves, by its names', () => {
    expect(tabs('cyberpunk_red')).toEqual(['VEHICLES', 'VEHICLE FITTINGS', 'VEHICLE WEAPONS']);
    expect(tabs(HEARTH)).toEqual(['WAGONS', 'VEHICLE FITTINGS']);
  });

  it('counts a shop as empty only by the shelves it has', () => {
    expect(emptyShelves('armorer', 'cyberpunk_red')).toEqual(['armor', 'armor_mods']);
    expect(emptyShelves('armorer', HEARTH)).toEqual(['armor_mods']);
  });
});
