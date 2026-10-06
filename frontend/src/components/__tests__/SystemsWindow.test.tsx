import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));
vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));
vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => <div><div data-testid="window-title">{title}</div>{children}</div>,
}));

import { SystemsWindow } from '../SystemsWindow';
import { AdminPanel } from '../AdminPanel';
import { SYSTEMS_CHANGED_EVENT, type LibrarySystem, type InstallPreview } from '../../sheets/systemsLibrary';

/**
 * SYSTEMS.EXE (4a1c1): the main admin's systems, opened from the GAME tab. Decided with the user:
 * a window opened from one button under the game-system picker, which stays outside it
 * (2026-10-02); a rename refused for a taken name stays open with the reason (2026-10-06).
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const NEON = 'sys_bbbbbbbbbbbbbbbb';
const VAULT = 'sys_cccccccccccccccc';
const COPY = 'sys_dddddddddddddddd';

const row = (over: Partial<LibrarySystem>): LibrarySystem => ({
  id: HEARTH, name: 'Hearth', version: 3, updatedAt: '2026-10-06 14:10:00', publishedAt: '2026-10-06 14:10:00',
  published: true, unpublishedChanges: false, installed: false, problemCount: 0,
  description: '', author: '', characterCount: 0, ...over,
});

let systems: LibrarySystem[];
let calls: { url: string; method: string; body: unknown }[];
/** How the server answers a rename, a preview and an install; a test changes them. */
let renameAnswer: { status: number; body: unknown } | null;
let previewAnswer: { status: number; body: unknown };
let installAnswer: { status: number; body: unknown };

const INSIDE = { words: 12, partsOff: 0, currencies: 2, derived: 0, lookups: 0, sheetFields: 41, npcTiers: 0, healthModel: null };
const PREVIEW: InstallPreview = {
  manifest: { name: 'Iron Sea', author: 'M. Okafor', license: 'CC BY 4.0', builder: '1.15.0', version: 4, origin: 'org_iron' },
  name: 'Iron Sea', inside: INSIDE, problems: [], installed: [], restores: null,
  installsAs: { new: 'Iron Sea', update: null, keep_both: 'Iron Sea' },
};

const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  const json = (status: number, b: unknown, headers: Record<string, string> = {}) => ({
    ok: status < 300, status, json: async () => b, text: async () => String(b), headers: { get: (k: string) => headers[k] ?? null },
  }) as unknown as Response;
  if (url === '/api/systems' && method === 'GET') return json(200, systems);
  if (url === '/api/systems' && method === 'POST') {
    const taken = systems.find((s) => s.name.toLowerCase() === body.name.trim().toLowerCase());
    if (taken) return json(409, { error: `Another system is already called ${taken.name}.` });
    systems = [row({ id: COPY, name: body.name, published: false, version: 0, unpublishedChanges: true }), ...systems];
    return json(200, { id: COPY, problems: [] });
  }
  if (url === '/api/systems/install/preview') return json(previewAnswer.status, previewAnswer.body);
  if (url === '/api/systems/install') {
    if (installAnswer.status === 200) systems = [row({ id: COPY, name: (installAnswer.body as { name: string }).name, installed: true }), ...systems];
    return json(installAnswer.status, installAnswer.body);
  }
  const m = /^\/api\/systems\/(sys_[0-9a-f]+)(\/[a-z]+)?$/.exec(url);
  if (m) {
    const [, id, rest] = m;
    const s = systems.find((x) => x.id === id)!;
    if (!rest && method === 'GET') return json(200, { draft: { author: id === HEARTH ? 'Cody' : '' } });
    if (rest === '/name') {
      if (renameAnswer) return json(renameAnswer.status, renameAnswer.body);
      s.name = body.name.trim();
      return json(200, { name: s.name });
    }
    if (rest === '/duplicate') {
      systems = [row({ id: COPY, name: `${s.name} copy`, published: false, version: 0, unpublishedChanges: true }), ...systems];
      return json(200, { id: COPY, name: `${s.name} copy` });
    }
    if (rest === '/export') return json(200, '{"citysys":1}', { 'Content-Disposition': 'attachment; filename="hearth.citysys"' });
    if (!rest && method === 'DELETE') { systems = systems.filter((x) => x.id !== id); return json(200, { deleted: true }); }
  }
  return json(404, { error: 'No such route' });
});

beforeEach(() => {
  calls = [];
  renameAnswer = null;
  previewAnswer = { status: 200, body: PREVIEW };
  installAnswer = { status: 200, body: { id: COPY, name: 'Iron Sea', published: true, problems: [] } };
  systems = [
    row({}),
    row({ id: NEON, name: 'Neon Exchange', version: 1, unpublishedChanges: true }),
    row({ id: VAULT, name: 'Vault Knights', version: 0, published: false, unpublishedChanges: true, installed: true, problemCount: 3 }),
  ];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (running: string | null = HEARTH) => render(
  <SystemsWindow token="gm" running={running} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} fetcher={fakeServer as typeof fetch} />,
);
const listed = () => within(screen.getByRole('group', { name: 'Your systems' })).getAllByRole('button');
const entry = (name: string) => listed().find((b) => b.textContent!.startsWith(name.toUpperCase()))!;

describe('the list', () => {
  it('shows every system with its badges, the first picked with its facts', async () => {
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(listed().map((b) => b.textContent)).toEqual([
      'HEARTHv3RUNNINGPUBLISHED v3',
      'NEON EXCHANGEv1PUBLISHED v1UNPUBLISHED CHANGES',
      'VAULT KNIGHTSDRAFTNEVER PUBLISHED3 PROBLEMSINSTALLED',
    ]);
    expect(entry('Hearth').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('window-title').textContent).toBe('SYSTEMS.EXE · HEARTH');
    expect(screen.getByText('YOUR SYSTEMS · 3')).toBeTruthy();
    expect(await screen.findByText('Cody')).toBeTruthy();
    expect(screen.getByText('v3 published')).toBeTruthy();
    expect(screen.getByText('Made here')).toBeTruthy();
  });

  it('picks another, with its own facts and no author it hasn\'t got', async () => {
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(entry('Vault Knights'));
    expect(screen.getByTestId('window-title').textContent).toBe('SYSTEMS.EXE · VAULT KNIGHTS');
    expect(screen.getByText('Never published')).toBeTruthy();
    expect(screen.getByText('Installed from a file')).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.url === `/api/systems/${VAULT}`)).toBe(true));
    expect(screen.queryByText('AUTHOR')).toBeNull();
  });

  it('says when there are none, and when the server can\'t be reached', async () => {
    systems = [];
    open();
    expect(await screen.findByText('No systems of your own yet. Make one in NEW, or install a file in INSTALL.')).toBeTruthy();
    expect(screen.getByTestId('window-title').textContent).toBe('SYSTEMS.EXE · LIBRARY');
    cleanup();
    render(<SystemsWindow token="gm" running={null} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
      fetcher={(async () => { throw new TypeError('down'); }) as never} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.');
  });
});

describe('RENAME', () => {
  it('renames at once, telling the picker beside it', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(screen.getByText('RENAME'));
    const input = screen.getByLabelText('New name') as HTMLInputElement;
    expect(input.value).toBe('Hearth');
    await userEvent.clear(input);
    await userEvent.type(input, 'Emberhold{Enter}');
    expect(calls.find((c) => c.method === 'PUT')).toEqual({ url: `/api/systems/${HEARTH}/name`, method: 'PUT', body: { name: 'Emberhold' } });
    expect(await screen.findByText('Renamed to Emberhold.')).toBeTruthy();
    await waitFor(() => expect(entry('Emberhold')).toBeTruthy());
    expect(screen.queryByLabelText('New name')).toBeNull();
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('refused, stays open where it is with what was typed and why', async () => {
    renameAnswer = { status: 409, body: { error: 'Another system is already called Neon Exchange.' } };
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(screen.getByText('RENAME'));
    const input = screen.getByLabelText('New name') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'neon exchange');
    await userEvent.click(screen.getByText('SAVE'));
    expect((await screen.findByRole('alert')).textContent).toBe('Another system is already called Neon Exchange.');
    expect((screen.getByLabelText('New name') as HTMLInputElement).value).toBe('neon exchange');
    expect(document.activeElement).toBe(screen.getByLabelText('New name'));
    expect(screen.getByLabelText('New name').getAttribute('aria-invalid')).toBe('true');
    // Typing again clears the reason.
    await userEvent.type(input, 's');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('won\'t save a blank name, and CANCEL or Esc puts it away', async () => {
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(screen.getByText('RENAME'));
    await userEvent.clear(screen.getByLabelText('New name'));
    expect((screen.getByText('SAVE') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByText('CANCEL'));
    expect(screen.queryByLabelText('New name')).toBeNull();
    await userEvent.click(screen.getByText('RENAME'));
    await userEvent.type(screen.getByLabelText('New name'), '{Escape}');
    expect(screen.queryByLabelText('New name')).toBeNull();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('DUPLICATE', () => {
  it('makes the copy and picks it', async () => {
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(screen.getByText('DUPLICATE'));
    expect(await screen.findByText('Copied as Hearth copy: a draft, its own system.')).toBeTruthy();
    await waitFor(() => expect(listed()).toHaveLength(4));
    expect(entry('Hearth copy').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('EXPORT', () => {
  it('downloads a published system\'s file under its own name', async () => {
    const created = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(screen.getByText('EXPORT .CITYSYS'));
    expect(await screen.findByText('Downloading hearth.citysys (v3).')).toBeTruthy();
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('hearth.citysys');
    click.mockRestore();
  });

  it('is off for one never published, saying why', async () => {
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(entry('Vault Knights'));
    expect((screen.getByText('EXPORT .CITYSYS') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('EXPORT: Publish it before sharing it. Only a published system is shared.')).toBeTruthy();
  });
});

describe('DELETE', () => {
  it('is off for the system the game runs, saying why', async () => {
    open(HEARTH);
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect((screen.getByText('DELETE') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('DELETE: This is the system the game is running. Switch to another first.')).toBeTruthy();
  });

  it('asks first; KEEP IT keeps it, DELETE hides it', async () => {
    open('cities_without_number');
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(entry('Neon Exchange'));
    await userEvent.click(screen.getByText('DELETE'));
    const ask = screen.getByRole('alertdialog', { name: 'Delete Neon Exchange' });
    await userEvent.click(within(ask).getByText('KEEP IT'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByText('DELETE'));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByText('DELETE'));
    expect(await screen.findByText('Deleted Neon Exchange. Installing its file brings it back.')).toBeTruthy();
    await waitFor(() => expect(listed()).toHaveLength(2));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/systems/${NEON}`);
    expect(entry('Hearth').getAttribute('aria-pressed')).toBe('true');
  });
});

const folder = async (name: 'SYSTEMS' | 'NEW' | 'INSTALL') => {
  await waitFor(() => expect(listed().length).toBeGreaterThan(0));
  await userEvent.click(screen.getByRole('tab', { name }));
};

describe('the builder', () => {
  it('OPEN IN BUILDER opens the picked system there', async () => {
    const onOpenBuilder = vi.fn();
    render(<SystemsWindow token="gm" running={null} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} onOpenBuilder={onOpenBuilder} fetcher={fakeServer as typeof fetch} />);
    await waitFor(() => expect(listed()).toHaveLength(3));
    await userEvent.click(entry('Neon Exchange'));
    await userEvent.click(screen.getByText('OPEN IN BUILDER'));
    expect(onOpenBuilder).toHaveBeenCalledWith(NEON, 'setup');
  });

  it('CREATE opens the new system there, on SETUP', async () => {
    const onOpenBuilder = vi.fn();
    render(<SystemsWindow token="gm" running={null} pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} onOpenBuilder={onOpenBuilder} fetcher={fakeServer as typeof fetch} />);
    await folder('NEW');
    await userEvent.type(screen.getByLabelText('NAME'), 'Tidewater{Enter}');
    await waitFor(() => expect(onOpenBuilder).toHaveBeenCalledWith(COPY, 'setup'));
  });

  it('has no OPEN IN BUILDER without a builder to open', async () => {
    open();
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(screen.queryByText('OPEN IN BUILDER')).toBeNull();
  });
});

describe('NEW', () => {
  it('makes a draft from a name, then shows it picked in SYSTEMS', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    open();
    await folder('NEW');
    expect((screen.getByText('CREATE') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('NAME'), '  Tidewater {Enter}');
    expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/api/systems', method: 'POST', body: { name: 'Tidewater' } });
    expect(await screen.findByText('Made Tidewater as a draft.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'SYSTEMS' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(entry('Tidewater').getAttribute('aria-pressed')).toBe('true'));
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('refuses a name in use where it was typed, keeping it to change', async () => {
    open();
    await folder('NEW');
    await userEvent.type(screen.getByLabelText('NAME'), 'hearth');
    await userEvent.click(screen.getByText('CREATE'));
    expect((await screen.findByRole('alert')).textContent).toBe('Another system is already called Hearth.');
    expect((screen.getByLabelText('NAME') as HTMLInputElement).value).toBe('hearth');
    expect(document.activeElement).toBe(screen.getByLabelText('NAME'));
    await userEvent.type(screen.getByLabelText('NAME'), 'fire');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts blank only, for now', async () => {
    open();
    await folder('NEW');
    const starts = within(screen.getByRole('radiogroup', { name: 'Start from' })).getAllByRole('radio') as HTMLButtonElement[];
    expect(starts.map((b) => [b.textContent!.split('A name')[0].split('Cities')[0].split('Fantasy')[0], b.disabled, b.getAttribute('aria-checked')])).toEqual([
      ['BLANK', false, 'true'], ['A BUILT-IN EXAMPLE', true, 'false'], ['A GENRE STARTER', true, 'false'],
    ]);
  });
});

describe('INSTALL', () => {
  /** The INSTALL button, not the INSTALL folder. */
  const installButton = () => screen.getAllByRole('button', { name: 'INSTALL' }).find((b) => b.getAttribute('role') !== 'tab')!;
  const choose = async (text = '{"citysys":1}', name = 'iron-sea.citysys') => {
    await userEvent.upload(screen.getByLabelText('System file'), new File([text], name, { type: 'application/json' }));
  };

  it('previews a file, then installs it, saying so', async () => {
    open();
    await folder('INSTALL');
    await choose();
    const cover = await screen.findByTestId('install-cover');
    expect(calls.find((c) => c.url === '/api/systems/install/preview')!.body).toEqual({ file: '{"citysys":1}' });
    expect(within(cover).getByText('IRON SEA')).toBeTruthy();
    expect(within(cover).getByText('M. Okafor')).toBeTruthy();
    expect(within(cover).getByText('CITY_NET 1.15.0')).toBeTruthy();
    expect(within(cover).getByText('12 WORDS RENAMED')).toBeTruthy();
    expect(screen.getByText('iron-sea.citysys · CHOOSE ANOTHER FILE')).toBeTruthy();
    expect(screen.getByText('Not installed here. It installs as a new system, published and ready to run.')).toBeTruthy();
    await userEvent.click(installButton());
    expect(calls.find((c) => c.url === '/api/systems/install')!.body).toEqual({ file: '{"citysys":1}', mode: 'new' });
    expect(await screen.findByText('Installed Iron Sea v4. It\'s in the list and the game-system picker.')).toBeTruthy();
    expect(screen.queryByTestId('install-cover')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'SYSTEMS' }));
    expect(entry('Iron Sea').getAttribute('aria-pressed')).toBe('true');
  });

  it('asks before REPLACING changes made here, and sends the say-so only then', async () => {
    previewAnswer = { status: 200, body: {
      ...PREVIEW, installed: [{ id: HEARTH, name: 'Iron Sea (ours)', version: 3, edited: true }],
      installsAs: { new: null, update: 'Iron Sea (ours)', keep_both: 'Iron Sea copy' },
    } };
    open();
    await folder('INSTALL');
    await choose();
    await userEvent.click(await screen.findByText('REPLACE WITH v4'));
    const ask = screen.getByRole('alertdialog', { name: 'REPLACE WITH v4' });
    expect(within(ask).getByText('Your changes to Iron Sea (ours) since you installed it will be lost. Characters, banks and tokens are kept.')).toBeTruthy();
    await userEvent.click(within(ask).getByText('CANCEL'));
    expect(calls.some((c) => c.url === '/api/systems/install')).toBe(false);
    await userEvent.click(screen.getByText('REPLACE WITH v4'));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByText('REPLACE WITH v4'));
    expect(calls.find((c) => c.url === '/api/systems/install')!.body).toEqual({ file: '{"citysys":1}', mode: 'update', replaceChanges: true });
  });

  it('keeps both without asking, and won\'t update with a file that has problems', async () => {
    previewAnswer = { status: 200, body: {
      ...PREVIEW, problems: [{ where: 'derived armor', message: 'Depends on itself' }],
      installed: [{ id: HEARTH, name: 'Iron Sea', version: 3, edited: false }],
      installsAs: { new: null, update: 'Iron Sea', keep_both: 'Iron Sea copy' },
    } };
    open();
    await folder('INSTALL');
    await choose();
    expect(await screen.findByText('derived armor: Depends on itself')).toBeTruthy();
    expect((screen.getByText('UPDATE TO v4') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('UPDATE TO v4: The file has problems.')).toBeTruthy();
    await userEvent.click(screen.getByText('KEEP BOTH, AS A DRAFT'));
    expect(calls.find((c) => c.url === '/api/systems/install')!.body).toEqual({ file: '{"citysys":1}', mode: 'keep_both' });
  });

  it('says why a file can\'t be read, and refuses one far too large without sending it', async () => {
    previewAnswer = { status: 400, body: { error: 'Not a CITY_NET system file' } };
    open();
    await folder('INSTALL');
    await choose('hello', 'notes.txt');
    expect((await screen.findByRole('alert')).textContent).toBe('Not a CITY_NET system file');
    expect(screen.queryByTestId('install-cover')).toBeNull();
    const before = calls.length;
    await choose('x'.repeat(1024 * 1024 + 1), 'huge.citysys');
    expect((await screen.findByRole('alert')).textContent).toBe('huge.citysys is over 1 MB, too large to be a system file.');
    expect(calls.length).toBe(before);
  });

  it('shows a refused install where it happened', async () => {
    installAnswer = { status: 409, body: { error: 'Already installed. Update it or keep both.' } };
    open();
    await folder('INSTALL');
    await choose();
    await screen.findByTestId('install-cover');
    await userEvent.click(installButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Already installed. Update it or keep both.');
    expect(screen.getByTestId('install-cover')).toBeTruthy();
  });
});

describe('the GAME tab', () => {
  let pickerFetches = 0;
  beforeEach(() => {
    pickerFetches = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/sheets/system') pickerFetches += 1;
      return { ok: true, json: async () => (String(url) === '/api/sheets/system' ? { system: 'generic', systems: [] } : []) };
    }));
  });
  const props = (onOpenSystems?: () => void): any => ({
    socketRef: { current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }, token: 'admintoken', onLogout: vi.fn(),
    refreshLocations: vi.fn(), refreshRoads: vi.fn(), locations: [], roads: [], editData: {}, setEditData: vi.fn(),
    editId: null, setEditId: vi.fn(), view: 'list', setView: vi.fn(), pendingRequests: [], setPendingRequests: vi.fn(),
    selectedIds: [], setSelectedIds: vi.fn(), districts: [], fetchDistricts: vi.fn(), districtConfig: {}, setDistrictConfig: vi.fn(),
    fetchGlobalSettings: vi.fn(), activeUsers: [], setIsAdminPayOpen: vi.fn(), handleSaveDefault: vi.fn(), handleLoadDefault: vi.fn(),
    globalSettings: { game_system: 'generic' }, gameSystem: 'generic', onOpenSystems,
  });
  const ttrpg = async (onOpenSystems?: () => void) => {
    render(<AdminPanel {...props(onOpenSystems)} />);
    await userEvent.click(screen.getByText('GAME'));
    await userEvent.click(screen.getByText(/TTRPG_SYSTEM/));
  };

  it('opens SYSTEMS.EXE from one button under the picker', async () => {
    const opened = vi.fn();
    await ttrpg(opened);
    await userEvent.click(screen.getByText('SYSTEMS.EXE'));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('has no button for anyone but the main admin', async () => {
    await ttrpg(undefined);
    expect(screen.queryByText('SYSTEMS.EXE')).toBeNull();
  });

  it('fetches the picker\'s list again when SYSTEMS.EXE changes a system', async () => {
    await ttrpg(vi.fn());
    await waitFor(() => expect(pickerFetches).toBe(1));
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
    await waitFor(() => expect(pickerFetches).toBe(2));
  });
});
