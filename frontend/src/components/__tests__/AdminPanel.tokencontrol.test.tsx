import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';

/**
 * Handing a friendly NPC to the players running it.
 *
 * The panel is the only way to set a grant, so these cover what it offers and what it
 * emits. The rule itself lives in utils/tokenControl and is tested against the server's
 * copy there; this is about the control being reachable, honest about its current state,
 * and impossible to point at a token that cannot carry it.
 */

const ACTIVE_USERS = [
  { userName: 'alice' },
  { userName: 'bob' },
  { userName: 'gm', isAdmin: true },
  { userName: 'GOON', isNPC: true },
];

let emit: ReturnType<typeof vi.fn>;

const baseProps = (): any => ({
  socketRef: { current: { emit, on: vi.fn(), off: vi.fn() } },
  token: 'admintoken',
  onLogout: vi.fn(), refreshLocations: vi.fn(), refreshRoads: vi.fn(),
  locations: [], roads: [], waterBodies: [],
  editData: {}, setEditData: vi.fn(), editId: 42, setEditId: vi.fn(),
  transformMode: 'translate', setTransformMode: vi.fn(), targetObject: null,
  blockBuildings: false, setBlockBuildings: vi.fn(),
  selectedLocation: null, setSelectedLocation: vi.fn(), setTargetObject: vi.fn(),
  isChatOpen: false, setIsChatOpen: vi.fn(), controlsRef: { current: null },
  view: 'editor', setView: vi.fn(),
  pendingRequests: [], setPendingRequests: vi.fn(),
  isBatchSelecting: false, setIsBatchSelecting: vi.fn(),
  selectedIds: [], setSelectedIds: vi.fn(), toggleSelection: vi.fn(), batchDelete: vi.fn(),
  districtSelection: [], setDistrictSelection: vi.fn(),
  districtConfig: { name: '', color: '#00ff00' }, setDistrictConfig: vi.fn(),
  districts: [], fetchDistricts: vi.fn(),
  editingDistrict: null, setEditingDistrict: vi.fn(),
  assigningDistrict: null, setAssigningDistrict: vi.fn(),
  joinSelection: null, setJoinSelection: vi.fn(),
  selectedClassification: '', setSelectedClassification: vi.fn(),
  roadSelectionBounds: null, onToggleHidden: vi.fn(),
  activeUsers: ACTIVE_USERS,
  globalSettings: {}, fetchGlobalSettings: vi.fn(),
  isAdmin: true, isPrimaryAdmin: true,
  editorGenParts: [], setEditorGenParts: vi.fn(),
});

beforeEach(() => {
  emit = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

const open = (editData: any, over: any = {}) => {
  const props = { ...baseProps(), editData, ...over };
  render(<AdminPanel {...props} />);
  return props;
};

const friendly = (over = {}) => ({ shape: 'friendly_rhombus', name: 'ALLY', ...over });
const controlEmits = () => emit.mock.calls.filter((c) => c[0] === 'setTokenControl');

describe('where the control appears', () => {
  it('is offered on a friendly NPC', () => {
    open(friendly());
    expect(screen.getByText('PLAYER_CONTROL')).toBeTruthy();
  });

  it('is not offered on an enemy', () => {
    // Enemies stay with the GM, and the server refuses a grant on one - so the panel
    // must not offer a control that would be rejected.
    open({ shape: 'enemy_rhombus', name: 'GOON' });
    expect(screen.queryByText('PLAYER_CONTROL')).toBeNull();
  });

  it('is not offered on a player token or a building', () => {
    for (const shape of ['rhombus', 'box']) {
      const { unmount } = render(<AdminPanel {...baseProps()} editData={{ shape, name: 'X' }} />);
      expect(screen.queryByText('PLAYER_CONTROL')).toBeNull();
      unmount();
    }
  });

  it('is not offered before the NPC has been saved', () => {
    // There is no id to grant against yet.
    open(friendly(), { editId: null });
    expect(screen.queryByText('PLAYER_CONTROL')).toBeNull();
  });

  it('says the admin keeps control', () => {
    open(friendly());
    expect(screen.getByText(/You keep control either way/i)).toBeTruthy();
  });
});

describe('who it offers', () => {
  it('lists players, not admins or NPCs', () => {
    open(friendly());
    expect(screen.getByLabelText('alice')).toBeTruthy();
    expect(screen.getByLabelText('bob')).toBeTruthy();
    expect(screen.queryByLabelText('gm')).toBeNull();
    expect(screen.queryByLabelText('GOON')).toBeNull();
  });

  it('keeps listing someone already granted who is now offline', () => {
    // Otherwise revoking them would mean waiting for them to log back in.
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['carol'] }) }));
    expect(screen.getByLabelText('carol')).toBeTruthy();
  });

  it('says so when there is nobody to name', () => {
    open(friendly(), { activeUsers: [] });
    expect(screen.getByText('NO PLAYERS ONLINE TO NAME.')).toBeTruthy();
  });
});

describe('what it shows and emits', () => {
  it('starts with nobody granted', () => {
    open(friendly());
    expect((screen.getByLabelText('ALL PLAYERS') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('alice') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/NOW: NOBODY — admin only/)).toBeTruthy();
  });

  it('reflects a grant that is already set', () => {
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['bob'] }) }));
    expect((screen.getByLabelText('bob') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('alice') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/NOW: bob/)).toBeTruthy();
  });

  it('grants one player', async () => {
    open(friendly());
    await userEvent.click(screen.getByLabelText('bob'));
    expect(controlEmits()).toHaveLength(1);
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: false, users: ['bob'] });
  });

  it('takes a player back off', async () => {
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['alice', 'bob'] }) }));
    await userEvent.click(screen.getByLabelText('bob'));
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: false, users: ['alice'] });
  });

  it('opens the token to everyone', async () => {
    open(friendly());
    await userEvent.click(screen.getByLabelText('ALL PLAYERS'));
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: true, users: [] });
  });

  it('keeps the named list while everyone is on, so turning it off restores them', async () => {
    // "specific players and/or all players" - the two are separate settings, and the
    // named list must survive the broader one being switched on and off.
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['bob'] }) }));
    await userEvent.click(screen.getByLabelText('ALL PLAYERS'));
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: true, users: ['bob'] });
  });

  it('greys out the individual names while everyone has it', () => {
    open(friendly({ controllers: JSON.stringify({ all: true, users: [] }) }));
    const alice = screen.getByLabelText('alice') as HTMLInputElement;
    expect(alice.checked).toBe(true);
    expect(alice.disabled).toBe(true);
  });

  it('writes the new grant back onto the form as well as sending it', async () => {
    // So the panel shows the change immediately rather than waiting for a round trip.
    const props = open(friendly());
    await userEvent.click(screen.getByLabelText('bob'));
    expect(props.setEditData).toHaveBeenCalledWith(
      expect.objectContaining({ controllers: JSON.stringify({ all: false, users: ['bob'] }) })
    );
  });
});
