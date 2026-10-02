import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TokenWindow } from '../TokenWindow';
import { QuickActions } from '../QuickActions';
import { tokenActionKeys, type TokenViewer } from '../tokenActions';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * A custom system with combat turned off, in the windows (3b6b): no attack buttons, and no
 * defense (AC or DV) in the token window, for the GM or the token's owner. All as today under
 * every built-in system and a custom one that kept combat. The server starts no attack there
 * anyway (system_builder_parts_combat.test.js).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const NOCOMBAT = 'sys_aaaaaaaaaaaaaaaa';
const KEPT = 'sys_bbbbbbbbbbbbbbbb';
const WITH_COMBAT = [...BUILT_INS, KEPT];

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: NOCOMBAT, name: 'Hearth', parts: { combat: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
  registerCustomTemplate({ id: KEPT, name: 'Kept', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
});
afterEach(() => { cleanup(); clearCustomTemplates(); });

const defense = { label: 'AC', melee: 12, ranged: 14 };
const socket = () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() });

describe('the attack buttons', () => {
  const player: TokenViewer = {
    isAdmin: false, isPrimaryAdmin: false, isOwner: false, isLoggedIn: true, isPlayerToken: false, hasOwner: false,
    sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: false,
    hasRoster: false, systemHasVehicles: false, systemHasBank: true, systemHasCombat: true, hasBattleMaps: false,
  };

  it('are offered only where the game has combat, and nothing else changes with them', () => {
    expect(tokenActionKeys(player)).toEqual(expect.arrayContaining(['melee', 'ranged']));
    expect(tokenActionKeys({ ...player, sheetCombat: true })).toContain('attack');
    const off = tokenActionKeys({ ...player, systemHasCombat: false });
    expect(off.filter((k) => ['melee', 'ranged', 'attack'].includes(k))).toEqual([]);
    expect(off).toEqual(tokenActionKeys(player).filter((k) => k !== 'melee' && k !== 'ranged'));
  });
});

describe('the GM\'s part of HEALTH', () => {
  const read = (gameSystem: string) => {
    render(<TokenWindow location={{ id: 9, name: 'Ghoul', shape: 'enemy_rhombus' }} title="ID.EXE" pos={{ x: 0, y: 0 }} setPos={vi.fn()}
      onClose={vi.fn()} portrait={null} description="" actions={[]} operator={null} socket={socket()} health={<div />}
      gmHealth={{ defense, onSaveDefense: vi.fn(), onAddToInit: vi.fn() }} gameSystem={gameSystem} />);
    fireEvent.click(screen.getByRole('tab', { name: 'HEALTH' }));
    const out = {
      defense: screen.queryByText('EDIT_AC') !== null,
      // Initiative is its own part: the manual entry stays.
      initiative: screen.queryByText(/^ADD TO /) !== null,
    };
    cleanup();
    return out;
  };

  it('shows the defense to edit as today wherever the game has combat, and not where it does not', () => {
    for (const system of WITH_COMBAT) expect(read(system), system).toEqual({ defense: true, initiative: true });
    expect(read(NOCOMBAT)).toEqual({ defense: false, initiative: true });
  });
});

describe('the owner\'s QUICK ACTIONS', () => {
  const shown = (system: string) => {
    render(<QuickActions socket={socket()} userName="JADE" defense={defense} system={system} />);
    const there = screen.queryByText('DEFENSE') !== null;
    cleanup();
    return there;
  };

  it('show the defense as today wherever the game has combat, and not where it does not', () => {
    for (const system of WITH_COMBAT) expect(shown(system), system).toBe(true);
    expect(shown(NOCOMBAT)).toBe(false);
  });
});
