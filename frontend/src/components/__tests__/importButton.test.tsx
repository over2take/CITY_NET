import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { CharacterSheetWindow } from '../CharacterSheetWindow';
import { NpcSheetWindow } from '../NpcSheetWindow';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

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
 * The sheet windows' IMPORT button (3b6c). There is no importer for a custom system, so the
 * server refuses every import there, and the button is not offered. Every built-in system
 * shows it as before; Generic included, whose import the server also refuses (left as it was).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';

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

  it('offers IMPORT under every built-in system and not under a custom one', () => {
    for (const system of BUILT_INS) expect(offered(system), system).toBe(true);
    expect(offered(HEARTH)).toBe(false);
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

  it('offers IMPORT under every built-in system and not under a custom one', async () => {
    for (const system of BUILT_INS) expect(await offered(system), system).toBe(true);
    expect(await offered(HEARTH)).toBe(false);
  });
});
