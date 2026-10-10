import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MySystemsPage } from '../MySystemsPage';
import { systemsApi } from '../../sheets/systemsApi';
import { SYSTEMS_CHANGED_EVENT, changedFact, type LibrarySystem, type InstallPreview } from '../../sheets/systemsLibrary';
import { createRequire } from 'module';

/**
 * The builder's MY SYSTEMS page (4a2c2a): everything SYSTEMS.EXE did, inside the builder. Approved
 * mockup builder-my-systems (2026-10-06): line items opening out in place; + NEW opens what it
 * makes on SETUP; INSTALL A FILE offers OPEN IT. A taken name is refused where it was typed.
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
const AT = changedFact('2026-10-06 14:10:00');

let systems: LibrarySystem[];
let calls: { url: string; method: string; body: unknown }[];
let renameAnswer: { status: number; body: unknown } | null;
let examplesDown: boolean;
let exampleGone: string | null;
const { exampleList, exampleDefinition, exampleKind } = createRequire(import.meta.url)('../../../../backend/systemBuilder/examples.js');

const PREVIEW: InstallPreview = {
  manifest: { name: 'Iron Sea', author: 'M. Okafor', license: '', builder: '1.15.0', version: 4, origin: 'org_iron' },
  name: 'Iron Sea', inside: { words: 0, partsOff: 0, currencies: 0, derived: 0, lookups: 0, sheetFields: 0, npcTiers: 0, healthModel: null },
  problems: [], installed: [], restores: null, installsAs: { new: 'Iron Sea', update: null, keep_both: 'Iron Sea' },
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
  const listed = /^\/api\/systems\/examples(\?kind=starter)?$/.exec(url);
  if (listed) return examplesDown ? json(500, { error: 'Could not reach the systems store' }) : json(200, exampleList(listed[1] ? 'starter' : 'example'));
  const ex = /^\/api\/systems\/examples\/([a-z0-9]+)$/.exec(url);
  if (ex) return ex[1] === exampleGone ? json(404, { error: 'No such example' }) : json(200, { id: ex[1], kind: exampleKind(ex[1]), definition: exampleDefinition(ex[1]) });
  if (url === '/api/systems' && method === 'POST') {
    const taken = systems.find((s) => s.name.toLowerCase() === body.name.trim().toLowerCase());
    if (taken) return json(409, { error: `Another system is already called ${taken.name}.` });
    systems = [row({ id: COPY, name: body.name, published: false, version: 0 }), ...systems];
    return json(200, { id: COPY, problems: [] });
  }
  if (url === '/api/systems/install/preview') return json(200, PREVIEW);
  if (url === '/api/systems/install') {
    systems = [row({ id: COPY, name: 'Iron Sea', installed: true }), ...systems];
    return json(200, { id: COPY, name: 'Iron Sea', published: true, problems: [] });
  }
  const m = /^\/api\/systems\/(sys_[0-9a-f]+)(\/[a-z]+)?$/.exec(url);
  if (m) {
    const [, id, rest] = m;
    const s = systems.find((x) => x.id === id)!;
    if (rest === '/name') {
      if (renameAnswer) return json(renameAnswer.status, renameAnswer.body);
      s.name = body.name.trim();
      return json(200, { name: s.name });
    }
    if (rest === '/duplicate') {
      systems = [row({ id: COPY, name: `${s.name} copy`, published: false, version: 0 }), ...systems];
      return json(200, { id: COPY, name: `${s.name} copy` });
    }
    if (rest === '/export') return json(200, '{"citysys":1}', { 'Content-Disposition': 'attachment; filename="neon-exchange.citysys"' });
    if (!rest && method === 'DELETE') { systems = systems.filter((x) => x.id !== id); return json(200, { deleted: true }); }
  }
  return json(404, { error: 'No such route' });
});

beforeEach(() => {
  calls = [];
  renameAnswer = null;
  examplesDown = false;
  exampleGone = null;
  systems = [
    row({ description: 'Low fantasy around one village fire.', author: 'Cody', characterCount: 5 }),
    row({ id: NEON, name: 'Neon Exchange', version: 1, unpublishedChanges: true, characterCount: 1 }),
    row({ id: VAULT, name: 'Vault Knights', version: 0, published: false, unpublishedChanges: true, installed: true, problemCount: 3, author: 'R. Ade' }),
  ];
});
afterEach(() => cleanup());

const open = ({ openId = HEARTH as string | null, running = HEARTH as string | null, onLook = undefined as ((id: string) => void) | undefined, startTab = undefined as 'list' | 'new' | 'install' | undefined } = {}) => {
  const onOpen = vi.fn();
  const say = vi.fn();
  render(<MySystemsPage api={systemsApi('gm', fakeServer as typeof fetch)} openId={openId} running={running} onOpen={onOpen} say={say} onLook={onLook} startTab={startTab} />);
  return { onOpen, say };
};
const line = (id: string) => screen.getByTestId(`system-${id}`);
const header = (id: string) => within(line(id)).getAllByRole('button')[0];
const ready = () => waitFor(() => expect(screen.getByRole('group', { name: 'Your systems' })).toBeTruthy());

describe('the line items', () => {
  it('show each system\'s name, version, description, facts and badges, the open one opened out', async () => {
    open();
    await ready();
    expect(header(HEARTH).textContent).toBe(`HEARTHOPEN NOWLow fantasy around one village fire.BY CODYCHANGED ${AT}MADE HERE5 CHARACTERSRUNNINGPUBLISHED v3`);
    expect(header(NEON).textContent).toBe(`NEON EXCHANGEv1No description yet. SETUP asks for one.CHANGED ${AT}MADE HERE1 CHARACTERPUBLISHED v1UNPUBLISHED CHANGES`);
    expect(header(VAULT).textContent).toBe(`VAULT KNIGHTSDRAFTNo description yet. SETUP asks for one.BY R. ADECHANGED ${AT}INSTALLED FROM A FILE0 CHARACTERSNEVER PUBLISHED3 PROBLEMSINSTALLED`);
    expect(header(HEARTH).getAttribute('aria-expanded')).toBe('true');
    expect(within(line(HEARTH)).getByText('OPEN NOW IN THE BUILDER')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'YOUR SYSTEMS · 3' }).getAttribute('aria-selected')).toBe('true');
  });

  it('open out one at a time, and close again', async () => {
    open();
    await ready();
    await userEvent.click(header(NEON));
    expect(header(NEON).getAttribute('aria-expanded')).toBe('true');
    expect(header(HEARTH).getAttribute('aria-expanded')).toBe('false');
    expect(within(line(HEARTH)).queryByText('RENAME')).toBeNull();
    await userEvent.click(header(NEON));
    expect(header(NEON).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('RENAME')).toBeNull();
  });

  it('OPEN opens another in the builder, which saves the open one first', async () => {
    const { onOpen } = open();
    await ready();
    await userEvent.click(header(NEON));
    expect(within(line(NEON)).getByText('OPEN saves the one you have open first.')).toBeTruthy();
    await userEvent.click(within(line(NEON)).getByText('OPEN'));
    expect(onOpen).toHaveBeenCalledWith(NEON, 'setup');
  });

  it('with nothing open, nothing is opened out and OPEN needs no warning', async () => {
    open({ openId: null });
    await ready();
    expect(screen.queryByText('RENAME')).toBeNull();
    await userEvent.click(header(NEON));
    expect(within(line(NEON)).queryByText('OPEN saves the one you have open first.')).toBeNull();
  });

  it('say when there are none, and when the list can\'t be read', async () => {
    systems = [];
    open();
    expect(await screen.findByText('No systems of your own yet. Make one in + NEW, or install a file.')).toBeTruthy();
    cleanup();
    render(<MySystemsPage api={systemsApi('gm', (async () => { throw new TypeError('down'); }) as never)} openId={null} running={null} onOpen={vi.fn()} say={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.');
  });
});

describe('RENAME, DUPLICATE, EXPORT, DELETE', () => {
  it('RENAME renames at once and tells the picker', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    const { say } = open();
    await ready();
    await userEvent.click(within(line(HEARTH)).getByText('RENAME'));
    await userEvent.clear(screen.getByLabelText('New name'));
    await userEvent.type(screen.getByLabelText('New name'), 'Emberhold{Enter}');
    await waitFor(() => expect(say).toHaveBeenCalledWith('Renamed to Emberhold.'));
    await waitFor(() => expect(header(HEARTH).textContent).toMatch(/^EMBERHOLD/));
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('a refused name stays in the box, with why, to change it there', async () => {
    renameAnswer = { status: 409, body: { error: 'Another system is already called Neon Exchange.' } };
    open();
    await ready();
    await userEvent.click(within(line(HEARTH)).getByText('RENAME'));
    const input = screen.getByLabelText('New name') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'neon exchange');
    await userEvent.click(screen.getByText('SAVE'));
    expect((await screen.findByRole('alert')).textContent).toBe('Another system is already called Neon Exchange.');
    expect(input.value).toBe('neon exchange');
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, 's');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.type(input, '{Escape}');
    expect(screen.queryByLabelText('New name')).toBeNull();
  });

  it('DUPLICATE makes the copy and opens it out', async () => {
    const { say } = open();
    await ready();
    await userEvent.click(within(line(HEARTH)).getByText('DUPLICATE'));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Copied as Hearth copy: a draft, its own system.'));
    await waitFor(() => expect(header(COPY).getAttribute('aria-expanded')).toBe('true'));
  });

  it('EXPORT downloads a published one, and is off for one never published', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { say } = open();
    await ready();
    await userEvent.click(header(NEON));
    await userEvent.click(within(line(NEON)).getByText('EXPORT .CITYSYS'));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Downloading neon-exchange.citysys (v1).'));
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('neon-exchange.citysys');
    click.mockRestore();
    await userEvent.click(header(VAULT));
    expect((within(line(VAULT)).getByText('EXPORT .CITYSYS') as HTMLButtonElement).disabled).toBe(true);
    expect(within(line(VAULT)).getByText('EXPORT: Publish it before sharing it. Only a published system is shared.')).toBeTruthy();
  });

  it('DELETE is off for the running system and the one open here, saying why', async () => {
    open({ openId: NEON, running: HEARTH });
    await ready();
    await userEvent.click(header(HEARTH));
    expect((within(line(HEARTH)).getByText('DELETE') as HTMLButtonElement).disabled).toBe(true);
    expect(within(line(HEARTH)).getByText('DELETE: This is the system the game is running. Switch to another first.')).toBeTruthy();
    await userEvent.click(header(NEON));
    expect(within(line(NEON)).getByText('DELETE: It\'s open in the builder. Open another first.')).toBeTruthy();
  });

  it('DELETE asks first; KEEP IT keeps it, DELETE hides it', async () => {
    const { say } = open();
    await ready();
    await userEvent.click(header(VAULT));
    await userEvent.click(within(line(VAULT)).getByText('DELETE'));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete Vault Knights' })).getByText('KEEP IT'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(within(line(VAULT)).getByText('DELETE'));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByText('DELETE'));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Deleted Vault Knights. Installing its file brings it back.'));
    await waitFor(() => expect(screen.queryByTestId(`system-${VAULT}`)).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/systems/${VAULT}`);
  });
});

describe('+ NEW and INSTALL A FILE', () => {
  it('+ NEW makes one and opens it on SETUP, telling the picker', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    const { onOpen } = open();
    await ready();
    await userEvent.click(screen.getByRole('tab', { name: '+ NEW' }));
    await userEvent.type(screen.getByLabelText('NAME'), 'Tidewater{Enter}');
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(COPY, 'setup'));
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('+ NEW refuses a name in use where it was typed', async () => {
    const { onOpen } = open();
    await ready();
    await userEvent.click(screen.getByRole('tab', { name: '+ NEW' }));
    await userEvent.type(screen.getByLabelText('NAME'), 'hearth{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('Another system is already called Hearth.');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('can open on + NEW', async () => {
    open({ startTab: 'new' });
    expect(screen.getByRole('tab', { name: '+ NEW' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('NAME')).toBeTruthy();
  });

  it('INSTALL A FILE installs, then offers OPEN IT', async () => {
    const { onOpen } = open();
    await ready();
    await userEvent.click(screen.getByRole('tab', { name: 'INSTALL A FILE' }));
    await userEvent.upload(screen.getByLabelText('System file'), new File(['{"citysys":1}'], 'iron-sea.citysys'));
    await screen.findByTestId('install-cover');
    await userEvent.click(screen.getAllByRole('button', { name: 'INSTALL' })[0]);
    expect(await screen.findByText('Installed Iron Sea v4. It\'s in the list and the game-system picker.')).toBeTruthy();
    await userEvent.click(screen.getByText('OPEN IT'));
    expect(onOpen).toHaveBeenCalledWith(COPY, 'setup');
    // Back on the list, it is there.
    await userEvent.click(screen.getByRole('tab', { name: 'YOUR SYSTEMS · 4' }));
    expect(screen.getByTestId(`system-${COPY}`)).toBeTruthy();
  });
});

describe('+ NEW from a built-in example (4d1b)', () => {
  // Approved mockup builder-examples (2026-10-08): a card each, LOOK FIRST, a copy under a name of the GM's own.
  const pickExamples = async (over: Parameters<typeof open>[0] = {}) => {
    const opened = open({ startTab: 'new', ...over });
    await userEvent.click(screen.getByRole('radio', { name: /A BUILT-IN EXAMPLE/ }));
    return opened;
  };
  const card = (id: string) => screen.getByTestId(`example-${id}`);

  it('shows a card for each, saying what it holds, the first picked and named on the button', async () => {
    await pickExamples();
    await screen.findByTestId('example-cwn');
    expect(within(card('cwn')).getByText('14 in 6 groups')).toBeTruthy();
    expect(within(card('cwn')).getByText('One pool')).toBeTruthy();
    expect(within(card('sr6')).getByText('Two tracks, overflow')).toBeTruthy();
    expect(within(card('sr6')).getByText('Spend KARMA')).toBeTruthy();
    expect(within(card('cwn')).getByRole('radio', { name: 'CITIES WITHOUT NUMBER' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('NAME') as HTMLInputElement).placeholder).toBe('Cities Without Number (house rules)');
    expect((screen.getByRole('button', { name: 'COPY CITIES WITHOUT NUMBER' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no link back to the example/)).toBeTruthy();
  });

  it('copies the one picked under the name typed, and opens it on SETUP, telling the picker', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    const { onOpen } = await pickExamples();
    await userEvent.click(await within(await screen.findByTestId('example-sr6')).findByRole('radio', { name: 'SHADOWRUN 6E' }));
    await userEvent.type(screen.getByLabelText('NAME'), 'Runners');
    await userEvent.click(screen.getByRole('button', { name: 'COPY SHADOWRUN 6E' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(COPY, 'setup'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Runners', example: 'sr6' });
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('refuses a name in use where it was typed', async () => {
    const { onOpen } = await pickExamples();
    await screen.findByTestId('example-cwn');
    await userEvent.type(screen.getByLabelText('NAME'), 'Neon exchange{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('Another system is already called Neon Exchange.');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('LOOK FIRST opens the one asked for, and is offered only where there is somewhere to look', async () => {
    const onLook = vi.fn();
    await pickExamples({ onLook });
    await userEvent.click(await screen.findByRole('button', { name: 'Look at Shadowrun 6E first' }));
    expect(onLook).toHaveBeenCalledWith('sr6');
    cleanup();
    await pickExamples();
    await screen.findByTestId('example-cwn');
    expect(screen.queryByText('LOOK FIRST')).toBeNull();
  });

  it('BLANK goes back to a plain CREATE, sending no example', async () => {
    const { onOpen } = await pickExamples();
    await screen.findByTestId('example-cwn');
    await userEvent.click(screen.getByRole('radio', { name: /^BLANK/ }));
    expect(screen.queryByTestId('example-cwn')).toBeNull();
    await userEvent.type(screen.getByLabelText('NAME'), 'Plain');
    await userEvent.click(screen.getByRole('button', { name: 'CREATE' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(COPY, 'setup'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Plain' });
  });

  it('says when the examples can\'t be read, and copies nothing', async () => {
    examplesDown = true;
    await pickExamples();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the examples: Could not reach the systems store');
    await userEvent.type(screen.getByLabelText('NAME'), 'Runners{Enter}');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('says so when one of them can\'t be read', async () => {
    exampleGone = 'sr6';
    await pickExamples();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the examples: No such example');
    expect(screen.queryByTestId('example-cwn')).toBeNull();
  });

});

describe('+ NEW from a genre starter (4d3b)', () => {
  // The same cards as the examples (the user's call, 2026-10-09: no mockup), listed apart from the games.
  const pickStarters = async (over: Parameters<typeof open>[0] = {}) => {
    const opened = open({ startTab: 'new', ...over });
    await userEvent.click(screen.getByRole('radio', { name: /A GENRE STARTER/ }));
    await screen.findByTestId('example-fantasy');
    return opened;
  };
  const card = (id: string) => screen.getByTestId(`example-${id}`);

  it('shows the three starters, not the games, each saying what it holds', async () => {
    await pickStarters();
    expect(screen.getByRole('radiogroup', { name: 'Starter' })).toBeTruthy();
    expect(within(card('fantasy')).getByText('SWORD & SPELL')).toBeTruthy();
    expect(within(card('scifi')).getByText('Wound count')).toBeTruthy();
    expect(within(card('narrative')).getByText('Harm levels')).toBeTruthy();
    expect(within(card('narrative')).getByText('Milestone')).toBeTruthy();
    expect(within(card('narrative')).getByText('Zones')).toBeTruthy();
    expect(screen.queryByTestId('example-cwn')).toBeNull();
    expect(calls.map((c) => c.url)).toContain('/api/systems/examples?kind=starter');
    expect((screen.getByLabelText('NAME') as HTMLInputElement).placeholder).toBe('Sword & Spell (house rules)');
    expect(screen.getByText(/no link back to the starter/)).toBeTruthy();
  });

  it('copies the one picked under the name typed, and opens it on SETUP', async () => {
    const { onOpen } = await pickStarters();
    await userEvent.click(within(card('scifi')).getByRole('radio', { name: 'STARFARER' }));
    await userEvent.type(screen.getByLabelText('NAME'), 'Deep Black');
    await userEvent.click(screen.getByRole('button', { name: 'COPY STARFARER' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(COPY, 'setup'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Deep Black', example: 'scifi' });
  });

  it('starts afresh when switching between games and starters', async () => {
    await pickStarters();
    await userEvent.click(within(card('narrative')).getByRole('radio', { name: 'STORY FIRST' }));
    expect(screen.getByRole('button', { name: 'COPY STORY FIRST' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /A BUILT-IN EXAMPLE/ }));
    await screen.findByTestId('example-cwn');
    expect(screen.queryByTestId('example-fantasy')).toBeNull();
    expect(screen.getByRole('button', { name: 'COPY CITIES WITHOUT NUMBER' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /A GENRE STARTER/ }));
    await screen.findByTestId('example-fantasy');
    expect(screen.getByRole('button', { name: 'COPY SWORD & SPELL' })).toBeTruthy();
  });

  it('LOOK FIRST opens a starter like an example', async () => {
    const onLook = vi.fn();
    await pickStarters({ onLook });
    await userEvent.click(screen.getByRole('button', { name: 'Look at Story First first' }));
    expect(onLook).toHaveBeenCalledWith('narrative');
  });

  it('says when the starters can\'t be read', async () => {
    examplesDown = true;
    open({ startTab: 'new' });
    await userEvent.click(screen.getByRole('radio', { name: /A GENRE STARTER/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the starters: Could not reach the systems store');
  });
});
