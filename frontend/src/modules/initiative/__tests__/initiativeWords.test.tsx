import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InitiativeWindow } from '../components/InitiativeWindow';
import { InitiativeNavPanel } from '../components/InitiativeNavPanel';
import { Sidebar } from '../../../components/Sidebar';
import type { InitiativeState } from '../hooks/useInitiative';
import { registerCustomTemplate, clearCustomTemplates } from '../../../sheets/customTemplates';

/**
 * The glossary in the initiative tracker (3a5a). Every place reads exactly as today under each
 * built-in system - CWN, Cyberpunk RED and Generic counting ROUNDs (Generic since 8a8, which counted TURNs), Shadowrun PASSes -
 * and under a custom system that renamed nothing; a custom system that renamed initiative or
 * the turn shows its own words.
 */

const RENAMED = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const COUNTERS: Record<string, string> = { cities_without_number: 'ROUND', cyberpunk_red: 'ROUND', shadowrun_6e: 'PASS', generic: 'ROUND', [PLAIN]: 'ROUND' };

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: RENAMED, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] },
    words: { initiative: { singular: 'ORDER', plural: 'ORDER', short: 'ORD' }, turn: { singular: 'BEAT', plural: 'BEATS', short: 'BEAT' },
      // The count is of rounds (8a8): its own word, the turn's renamed apart.
      round: { singular: 'BOUT', plural: 'BOUTS', short: 'BOUT' } } });
  registerCustomTemplate({ id: PLAIN, name: 'Plain', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
});
afterEach(() => { cleanup(); clearCustomTemplates(); });

const windowProps = (system: string, over = {}) => ({
  state: null as InitiativeState | null, activeCombats: [], sceneKey: 'city:0', sceneLabel: 'CITY MAP', isAdmin: true,
  onClose: vi.fn(), onStart: vi.fn(), onListCombats: vi.fn(), onNext: vi.fn(), onEnd: vi.fn(), onRemove: vi.fn(), onReorder: vi.fn(),
  system, ...over,
});
const state = (system: string, over = {}): InitiativeState => ({
  sceneKey: 'city:0', combatId: 1, combatants: [], turnIndex: 0, turnCounter: 3, passCounter: 2, system, ...over,
} as InitiativeState);

describe('the tracker window', () => {
  const read = async (system: string) => {
    const out: Record<string, string | null> = {};
    let r = render(<InitiativeWindow {...windowProps(system, { activeCombats: [{ id: 4, scene_keys: ['city:0'], scene_counters: { 'city:0': 7 } }] })} />);
    out.start = screen.getByText(/^START /).textContent;
    await userEvent.click(screen.getByText('JOIN EXISTING COMBAT'));
    out.combat = screen.getByText(/^COMBAT #4/).textContent;
    r.unmount();
    r = render(<InitiativeWindow {...windowProps(system, { isAdmin: false })} />);
    out.none = screen.getByText(/^NO ACTIVE /).textContent;
    r.unmount();
    r = render(<InitiativeWindow {...windowProps(system, { state: state(system) })} />);
    out.counter = screen.getByText(/ [23]$/).textContent;
    out.end = screen.getByText(/^END /).textContent;
    r.unmount();
    render(<InitiativeWindow {...windowProps(system, { state: state(system), isAdmin: false, onJoin: vi.fn(), playerCombatantId: 'player:jade' })} />);
    out.join = screen.getByText(/^JOIN /).textContent;
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', async () => {
    for (const system of Object.keys(COUNTERS)) {
      expect(await read(system), system).toEqual({
        start: 'START INITIATIVE', combat: 'COMBAT #4 [1 SCENE]', none: 'NO ACTIVE INITIATIVE IN THIS SCENE',
        counter: `${COUNTERS[system]} ${system === 'shadowrun_6e' ? 2 : 3}`, end: 'END INIT', join: 'JOIN INITIATIVE',
      });
    }
  });

  it('uses a custom system\'s own words', async () => {
    expect(await read(RENAMED)).toEqual({
      start: 'START ORDER', combat: 'COMBAT #4 [1 SCENE]', none: 'NO ACTIVE ORDER IN THIS SCENE',
      counter: 'BOUT 3', end: 'END ORD', join: 'JOIN ORDER',
    });
  });
});

// Group style drawn in the tracker window, as at the table: its counter and END are the window's (8a9c, InitiativeControls).
describe('the side view', () => {
  const read = (system: string) => {
    const s = state(system, { mode: 'side', sides: [{ id: 'pc', name: 'PLAYERS', score: 12, isPlayerSide: true }, { id: 'npc', name: 'NPC', score: 0, isPlayerSide: false }] });
    let r = render(<InitiativeWindow {...windowProps(system, { state: s })} />);
    const out: Record<string, string | null> = {
      counter: screen.getByText(/ 3$/).textContent,
      score: screen.getByText(/ 12$/).textContent,
      end: screen.getByText(/^END /).textContent,
    };
    r.unmount();
    r = render(<InitiativeWindow {...windowProps(system, { state: s, isAdmin: false, onJoin: vi.fn(), playerCombatantId: 'player:jade' })} />);
    out.join = screen.getByText(/^JOIN /).textContent;
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', () => {
    for (const system of Object.keys(COUNTERS)) {
      expect(read(system), system).toEqual({ counter: `${COUNTERS[system]} 3`, score: 'INIT 12', end: 'END INIT', join: 'JOIN INITIATIVE' });
    }
  });

  it('uses a custom system\'s own words', () => {
    expect(read(RENAMED)).toEqual({ counter: 'BOUT 3', score: 'ORD 12', end: 'END ORD', join: 'JOIN ORDER' });
  });
});

describe('the nav panel', () => {
  const read = (system?: string) => {
    let r = render(<InitiativeNavPanel initiativeActive={false} activeCombats={[]} locations={[]} onClose={vi.fn()} system={system} />);
    const out: Record<string, string | null> = {
      heading: screen.getByRole('heading', { level: 3 }).textContent,
      hint: screen.getByText(/^NO ACTIVE COMBATS/).textContent,
    };
    r.unmount();
    r = render(<InitiativeNavPanel initiativeActive activeCombats={[{ id: 4, scene_keys: ['city:0'], scene_counters: { 'city:0': 7 } }]} locations={[]} onClose={vi.fn()} system={system} />);
    out.combat = screen.getByText(/^COMBAT #4/).textContent;
    // Each scene with its own count, named as its tracker names it (8a8).
    out.scene = screen.getByRole('button', { name: /^▶ / }).textContent;
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', () => {
    for (const system of [undefined, ...Object.keys(COUNTERS)]) {
      expect(read(system), String(system)).toEqual({
        heading: 'INITIATIVE',
        hint: 'NO ACTIVE COMBATS. OPEN THE TRACKER AND CLICK START INITIATIVE TO BEGIN. EACH ACTIVE SCENE WILL APPEAR HERE FOR QUICK NAVIGATION.',
        combat: 'COMBAT #4', scene: `▶ CITY MAP · ${system ? COUNTERS[system] : 'ROUND'} 7`,
      });
    }
  });

  it('gets the running system from the sidebar', () => {
    const props: any = {
      activeMenu: 'initiative_tracker', setActiveMenu: vi.fn(), locations: [], onSelect: vi.fn(), onZoom: vi.fn(), selectedLocation: null,
      userName: 'GHOST', token: '', onLogout: vi.fn(), audioEnabled: false, setAudioEnabled: vi.fn(), masterVolume: 1,
      setMasterVolume: vi.fn(), musicVolume: 1, setMusicVolume: vi.fn(), rhombusState: { color: '#00ff00' }, setRhombusState: vi.fn(),
      refreshLocations: vi.fn(), socketRef: { current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }, isChatOpen: false,
      setIsChatOpen: vi.fn(), hasUnreadChat: false, syncRhombusToDB: vi.fn(), view: 'list', activeBattleMapData: null,
      isHitPointsOpen: false, setIsHitPointsOpen: vi.fn(), activeUsers: [], setIsDiceTrayOpen: vi.fn(), setNotification: vi.fn(),
      measureMode: false, setMeasureMode: vi.fn(), isBankOpen: false, setIsBankOpen: vi.fn(), isSheetOpen: false,
      setIsSheetOpen: vi.fn(), gameSystem: RENAMED, activeCombats: [],
    };
    render(<Sidebar {...props} />);
    expect(screen.getByRole('heading', { level: 3, name: 'ORDER' })).toBeTruthy();
  });

  it('uses a custom system\'s own words', () => {
    expect(read(RENAMED)).toEqual({
      heading: 'ORDER',
      hint: 'NO ACTIVE COMBATS. OPEN THE TRACKER AND CLICK START ORDER TO BEGIN. EACH ACTIVE SCENE WILL APPEAR HERE FOR QUICK NAVIGATION.',
      combat: 'COMBAT #4', scene: '▶ CITY MAP · BOUT 7',
    });
  });
});
