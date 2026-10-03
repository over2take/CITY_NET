import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { CharacterSheetWindow } from '../CharacterSheetWindow';
import { NpcSheetWindow } from '../NpcSheetWindow';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';
import { canImport, IMPORTABLE_SYSTEMS } from '../../sheets/importable';
import { createRequire } from 'module';

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
 * The sheet windows' IMPORT button. It is offered only where the server has an importer
 * (backend/sheets/importers.js): CWN, Cyberpunk RED and Shadowrun. Generic and every custom
 * system have none, so the server refused every import there and the button only ever failed:
 * hidden for custom systems since 3b6c, and for Generic at the user's choice (2026-10-02).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e'];
const NONE = ['generic', 'sys_aaaaaaaaaaaaaaaa'];
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';

describe('which systems can import', () => {
  it('are exactly the ones the server has an importer for', () => {
    const server = createRequire(import.meta.url)('../../../../backend/sheets/importers.js');
    expect([...IMPORTABLE_SYSTEMS].sort()).toEqual(Object.keys(server.IMPORTERS).sort());
    for (const system of [...NONE, null, undefined, '']) expect(canImport(system), String(system)).toBe(false);
  });
});

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
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

  it('offers IMPORT where there is an importer, and not under Generic or a custom system', () => {
    for (const system of BUILT_INS) expect(offered(system), system).toBe(true);
    for (const system of NONE) expect(offered(system), system).toBe(false);
  });
});

describe('the NPC sheet window', () => {
  const offered = async (system: string) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/api/settings')
      ? { ok: true, json: async () => [] }
      : { ok: true, json: async () => ({ id: 3, username: 'npc', system, data: { name: 'Ghoul' }, portrait_url: null, is_npc: 1 }) })));
    render(<NpcSheetWindow token="admintoken" npcId={3} npcLabel="Ghoul" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socket={socket()} />);
    // Shown once the sheet has loaded and its system is known.
    await waitFor(() => expect(screen.queryByText('NPC_RECORD_NOT_FOUND')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('title-controls').textContent).not.toBe(''));
    await new Promise((r) => setTimeout(r, 20));
    const there = screen.getByTestId('title-controls').textContent?.includes('IMPORT') ?? false;
    cleanup();
    vi.unstubAllGlobals();
    return there;
  };

  it('offers IMPORT where there is an importer, and not under Generic or a custom system', async () => {
    for (const system of BUILT_INS) expect(await offered(system), system).toBe(true);
    for (const system of NONE) expect(await offered(system), system).toBe(false);
  });
});
