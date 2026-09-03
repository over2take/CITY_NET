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

  it('is offered while placing a new NPC too', () => {
    // There is no id yet, so the grant rides on the form and is applied by the create.
    open(friendly(), { editId: null });
    expect(screen.getByText('PLAYER_CONTROL')).toBeTruthy();
    expect(screen.getByText(/applied when the NPC is placed/i)).toBeTruthy();
  });

  it('does not say "applied when placed" once the NPC exists', () => {
    open(friendly());
    expect(screen.queryByText(/applied when the NPC is placed/i)).toBeNull();
  });

  it('says the admin keeps control', () => {
    open(friendly());
    expect(screen.getByText(/You keep control either way/i)).toBeTruthy();
  });
});

describe('who it offers', () => {
  const optionsOf = () =>
    [...(screen.getByLabelText('Grant control') as HTMLSelectElement).options]
      .map((o) => o.textContent);

  it('always offers ALL PLAYERS first', () => {
    // Ahead of every name, whoever happens to be online and however they sort.
    open(friendly());
    expect(optionsOf()).toEqual(['+ GRANT…', 'ALL PLAYERS', 'alice', 'bob']);
  });

  it('offers players, not admins or NPCs', () => {
    open(friendly());
    expect(optionsOf()).not.toContain('gm');
    expect(optionsOf()).not.toContain('GOON');
  });

  it('stops offering someone already granted', () => {
    // The list narrows as you grant, so nobody can be added twice.
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['bob'] }) }));
    expect(optionsOf()).toEqual(['+ GRANT…', 'ALL PLAYERS', 'alice']);
  });

  it('stops offering ALL PLAYERS once it is on', () => {
    open(friendly({ controllers: JSON.stringify({ all: true, users: [] }) }));
    expect(optionsOf()).toEqual(['+ GRANT…', 'alice', 'bob']);
  });

  it('still reaches someone granted who is now offline', () => {
    // Not in the dropdown - they are already granted - but revocable as a chip.
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['carol'] }) }));
    expect(screen.getByLabelText('Revoke carol')).toBeTruthy();
  });

  it('closes itself when there is nobody left to grant', () => {
    open(friendly({ controllers: JSON.stringify({ all: true, users: ['alice', 'bob'] }) }));
    const select = screen.getByLabelText('Grant control') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options[0].textContent).toBe('EVERYONE GRANTED');
  });

  it('offers only ALL PLAYERS when no players are online', () => {
    open(friendly(), { activeUsers: [] });
    expect(optionsOf()).toEqual(['+ GRANT…', 'ALL PLAYERS']);
  });
});

describe('what it shows and emits', () => {
  const grantVia = async (value: string) =>
    userEvent.selectOptions(screen.getByLabelText('Grant control'), value);

  it('starts with nobody granted', () => {
    open(friendly());
    expect(screen.getByText('NOBODY GRANTED')).toBeTruthy();
    expect(screen.getByText(/NOW: NOBODY — admin only/)).toBeTruthy();
  });

  it('shows a chip for each player who has it', () => {
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['bob'] }) }));
    expect(screen.getByLabelText('Revoke bob')).toBeTruthy();
    expect(screen.queryByLabelText('Revoke alice')).toBeNull();
    expect(screen.getByText(/NOW: bob/)).toBeTruthy();
  });

  it('grants one player', async () => {
    open(friendly());
    await grantVia('bob');
    expect(controlEmits()).toHaveLength(1);
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: false, users: ['bob'] });
  });

  it('grants everyone', async () => {
    open(friendly());
    await grantVia('*');
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: true, users: [] });
  });

  it('revokes one player from their chip', async () => {
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['alice', 'bob'] }) }));
    await userEvent.click(screen.getByLabelText('Revoke bob'));
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: false, users: ['alice'] });
  });

  it('keeps the named players when everyone is granted', async () => {
    // "specific players and/or all players" - the two are separate, and the named list
    // must survive the broader one going on.
    open(friendly({ controllers: JSON.stringify({ all: false, users: ['bob'] }) }));
    await grantVia('*');
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: true, users: ['bob'] });
  });

  it('gives the names back when ALL PLAYERS is revoked', async () => {
    open(friendly({ controllers: JSON.stringify({ all: true, users: ['bob'] }) }));
    await userEvent.click(screen.getByLabelText('Revoke ALL PLAYERS'));
    expect(controlEmits()[0][1]).toEqual({ id: 42, all: false, users: ['bob'] });
  });

  it('shows ALL PLAYERS as its own chip', () => {
    open(friendly({ controllers: JSON.stringify({ all: true, users: [] }) }));
    expect(screen.getByLabelText('Revoke ALL PLAYERS')).toBeTruthy();
  });

  it('writes the new grant back onto the form as well as sending it', async () => {
    // So the panel shows the change immediately rather than waiting for a round trip.
    const props = open(friendly());
    await grantVia('bob');
    expect(props.setEditData).toHaveBeenCalledWith(
      expect.objectContaining({ controllers: JSON.stringify({ all: false, users: ['bob'] }) })
    );
  });
});

describe('granting while placing a new NPC', () => {
  const placing = (over: any = {}) => open(friendly(), { editId: null, ...over });

  it('stages the grant on the form instead of sending it', async () => {
    // Nothing to send it about yet - emitting with a null id would be a no-op the admin
    // could not see, and the grant would be silently lost on save.
    const props = placing();
    await userEvent.selectOptions(screen.getByLabelText('Grant control'), 'bob');

    expect(props.setEditData).toHaveBeenCalledWith(
      expect.objectContaining({ controllers: JSON.stringify({ all: false, users: ['bob'] }) })
    );
    expect(controlEmits()).toHaveLength(0);
  });

  it('offers the same choices as it does on an existing NPC', () => {
    placing();
    const options = [...(screen.getByLabelText('Grant control') as HTMLSelectElement).options]
      .map((o) => o.textContent);
    expect(options).toEqual(['+ GRANT…', 'ALL PLAYERS', 'alice', 'bob']);
  });

  it('shows a staged grant back as a chip', () => {
    placing({ editData: { ...friendly(), controllers: JSON.stringify({ all: true, users: [] }) } });
    expect(screen.getByLabelText('Revoke ALL PLAYERS')).toBeTruthy();
  });
});

describe('the staged grant survives the save', () => {
  /**
   * The wiring, not the control. A grant chosen while placing an NPC has no id to attach
   * to, so it rides on the form and is applied once the create hands one back - through
   * the same admin-only socket handler an edit uses, rather than riding in on the insert.
   */
  const targetObject: any = {
    position: { x: 1, y: 0, z: 2 },
    scale: { x: 1, y: 1, z: 1, set: vi.fn() },
    rotation: { x: 0, y: 0, z: 0, set: vi.fn() },
  };

  const place = async (editData: any, created: any = { data: [{ id: 99 }] }) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.stubGlobal('fetch', fetchMock);
    const props = {
      ...baseProps(), editData, editId: null, targetObject,
      view: 'editor', editorGenParts: [],
    };
    render(<AdminPanel {...props} />);
    const label = editData.shape === 'enemy_rhombus' ? 'UPLOAD_NEW_ENEMY' : 'UPLOAD_NEW_FRIENDLY';
    await userEvent.click(screen.getByText(label));
    return { fetchMock, props };
  };

  it('applies it to the NPC that was just created', async () => {
    await place(friendly({ controllers: JSON.stringify({ all: false, users: ['bob'] }) }));
    expect(controlEmits()).toHaveLength(1);
    expect(controlEmits()[0][1]).toEqual({ id: 99, all: false, users: ['bob'] });
  });

  it('carries ALL PLAYERS across too', async () => {
    await place(friendly({ controllers: JSON.stringify({ all: true, users: ['bob'] }) }));
    expect(controlEmits()[0][1]).toEqual({ id: 99, all: true, users: ['bob'] });
  });

  it('sends nothing when nothing was granted', async () => {
    await place(friendly());
    expect(controlEmits()).toHaveLength(0);
  });

  it('sends nothing if the create came back without an id', async () => {
    // Rather than emitting against undefined, which the server would ignore anyway but
    // which would look like the grant had been applied.
    await place(friendly({ controllers: JSON.stringify({ all: true, users: [] }) }), { data: [] });
    expect(controlEmits()).toHaveLength(0);
  });

  it('does not grant on a shape that cannot carry one', async () => {
    await place({ shape: 'enemy_rhombus', name: 'GOON', controllers: JSON.stringify({ all: true, users: [] }) });
    expect(controlEmits()).toHaveLength(0);
  });
});
