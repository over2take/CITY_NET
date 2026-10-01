import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));

import { BuildingWindow } from '../BuildingWindow';
import { BuildingExtrasEditor, type BuildingExtrasHandle } from '../BuildingExtrasEditor';
import { TokenWindow } from '../TokenWindow';
import { AdminPanel } from '../AdminPanel';
import { resetRender3dCheck } from '../BuildingPreview';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * The glossary in the building GM notes and the admin GAME tab (3a5b). Every place reads
 * exactly as today under each built-in system and under a custom system that renamed nothing;
 * a custom system that renamed the GM, initiative or the bank shows its own words: in capitals
 * where the label is in capitals, and as the system wrote them inside a sentence.
 *
 * Not here, because no custom system can reach them yet: the XP window (CWN only, 3b6), the
 * vehicles window (CWN and Cyberpunk RED, 3b4), the shop buy-back rate (3b3), and the CWN and
 * Cyberpunk RED initiative house rules.
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const RENAMED = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const TODAY = [...BUILT_INS, PLAIN];

/** What the notes route answers; a PUT says whatever `putAnswer` holds. */
let putAnswer: { ok: boolean; body: unknown } = { ok: true, body: { notes: '' } };
/** The system the TTRPG_SYSTEM panel is told is running. */
let pickedSystem = 'generic';

beforeEach(() => {
  resetRender3dCheck();
  clearCustomTemplates();
  registerCustomTemplate({ id: RENAMED, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] },
    words: {
      gm: { singular: 'Warden', plural: 'Wardens', short: 'Warden' },
      initiative: { singular: 'Order', plural: 'Orders', short: 'Ord' },
      bank: { singular: 'Coffer', plural: 'Coffers', short: 'Coffer' },
    } });
  registerCustomTemplate({ id: PLAIN, name: 'Plain', parts: {}, derived: [], sheet: { sections: [] }, words: {} });
  putAnswer = { ok: true, body: { notes: '' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { ok: putAnswer.ok, json: async () => putAnswer.body };
    if (String(url).includes('gm-notes')) return { ok: true, json: async () => ({ notes: 'Owes the Claws.' }) };
    if (String(url).includes('/api/sheets/system')) return { ok: true, json: async () => ({ system: pickedSystem, systems: [] }) };
    return { ok: true, json: async () => [] };
  }));
});
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('the building window', () => {
  const building = { id: 7, name: 'ARMS', description: 'Guns.', npcs: 'Vic', building_type: 'gun_shop', x: 0, y: 0, z: 0, width: 4, height: 6, depth: 4 };
  const open = async (gameSystem: string) => {
    render(<BuildingWindow location={building} title="ARMS" gameSystem={gameSystem} pos={{ x: 0, y: 0 }} setPos={vi.fn()}
      onClose={vi.fn()} actions={[]} isPrimaryAdmin token="admintoken" />);
    const folder = screen.getAllByRole('tab').map((t) => t.textContent).find((t) => t?.endsWith(' NOTES')) ?? null;
    fireEvent.click(screen.getByRole('tab', { name: folder! }));
    const header = screen.getByText(/ ONLY · PLAYERS NEVER SEE THIS$/).textContent;
    fireEvent.click(await screen.findByText('EDIT NOTES'));
    const aria = screen.getByRole('textbox').getAttribute('aria-label');
    cleanup();
    return { folder, header, aria };
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', async () => {
    for (const system of TODAY) {
      expect(await open(system), system).toEqual({ folder: 'GM NOTES', header: 'GM ONLY · PLAYERS NEVER SEE THIS', aria: 'GM notes' });
    }
  });

  it('uses a custom system\'s own word for the GM', async () => {
    expect(await open(RENAMED)).toEqual({ folder: 'WARDEN NOTES', header: 'WARDEN ONLY · PLAYERS NEVER SEE THIS', aria: 'Warden notes' });
  });
});

describe('the token window\'s notes box', () => {
  // The folder and header were renamed in 3a3; the box they share with buildings was not.
  const aria = async (gameSystem: string) => {
    render(<TokenWindow location={{ id: 9, name: 'Ghoul', shape: 'enemy_rhombus' }} title="ID.EXE" pos={{ x: 0, y: 0 }} setPos={vi.fn()}
      onClose={vi.fn()} portrait={null} description="" actions={[]} operator={null} socket={{ on: vi.fn(), off: vi.fn(), emit: vi.fn() }}
      health={<div />} gmNotesToken="gm-token" gameSystem={gameSystem} />);
    const folder = screen.getAllByRole('tab').map((t) => t.textContent).find((t) => t?.endsWith(' NOTES'));
    fireEvent.click(screen.getByRole('tab', { name: folder! }));
    fireEvent.click(await screen.findByText('EDIT NOTES'));
    const label = screen.getByRole('textbox').getAttribute('aria-label');
    cleanup();
    return label;
  };

  it('is labelled as today, or with a custom system\'s word for the GM', async () => {
    for (const system of TODAY) expect(await aria(system), system).toBe('GM notes');
    expect(await aria(RENAMED)).toBe('Warden notes');
  });
});

describe('the admin\'s building editor', () => {
  const read = async (gameSystem: string) => {
    let r = render(<BuildingExtrasEditor locationId={null} token="admintoken" gameSystem={gameSystem} />);
    const unsaved = r.container.textContent;
    r.unmount();
    const ref = createRef<BuildingExtrasHandle>();
    r = render(<BuildingExtrasEditor ref={ref} locationId={7} token="admintoken" photoUrl={null} gameSystem={gameSystem} />);
    const label = screen.getByText(/ NOTES$/).textContent;
    const box = screen.getByLabelText(label!) as HTMLTextAreaElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.change(box, { target: { value: 'New notes.' } });
    putAnswer = { ok: false, body: {} };
    let refused: string[] = [];
    await act(async () => { refused = await ref.current!.commit(); });
    putAnswer = { ok: true, body: {} };
    let stale: string[] = [];
    await act(async () => { stale = await ref.current!.commit(); });
    const online = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async () => { throw new Error('offline'); });
    let offline: string[] = [];
    await act(async () => { offline = await ref.current!.commit(); });
    vi.mocked(fetch).mockImplementation(online);
    r.unmount();
    return { unsaved, label, refused, stale: stale.map((s) => s.split('. ')[0]), offline };
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', async () => {
    for (const system of TODAY) {
      expect(await read(system), system).toEqual({
        unsaved: 'Save the building first to give it a photo or GM notes.',
        label: 'GM NOTES',
        refused: ['The GM notes were not saved.'],
        stale: ['The server did not take the GM notes'],
        offline: ['The GM notes were not saved.'],
      });
    }
  });

  it('uses a custom system\'s own word for the GM', async () => {
    expect(await read(RENAMED)).toEqual({
      unsaved: 'Save the building first to give it a photo or Warden notes.',
      label: 'WARDEN NOTES',
      refused: ['The Warden notes were not saved.'],
      stale: ['The server did not take the Warden notes'],
      offline: ['The Warden notes were not saved.'],
    });
  });
});

describe('the admin GAME tab', () => {
  const props = (): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [],
  });

  const read = async (system: string) => {
    pickedSystem = system;
    render(<AdminPanel {...props()} globalSettings={{ game_system: system }} gameSystem={system} />);
    await userEvent.click(screen.getByText('GAME'));
    // By text: a role lookup copies every button on this tab, and jsdom cannot parse one of
    // their background styles.
    const sounds = screen.getByText(/ SOUNDS$/).textContent;
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM$/));
    await userEvent.click(screen.getByText('HOUSE RULES'));
    const rule = await screen.findByText(/ FOLLOWS BUILDING /);
    const out = { sounds, rule: rule.textContent, title: rule.closest('label')?.getAttribute('title') };
    cleanup();
    return out;
  };

  const TITLE = (one: string, many: string) => `When enabled, all floors of the same building share a single ${one} tracker. Players moving between floors stay in the same combat order. Each building and the city map still have their own separate ${many}.`;

  it('reads as today under every built-in system, and a custom one that renamed nothing', async () => {
    for (const system of TODAY) {
      expect(await read(system), system).toEqual({
        sounds: 'BANK SOUNDS',
        rule: 'INITIATIVE FOLLOWS BUILDING (ALL FLOORS SHARE ONE TRACKER)',
        title: TITLE('initiative', 'initiatives'),
      });
    }
  });

  it('uses a custom system\'s own words for the bank and initiative', async () => {
    expect(await read(RENAMED)).toEqual({
      sounds: 'COFFER SOUNDS',
      rule: 'ORDER FOLLOWS BUILDING (ALL FLOORS SHARE ONE TRACKER)',
      title: TITLE('Order', 'Orders'),
    });
  });
});
