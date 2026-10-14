import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { CharacterSheetWindow } from '../CharacterSheetWindow';
import { NpcSheetWindow } from '../NpcSheetWindow';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';
import { canImport, canImportNpc, hasJsonTemplate, IMPORTABLE_SYSTEMS } from '../../sheets/importable';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title, titleControls }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      <div data-testid="title-controls">{titleControls}</div>
      {children}
    </div>
  ),
}));

/**
 * The sheet windows' IMPORT button. It is offered where the server has an importer: CWN, Cyberpunk
 * RED and Shadowrun (backend/sheets/importers.js), and since 4h2c every custom system while it has
 * SHEET IMPORT on (backend systemBuilder/sheetImport.js), for a character's sheet. Generic has none
 * (hidden at the user's choice, 2026-10-02), and neither has a custom system's NPC stat block.
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e'];
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const SHUT = 'sys_bbbbbbbbbbbbbbbb';

describe('which systems can import', () => {
  it('the three built-in games the server has an importer for', () => {
    // Pinned here and in backend/__tests__/sheet_import_inventory.test.js, which holds the
    // server's IMPORTERS to the same list. This suite may not load that file: it needs pdf-lib,
    // which only the backend has (crossBoundaryImports.test.ts).
    expect([...IMPORTABLE_SYSTEMS].sort()).toEqual(['cities_without_number', 'cyberpunk_red', 'shadowrun_6e']);
    for (const system of BUILT_INS) {
      expect(canImport(system), system).toBe(true);
      expect(canImportNpc(system), system).toBe(true);
      expect(hasJsonTemplate(system), system).toBe(false);
    }
  });

  it('a custom system\'s characters while it has SHEET IMPORT on, never its NPCs', () => {
    expect([canImport(HEARTH), canImportNpc(HEARTH), hasJsonTemplate(HEARTH)]).toEqual([true, false, true]);
    expect([canImport(SHUT), canImportNpc(SHUT), hasJsonTemplate(SHUT)]).toEqual([false, false, false]);
  });

  it('nothing else', () => {
    for (const system of ['generic', 'nonsense', null, undefined, '']) {
      expect([canImport(system), canImportNpc(system), hasJsonTemplate(system)], String(system)).toEqual([false, false, false]);
    }
  });

  it('a custom system not loaded yet reads as on, like every part, until its definition arrives', () => {
    expect([canImport('sys_cccccccccccccccc'), canImportNpc('sys_cccccccccccccccc')]).toEqual([true, false]);
  });
});

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
  registerCustomTemplate({ id: SHUT, name: 'Shut', parts: { sheet_import: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const socket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

describe('the player\'s sheet window', () => {
  const offered = (system: string) => {
    const s = socket();
    render(<CharacterSheetWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={s} userName="GHOST" />);
    const onSheetData = s.on.mock.calls.find((c: any) => c[0] === 'sheetData')[1];
    act(() => onSheetData({ id: 1, username: 'GHOST', system, data: { name: 'GHOST' }, portrait_url: null, is_npc: 0 }));
    const there = screen.getByTestId('title-controls').textContent?.includes('IMPORT') ?? false;
    cleanup();
    return there;
  };

  it('offers IMPORT for the built-in games and a custom system with SHEET IMPORT on', () => {
    for (const system of [...BUILT_INS, HEARTH]) expect(offered(system), system).toBe(true);
    for (const system of ['generic', SHUT]) expect(offered(system), system).toBe(false);
  });
});

describe('the NPC sheet window', () => {
  const offered = async (system: string, playerUsername?: string) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/api/settings')
      ? { ok: true, json: async () => [] }
      : { ok: true, json: async () => ({ id: 3, username: playerUsername ?? 'npc', system, data: { name: 'Ghoul' }, portrait_url: null, is_npc: playerUsername ? 0 : 1 }) })));
    render(<NpcSheetWindow token="admintoken" npcId={3} npcLabel="Ghoul" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={socket()}
      {...(playerUsername ? { playerUsername } : {})} />);
    // Shown once the sheet has loaded and its system is known.
    await waitFor(() => expect(screen.queryByText('NPC_RECORD_NOT_FOUND')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('title-controls').textContent).not.toBe(''));
    await new Promise((r) => setTimeout(r, 20));
    const there = screen.getByTestId('title-controls').textContent?.includes('IMPORT') ?? false;
    cleanup();
    vi.unstubAllGlobals();
    return there;
  };

  it('offers IMPORT on an NPC for the built-in games only', async () => {
    for (const system of BUILT_INS) expect(await offered(system), system).toBe(true);
    for (const system of ['generic', HEARTH, SHUT]) expect(await offered(system), system).toBe(false);
  });

  it('offers it on a player\'s sheet opened by the GM as the player\'s own window does', async () => {
    expect(await offered(HEARTH, 'GHOST')).toBe(true);
    expect(await offered(SHUT, 'GHOST')).toBe(false);
  });
});
