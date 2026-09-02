import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { AdminPanel } from '../AdminPanel';

/**
 * The district flow, which is now three views rather than two.
 *
 * The old one put you into map-selection the moment you pressed EDIT, and SAVE replaced
 * the district with whatever was selected - so editing a district and choosing what was in
 * it were the same screen, and a stale selection quietly emptied it. These pin the split:
 * ASSIGN picks structures and only ever adds, EDIT changes the colour and removes one at a
 * time, and neither can do the other's job.
 */

const DISTRICTS = [
  { id: 1, name: 'DOWNTOWN', color: '#ff0000' },
  { id: 2, name: 'SLUMS', color: '#00ff00' },
];

const LOCATIONS = [
  { id: 10, name: 'TOWER', shape: 'box', district_name: 'DOWNTOWN', district_color: '#ff0000' },
  { id: 11, name: 'ARCADE', shape: 'box', district_name: 'DOWNTOWN', district_color: '#ff0000' },
  { id: 12, name: 'SHACK', shape: 'box', district_name: 'SLUMS', district_color: '#00ff00' },
  { id: 13, name: 'EMPTY LOT', shape: 'box', district_name: null, district_color: null },
];

const baseProps = (): any => ({
  socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
  token: 'admintoken',
  onLogout: vi.fn(),
  refreshLocations: vi.fn(),
  refreshRoads: vi.fn(),
  locations: LOCATIONS,
  roads: [],
  editData: {}, setEditData: vi.fn(), editId: null, setEditId: vi.fn(),
  transformMode: 'translate', setTransformMode: vi.fn(), targetObject: null,
  blockBuildings: false, setBlockBuildings: vi.fn(),
  selectedLocation: null, setSelectedLocation: vi.fn(), setTargetObject: vi.fn(),
  isChatOpen: false, setIsChatOpen: vi.fn(), controlsRef: { current: null },
  view: 'district', setView: vi.fn(),
  pendingRequests: [], setPendingRequests: vi.fn(),
  isBatchSelecting: false, setIsBatchSelecting: vi.fn(),
  selectedIds: [], setSelectedIds: vi.fn(), toggleSelection: vi.fn(), batchDelete: vi.fn(),
  districtSelection: [], setDistrictSelection: vi.fn(),
  districtConfig: { name: '', color: '#00ff00' }, setDistrictConfig: vi.fn(),
  districts: DISTRICTS, fetchDistricts: vi.fn(),
  editingDistrict: null, setEditingDistrict: vi.fn(),
  assigningDistrict: null, setAssigningDistrict: vi.fn(),
  joinSelection: null, setJoinSelection: vi.fn(),
  selectedClassification: '', setSelectedClassification: vi.fn(),
  roadSelectionBounds: null,
  waterBodies: [],
  onToggleHidden: vi.fn(),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = (overrides = {}) => {
  const props = { ...baseProps(), ...overrides };
  render(<AdminPanel {...props} />);
  return props;
};

const bodyOf = (call: any[]) => JSON.parse(call[1].body);

describe('the district list', () => {
  it('says how to use it, which it never did', () => {
    open();
    expect(screen.getByText(/use ASSIGN on it to pick its structures/i)).toBeTruthy();
  });

  it('shows each district with its colour and how much is in it', () => {
    open();
    const downtown = screen.getByText('DOWNTOWN').closest('.list-item')!;
    expect(within(downtown as HTMLElement).getByText('2 STRUCTURES')).toBeTruthy();
    const slums = screen.getByText('SLUMS').closest('.list-item')!;
    expect(within(slums as HTMLElement).getByText('1 STRUCTURES')).toBeTruthy();
  });

  it('offers ASSIGN and EDIT as separate buttons', () => {
    // The whole point of the rework: they were one button doing both jobs.
    open();
    const downtown = screen.getByText('DOWNTOWN').closest('.list-item')! as HTMLElement;
    expect(within(downtown).getByText('ASSIGN')).toBeTruthy();
    expect(within(downtown).getByText('EDIT')).toBeTruthy();
  });

  it('starts assigning with an empty selection', async () => {
    // Prefilling it with the current members is what made SAVE look like a full replace.
    const props = open();
    const downtown = screen.getByText('DOWNTOWN').closest('.list-item')! as HTMLElement;
    await userEvent.click(within(downtown).getByText('ASSIGN'));

    expect(props.setDistrictSelection).toHaveBeenCalledWith([]);
    expect(props.setAssigningDistrict).toHaveBeenCalledWith(DISTRICTS[0]);
    expect(props.setEditingDistrict).not.toHaveBeenCalled();
  });

  it('opens EDIT with that district colour loaded', async () => {
    const props = open();
    const downtown = screen.getByText('DOWNTOWN').closest('.list-item')! as HTMLElement;
    await userEvent.click(within(downtown).getByText('EDIT'));

    expect(props.setDistrictConfig).toHaveBeenCalledWith({ name: 'DOWNTOWN', color: '#ff0000' });
    expect(props.setEditingDistrict).toHaveBeenCalledWith(DISTRICTS[0]);
    expect(props.setAssigningDistrict).not.toHaveBeenCalled();
  });

  it('says what deleting will cost before it does it', async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    open();
    const downtown = screen.getByText('DOWNTOWN').closest('.list-item')! as HTMLElement;
    await userEvent.click(within(downtown).getByText('DEL'));

    expect(confirmSpy.mock.calls[0][0]).toMatch(/2 structure\(s\) will be left with no district/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells you when there is nothing yet', () => {
    open({ districts: [] });
    expect(screen.getByText('NO DISTRICTS YET.')).toBeTruthy();
  });
});

describe('assigning structures', () => {
  const assigning = (selection: number[] = []) =>
    open({ assigningDistrict: DISTRICTS[0], districtSelection: selection });

  it('explains what clicking the map will do', () => {
    assigning();
    expect(screen.getByText(/Click structures on the map to add them/i)).toBeTruthy();
    expect(screen.getByText(/moves to this one/i)).toBeTruthy();
  });

  it('cannot save an empty selection', () => {
    assigning();
    expect(screen.getByText('SAVE').hasAttribute('disabled')).toBe(true);
  });

  it('warns when the selection would take structures off another district', () => {
    // SHACK is in SLUMS. Assigning it to DOWNTOWN moves it, which is right - but the
    // admin should know before pressing SAVE, not after.
    assigning([12, 13]);
    expect(screen.getByText(/1 will move out of another district/i)).toBeTruthy();
  });

  it('says nothing about moving when nothing moves', () => {
    assigning([13]); // EMPTY LOT is in no district
    expect(screen.queryByText(/will move out of another district/i)).toBeNull();
  });

  it('posts only the selected ids, and lets the server pick the colour', async () => {
    // Additive by construction: the request carries no notion of the district's
    // current members, so nothing outside the selection can be touched.
    assigning([12, 13]);
    await userEvent.click(screen.getByText('SAVE'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/locations/assign-district');
    expect(init.method).toBe('POST');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ ids: [12, 13], district_name: 'DOWNTOWN' });
    expect(bodyOf(fetchMock.mock.calls[0]).district_color).toBeUndefined();
  });

  it('closes back to the list once saved', async () => {
    const props = assigning([13]);
    await userEvent.click(screen.getByText('SAVE'));

    expect(props.setAssigningDistrict).toHaveBeenCalledWith(null);
    expect(props.setDistrictSelection).toHaveBeenCalledWith([]);
    expect(props.refreshLocations).toHaveBeenCalled();
  });

  it('leaves the district alone if the save fails', async () => {
    // A failed save must not look like a successful one: the view stays open with the
    // selection intact, so the admin can try again rather than re-picking everything.
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const props = assigning([13]);
    await userEvent.click(screen.getByText('SAVE'));

    expect(screen.getByText('ASSIGN_FAILED')).toBeTruthy();
    expect(props.setAssigningDistrict).not.toHaveBeenCalledWith(null);
    expect(props.refreshLocations).not.toHaveBeenCalled();
  });

  it('can drop the selection without saving', async () => {
    const props = assigning([12, 13]);
    await userEvent.click(screen.getByText('CLEAR'));
    expect(props.setDistrictSelection).toHaveBeenCalledWith([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('editing a district', () => {
  const editing = (color = '#ff0000') =>
    open({ editingDistrict: DISTRICTS[0], districtConfig: { name: 'DOWNTOWN', color } });

  it('shows the colour it currently has', () => {
    editing();
    const swatch = document.querySelector('input[type="color"]') as HTMLInputElement;
    expect(swatch.value).toBe('#ff0000');
  });

  it('will not save a colour that has not changed', () => {
    editing('#ff0000');
    expect(screen.getByText('SAVE COLOR').hasAttribute('disabled')).toBe(true);
  });

  it('saves a new colour to the district', async () => {
    editing('#0000ff');
    await userEvent.click(screen.getByText('SAVE COLOR'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/districts/DOWNTOWN');
    expect(init.method).toBe('PUT');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ color: '#0000ff' });
  });

  it('refreshes the map after a recolour, since every building carries a copy', async () => {
    const props = editing('#0000ff');
    await userEvent.click(screen.getByText('SAVE COLOR'));
    expect(props.refreshLocations).toHaveBeenCalled();
    expect(props.fetchDistricts).toHaveBeenCalled();
  });

  it('lists what is in the district', () => {
    editing();
    expect(screen.getByText('TOWER')).toBeTruthy();
    expect(screen.getByText('ARCADE')).toBeTruthy();
    // SHACK is in SLUMS, not this one.
    expect(screen.queryByText('SHACK')).toBeNull();
  });

  it('removes one structure without touching the rest', async () => {
    editing();
    const tower = screen.getByText('TOWER').closest('.list-item')! as HTMLElement;
    await userEvent.click(within(tower).getByText('REMOVE'));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/locations/unassign-district');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ ids: [10] });
  });

  it('offers no map selection at all', () => {
    // The old EDIT was a selection screen. This one is not, which is the point.
    editing();
    expect(screen.queryByText(/DRAG TO SELECT/i)).toBeNull();
    expect(screen.queryByText('SAVE DISTRICT')).toBeNull();
  });

  it('says so when the district is empty', () => {
    open({ editingDistrict: DISTRICTS[1], districtConfig: { name: 'SLUMS', color: '#00ff00' }, locations: [] });
    expect(screen.getByText('NONE. USE ASSIGN TO ADD SOME.')).toBeTruthy();
  });
});
