import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The standalone sheet tab and SHEET.EXE are one sheet (8s1a; the user, 2026-11-15: "they should be identical").
 * Both hand SheetRenderer the same play props, from usePlayerSheet's `sheetProps`, and each action on the tab reaches the
 * server as the window's does. And the tab itself: inside the theme, following the main app's theme, still signed in
 * after a refresh, saying when the connection is lost, showing only this player's own rolls.
 */

type Props = Record<string, unknown>;
const drawn = vi.hoisted(() => ({ props: [] as Props[] }));
vi.mock('../components/SheetRenderer', () => ({
  SheetRenderer: (p: Props) => { drawn.props.push(p); return <div data-testid="sheet" />; },
}));

/** A socket as the app's: what it was sent, and a way to answer as the server. */
const fakeSocket = () => {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const sent: [string, unknown][] = [];
  return {
    sent,
    on: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, [...(handlers.get(e) ?? []), fn]); },
    off: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, (handlers.get(e) ?? []).filter((f) => f !== fn)); },
    emit: (e: string, p?: unknown) => { sent.push([e, p]); },
    disconnect: () => {},
    serve: (e: string, ...a: unknown[]) => act(() => { for (const fn of handlers.get(e) ?? []) fn(...a); }),
  };
};
const tabSocket = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeSocket> | null }));
vi.mock('socket.io-client', () => ({ io: () => tabSocket.current }));

import { CharacterSheetWindow } from '../components/CharacterSheetWindow';
import SheetPage from '../SheetPage';
import { LIVE_THEME_KEY } from '../utils/liveTheme';

const SHEET = { username: 'kes', system: 'generic', data: { name: 'Kes' } };
let settings: { key: string; value: string }[] = [];

beforeEach(() => {
  drawn.props = [];
  settings = [];
  tabSocket.current = fakeSocket();
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => settings })));
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** The tab opened from the main app, as ⧉ opens it: the handshake in localStorage. */
const openTab = (auth: Record<string, unknown> = { userName: 'kes', playerToken: 'tok', theme: 'vaporwave' }) => {
  localStorage.setItem('sheet_tab_auth', JSON.stringify(auth));
  return render(<SheetPage />);
};
const last = () => drawn.props[drawn.props.length - 1];

/** What each surface hands the sheet, once its sheet has arrived. */
const propsOf = async () => {
  const win = fakeSocket();
  render(<CharacterSheetWindow pos={{ x: 0, y: 0 }} setPos={() => {}} onClose={() => {}} socket={win} userName="kes" playerToken="tok"
    onOpenLink={() => {}} onOpenLevelUp={() => {}} onOpenVehicles={() => {}} />);
  await win.serve('sheetData', SHEET);
  const windowProps = last();
  cleanup();
  drawn.props = [];
  openTab();
  await tabSocket.current!.serve('connect');
  await tabSocket.current!.serve('sheetData', SHEET);
  return { windowProps, tabProps: last() };
};

/** What the window has that the tab is still to get, and the piece bringing each: none may be missing silently. */
const WINDOW_ONLY = {
  onOpenLink: '8s1d: HEALTH and BANK on the tab',
  onSectionAction: '8s1d: VEHICLES on the tab',
};

describe('the tab and the window hand the sheet the same', () => {
  it('every prop the window gives, the tab gives too, but those named as still to come', async () => {
    const { windowProps, tabProps } = await propsOf();
    const windowKeys = Object.keys(windowProps).filter((k) => windowProps[k] !== undefined && !(k in WINDOW_ONLY)).sort();
    const tabKeys = Object.keys(tabProps).filter((k) => tabProps[k] !== undefined).sort();
    expect(tabKeys).toEqual(windowKeys);
    // Those still to come are the window's, so none is stale.
    for (const k of Object.keys(WINDOW_ONLY)) expect(windowProps[k], k).toBeTypeOf('function');
    // Every play prop is among them, from the oldest rolls to what Phase 7 and 8 added.
    for (const k of ['onRoll', 'onDeathSave', 'onStabilize', 'onCastSpell', 'onRollAbility', 'onResistDrain', 'onGearRoll',
      'onChoices', 'onLevel', 'onItem', 'onSpend', 'onImprove', 'onRecoverySpend', 'onRestTake']) expect(tabProps[k], k).toBeTypeOf('function');
    for (const k of ['choicesRefused', 'recoveryOpen', 'allowFumbleShield', 'xpRate', 'encumbranceEnforced', 'hiddenTabs']) expect(tabProps, k).toHaveProperty(k);
  });

  it('each action on the tab reaches the server as the window\'s does', async () => {
    openTab();
    const s = tabSocket.current!;
    await s.serve('sheetData', SHEET);
    const p = last() as Record<string, (...a: unknown[]) => void>;
    s.sent.length = 0;
    p.onChoices({ kind: 'pick', list: 'feats', option: 'tough' });
    p.onLevel({ kind: 'up' });
    p.onItem({ kind: 'wear', item: 'ring' });
    p.onSpend({ kind: 'buy', buy: 'feat' });
    p.onImprove({ kind: 'mark', stat: 'lore', on: true });
    p.onRecoverySpend('hit_dice', 2);
    p.onRestTake('long_rest');
    p.onGearRoll(0, 'damage');
    expect(s.sent).toEqual([
      ['choicesAction', { kind: 'pick', list: 'feats', option: 'tough' }],
      ['levelAction', { kind: 'up' }],
      ['itemAction', { kind: 'wear', item: 'ring' }],
      ['spendAction', { kind: 'buy', buy: 'feat' }],
      ['improveAction', { kind: 'mark', stat: 'lore', on: true }],
      ['recoverySpend', { pool: 'hit_dice', count: 2 }],
      ['restTake', { rest: 'long_rest' }],
      ['requestSheetRoll', { gear: { line: 0, column: 'damage' } }],
    ]);
  });

  it('what the server refused, and whether recovery is open, reach the tab\'s sheet', async () => {
    settings = [{ key: 'recovery_open', value: '1' }];
    openTab();
    const s = tabSocket.current!;
    await s.serve('sheetData', SHEET);
    await vi.waitFor(() => expect(last().recoveryOpen).toBe(true));
    await s.serve('choicesRefused', { error: 'Not at this level' });
    expect(last().choicesRefused).toBe('Not at this level');
  });
});

describe('IMPORT and what the GM gives, on both (8s1b)', () => {
  it('IMPORT where the system can import, on the window and the tab alike; none where it can\'t; IMPORT.EXE from the tab', async () => {
    const CPR = { ...SHEET, system: 'cyberpunk_red' };
    const win = fakeSocket();
    render(<CharacterSheetWindow pos={{ x: 0, y: 0 }} setPos={() => {}} onClose={() => {}} socket={win} userName="kes" />);
    await win.serve('sheetData', CPR);
    expect(screen.getAllByRole('button', { name: 'IMPORT' })).toHaveLength(1);
    cleanup();
    openTab();
    await tabSocket.current!.serve('sheetData', CPR);
    expect(screen.queryByText('IMPORT.EXE')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    expect(screen.getByText('IMPORT.EXE')).toBeTruthy();
    cleanup();
    openTab();
    await tabSocket.current!.serve('sheetData', SHEET);
    expect(screen.queryByRole('button', { name: 'IMPORT' })).toBeNull();
  });

  it('what the GM gives is said on the tab, as in the main app', async () => {
    openTab();
    await tabSocket.current!.serve('sheetData', SHEET);
    await tabSocket.current!.serve('itemReceived', { item: 'Cutlass', qty: 1 });
    expect(document.body.textContent).toContain('GAVE YOU CUTLASS ×1');
  });
});

describe('LEVEL_UP.EXE and NEW_CHARACTER.EXE on the tab (8s1c)', () => {
  const ID = 'sys_0a1b2c3d4e5f6a7b';
  const RENDER = {
    id: ID, name: 'Tabflow', words: {}, derived: [],
    sheet: { header: { nameField: 'name' }, sections: [{ id: 'identity', label: 'IDENTITY', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }] }] },
    choices: [],
    creation: { steps: ['who'], stats: [] },
  };

  it('LEVEL UP READY opens LEVEL_UP.EXE on the tab, as SHEET.EXE opens it', async () => {
    openTab();
    await tabSocket.current!.serve('sheetData', SHEET);
    expect(document.body.textContent).not.toMatch(/LEVEL_UP\.EXE/);
    await act(async () => { (last().onLevelUp as () => void)(); });
    expect(document.body.textContent).toMatch(/LEVEL_UP\.EXE/);
  });

  it('a sheet being made says CREATING · CONTINUE on the tab, which opens NEW_CHARACTER.EXE where it was left', async () => {
    const { registerCustomTemplate, clearCustomTemplates } = await import('../sheets/customTemplates');
    registerCustomTemplate(RENDER as never);
    try {
      openTab();
      const s = tabSocket.current!;
      await s.serve('sheetData', { username: 'kes', system: ID, data: { _creating: { at: 'who' } } });
      s.sent.length = 0;
      await userEvent.click(screen.getByRole('button', { name: 'CREATING · CONTINUE' }));
      expect(s.sent[0]).toEqual(['creationAction', { kind: 'open' }]);
      expect(document.body.textContent).toContain('NEW_CHARACTER.EXE ·');
      // A sheet that isn't being made says nothing of it.
      cleanup();
      openTab();
      await tabSocket.current!.serve('sheetData', { username: 'kes', system: ID, data: { name: 'Kes' } });
      expect(screen.queryByRole('button', { name: 'CREATING · CONTINUE' })).toBeNull();
    } finally { clearCustomTemplates(); }
  });
});

describe('the tab itself', () => {
  it('is a theme container in the theme it was opened with, and follows the main app\'s as it changes', async () => {
    const { container } = openTab();
    const root = container.firstElementChild!;
    expect(root.className).toBe('crt-container theme-vaporwave');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: LIVE_THEME_KEY, newValue: 'ocean' })); });
    expect(root.className).toBe('crt-container theme-ocean');
    // Not a theme, or another key: as it was.
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: LIVE_THEME_KEY, newValue: 'nope' })); });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'solar' })); });
    expect(root.className).toBe('crt-container theme-ocean');
  });

  it('a refresh stays signed in: the handshake kept for the life of the tab', async () => {
    openTab();
    expect(localStorage.getItem('sheet_tab_auth')).toBeNull();
    await tabSocket.current!.serve('connect');
    expect(tabSocket.current!.sent.find(([e]) => e === 'identify')).toEqual(['identify', { userName: 'kes', playerToken: 'tok' }]);
    cleanup();
    tabSocket.current = fakeSocket();
    render(<SheetPage />);
    await tabSocket.current.serve('connect');
    expect(tabSocket.current.sent.find(([e]) => e === 'identify')).toEqual(['identify', { userName: 'kes', playerToken: 'tok' }]);
  });

  it('says when the connection is lost, and stops saying it once back', async () => {
    openTab();
    const s = tabSocket.current!;
    await s.serve('disconnect');
    expect(screen.getByRole('alert').textContent).toMatch(/^CONNECTION LOST · RECONNECTING…/);
    await s.serve('connect');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows only this player\'s own rolls, once the dice have landed', async () => {
    vi.useFakeTimers();
    openTab();
    const s = tabSocket.current!;
    // Another's roll after this player's: it would be the line shown, were it not passed over.
    await s.serve('diceRollBroadcast', { historyString: 'Kes rolled 7', account: 'kes' });
    await s.serve('diceRollBroadcast', { historyString: 'Vex rolled 12', account: 'vex' });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('⌁ Kes rolled 7')).toBeTruthy();
    expect(screen.queryByText(/Vex rolled/)).toBeNull();
  });
});
