import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { buildBuildingActions, type BuildingViewer } from '../buildingActions';
import { buildTokenActions, type TokenViewer } from '../tokenActions';
import { EmptyShopSteps } from '../EmptyShopSteps';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';
import { wordFor } from '../../sheets/words';

/**
 * The glossary in the bank and shop menus and the empty-shop steps (3a4). Each place reads
 * exactly as today under every built-in system and a custom system that renamed nothing, and
 * in a custom system's own words where it renamed shops or the bank. The shop window itself
 * is tested in ShopWindow.test.tsx.
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const RENAMED = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const all = (w: string, plural = w) => ({ singular: w, plural, short: w });
const custom = (id: string, words: Record<string, ReturnType<typeof all>>) => registerCustomTemplate({
  id, name: id, parts: {}, derived: [], sheet: { sections: [] }, words,
});
const lookup = (system: string) => (term: Parameters<typeof wordFor>[1], form: Parameters<typeof wordFor>[2], builtIn: string) => wordFor(system, term, form, builtIn);

beforeEach(() => {
  clearCustomTemplates();
  custom(RENAMED, { shop: all('MERCHANT', 'MERCHANTS'), bank: all('COIN PURSE') });
  custom(PLAIN, {});
});
afterEach(() => { cleanup(); clearCustomTemplates(); });

describe('the building menu', () => {
  const viewer: BuildingViewer = { shopHere: true, hasBattleMaps: false, isAdmin: true, systemHasVehicles: false };
  const shopLabel = (words?: ReturnType<typeof lookup>) => buildBuildingActions(viewer, {
    location: { id: 1, name: 'Vic' }, userName: 'gm', emit: vi.fn(), someoneEditing: false, notify: vi.fn(), words,
    open: { shop: vi.fn(), battleMap: vi.fn(), enemyVehicles: vi.fn() }, ping: vi.fn(), broadcast: vi.fn(),
  }).find((a) => a.key === 'shop')!.label;

  it('reads SHOP with no words, under every built-in system, and a custom one that renamed nothing', () => {
    expect(shopLabel()).toBe('SHOP');
    for (const system of [...BUILT_INS, PLAIN]) expect(shopLabel(lookup(system)), system).toBe('SHOP');
  });

  it('uses a custom system\'s own word for its shops', () => {
    expect(shopLabel(lookup(RENAMED))).toBe('MERCHANT');
  });
});

describe('the token menu', () => {
  const viewer: TokenViewer = {
    isAdmin: true, isPrimaryAdmin: true, isOwner: false, isLoggedIn: true, isPlayerToken: true, hasOwner: true,
    sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: true,
    hasRoster: false, systemHasVehicles: false, hasBattleMaps: false,
  };
  const bankLabel = (words?: ReturnType<typeof lookup>) => buildTokenActions(viewer, {
    location: { id: 42, name: 'GHOST', shape: 'rhombus', owner: 'ghost' }, authToken: 'tok', emit: vi.fn(),
    fetch: vi.fn(async () => ({ ok: true })), refreshLocations: vi.fn(), sheetLink: null, tier: undefined, isOwner: false, words,
    open: { ownSheet: vi.fn(), playerSheet: vi.fn(), npcSheet: vi.fn(), editLocation: vi.fn(), vehicles: vi.fn(), bank: vi.fn(), enemyVehicles: vi.fn(), battleMap: vi.fn() },
    ping: vi.fn(), broadcast: vi.fn(), clearSelection: vi.fn(),
  }).find((a) => a.key === 'bank')!.label;

  it('reads VIEW_BANK with no words, under every built-in system, and a custom one that renamed nothing', () => {
    expect(bankLabel()).toBe('VIEW_BANK');
    for (const system of [...BUILT_INS, PLAIN]) expect(bankLabel(lookup(system)), system).toBe('VIEW_BANK');
  });

  it('uses a custom system\'s own word for the bank, in the label style', () => {
    expect(bankLabel(lookup(RENAMED))).toBe('VIEW_COIN_PURSE');
  });
});

describe('the empty-shop steps', () => {
  const steps = (system: string) => {
    render(<EmptyShopSteps buildingType="gun_shop" system={system} />);
    const note = screen.getByRole('note', { name: 'How to stock this shop' }).textContent ?? '';
    cleanup();
    return note;
  };

  it('read as today outside CWN, and under a custom system that renamed nothing', () => {
    for (const system of ['cyberpunk_red', 'shadowrun_6e', 'generic', PLAIN]) {
      const note = steps(system);
      expect(note, system).toContain('Shops in this game sell only what you add.');
      expect(note, system).toContain('Open SHOP_CATALOGUES, in the admin panel');
    }
  });

  it('use a custom system\'s own word for its shops', () => {
    const note = steps(RENAMED);
    expect(note).toContain('MERCHANTS in this game sell only what you add.');
    expect(note).toContain('Open MERCHANT_CATALOGUES, in the admin panel');
  });
});
