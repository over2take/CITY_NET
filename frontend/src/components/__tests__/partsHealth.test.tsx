import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({ controls: { enabled: true }, raycaster: { ray: { intersectPlane: vi.fn() } } }),
}));
vi.mock('@react-three/drei', () => ({ Html: ({ children }: any) => <div>{children}</div> }));
vi.mock('../../HealthBar', () => ({ HealthBar: () => <div data-testid="health-bar" /> }));

import { EnemyRhombus, FriendlyRhombus, PlayerRhombus } from '../Rhombuses';
import { TokenWindow } from '../TokenWindow';
import { Sidebar, CharacterControlsMenu } from '../Sidebar';
import { StreamerOverlay } from '../StreamerOverlay';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * A custom system with token health turned off, in the windows (3b6d2): no health bar on the
 * map or on stream, no HIT_POINTS button, no MAX HEALTH to set, and no health panel in the
 * token window, whose HEALTH folder stays only for what the GM keeps there. All as today under
 * every built-in system and a custom one that kept token health. The server refuses health
 * actions there anyway (system_builder_parts_health.test.js).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const NOHEALTH = 'sys_aaaaaaaaaaaaaaaa';
const KEPT = 'sys_bbbbbbbbbbbbbbbb';
const BARE = 'sys_cccccccccccccccc';
const WITH_HEALTH = [...BUILT_INS, KEPT];

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: NOHEALTH, name: 'Hearth', parts: { token_health: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
  registerCustomTemplate({ id: KEPT, name: 'Kept', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
  // Neither health nor combat: nothing left to set in the character controls.
  registerCustomTemplate({ id: BARE, name: 'Bare', parts: { token_health: { on: false }, combat: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
});
afterEach(() => { cleanup(); clearCustomTemplates(); });

const socket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
const loc = (shape: string): any => ({ id: 1, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, name: 'X', color: '#00ff00', shape, hp_current: 10, hp_max: 10, hp_temp: 0, owner: 'GHOST' });

describe('the health bars on the map', () => {
  const bars = (gameSystem: string) => {
    const common = { onClick: vi.fn(), isSelected: false, setTargetObject: vi.fn(), refreshLocations: vi.fn(), setIsDragging: vi.fn(),
      socket: socket(), roads: [], isBattleMap: false, measureMode: false, gameSystem };
    render(<>
      <EnemyRhombus location={loc('enemy_rhombus')} token="gm" {...common} />
      <FriendlyRhombus location={loc('friendly_rhombus')} token="gm" userName="gm" {...common} />
      <PlayerRhombus location={loc('rhombus')} token="gm" userName="gm" activeUsers={[{ userName: 'GHOST' }]} {...common} />
    </>);
    const n = screen.queryAllByTestId('health-bar').length;
    cleanup();
    return n;
  };

  it('show on every token as today wherever the game has token health, and on none where it does not', () => {
    for (const system of WITH_HEALTH) expect(bars(system), system).toBe(3);
    expect(bars(NOHEALTH)).toBe(0);
  });
});

describe('the token window', () => {
  const read = (gameSystem: string, gmHealth?: any) => {
    render(<TokenWindow location={{ id: 9, name: 'Ghoul', shape: 'enemy_rhombus' }} title="ID.EXE" pos={{ x: 0, y: 0 }} setPos={vi.fn()}
      onClose={vi.fn()} portrait={null} description="" actions={[]} operator={null} socket={socket()}
      health={<div data-testid="health-panel" />} gmHealth={gmHealth} gameSystem={gameSystem} />);
    const tab = screen.queryByRole('tab', { name: 'HEALTH' });
    if (tab) fireEvent.click(tab);
    const out = { folder: !!tab, panel: screen.queryByTestId('health-panel') !== null };
    cleanup();
    return out;
  };
  const gm = { defense: { label: 'AC', melee: 12, ranged: null }, onSaveDefense: vi.fn() };

  it('shows the health panel as today wherever the game has token health', () => {
    for (const system of WITH_HEALTH) {
      expect(read(system), system).toEqual({ folder: true, panel: true });
      expect(read(system, gm), system).toEqual({ folder: true, panel: true });
    }
  });

  it('keeps the folder without the panel only for what the GM keeps there', () => {
    expect(read(NOHEALTH)).toEqual({ folder: false, panel: false });
    expect(read(NOHEALTH, gm)).toEqual({ folder: true, panel: false });
    // No combat either: the defense goes too, and the folder with it, unless initiative is in it.
    expect(read(BARE, gm)).toEqual({ folder: false, panel: false });
    expect(read(BARE, { ...gm, onAddToInit: vi.fn() })).toEqual({ folder: true, panel: false });
  });
});

describe('the sidebar', () => {
  const props = (gameSystem: string): any => ({
    activeMenu: null, setActiveMenu: vi.fn(), locations: [], onSelect: vi.fn(), onZoom: vi.fn(), selectedLocation: null,
    userName: 'GHOST', token: '', onLogout: vi.fn(), audioEnabled: false, setAudioEnabled: vi.fn(), masterVolume: 1,
    setMasterVolume: vi.fn(), musicVolume: 1, setMusicVolume: vi.fn(), rhombusState: { color: '#00ff00' }, setRhombusState: vi.fn(),
    refreshLocations: vi.fn(), socketRef: { current: socket() }, isChatOpen: false, setIsChatOpen: vi.fn(), hasUnreadChat: false,
    syncRhombusToDB: vi.fn(), view: 'list', activeBattleMapData: null, isHitPointsOpen: false, setIsHitPointsOpen: vi.fn(),
    activeUsers: [], setIsDiceTrayOpen: vi.fn(), setNotification: vi.fn(), measureMode: false, setMeasureMode: vi.fn(),
    isBankOpen: false, setIsBankOpen: vi.fn(), isSheetOpen: false, setIsSheetOpen: vi.fn(), gameSystem, activeCombats: [],
  });
  const hitPoints = (system: string) => {
    render(<Sidebar {...props(system)} />);
    const there = screen.queryByLabelText('HIT_POINTS') !== null;
    cleanup();
    return there;
  };
  const controls = (system: string) => {
    render(<CharacterControlsMenu {...props(system)} rhombusState={{ color: '#00ff00', hp_max: 10 }} locations={[]} />);
    const out = {
      maxHealth: screen.queryByText('MAX HEALTH') !== null,
      save: screen.queryByText('SAVE_STATS') !== null,
    };
    cleanup();
    return out;
  };

  it('has HIT_POINTS as today wherever the game has token health, and not where it does not', () => {
    for (const system of WITH_HEALTH) expect(hitPoints(system), system).toBe(true);
    expect(hitPoints(NOHEALTH)).toBe(false);
  });

  it('lets a player set MAX HEALTH only where the game has token health, and SAVE only with something to save', () => {
    for (const system of WITH_HEALTH) expect(controls(system), system).toEqual({ maxHealth: true, save: true });
    expect(controls(NOHEALTH)).toEqual({ maxHealth: false, save: true });
    expect(controls(BARE)).toEqual({ maxHealth: false, save: false });
  });
});

describe('the stream overlay', () => {
  const monitor = (gameSystem: string) => {
    render(<StreamerOverlay socket={socket()} directorState={{} as any} selectedLocation={loc('enemy_rhombus')} gameSystem={gameSystem} />);
    const there = document.querySelector('[data-band], .heart-monitor, svg polyline') !== null || screen.queryAllByText(/BPM|HEART/i).length > 0;
    cleanup();
    return there;
  };

  it('shows the heart monitor as today wherever the game has token health, and not where it does not', () => {
    for (const system of WITH_HEALTH) expect(monitor(system), system).toBe(true);
    expect(monitor(NOHEALTH)).toBe(false);
  });
});
