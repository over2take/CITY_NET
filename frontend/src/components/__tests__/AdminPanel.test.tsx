import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';

const makeSocketRef = () => ({ current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } });

const baseProps = (): any => ({
  socketRef: makeSocketRef(),
  token: 'admintoken',
  onLogout: vi.fn(),
  refreshLocations: vi.fn(),
  refreshRoads: vi.fn(),
  locations: [],
  roads: [],
  editData: {},
  setEditData: vi.fn(),
  editId: null,
  setEditId: vi.fn(),
  transformMode: 'translate',
  setTransformMode: vi.fn(),
  targetObject: null,
  blockBuildings: false,
  setBlockBuildings: vi.fn(),
  selectedLocation: null,
  setSelectedLocation: vi.fn(),
  setTargetObject: vi.fn(),
  isChatOpen: false,
  setIsChatOpen: vi.fn(),
  controlsRef: { current: null },
  view: 'list',
  setView: vi.fn(),
  pendingRequests: [],
  setPendingRequests: vi.fn(),
  isBatchSelecting: false,
  setIsBatchSelecting: vi.fn(),
  selectedIds: [],
  setSelectedIds: vi.fn(),
  toggleSelection: vi.fn(),
  batchDelete: vi.fn(),
  districtSelection: null,
  setDistrictSelection: vi.fn(),
  districtConfig: {},
  setDistrictConfig: vi.fn(),
  districts: [],
  fetchDistricts: vi.fn(),
  editingDistrict: null,
  setEditingDistrict: vi.fn(),
  joinSelection: null,
  setJoinSelection: vi.fn(),
  selectedClassification: '',
  setSelectedClassification: vi.fn(),
  roadSelectionBounds: null,
  setRoadSelectionBounds: vi.fn(),
  roadTrail: [],
  setRoadTrail: vi.fn(),
  waterTrail: [],
  setWaterTrail: vi.fn(),
  fetchWaterBodies: vi.fn(),
  roadDrawMode: 'freehand',
  setRoadDrawMode: vi.fn(),
  snapToGrid: false,
  setSnapToGrid: vi.fn(),
  snapRotation: false,
  setSnapRotation: vi.fn(),
  drawingRoadWidth: 2,
  setDrawingRoadWidth: vi.fn(),
  isGeneratingMap: false,
  setIsGeneratingMap: vi.fn(),
  citySectionType: 'SLUMS',
  setCitySectionType: vi.fn(),
  genExcludeRoads: false,
  setGenExcludeRoads: vi.fn(),
  setRhombusState: vi.fn(),
  setActiveSidebarMenu: vi.fn(),
  editorGenParts: 1,
  setEditorGenParts: vi.fn(),
  editorGenType: 'box',
  setEditorGenType: vi.fn(),
  editorStyleIndex: 0,
  setEditorStyleIndex: vi.fn(),
  isCopyingSize: false,
  setIsCopyingSize: vi.fn(),
  isAdmin: true,
  isPrimaryAdmin: false,
  setShowBattleMapManager: vi.fn(),
  isPlantingTrees: false,
  setIsPlantingTrees: vi.fn(),
  treeBatchSize: 5,
  setTreeBatchSize: vi.fn(),
  userName: 'ADMIN',
  isDeployingEnemy: false,
  setIsDeployingEnemy: vi.fn(),
  isDeployingFriendly: false,
  setIsDeployingFriendly: vi.fn(),
  handleSaveDefault: vi.fn(),
  handleLoadDefault: vi.fn(),
  tempCityMapScale: null,
  setTempCityMapScale: vi.fn(),
  globalSettings: {},
  fetchGlobalSettings: vi.fn(),
  tempBattleMapScale: null,
  setTempBattleMapScale: vi.fn(),
  activeBattleMapData: null,
  setIsAdminPayOpen: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

// ─── list view ────────────────────────────────────────────────────────────────

describe('AdminPanel list view', () => {
  it('renders without crashing', () => {
    expect(() => render(<AdminPanel {...baseProps()} />)).not.toThrow();
  });

  it('shows EXIT_ADMIN_MODE button', () => {
    render(<AdminPanel {...baseProps()} />);
    expect(screen.getByText('EXIT_ADMIN_MODE')).toBeInTheDocument();
  });

  it('calls onLogout when EXIT_ADMIN_MODE is clicked', async () => {
    const props = baseProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('EXIT_ADMIN_MODE'));
    expect(props.onLogout).toHaveBeenCalled();
  });

  it('shows PAY_PLAYERS button', () => {
    render(<AdminPanel {...baseProps()} />);
    expect(screen.getByText('PAY_PLAYERS')).toBeInTheDocument();
  });

  it('calls setIsAdminPayOpen when PAY_PLAYERS is clicked', async () => {
    const props = baseProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('PAY_PLAYERS'));
    expect(props.setIsAdminPayOpen).toHaveBeenCalledWith(true);
  });

  it('shows SAVE_DEFAULT and LOAD_DEFAULT buttons in battle_map view', () => {
    render(<AdminPanel {...baseProps()} view="battle_map" />);
    expect(screen.getByText('SAVE_DEFAULT')).toBeInTheDocument();
    expect(screen.getByText('LOAD_DEFAULT')).toBeInTheDocument();
  });
});

// ─── battle_map view ──────────────────────────────────────────────────────────

describe('AdminPanel battle_map view', () => {
  it('renders BATTLE ADMIN heading', () => {
    render(<AdminPanel {...baseProps()} view="battle_map" />);
    expect(screen.getByText('BATTLE ADMIN')).toBeInTheDocument();
  });

  it('shows ADD_ENEMY and ADD_FRIENDLY buttons', () => {
    render(<AdminPanel {...baseProps()} view="battle_map" />);
    expect(screen.getByText('ADD_ENEMY')).toBeInTheDocument();
    expect(screen.getByText('ADD_FRIENDLY')).toBeInTheDocument();
  });

  it('toggles ADD_ENEMY to CANCEL_DEPLOY on click', async () => {
    const props = baseProps();
    render(<AdminPanel {...props} view="battle_map" />);
    await userEvent.click(screen.getByText('ADD_ENEMY'));
    expect(props.setIsDeployingEnemy).toHaveBeenCalledWith(true);
  });

  it('shows MAP SCALE label', () => {
    render(<AdminPanel {...baseProps()} view="battle_map" />);
    expect(screen.getByText(/MAP SCALE/)).toBeInTheDocument();
  });
});

// ─── draw_roads view ──────────────────────────────────────────────────────────

describe('AdminPanel draw_roads view', () => {
  it('renders without crashing', () => {
    expect(() => render(<AdminPanel {...baseProps()} view="draw_roads" />)).not.toThrow();
  });
});

describe('AdminPanel list view road tools', () => {
  it('shows PURGE_ROADS button in list view', () => {
    render(<AdminPanel {...baseProps()} view="list" />);
    expect(screen.getByText('PURGE_ROADS')).toBeInTheDocument();
  });
});

// ─── pending requests ─────────────────────────────────────────────────────────

const makePendingRequest = () => ({ userId: 'user-99', userName: 'GHOST', locationId: 42, locationName: '' });

describe('AdminPanel pending requests', () => {
  it('shows APPROVE and DENY for pending requests', () => {
    const props = baseProps();
    props.pendingRequests = [makePendingRequest()];
    render(<AdminPanel {...props} />);
    expect(screen.getByText('APPROVE')).toBeInTheDocument();
    expect(screen.getByText('DENY')).toBeInTheDocument();
  });

  it('emits approveEditing on APPROVE click', async () => {
    const props = baseProps();
    props.pendingRequests = [makePendingRequest()];
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('APPROVE'));
    expect(props.socketRef.current.emit).toHaveBeenCalledWith('approveEditing', expect.objectContaining({ userId: 'user-99' }));
  });

  it('emits denyEditing on DENY click', async () => {
    const props = baseProps();
    props.pendingRequests = [makePendingRequest()];
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('DENY'));
    expect(props.socketRef.current.emit).toHaveBeenCalledWith('denyEditing', expect.objectContaining({ userId: 'user-99' }));
  });
});
