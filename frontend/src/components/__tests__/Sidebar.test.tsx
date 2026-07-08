import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavControlsMenu, SystemInfoMenu, DiceMenu, QuickAccessMenu, GeometryMenu } from '../Sidebar';

vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));
vi.mock('../CityDatabase', () => ({
  CityDataBaseMenu: () => <div>CITY_DATA_BASE_MOCK</div>,
}));

const makeSocketRef = () => ({ current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } });

beforeEach(() => vi.clearAllMocks());

// ─── NavControlsMenu ─────────────────────────────────────────────────────────

describe('NavControlsMenu', () => {
  it('renders NAV_CONTROLS header', () => {
    render(<NavControlsMenu onToggleHelp={vi.fn()} />);
    expect(screen.getByText('NAV_CONTROLS')).toBeInTheDocument();
  });

  it('renders all four control entries', () => {
    render(<NavControlsMenu onToggleHelp={vi.fn()} />);
    expect(screen.getByText('GIMBALL / ROTATE')).toBeInTheDocument();
    expect(screen.getByText('PAN / MOVE VIEW')).toBeInTheDocument();
    expect(screen.getByText('ZOOM IN/OUT')).toBeInTheDocument();
    expect(screen.getByText('SPOT / PING LOCATION')).toBeInTheDocument();
  });

  it('calls onToggleHelp(false) on back button click', async () => {
    const onToggleHelp = vi.fn();
    render(<NavControlsMenu onToggleHelp={onToggleHelp} />);
    await userEvent.click(screen.getByText('◀'));
    expect(onToggleHelp).toHaveBeenCalledWith(false);
  });
});

// ─── SystemInfoMenu ───────────────────────────────────────────────────────────

describe('SystemInfoMenu', () => {
  it('renders operator name', () => {
    render(<SystemInfoMenu userName="GHOST" token="" />);
    expect(screen.getByText('GHOST')).toBeInTheDocument();
  });

  it('shows UNPRIVILEGED_USER when no token', () => {
    render(<SystemInfoMenu userName="GHOST" token="" />);
    expect(screen.getByText('UNPRIVILEGED_USER')).toBeInTheDocument();
  });

  it('shows ADMIN_PRIVILEGES when token present', () => {
    render(<SystemInfoMenu userName="GHOST" token="sometoken" />);
    expect(screen.getByText('ADMIN_PRIVILEGES')).toBeInTheDocument();
  });
});

// ─── DiceMenu ─────────────────────────────────────────────────────────────────

describe('DiceMenu', () => {
  it('renders DICE_ROLLER header', () => {
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} />);
    expect(screen.getByText('DICE_ROLLER')).toBeInTheDocument();
  });

  it('renders all 8 dice types', () => {
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} />);
    [2, 4, 6, 8, 10, 12, 20, 100].forEach(d => {
      expect(screen.getByText(`d${d}`)).toBeInTheDocument();
    });
  });

  it('increments dice count on + click', async () => {
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} />);
    const plusBtns = screen.getAllByText('+');
    await userEvent.click(plusBtns[0]); // d2
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('sets notification when rolling with no dice selected', async () => {
    const setNotification = vi.fn();
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={setNotification} />);
    await userEvent.click(screen.getByText('ROLL DICE'));
    expect(setNotification).toHaveBeenCalledWith('INVALID_ROLL: SELECT_DICE');
  });

  it('emits requestDiceRoll and opens tray after rolling', async () => {
    const socketRef = makeSocketRef();
    const setIsDiceTrayOpen = vi.fn();
    render(<DiceMenu userName="GHOST" socketRef={socketRef} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={setIsDiceTrayOpen} setNotification={vi.fn()} />);
    await userEvent.click(screen.getAllByText('+')[0]); // add a d2
    await userEvent.click(screen.getByText('ROLL DICE'));
    expect(socketRef.current.emit).toHaveBeenCalledWith('requestDiceRoll', expect.objectContaining({ userName: 'GHOST' }));
    expect(setIsDiceTrayOpen).toHaveBeenCalledWith(true);
  });

  it('shows NO MODIFIERS by default', () => {
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} />);
    expect(screen.getByText('NO MODIFIERS')).toBeInTheDocument();
  });

  it('adds modifier on ADD click', async () => {
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} />);
    const modPlusBtns = screen.getAllByText('+');
    await userEvent.click(modPlusBtns[modPlusBtns.length - 1]); // modifier +1 btn in modifier section
    await userEvent.click(screen.getByText('ADD'));
    expect(screen.queryByText('NO MODIFIERS')).not.toBeInTheDocument();
  });

  it('toggles dice tray on DICE_TRAY.exe click', async () => {
    const setIsDiceTrayOpen = vi.fn();
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={setIsDiceTrayOpen} setNotification={vi.fn()} />);
    await userEvent.click(screen.getByText('DICE_TRAY.exe'));
    expect(setIsDiceTrayOpen).toHaveBeenCalled();
  });

  // ─── Attack banner ────────────────────────────────────────────────────────

  it('shows no attack banner when attackPending is undefined', () => {
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} />);
    expect(screen.queryByText(/ATTACK ROLL/)).toBeNull();
    expect(screen.queryByText('CANCEL ATTACK')).toBeNull();
  });

  it('shows attack banner with target name when attackPending is set', () => {
    const pending = { targetId: 1, targetName: 'ENEMY_NODE', attackType: 'melee' as const, ac: 14 };
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.getByText(/ATTACK ROLL — vs ENEMY_NODE/)).toBeInTheDocument();
  });

  it('shows attack type, AC and roll threshold to admins', () => {
    const pending = { targetId: 2, targetName: 'BRUTE', attackType: 'ranged' as const, ac: 16 };
    render(<DiceMenu userName="GHOST" token="admin-token" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.getByText(/RANGED/)).toBeInTheDocument();
    expect(screen.getByText(/AC 16/)).toBeInTheDocument();
    expect(screen.getByText(/Roll 16\+ to hit/)).toBeInTheDocument();
  });

  it('hides AC and roll threshold from non-admin players', () => {
    const pending = { targetId: 2, targetName: 'BRUTE', attackType: 'ranged' as const, ac: 16 };
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.getByText(/RANGED/)).toBeInTheDocument();
    expect(screen.queryByText(/AC 16/)).toBeNull();
    expect(screen.queryByText(/Roll 16\+ to hit/)).toBeNull();
  });

  it('renders CANCEL ATTACK button when attackPending is set', () => {
    const pending = { targetId: 3, targetName: 'SHADOW', attackType: 'melee' as const, ac: 12 };
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.getByText('CANCEL ATTACK')).toBeInTheDocument();
  });

  it('emits cancelAttack and calls onCancelAttack on cancel click', async () => {
    const socketRef = makeSocketRef();
    const onCancelAttack = vi.fn();
    const pending = { targetId: 4, targetName: 'GHOST_TARGET', attackType: 'melee' as const, ac: 10 };
    render(<DiceMenu userName="GHOST" socketRef={socketRef} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} onCancelAttack={onCancelAttack} />);
    await userEvent.click(screen.getByText('CANCEL ATTACK'));
    expect(socketRef.current.emit).toHaveBeenCalledWith('cancelAttack');
    expect(onCancelAttack).toHaveBeenCalled();
  });

  it('rolling dice with a pending attack still emits requestDiceRoll', async () => {
    const socketRef = makeSocketRef();
    const pending = { targetId: 5, targetName: 'TARGET', attackType: 'melee' as const, ac: 13 };
    render(<DiceMenu userName="GHOST" socketRef={socketRef} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    await userEvent.click(screen.getAllByText('+')[0]); // add a d2
    await userEvent.click(screen.getByText('ROLL DICE'));
    expect(socketRef.current.emit).toHaveBeenCalledWith('requestDiceRoll', expect.objectContaining({ userName: 'GHOST' }));
  });

  it('shows MELEE attack type in banner', () => {
    const pending = { targetId: 6, targetName: 'GRUNT', attackType: 'melee' as const, ac: 11 };
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.getByText(/MELEE/)).toBeInTheDocument();
  });

  it('banner does not appear when different target is pending (no cross-contamination)', () => {
    const pending = { targetId: 99, targetName: 'OTHER', attackType: 'melee' as const, ac: 10 };
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.queryByText(/ENEMY_NODE/)).toBeNull();
    expect(screen.getByText(/OTHER/)).toBeInTheDocument();
  });

  it('onCancelAttack is optional — no crash when undefined and cancel clicked', async () => {
    const socketRef = makeSocketRef();
    const pending = { targetId: 7, targetName: 'MOOK', attackType: 'ranged' as const, ac: 15 };
    render(<DiceMenu userName="GHOST" socketRef={socketRef} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    await expect(userEvent.click(screen.getByText('CANCEL ATTACK'))).resolves.not.toThrow();
    expect(socketRef.current.emit).toHaveBeenCalledWith('cancelAttack');
  });
});

// ─── QuickAccessMenu ──────────────────────────────────────────────────────────

const makeLocation = (overrides = {}): any => ({
  id: 1, name: 'GHOST_HQ', shape: 'box', x: 0, y: 0, z: 0, width: 2, height: 2, depth: 2,
  isDanger: false, isFavorite: false, district_name: null, parent_id: null, battle_map_id: null,
  description: 'Some desc',
  ...overrides,
});

describe('QuickAccessMenu', () => {
  it('renders QUICK_ACCESS header', () => {
    render(<QuickAccessMenu locations={[]} onSelect={vi.fn()} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={vi.fn()} view="list" activeUsers={[]} />);
    expect(screen.getByText('QUICK_ACCESS')).toBeInTheDocument();
  });

  it('shows NO_DEFINED_DATA_POINTS when empty', () => {
    render(<QuickAccessMenu locations={[]} onSelect={vi.fn()} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={vi.fn()} view="list" activeUsers={[]} />);
    expect(screen.getByText('NO_DEFINED_DATA_POINTS')).toBeInTheDocument();
  });

  it('shows DEFINED_STRUCTURES section for named locations', async () => {
    const locs = [makeLocation()];
    render(<QuickAccessMenu locations={locs} onSelect={vi.fn()} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={vi.fn()} view="list" activeUsers={[]} />);
    expect(screen.getByText(/DEFINED_STRUCTURES/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/DEFINED_STRUCTURES/));
    expect(screen.getByText('GHOST_HQ')).toBeInTheDocument();
  });

  it('shows CRITICAL_SITES for danger locations', async () => {
    const locs = [makeLocation({ isDanger: true })];
    render(<QuickAccessMenu locations={locs} onSelect={vi.fn()} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={vi.fn()} view="list" activeUsers={[]} />);
    expect(screen.getByText(/CRITICAL_SITES/)).toBeInTheDocument();
  });

  it('shows PRIORITY_NODES for starred locations', async () => {
    const locs = [makeLocation({ isFavorite: true })];
    render(<QuickAccessMenu locations={locs} onSelect={vi.fn()} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={vi.fn()} view="list" activeUsers={[]} />);
    expect(screen.getByText(/PRIORITY_NODES/)).toBeInTheDocument();
  });

  it('calls setIsOpen(false) on back button', async () => {
    const setIsOpen = vi.fn();
    render(<QuickAccessMenu locations={[]} onSelect={vi.fn()} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={setIsOpen} view="list" activeUsers={[]} />);
    await userEvent.click(screen.getByText('◀'));
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it('calls onSelect when a location is clicked', async () => {
    const onSelect = vi.fn();
    const locs = [makeLocation()];
    render(<QuickAccessMenu locations={locs} onSelect={onSelect} onZoom={vi.fn()} selectedLocation={null} isOpen={true} setIsOpen={vi.fn()} view="list" activeUsers={[]} />);
    await userEvent.click(screen.getByText(/DEFINED_STRUCTURES/));
    await userEvent.click(screen.getByText('GHOST_HQ'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});

// ─── GeometryMenu ─────────────────────────────────────────────────────────────

const baseRhombus = { active: false, color: '#00ff00', name: '', description: '', hp_max: 0 };

describe('GeometryMenu', () => {
  it('renders TOKEN_PROTOCOLS header', () => {
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('TOKEN_PROTOCOLS')).toBeInTheDocument();
  });

  it('shows PLACE_MY_TOKEN when no active rhombus', () => {
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('PLACE_MY_TOKEN')).toBeInTheDocument();
  });

  it('shows TOKEN_PLACED when user has deployed rhombus', () => {
    const locations = [{ id: 10, shape: 'rhombus', owner: 'GHOST', battle_map_id: null, x: 0, y: 0, z: 0 }];
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={locations} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('TOKEN_PLACED')).toBeInTheDocument();
  });

  it('shows REMOVE_MY_TOKEN button when rhombus is active', () => {
    const locations = [{ id: 10, shape: 'rhombus', owner: 'GHOST', battle_map_id: null, x: 0, y: 0, z: 0 }];
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={locations} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('REMOVE_MY_TOKEN')).toBeInTheDocument();
  });

  it('emits requestRhombusPurge on remove click', async () => {
    const socketRef = makeSocketRef();
    const locations = [{ id: 10, shape: 'rhombus', owner: 'GHOST', battle_map_id: null, x: 0, y: 0, z: 0 }];
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={locations} socketRef={socketRef} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    await userEvent.click(screen.getByText('REMOVE_MY_TOKEN'));
    expect(socketRef.current.emit).toHaveBeenCalledWith('requestRhombusPurge', expect.objectContaining({ id: 10 }));
  });

  it('calls syncRhombusToDB when SAVE_TOKEN_SETTINGS button is clicked', async () => {
    const syncRhombusToDB = vi.fn();
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={syncRhombusToDB} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    await userEvent.click(screen.getByText('SAVE_TOKEN_SETTINGS'));
    expect(syncRhombusToDB).toHaveBeenCalled();
  });

  it('shows ARMOR_CLASS label', () => {
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('ARMOR_CLASS')).toBeInTheDocument();
  });

  it('shows MELEE and RANGED AC inputs', () => {
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('MELEE')).toBeInTheDocument();
    expect(screen.getByText('RANGED')).toBeInTheDocument();
  });

  it('AC fields are visible even with no deployed rhombus', () => {
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('ARMOR_CLASS')).toBeInTheDocument();
    expect(screen.getByText('MELEE')).toBeInTheDocument();
  });

  it('shows CLICK MAP TO PLACE label when rhombus is in active/scanning state', () => {
    render(
      <GeometryMenu rhombusState={{ ...baseRhombus, active: true }} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('CLICK MAP TO PLACE')).toBeInTheDocument();
    expect(screen.getByText('place user token')).toBeInTheDocument();
  });

  it('shows PLACE_MY_TOKEN when inactive and no deployed rhombus', () => {
    render(
      <GeometryMenu rhombusState={baseRhombus} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={makeSocketRef()} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} />
    );
    expect(screen.getByText('PLACE_MY_TOKEN')).toBeInTheDocument();
  });
});

// ─── Attack result banner (hit/miss message) ──────────────────────────────────
// Tested via DiceMenu since that's where the banner renders in the sidebar.
// The banner must not expose the target's AC — only the roll value.

describe('Attack result banner AC visibility', () => {
  it('admin pending banner shows AC; non-admin does not', () => {
    const pending = { targetId: 1, targetName: 'TARGET', attackType: 'melee' as const, ac: 18 };

    // Admin sees AC
    const { unmount } = render(<DiceMenu userName="GHOST" token="admin-token" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.getByText(/AC 18/)).toBeInTheDocument();
    expect(screen.queryByText(/rolled/)).toBeNull();
    unmount();

    // Non-admin does not see AC
    render(<DiceMenu userName="GHOST" socketRef={makeSocketRef()} rhombusState={{ color: '#0f0' }} setIsDiceTrayOpen={vi.fn()} setNotification={vi.fn()} attackPending={pending} />);
    expect(screen.queryByText(/AC 18/)).toBeNull();
    expect(screen.queryByText(/rolled/)).toBeNull();
  });
});
