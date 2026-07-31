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

  it('shows PAY_PLAYERS button on game tab', async () => {
    render(<AdminPanel {...baseProps()} />);
    await userEvent.click(screen.getByText('GAME'));
    expect(screen.getByText('PAY_PLAYERS')).toBeInTheDocument();
  });

  it('calls setIsAdminPayOpen when PAY_PLAYERS is clicked', async () => {
    const props = baseProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GAME'));
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
  it('shows APPROVE and DENY for pending requests on players tab', async () => {
    const props = baseProps();
    props.pendingRequests = [makePendingRequest()];
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('PLAYERS'));
    expect(screen.getByText('APPROVE')).toBeInTheDocument();
    expect(screen.getByText('DENY')).toBeInTheDocument();
  });

  it('emits approveEditing on APPROVE click', async () => {
    const props = baseProps();
    props.pendingRequests = [makePendingRequest()];
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('PLAYERS'));
    await userEvent.click(screen.getByText('APPROVE'));
    expect(props.socketRef.current.emit).toHaveBeenCalledWith('approveEditing', expect.objectContaining({ userId: 'user-99' }));
  });

  it('emits denyEditing on DENY click', async () => {
    const props = baseProps();
    props.pendingRequests = [makePendingRequest()];
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('PLAYERS'));
    await userEvent.click(screen.getByText('DENY'));
    expect(props.socketRef.current.emit).toHaveBeenCalledWith('denyEditing', expect.objectContaining({ userId: 'user-99' }));
  });
});

// ─── map export ───────────────────────────────────────────────────────────────

const exportProps = (over: any = {}) => ({
  ...baseProps(),
  view: 'list',
  onExportPng: vi.fn(),
  onStartRecording: vi.fn(),
  onStopRecording: vi.fn(),
  isRecording: false,
  isExporting: false,
  ...over,
});

/** Export lives on its own admin tab now; select it before touching its controls. */
const openExport = async () => {
  await userEvent.click(screen.getByText('EXPORT'));
};

describe('AdminPanel map export', () => {
  it('offers an EXPORT tab', () => {
    render(<AdminPanel {...exportProps()} />);
    expect(screen.getByText('EXPORT')).toBeInTheDocument();
  });

  it('keeps the controls off the city tab', () => {
    // They used to sit at the bottom of CITY; the tab exists so they no longer do.
    render(<AdminPanel {...exportProps()} />);
    expect(screen.queryByText('EXPORT_PNG')).not.toBeInTheDocument();
  });

  it('shows the controls on the export tab', async () => {
    render(<AdminPanel {...exportProps()} />);
    await openExport();
    expect(screen.getByText('EXPORT_PNG')).toBeInTheDocument();
    expect(screen.getByText('RECORD_MAP')).toBeInTheDocument();
  });

  it('shows nothing on the export tab when no handler is wired', async () => {
    const props = baseProps();
    props.view = 'list';
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('EXPORT'));
    expect(screen.queryByText('EXPORT_PNG')).not.toBeInTheDocument();
  });

  it('defaults both toggles off so exports never leak hidden geometry', async () => {
    render(<AdminPanel {...exportProps()} />);
    await openExport();
    expect(screen.getByLabelText('INCLUDE_HIDDEN')).not.toBeChecked();
    expect(screen.getByLabelText('INCLUDE_TOKENS')).not.toBeChecked();
  });

  it('exports with both toggles off by default', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(
      expect.objectContaining({ includeHidden: false, includeTokens: false }),
    );
  });

  it('defaults the PNG width to 2048', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(expect.objectContaining({ width: 2048 }));
  });

  it('offers every selectable width', async () => {
    render(<AdminPanel {...exportProps()} />);
    await openExport();
    const select = screen.getByLabelText(/RESOLUTION/) as HTMLSelectElement;
    expect([...select.options].map(o => Number(o.value))).toEqual([1920, 2048, 4096, 8192]);
    // Labelled by the familiar tier, with the pixel width spelled out beside it.
    expect(select.options[0].textContent).toContain('1080P');
    expect(select.options[2].textContent).toContain('4K');
  });

  it('passes the chosen width through to the export', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.selectOptions(screen.getByLabelText(/RESOLUTION/), '4096');
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(expect.objectContaining({ width: 4096 }));
  });

  it('passes INCLUDE_HIDDEN through once enabled', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.click(screen.getByLabelText('INCLUDE_HIDDEN'));
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(
      expect.objectContaining({ includeHidden: true, includeTokens: false }),
    );
  });

  it('passes INCLUDE_TOKENS through once enabled', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.click(screen.getByLabelText('INCLUDE_TOKENS'));
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(
      expect.objectContaining({ includeHidden: false, includeTokens: true }),
    );
  });

  it('passes the toggles to recording as well', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.click(screen.getByLabelText('INCLUDE_TOKENS'));
    await userEvent.click(screen.getByText('RECORD_MAP'));
    expect(props.onStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ includeHidden: false, includeTokens: true }),
    );
  });

  it('swaps RECORD_MAP for STOP_RECORDING while recording', async () => {
    render(<AdminPanel {...exportProps({ isRecording: true })} />);
    await openExport();
    expect(screen.getByText('STOP_RECORDING')).toBeInTheDocument();
    expect(screen.queryByText('RECORD_MAP')).not.toBeInTheDocument();
  });

  it('stops recording on STOP_RECORDING click', async () => {
    const props = exportProps({ isRecording: true });
    render(<AdminPanel {...props} />);
    await openExport();
    await userEvent.click(screen.getByText('STOP_RECORDING'));
    expect(props.onStopRecording).toHaveBeenCalled();
  });

  it('disables PNG export while recording, since both mutate scene visibility', async () => {
    render(<AdminPanel {...exportProps({ isRecording: true })} />);
    await openExport();
    expect(screen.getByText('EXPORT_PNG')).toBeDisabled();
  });

  it('shows a busy label and blocks both actions while exporting', async () => {
    render(<AdminPanel {...exportProps({ isExporting: true })} />);
    await openExport();
    expect(screen.getByText('EXPORTING…')).toBeDisabled();
    expect(screen.getByText('RECORD_MAP')).toBeDisabled();
  });
});

describe('AdminPanel map export grid toggle', () => {
  const openIt = async () => userEvent.click(screen.getByText('EXPORT'));

  it('includes the grid by default', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    expect(screen.getByLabelText('INCLUDE_GRID')).toBeChecked();
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(expect.objectContaining({ includeGrid: true }));
  });

  it('drops the grid when unchecked', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.click(screen.getByLabelText('INCLUDE_GRID'));
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(expect.objectContaining({ includeGrid: false }));
  });

  it('carries the grid choice into recording too', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.click(screen.getByLabelText('INCLUDE_GRID'));
    await userEvent.click(screen.getByText('RECORD_MAP'));
    expect(props.onStartRecording).toHaveBeenCalledWith(expect.objectContaining({ includeGrid: false }));
  });
});

describe('AdminPanel recording countdown', () => {
  const openIt = async () => userEvent.click(screen.getByText('EXPORT'));

  it('shows nothing while idle', async () => {
    render(<AdminPanel {...exportProps({ isRecording: false })} />);
    await openIt();
    expect(screen.queryByText('● REC')).not.toBeInTheDocument();
  });

  it('shows a REC indicator and the seconds left while recording', async () => {
    // Recording no longer moves the camera, so this is the only sign it is running.
    render(<AdminPanel {...exportProps({ isRecording: true, recordSecondsLeft: 7 })} />);
    await openIt();
    expect(screen.getByText('● REC')).toBeInTheDocument();
    expect(screen.getByText('7s REMAINING')).toBeInTheDocument();
  });

  it('counts down as the capture runs', async () => {
    const { rerender } = render(<AdminPanel {...exportProps({ isRecording: true, recordSecondsLeft: 9 })} />);
    await openIt();
    expect(screen.getByText('9s REMAINING')).toBeInTheDocument();
    rerender(<AdminPanel {...exportProps({ isRecording: true, recordSecondsLeft: 3 })} />);
    expect(screen.getByText('3s REMAINING')).toBeInTheDocument();
  });

  it('reaches zero without going negative', async () => {
    render(<AdminPanel {...exportProps({ isRecording: true, recordSecondsLeft: 0 })} />);
    await openIt();
    expect(screen.getByText('0s REMAINING')).toBeInTheDocument();
  });
});

// ─── draw_water undo ──────────────────────────────────────────────────────────

describe('AdminPanel draw_water undo', () => {
  const waterProps = (): any => ({
    ...baseProps(),
    view: 'draw_water',
    waterTrail: [],
    setWaterTrail: vi.fn(),
    fetchWaterBodies: vi.fn(),
  });

  it('offers UNDO alongside the drawing controls', () => {
    render(<AdminPanel {...waterProps()} />);
    expect(screen.getByText('⟲ UNDO')).toBeInTheDocument();
  });

  it('keeps CLEAR_DRAWING as a separate control', () => {
    // CLEAR_DRAWING discards the untraced trail; UNDO reverts the last saved change.
    render(<AdminPanel {...waterProps()} />);
    expect(screen.getByText('CLEAR_DRAWING')).toBeInTheDocument();
    expect(screen.getByText('⟲ UNDO')).toBeInTheDocument();
  });

  it('posts to the same undo endpoint as the main admin header', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ type: 'water_create' }) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const props = waterProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('⟲ UNDO'));

    expect(fetchMock).toHaveBeenCalledWith('/api/undo', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });

  it('refreshes water when the undone action created one', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ type: 'water_create' }) } as Response),
    ));

    const props = waterProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('⟲ UNDO'));

    expect(props.fetchWaterBodies).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('AdminPanel export options', () => {
  const openIt = async () => userEvent.click(screen.getByText('EXPORT'));

  it('offers the record-length choices', async () => {
    render(<AdminPanel {...exportProps()} />);
    await openIt();
    const select = screen.getByLabelText(/RECORD_LENGTH/) as HTMLSelectElement;
    expect([...select.options].map(o => Number(o.value))).toEqual([5, 10, 30]);
  });

  it('defaults the record length to 10s', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.click(screen.getByText('RECORD_MAP'));
    expect(props.onStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 10 }),
    );
  });

  it('passes the chosen record length through', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.selectOptions(screen.getByLabelText(/RECORD_LENGTH/), '30');
    await userEvent.click(screen.getByText('RECORD_MAP'));
    expect(props.onStartRecording).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 30 }),
    );
  });

  it('locks the record length while a capture runs', async () => {
    render(<AdminPanel {...exportProps({ isRecording: true })} />);
    await openIt();
    expect(screen.getByLabelText(/RECORD_LENGTH/)).toBeDisabled();
  });

  it('defaults transparency off, so exports keep the themed background', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    expect(screen.getByLabelText('TRANSPARENT_BG')).not.toBeChecked();
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(
      expect.objectContaining({ transparent: false }),
    );
  });

  it('passes transparency through when enabled', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.click(screen.getByLabelText('TRANSPARENT_BG'));
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(
      expect.objectContaining({ transparent: true }),
    );
  });

  it('does not offer transparency to the video path, which has no usable alpha', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.click(screen.getByLabelText('TRANSPARENT_BG'));
    await userEvent.click(screen.getByText('RECORD_MAP'));
    expect(props.onStartRecording.mock.calls[0][0]).not.toHaveProperty('transparent');
  });

  it('passes the live map name so the file is named after it', async () => {
    const props = exportProps();
    props.globalSettings = { active_map_name: 'NIGHT_CITY' };
    render(<AdminPanel {...props} />);
    await openIt();
    await userEvent.click(screen.getByText('EXPORT_PNG'));
    expect(props.onExportPng).toHaveBeenCalledWith(
      expect.objectContaining({ mapName: 'NIGHT_CITY' }),
    );
  });

  it('refreshes settings on entry, since a map may have been loaded mid-session', async () => {
    const props = exportProps();
    render(<AdminPanel {...props} />);
    await openIt();
    expect(props.fetchGlobalSettings).toHaveBeenCalled();
  });
});

describe('AdminPanel export tab help text', () => {
  const openIt = async () => userEvent.click(screen.getByText('EXPORT'));

  it('explains what the tab does', async () => {
    render(<AdminPanel {...exportProps()} />);
    await openIt();
    expect(screen.getByText(/Renders the city as a top-down image or video/)).toBeInTheDocument();
  });

  it('disambiguates from CITY_DATA_BASE, which is what "export" most reads as', async () => {
    render(<AdminPanel {...exportProps()} />);
    await openIt();
    expect(screen.getByText(/does not save or back up your map/)).toBeInTheDocument();
    expect(screen.getByText(/CITY_DATA_BASE/)).toBeInTheDocument();
  });

  it('shows the guidance even when no export handler is wired', async () => {
    // The tab should never look empty and unexplained.
    const props = baseProps();
    props.view = 'list';
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('EXPORT'));
    expect(screen.getByText(/Renders the city as a top-down image or video/)).toBeInTheDocument();
  });
});

// ─── city generator bounds mode ───────────────────────────────────────────────

describe('AdminPanel city generator bounds mode', () => {
  const genProps = (over: any = {}): any => ({
    ...baseProps(),
    view: 'city_gen',
    citySectionType: 'MIXED',
    setCitySectionType: vi.fn(),
    overpassDensity: 'normal',
    setOverpassDensity: vi.fn(),
    cityGenDrawMode: 'rect',
    setCityGenDrawMode: vi.fn(),
    genBoundaryTrail: [],
    setGenBoundaryTrail: vi.fn(),
    waterBodies: [],
    ...over,
  });

  it('offers both bounds modes', () => {
    render(<AdminPanel {...genProps()} />);
    expect(screen.getByText('DRAG_RECT')).toBeInTheDocument();
    expect(screen.getByText('DRAW_AREA')).toBeInTheDocument();
  });

  it('prompts to drag while in rectangle mode', () => {
    render(<AdminPanel {...genProps()} />);
    expect(screen.getByText(/DRAG ON MAP TO SELECT/)).toBeInTheDocument();
  });

  it('prompts to trace while in draw mode', () => {
    render(<AdminPanel {...genProps({ cityGenDrawMode: 'draw' })} />);
    expect(screen.getByText(/HOLD LEFT-CLICK TO TRACE/)).toBeInTheDocument();
  });

  it('reports the traced point count once a boundary exists', () => {
    const trail = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    render(<AdminPanel {...genProps({ cityGenDrawMode: 'draw', genBoundaryTrail: trail })} />);
    expect(screen.getByText(/BOUNDARY_TRACED: 4 POINTS/)).toBeInTheDocument();
  });

  it('clears the rectangle when switching to draw, so the two cannot both apply', async () => {
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('DRAW_AREA'));
    expect(props.setCityGenDrawMode).toHaveBeenCalledWith('draw');
    expect(props.setRoadSelectionBounds).toHaveBeenCalledWith(null);
  });

  it('clears the traced boundary when switching back to rectangle', async () => {
    const props = genProps({ cityGenDrawMode: 'draw' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('DRAG_RECT'));
    expect(props.setCityGenDrawMode).toHaveBeenCalledWith('rect');
    expect(props.setGenBoundaryTrail).toHaveBeenCalledWith([]);
  });

  it('offers to clear a traced boundary', async () => {
    const trail = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
    const props = genProps({ cityGenDrawMode: 'draw', genBoundaryTrail: trail });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('CLEAR_BOUNDARY'));
    expect(props.setGenBoundaryTrail).toHaveBeenCalledWith([]);
  });
});

describe('AdminPanel layout selector', () => {
  const genProps = (over: any = {}): any => ({
    ...baseProps(),
    view: 'city_gen',
    citySectionType: 'MIXED',
    setCitySectionType: vi.fn(),
    overpassDensity: 'normal',
    setOverpassDensity: vi.fn(),
    cityGenDrawMode: 'rect',
    setCityGenDrawMode: vi.fn(),
    genBoundaryTrail: [],
    setGenBoundaryTrail: vi.fn(),
    cityLayout: 'BSP',
    setCityLayout: vi.fn(),
    waterBodies: [],
    ...over,
  });

  it('offers every layout', () => {
    render(<AdminPanel {...genProps()} />);
    const select = screen.getByLabelText('LAYOUT') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['BSP', 'GRID', 'SUPERBLOCK']);
  });

  it('defaults to the organic layout, so generation is unchanged out of the box', () => {
    render(<AdminPanel {...genProps()} />);
    expect((screen.getByLabelText('LAYOUT') as HTMLSelectElement).value).toBe('BSP');
  });

  it('describes what each layout produces rather than naming the algorithm', () => {
    render(<AdminPanel {...genProps()} />);
    const select = screen.getByLabelText('LAYOUT') as HTMLSelectElement;
    expect(select.options[1].textContent).toMatch(/SQUARE BLOCKS/);
    expect(select.options[2].textContent).toMatch(/TOWER IN PARK/);
  });

  it('reports a layout change', async () => {
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.selectOptions(screen.getByLabelText('LAYOUT'), 'GRID');
    expect(props.setCityLayout).toHaveBeenCalledWith('GRID');
  });
});
