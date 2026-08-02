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
    expect([...select.options].map(o => o.value)).toEqual(['BSP', 'GRID', 'SUPERBLOCK', 'RING', 'VORONOI', 'PERIMETER']);
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
    expect(select.options[3].textContent).toMatch(/BELTWAYS AND SPOKES/);
  });

  it('reports a layout change', async () => {
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.selectOptions(screen.getByLabelText('LAYOUT'), 'GRID');
    expect(props.setCityLayout).toHaveBeenCalledWith('GRID');
  });
});

describe('AdminPanel stays on the generator after generating', () => {
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
    roadSelectionBounds: { min: { x: -50, z: -50 }, max: { x: 50, z: 50 } },
    waterBodies: [],
    locations: [],
    roads: [],
    refreshOverpasses: vi.fn(),
    ...over,
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    ));
  });

  it('does not send the admin back to the main panel', async () => {
    // Iterating on layout and density means regenerating repeatedly; being kicked
    // back to the list every time made that tedious.
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    expect(props.setView).not.toHaveBeenCalledWith('list');
    vi.unstubAllGlobals();
  });

  it('keeps the selected area, so it can be regenerated without re-selecting', async () => {
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    expect(props.setRoadSelectionBounds).not.toHaveBeenCalledWith(null);
    vi.unstubAllGlobals();
  });
});

describe('AdminPanel city seed', () => {
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
    citySeed: '',
    setCitySeed: vi.fn(),
    lastCitySeed: '',
    setLastCitySeed: vi.fn(),
    roadSelectionBounds: { min: { x: -50, z: -50 }, max: { x: 50, z: 50 } },
    waterBodies: [],
    locations: [],
    roads: [],
    refreshOverpasses: vi.fn(),
    ...over,
  });

  it('offers a seed field that defaults to random', () => {
    render(<AdminPanel {...genProps()} />);
    const field = screen.getByLabelText(/SEED/) as HTMLInputElement;
    expect(field.value).toBe('');
    expect(field.placeholder).toBe('RANDOM');
  });

  it('says what a seed actually reproduces', () => {
    // A seed is not a city on its own; without saying so it reads as a bug when the
    // same seed over a different area builds something else.
    render(<AdminPanel {...genProps()} />);
    expect(screen.getByText(/SAME SEED \+ SAME AREA \+ SAME OPTIONS/)).toBeInTheDocument();
  });

  it('reports a typed seed', async () => {
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.type(screen.getByLabelText(/SEED/), '7');
    expect(props.setCitySeed).toHaveBeenCalledWith('7');
  });

  it('clears the field, which is how a fresh seed is rolled', async () => {
    const props = genProps({ citySeed: '12345' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByTitle('CLEAR SEED'));
    expect(props.setCitySeed).toHaveBeenCalledWith('');
  });

  it('reports the seed it rolled without filling the field', async () => {
    // Filling the input meant every later regenerate silently rebuilt the same city.
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    ));
    const props = genProps({ citySeed: '' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));

    const reported = props.setLastCitySeed.mock.calls.map((c: unknown[]) => c[0]);
    expect(reported.some((v: string) => v !== '' && Number.isFinite(Number(v)))).toBe(true);
    expect(props.setCitySeed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rolls a different seed each time the field is left blank', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    ));
    const props = genProps({ citySeed: '' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));

    const reported = props.setLastCitySeed.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(reported).size).toBeGreaterThan(1);
    vi.unstubAllGlobals();
  });

  it('shows the last seed used, and reuses it when clicked', async () => {
    const props = genProps({ citySeed: '', lastCitySeed: '4821960374' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByTitle('REUSE THIS SEED'));
    expect(props.setCitySeed).toHaveBeenCalledWith('4821960374');
  });

  it('shows no readout before anything has been generated', () => {
    render(<AdminPanel {...genProps({ citySeed: '', lastCitySeed: '' })} />);
    expect(screen.queryByTitle('REUSE THIS SEED')).not.toBeInTheDocument();
  });

  it('never rewrites a seed the admin typed', async () => {
    // Normalising it looked like the field being cleared and replaced.
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    ));
    const props = genProps({ citySeed: '464654654' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    expect(props.setCitySeed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('leaves a worded seed alone too', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    ));
    const props = genProps({ citySeed: 'NIGHTCITY' });
    render(<AdminPanel {...props} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    expect(props.setCitySeed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('offers UNDO on the generator panel', () => {
    render(<AdminPanel {...genProps()} />);
    expect(screen.getByText('⟲ UNDO')).toBeInTheDocument();
  });

  it('posts to the undo endpoint from the generator', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ type: 'location_create' }) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminPanel {...genProps()} />);
    await userEvent.click(screen.getByText('⟲ UNDO'));
    expect(fetchMock).toHaveBeenCalledWith('/api/undo', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });
});

describe('AdminPanel regenerate', () => {
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
    citySeed: '42',
    setCitySeed: vi.fn(),
    lastCitySeed: '',
    setLastCitySeed: vi.fn(),
    roadSelectionBounds: { min: { x: -50, z: -50 }, max: { x: 50, z: 50 } },
    waterBodies: [],
    locations: [],
    roads: [],
    refreshOverpasses: vi.fn(),
    ...over,
  });

  // An unnamed structure reads as generated under both the real isUserDefinedName and
  // the mock this file installs, so the fixture is valid either way.
  const generated = (x: number, z: number) =>
    ({ id: Math.random(), name: '', x, z, y: 0, shape: 'box', battle_map_id: null });
  const named = (x: number, z: number) =>
    ({ id: Math.random(), name: 'AFTERLIFE', x, z, y: 0, shape: 'box', battle_map_id: null });

  const stubFetch = () => {
    const mock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  it('offers both generate and regenerate', () => {
    render(<AdminPanel {...genProps()} />);
    expect(screen.getByText('GENERATE_CITY_GRID')).toBeInTheDocument();
    expect(screen.getByText('REGENERATE')).toBeInTheDocument();
  });

  it('does not purge on a plain generate', async () => {
    // Infilling is a legitimate use; only REGENERATE clears.
    const mock = stubFetch();
    render(<AdminPanel {...genProps({ locations: [generated(0, 0)] })} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    const purges = mock.mock.calls.filter(([u]) => String(u).includes('purge-region'));
    expect(purges).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('purges the region before regenerating', async () => {
    const mock = stubFetch();
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<AdminPanel {...genProps({ locations: [generated(0, 0)] })} />);
    await userEvent.click(screen.getByText('REGENERATE'));

    const purges = mock.mock.calls.filter(([u]) => String(u).includes('purge-region'));
    expect(purges).toHaveLength(1);
    expect(purges[0][1]).toMatchObject({ method: 'POST' });
    vi.unstubAllGlobals();
  });

  it('leads the confirm with how much goes and what survives', async () => {
    // "Regenerate?" invites a reflexive yes; a count does not.
    const mock = stubFetch();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<AdminPanel {...genProps({
      locations: [generated(0, 0), generated(5, 5), named(6, 6)],
    })} />);
    await userEvent.click(screen.getByText('REGENERATE'));

    expect(confirmSpy).toHaveBeenCalled();
    const message = String(confirmSpy.mock.calls[0][0]);
    expect(message).toContain('removes 2');
    expect(message).toContain('1 named structure');
    void mock;
    vi.unstubAllGlobals();
  });

  it('does nothing when the confirm is declined', async () => {
    const mock = stubFetch();
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<AdminPanel {...genProps({ locations: [generated(0, 0)] })} />);
    await userEvent.click(screen.getByText('REGENERATE'));
    expect(mock.mock.calls.filter(([u]) => String(u).includes('purge-region'))).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('does not ask when the region is empty', async () => {
    // The common first-generation case; making it feel dangerous discourages use.
    stubFetch();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<AdminPanel {...genProps({ locations: [] })} />);
    await userEvent.click(screen.getByText('REGENERATE'));
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('ignores structures outside the region when counting', async () => {
    stubFetch();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<AdminPanel {...genProps({ locations: [generated(9999, 9999)] })} />);
    await userEvent.click(screen.getByText('REGENERATE'));
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('re-reads the world after purging, so it does not build around what is gone', async () => {
    // Placement tests against existing locations; stale ones would leave the new city
    // avoiding buildings that no longer exist.
    const mock = stubFetch();
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<AdminPanel {...genProps({ locations: [generated(0, 0)] })} />);
    await userEvent.click(screen.getByText('REGENERATE'));

    const urls = mock.mock.calls.map(([u]) => String(u));
    const purgeAt = urls.findIndex((u) => u.includes('purge-region'));
    const refetchAt = urls.findIndex((u, i) => i > purgeAt && u === '/api/locations');
    expect(purgeAt).toBeGreaterThanOrEqual(0);
    expect(refetchAt).toBeGreaterThan(purgeAt);
    vi.unstubAllGlobals();
  });

  it('re-reads the water too, not just the locations and roads', async () => {
    // The purge deletes the last generated river. Generating against the stale water
    // list made the new city avoid a river that was no longer there, leaving a dead
    // band of empty ground tracing where the old one ran.
    const mock = stubFetch();
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<AdminPanel {...genProps({ locations: [generated(0, 0)] })} />);
    await userEvent.click(screen.getByText('REGENERATE'));

    const urls = mock.mock.calls.map(([u]) => String(u));
    const purgeAt = urls.findIndex((u) => u.includes('purge-region'));
    const waterRefetchAt = urls.findIndex((u, i) => i > purgeAt && u === '/api/water');
    expect(waterRefetchAt).toBeGreaterThan(purgeAt);
    vi.unstubAllGlobals();
  });
});

describe('AdminPanel water selector', () => {
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
    citySeed: '42',
    setCitySeed: vi.fn(),
    lastCitySeed: '',
    setLastCitySeed: vi.fn(),
    cityWater: 'NONE',
    setCityWater: vi.fn(),
    roadSelectionBounds: { min: { x: -300, z: -300 }, max: { x: 300, z: 300 } },
    waterBodies: [],
    locations: [],
    roads: [],
    refreshOverpasses: vi.fn(),
    fetchWaterBodies: vi.fn(),
    ...over,
  });

  const stubFetch = () => {
    const mock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response),
    );
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  it('offers every water type', () => {
    render(<AdminPanel {...genProps()} />);
    const select = screen.getByLabelText('WATER') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['NONE', 'RIVER', 'COAST', 'LAKE']);
  });

  it('defaults to none, so existing generation is unchanged', () => {
    // NONE doubles as the off switch, rather than a checkbox that could disagree
    // with the selector.
    render(<AdminPanel {...genProps()} />);
    expect((screen.getByLabelText('WATER') as HTMLSelectElement).value).toBe('NONE');
  });

  it('reports a water choice', async () => {
    const props = genProps();
    render(<AdminPanel {...props} />);
    await userEvent.selectOptions(screen.getByLabelText('WATER'), 'RIVER');
    expect(props.setCityWater).toHaveBeenCalledWith('RIVER');
  });

  it('persists no water when set to none', async () => {
    const mock = stubFetch();
    render(<AdminPanel {...genProps({ cityWater: 'NONE' })} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));
    expect(mock.mock.calls.filter(([u]) => String(u) === '/api/water')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('persists a generated river, marked so a regenerate can clear it', async () => {
    const mock = stubFetch();
    render(<AdminPanel {...genProps({ cityWater: 'RIVER' })} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));

    const posts = mock.mock.calls.filter(([u]) => String(u) === '/api/water');
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String((posts[0][1] as RequestInit).body));
    expect(body.generated).toBe(true);
    expect(body.points.length).toBeGreaterThan(2);
    vi.unstubAllGlobals();
  });

  it('saves the water before the roads it shaped', async () => {
    const mock = stubFetch();
    render(<AdminPanel {...genProps({ cityWater: 'RIVER' })} />);
    await userEvent.click(screen.getByText('GENERATE_CITY_GRID'));

    const urls = mock.mock.calls.map(([u]) => String(u));
    const waterAt = urls.indexOf('/api/water');
    const roadsAt = urls.indexOf('/api/roads');
    expect(waterAt).toBeGreaterThanOrEqual(0);
    if (roadsAt >= 0) expect(waterAt).toBeLessThan(roadsAt);
    vi.unstubAllGlobals();
  });
});
