import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));
vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));
vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => <div><div data-testid="window-title">{title}</div>{children}</div>,
}));

import { AdminPanel } from '../AdminPanel';
import { Sidebar } from '../Sidebar';
import { BankWindow, CurrencyIcon } from '../BankWindows';
import { registerCustomTemplate, clearCustomTemplates, customTemplate, type CustomRender } from '../../sheets/customTemplates';
import type { Currency } from '../../sheets/currencies';

/**
 * Currency icons in the windows (3c2c3): an uploaded icon drawn through <img> only, a currency's
 * icon beside its amount in BANK.EXE and on the sidebar's BANK button, and CURRENCY_ICON as one row
 * per currency in a custom system with currencies of its own (decided with the user, 2026-10-02).
 * Every built-in system keeps today's single table-wide icon.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const UPLOADED = `/uploads/currency_icons/${'d'.repeat(64)}.svg`;
const GOLD: Currency = {
  id: 'gold', name: 'Gold', decimals: 0, decimalMark: '.', debt: false, negative: false,
  denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }],
};
const FAVOR: Currency = { id: 'favor', name: 'Favor', decimals: 0, decimalMark: '.', debt: true, negative: false, denominations: [] };
const DOLLARS: Currency = { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2, decimalMark: '.', debt: true, negative: true, denominations: [] };
const hearth = (currencies: Currency[]): CustomRender => ({ id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] }, currencies });

beforeEach(() => clearCustomTemplates());
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('an icon', () => {
  it('the GM uploaded is drawn through <img>, never inlined', () => {
    const { container } = render(<CurrencyIcon icon={UPLOADED} size={20} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(UPLOADED);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('width')).toBe('20');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('that only looks like an upload is never drawn as an image', () => {
    for (const icon of ['/uploads/battle_maps/x.png', `https://example.com/uploads/currency_icons/${'d'.repeat(64)}.png`]) {
      const { container } = render(<CurrencyIcon icon={icon} />);
      expect(container.querySelector('img'), icon).toBeNull();
      cleanup();
    }
  });
});

describe('BANK.EXE', () => {
  const open = () => render(<BankWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={{ emit: vi.fn(), on: vi.fn(), off: vi.fn() }}
    userName="GHOST" isBankOpen system={HEARTH} bankData={{ balance: 250, debt: 0, currencies: [{ id: 'gold', balance: 250, debt: 0 }, { id: 'favor', balance: 5, debt: 0 }] }} />);

  it('shows the picked currency\'s own icon before its amount, and none for one without', async () => {
    registerCustomTemplate(hearth([{ ...GOLD, icon: UPLOADED }, FAVOR]));
    open();
    const balance = screen.getByTestId('bank-balance');
    expect(balance.querySelector('img')?.getAttribute('src')).toBe(UPLOADED);
    expect(balance.textContent).toBe('2\u00a0gp 50\u00a0cp');
    await userEvent.click(screen.getByTestId('bank-account-favor'));
    expect(screen.getByTestId('bank-balance').querySelector('img')).toBeNull();
    // Not the app's own coin either: a currency without an icon shows its amount alone.
    expect(screen.getByTestId('bank-balance').querySelector('div')).toBeNull();
    expect(screen.getByTestId('bank-balance').textContent).toBe('5\u00a0Favor');
  });

  it('shows one of the five as today\'s icon is shown', () => {
    registerCustomTemplate(hearth([{ ...GOLD, icon: '🪙' }, FAVOR]));
    open();
    expect(screen.getByTestId('bank-balance').textContent).toBe('🪙2\u00a0gp 50\u00a0cp');
  });
});

describe('the sidebar\'s BANK button', () => {
  const props = (gameSystem: string, currencyIcon?: string): any => ({
    activeMenu: null, setActiveMenu: vi.fn(), locations: [], onSelect: vi.fn(), onZoom: vi.fn(), selectedLocation: null,
    userName: 'GHOST', token: '', onLogout: vi.fn(), audioEnabled: false, setAudioEnabled: vi.fn(), masterVolume: 1,
    setMasterVolume: vi.fn(), musicVolume: 1, setMusicVolume: vi.fn(), rhombusState: { color: '#00ff00' }, setRhombusState: vi.fn(),
    refreshLocations: vi.fn(), socketRef: { current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }, isChatOpen: false,
    setIsChatOpen: vi.fn(), hasUnreadChat: false, syncRhombusToDB: vi.fn(), view: 'list', activeBattleMapData: null,
    isHitPointsOpen: false, setIsHitPointsOpen: vi.fn(), activeUsers: [], setIsDiceTrayOpen: vi.fn(), setNotification: vi.fn(),
    measureMode: false, setMeasureMode: vi.fn(), isBankOpen: false, setIsBankOpen: vi.fn(), isSheetOpen: false,
    setIsSheetOpen: vi.fn(), gameSystem, activeCombats: [], currencyIcon,
  });
  const button = (system: string, currencyIcon?: string) => {
    render(<Sidebar {...props(system, currencyIcon)} />);
    const b = screen.getByLabelText('CITY_NET // BANK');
    const out = { img: b.querySelector('img')?.getAttribute('src') ?? null, text: b.textContent, mask: !!b.querySelector('div') };
    cleanup();
    return out;
  };

  it('shows the table-wide icon in a built-in system, as today', () => {
    expect(button('cities_without_number', '€')).toEqual({ img: null, text: '€', mask: false });
    expect(button('generic')).toEqual({ img: null, text: '', mask: true });
  });

  it('shows the main currency\'s icon, else its symbol, else the app\'s own, never the table-wide one', () => {
    registerCustomTemplate(hearth([{ ...GOLD, icon: UPLOADED }, FAVOR]));
    expect(button(HEARTH, '€')).toEqual({ img: UPLOADED, text: '', mask: false });
    registerCustomTemplate(hearth([DOLLARS, FAVOR]));
    expect(button(HEARTH, '€')).toEqual({ img: null, text: '$', mask: false });
    registerCustomTemplate(hearth([GOLD, { ...FAVOR, icon: '🪙' }]));
    expect(button(HEARTH, '€')).toEqual({ img: null, text: '', mask: true });
  });
});

describe('CURRENCY_ICON', () => {
  let calls: { url: string; method: string; body: unknown }[] = [];
  /** What the server answers for each kind of request; a test changes these. */
  let uploadAnswer: { ok: boolean; body: unknown } = { ok: true, body: { icon: UPLOADED } };
  let setAnswer: { ok: boolean; body: unknown } = { ok: true, body: {} };
  let served: CustomRender = hearth([GOLD, FAVOR]);

  beforeEach(() => {
    calls = [];
    uploadAnswer = { ok: true, body: { icon: UPLOADED } };
    setAnswer = { ok: true, body: {} };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body instanceof FormData ? init.body.get('icon') : init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url) === `/api/systems/render/${HEARTH}`) return { ok: true, json: async () => served };
      if (String(url) === '/api/systems/currency-icons') return { ok: uploadAnswer.ok, json: async () => uploadAnswer.body };
      if (String(url).startsWith(`/api/systems/${HEARTH}/currencies/`)) return { ok: setAnswer.ok, json: async () => setAnswer.body };
      if (String(url).includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: HEARTH, systems: [] }) };
      return { ok: true, json: async () => [] };
    }));
  });

  const props = (system: string): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], setIsAdminPayOpen: vi.fn(), handleSaveDefault: vi.fn(), handleLoadDefault: vi.fn(),
    globalSettings: { game_system: system }, gameSystem: system,
  });
  const game = async (system: string) => {
    render(<AdminPanel {...props(system)} />);
    await userEvent.click(screen.getByText('GAME'));
  };
  const sets = () => calls.filter((c) => c.method === 'PUT');

  it('is a row per currency, NONE marked where it has no icon, and each choice saved into the system', async () => {
    registerCustomTemplate(hearth([GOLD, { ...FAVOR, icon: '$' }]));
    served = hearth([{ ...GOLD, icon: '🪙' }, { ...FAVOR, icon: '$' }]);
    await game(HEARTH);
    const gold = screen.getByTestId('currency-icon-gold');
    expect(within(gold).getByText('NONE').className).toContain('active');
    expect(within(screen.getByTestId('currency-icon-favor')).getByLabelText('$ for Favor').className).toContain('active');
    await userEvent.click(within(gold).getByLabelText('🪙 for Gold'));
    expect(sets()).toEqual([{ url: `/api/systems/${HEARTH}/currencies/gold/icon`, method: 'PUT', body: { icon: '🪙' } }]);
    // Fetched again at once, so the row shows what was saved.
    await waitFor(() => expect(customTemplate(HEARTH)?.currencies?.[0].icon).toBe('🪙'));
    expect(within(screen.getByTestId('currency-icon-gold')).getByLabelText('🪙 for Gold').className).toContain('active');
  });

  it('clears an icon with NONE', async () => {
    registerCustomTemplate(hearth([{ ...GOLD, icon: '$' }, FAVOR]));
    await game(HEARTH);
    await userEvent.click(within(screen.getByTestId('currency-icon-gold')).getByText('NONE'));
    expect(sets()).toEqual([{ url: `/api/systems/${HEARTH}/currencies/gold/icon`, method: 'PUT', body: { icon: null } }]);
  });

  it('uploads a file, then makes it the currency\'s icon, showing it beside the name', async () => {
    registerCustomTemplate(hearth([GOLD, FAVOR]));
    served = hearth([{ ...GOLD, icon: UPLOADED }, FAVOR]);
    await game(HEARTH);
    const file = new File(['<svg/>'], 'coin.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('Upload an icon for Gold'), { target: { files: [file] } });
    await waitFor(() => expect(sets()).toEqual([{ url: `/api/systems/${HEARTH}/currencies/gold/icon`, method: 'PUT', body: { icon: UPLOADED } }]));
    const upload = calls.find((c) => c.url === '/api/systems/currency-icons')!;
    expect(upload.method).toBe('POST');
    expect((upload.body as File).name).toBe('coin.svg');
    await waitFor(() => expect(screen.getByTestId('currency-icon-gold').querySelector('img')?.getAttribute('src')).toBe(UPLOADED));
  });

  it('says what the server refused, and sets nothing after a refused upload', async () => {
    registerCustomTemplate(hearth([GOLD, FAVOR]));
    await game(HEARTH);
    uploadAnswer = { ok: false, body: { error: '"coin.gif" is .gif, which is not supported. Use .png, .webp, .svg — up to 0.25MB.' } };
    fireEvent.change(screen.getByLabelText('Upload an icon for Gold'), { target: { files: [new File(['x'], 'coin.gif')] } });
    expect(await within(screen.getByTestId('currency-icon-gold')).findByRole('alert')).toHaveTextContent('"coin.gif" is .gif, which is not supported.');
    expect(sets()).toEqual([]);
    setAnswer = { ok: false, body: { error: 'No such currency' } };
    await userEvent.click(within(screen.getByTestId('currency-icon-favor')).getByLabelText('$ for Favor'));
    expect(await within(screen.getByTestId('currency-icon-favor')).findByRole('alert')).toHaveTextContent('No such currency');
  });

  it('is today\'s one table-wide choice in a built-in system', async () => {
    await game('cities_without_number');
    expect(screen.getByText('CURRENCY_ICON')).toBeInTheDocument();
    expect(screen.queryByText('NONE')).toBeNull();
    expect(screen.queryByLabelText(/^Upload an icon/)).toBeNull();
    await userEvent.click(screen.getByText('€'));
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/settings').map((c) => c.body)).toEqual([{ key: 'currency_icon', value: '€' }]);
  });
});
