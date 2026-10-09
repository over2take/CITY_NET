import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/locationHelpers', () => ({
  isUserDefinedName: (name: string) => !!name && name.trim() !== '',
  getStructLabel: (loc: any) => `STRUCT_${loc.id}`,
}));
vi.mock('../../assets/Credits.png', () => ({ default: 'credits.png' }));
vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => <div><div data-testid="window-title">{title}</div>{children}</div>,
}));

import { BuilderScreen } from '../BuilderScreen';
import { AdminPanel } from '../AdminPanel';
import { SYSTEMS_CHANGED_EVENT } from '../../sheets/systemsLibrary';
import type { SystemCopies } from '../../sheets/systemsApi';
import { createRequire } from 'module';

const { starterSheet, effectiveSheet } = createRequire(import.meta.url)('../../../../backend/systemBuilder/sheet.js');
const { tryHealth } = createRequire(import.meta.url)('../../../../backend/systemBuilder/tryHealth.js');
const { previewDerived } = createRequire(import.meta.url)('../../../../backend/systemBuilder/derived.js');
const { exampleList, exampleDefinition, exampleKind } = createRequire(import.meta.url)('../../../../backend/systemBuilder/examples.js');

/**
 * The builder screen (4a2b): it takes over the window, with its own sidebar of pages, SAVE,
 * PUBLISH and EXIT TO MAP. Design approved 2026-09-29; saving decided 2026-10-06 (two layers,
 * leaving warns only when saving failed). The pages arrive in later pieces; PROBLEMS is real now.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const PROBLEM = { where: 'derived armor', message: 'Depends on itself: armor → armor' };

const EMBER = 'sys_bbbbbbbbbbbbbbbb';
const row = (id: string, name: string, over = {}) => ({
  id, name, version: 2, updatedAt: '2026-10-06 14:10:00', publishedAt: null, published: true,
  unpublishedChanges: false, installed: false, problemCount: 0, description: '', author: '', characterCount: 0, ...over,
});
const LIBRARY = [row(HEARTH, 'Hearth', { version: 3 }), row(EMBER, 'Ember', { installed: true, problemCount: 1 })];

let served: SystemCopies;
let calls: { url: string; method: string }[];
let publishAnswer: { status: number; body: unknown };
let draftAnswer: { status: number; body: unknown };
let drafts: unknown[];
let posts: unknown[];
const COPY = 'sys_cccccccccccccccc';

const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ url, method });
  const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
  if (url === `/api/systems/${HEARTH}` && method === 'GET') return json(200, served);
  if (url === `/api/systems/${HEARTH}/name` && method === 'PUT') return json(200, { name: JSON.parse(String(init!.body)).name });
  if (url === `/api/systems/${HEARTH}/draft` && method === 'PUT') {
    drafts.push(JSON.parse(String(init!.body)).definition);
    return json(draftAnswer.status, draftAnswer.body);
  }
  if (url === '/api/systems' && method === 'GET') return json(200, LIBRARY);
  if (url === '/api/systems' && method === 'POST') {
    const body = JSON.parse(String(init!.body));
    posts.push(body);
    if (body.name.trim().toLowerCase() === 'hearth') return json(409, { error: 'Another system is already called Hearth.' });
    return json(200, { id: COPY, problems: [] });
  }
  if (url === '/api/systems/examples') return json(200, exampleList());
  const ex = /^\/api\/systems\/examples\/([a-z0-9]+)$/.exec(url);
  if (ex) {
    const definition = exampleDefinition(ex[1]);
    return definition ? json(200, { id: ex[1], kind: exampleKind(ex[1]), definition }) : json(404, { error: 'No such example' });
  }
  if (url === '/api/systems/try-health') {
    const body = JSON.parse(String(init!.body));
    return json(200, tryHealth(body.definition, body));
  }
  if (url === '/api/systems/preview-values') {
    const { definition } = JSON.parse(String(init!.body));
    return json(200, previewDerived({ lookups: definition.lookups, derived: definition.derived }, definition.samples ?? {}));
  }
  if (url === '/api/systems/preview-sheet') {
    const { definition } = JSON.parse(String(init!.body));
    return json(200, { sheet: effectiveSheet(definition), starter: starterSheet(definition) });
  }
  if (url === `/api/systems/${HEARTH}/publish`) {
    if (publishAnswer.status === 200) served = { ...served, version: served.version + 1 };
    return json(publishAnswer.status, publishAnswer.body);
  }
  return json(404, { error: 'No such route' });
});

beforeEach(() => {
  calls = [];
  served = {
    id: HEARTH, name: 'Hearth', version: 3, updatedAt: '2026-10-06 14:10:00', publishedAt: '2026-10-05 20:00:00',
    draft: { format: 1, name: 'Hearth' }, published: { format: 1, name: 'Hearth' }, problems: [],
  };
  publishAnswer = { status: 200, body: { version: 4 } };
  draftAnswer = { status: 200, body: { problems: [] } };
  drafts = [];
  posts = [];
});
afterEach(() => cleanup());

const open = (over: Partial<React.ComponentProps<typeof BuilderScreen>> = {}) => {
  const onExit = vi.fn();
  const onOpenSystem = vi.fn();
  render(<BuilderScreen token="gm" systemId={HEARTH} running={null} onExit={onExit} onOpenSystem={onOpenSystem}
    fetcher={fakeServer as typeof fetch} {...over} />);
  return { onExit, onOpenSystem };
};
const sidebar = () => screen.getByRole('navigation', { name: 'Builder' });
const ready = () => waitFor(() => expect(screen.getByTestId('save-status')).toBeTruthy());

describe('the builder', () => {
  it('takes over the window, naming the system, on the page it was opened at', async () => {
    open({ startPage: 'setup' });
    await ready();
    expect(screen.getByTestId('builder-screen').style.position).toBe('fixed');
    expect(within(screen.getByTestId('builder-system')).getByText('HEARTH')).toBeTruthy();
    expect(within(screen.getByTestId('builder-system')).getByText('PUBLISHED v3')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SETUP');
    expect(within(sidebar()).getByText('SETUP').closest('button')!.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('heading', { name: 'WHAT IS IT?' })).toBeTruthy();
    expect(screen.getByTestId('save-status').textContent).toMatch(/^DRAFT · SAVED \d\d:\d\d$/);
  });

  it('STATS & RULES adds stats, saved like any other change', async () => {
    open({ startPage: 'rules' });
    await ready();
    await userEvent.click(await screen.findByText('+ GROUP'));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', stats: [{ id: 'new_group', label: 'NEW GROUP', stats: [] }] }));
  });

  it('TRY IT tries the draft without saving anything', async () => {
    open({ startPage: 'try' });
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'DAMAGE' }));
    expect((await screen.findByTestId('health-log')).textContent).toContain('DAMAGE 5 → 5/10');
    await new Promise((r) => setTimeout(r, 50));
    expect(drafts).toEqual([]);
  });

  it('CONDITIONS turns a standard condition off, saved like any other change', async () => {
    open({ startPage: 'conditions' });
    await ready();
    await userEvent.click(await screen.findByRole('switch', { name: 'Prone on' }));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', conditions: { prone: { on: false } } }));
  });

  it('CONDITIONS is locked on a built-in example like every other page', async () => {
    open({ systemId: null, example: 'cwn', startPage: 'conditions' });
    const sw = await screen.findByRole('switch', { name: 'Prone on' });
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(true));
    expect(screen.queryByRole('button', { name: 'UPLOAD' })).toBeNull();
  });

  it('NPCS adds a tier, saved like any other change', async () => {
    open({ startPage: 'npcs' });
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: '+ TIER' }));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', npc: { tiers: [{ id: 'new_tier', label: 'NEW TIER' }] } }));
  });

  it('CHARACTER SHEET customizes the sheet, saved like any other change', async () => {
    open({ startPage: 'sheet' });
    await ready();
    await userEvent.click(await screen.findByRole('button', { name: 'CUSTOMIZE THIS SHEET' }));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', sheet: starterSheet({ format: 1, name: 'Hearth' }) }));
  });

  it('FEATURES turns parts on and off, saved like any other change', async () => {
    open({ startPage: 'features' });
    await ready();
    await userEvent.click(await screen.findByRole('switch', { name: 'VEHICLES' }));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', parts: { vehicles: { on: false } } }));
  });

  it('WORDS edits the system\'s terms, saved like any other change', async () => {
    open({ startPage: 'words' });
    await ready();
    await userEvent.type(await screen.findByLabelText('HP one'), 'wound');
    expect(screen.getByTestId('save-status').textContent).toBe('DRAFT · UNSAVED CHANGES');
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', words: { hp: { singular: 'WOUND' } } }));
  });

  it('lists every page, each saying what it is for, and opens the one picked', async () => {
    open({ startPage: 'problems' });
    await ready();
    const pages = within(sidebar()).getAllByRole('button').filter((b) => b.title && !['PUBLISH', 'MY SYSTEMS'].includes(b.textContent!));
    expect(pages.map((b) => b.textContent)).toEqual(['SETUP', 'WORDS', 'FEATURES', 'STATS & RULES', 'CHARACTER SHEET', 'NPCS', 'CONDITIONS', 'TRY IT', 'PROBLEMS']);
    expect(pages[1].title).toBe('What the game calls things: HP, credits, skills.');
    await userEvent.click(pages[1]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WORDS');
    expect(pages[1].getAttribute('aria-current')).toBe('page');
    // The list of systems is read only by the pages that use it (MY SYSTEMS; SETUP's character count).
    expect(calls.some((c) => c.url === '/api/systems')).toBe(false);
  });

  it('keeps the map\'s icon rail narrow, widening to show the names on hover or keyboard focus', async () => {
    open();
    await ready();
    const rail = sidebar();
    expect(rail.className).toBe('icon-rail');
    expect(rail.getAttribute('data-expanded')).toBe('false');
    fireEvent.mouseEnter(rail);
    expect(rail.getAttribute('data-expanded')).toBe('true');
    expect(rail.style.width).toBe('220px');
    fireEvent.mouseLeave(rail);
    expect(rail.getAttribute('data-expanded')).toBe('false');
    expect(rail.style.width).toBe('');
    // Tabbing in opens it; moving between its buttons keeps it open; tabbing out closes it.
    act(() => within(rail).getByLabelText('MY SYSTEMS').focus());
    expect(rail.getAttribute('data-expanded')).toBe('true');
    act(() => within(rail).getByLabelText('SETUP').focus());
    expect(rail.getAttribute('data-expanded')).toBe('true');
    act(() => within(rail).getByLabelText('SETUP').blur());
    expect(rail.getAttribute('data-expanded')).toBe('false');
  });

  it('marks PROBLEMS on the rail with how many there are', async () => {
    served = { ...served, problems: [PROBLEM] };
    open();
    await ready();
    expect(within(sidebar()).getByLabelText('PROBLEMS').textContent).toBe('PROBLEMS1');
  });

  it('a never-published draft says so', async () => {
    served = { ...served, version: 0, published: null };
    open();
    await ready();
    expect(within(screen.getByTestId('builder-system')).getByText('NEVER PUBLISHED')).toBeTruthy();
  });

  it('says when the system can\'t be read', async () => {
    open({ fetcher: (async () => ({ ok: false, status: 404, json: async () => ({ error: 'No such system' }) })) as never });
    expect((await screen.findByRole('alert')).textContent).toBe('No such system');
  });
});

describe('PROBLEMS', () => {
  it('lists the draft\'s problems, counted in the sidebar and the status line', async () => {
    served = { ...served, problems: [PROBLEM, { where: 'name', message: 'Required' }] };
    open({ startPage: 'problems' });
    await ready();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['derived armor: Depends on itself: armor → armor', 'name: Required']);
    expect(within(screen.getByTestId('builder-system')).getByText('2 PROBLEMS')).toBeTruthy();
    expect(screen.getByText('PROBLEMS: 2')).toBeTruthy();
  });

  it('says when there are none', async () => {
    open({ startPage: 'problems' });
    await ready();
    expect(screen.getByText('No problems. It can be published.')).toBeTruthy();
  });
});

describe('PUBLISH', () => {
  it('publishes, says the game runs it now when it does, and tells the picker', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    open({ running: HEARTH });
    await ready();
    await userEvent.click(screen.getByText('PUBLISH'));
    expect(await screen.findByText('Published v4. The game runs it from now on.')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([`/api/systems/${HEARTH}/publish`]);
    await waitFor(() => expect(within(screen.getByTestId('builder-system')).getByText('PUBLISHED v4')).toBeTruthy());
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('says it is ready to pick when the game runs another system', async () => {
    open({ running: 'cities_without_number' });
    await ready();
    await userEvent.click(screen.getByText('PUBLISH'));
    expect(await screen.findByText('Published v4. It\'s ready to pick in the game-system picker.')).toBeTruthy();
  });

  it('with problems, opens PROBLEMS and says why, sending nothing', async () => {
    served = { ...served, problems: [PROBLEM] };
    open({ startPage: 'words' });
    await ready();
    expect(screen.getByText('PUBLISH').closest('button')!.title).toBe('Fix this problem before publishing.');
    await userEvent.click(screen.getByText('PUBLISH'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PROBLEMS');
    expect(screen.getByRole('status').textContent).toBe('Fix this problem before publishing.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the server\'s refusal, opening PROBLEMS when it lists some', async () => {
    publishAnswer = { status: 409, body: { error: 'Fix these before publishing', problems: [PROBLEM] } };
    open();
    await ready();
    await userEvent.click(screen.getByText('PUBLISH'));
    expect(await screen.findByText('Fix these before publishing')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PROBLEMS');
    publishAnswer = { status: 500, body: { error: 'Could not reach the systems store' } };
    await userEvent.click(within(sidebar()).getByText('WORDS'));
    await userEvent.click(screen.getByText('PUBLISH'));
    expect(await screen.findByText('Could not reach the systems store')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WORDS');
  });
});

describe('leaving', () => {
  it('EXIT TO MAP goes straight back when nothing is unsaved', async () => {
    const { onExit, onOpenSystem } = open();
    await ready();
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onOpenSystem).not.toHaveBeenCalled();
  });
});

describe('MY SYSTEMS', () => {
  it('is the builder\'s page for every system, the open one opened out', async () => {
    const { onExit } = open({ running: HEARTH });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('MY SYSTEMS'));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Your systems' })).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('MY SYSTEMS');
    expect(within(sidebar()).getByLabelText('MY SYSTEMS').getAttribute('aria-current')).toBe('page');
    expect(within(screen.getByTestId(`system-${HEARTH}`)).getByText('OPEN NOW IN THE BUILDER')).toBeTruthy();
    expect(screen.queryByText('OPEN SYSTEMS.EXE')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('OPEN on another system opens it here, on SETUP', async () => {
    const { onOpenSystem, onExit } = open();
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('MY SYSTEMS'));
    await waitFor(() => expect(screen.getByTestId(`system-${EMBER}`)).toBeTruthy());
    await userEvent.click(within(screen.getByTestId(`system-${EMBER}`)).getAllByRole('button')[0]);
    await userEvent.click(within(screen.getByTestId(`system-${EMBER}`)).getByText('OPEN'));
    await waitFor(() => expect(onOpenSystem).toHaveBeenCalledWith(EMBER, 'setup'));
    expect(onExit).not.toHaveBeenCalled();
  });

  it('says what it did on the builder\'s status line', async () => {
    open();
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('MY SYSTEMS'));
    await waitFor(() => expect(screen.getByTestId(`system-${EMBER}`)).toBeTruthy());
    await userEvent.click(within(screen.getByTestId(`system-${EMBER}`)).getAllByRole('button')[0]);
    await userEvent.click(within(screen.getByTestId(`system-${EMBER}`)).getByText('DUPLICATE'));
    // The fake server has no duplicate route, so the refusal is what the status line shows.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No such route'));
  });
});

describe('with no system open', () => {
  it('opens on MY SYSTEMS, the only page there is, with nothing to save or publish', async () => {
    const { onOpenSystem } = open({ systemId: null, startPage: 'setup' });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Your systems' })).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('MY SYSTEMS');
    expect(within(screen.getByTestId('builder-system')).getByText('NO SYSTEM OPEN')).toBeTruthy();
    for (const label of ['SETUP', 'WORDS', 'PROBLEMS', 'SAVE', 'PUBLISH']) {
      expect((within(sidebar()).getByLabelText(label) as HTMLButtonElement).disabled, label).toBe(true);
    }
    expect(within(sidebar()).getByLabelText('SETUP').title).toBe('Open a system first, in MY SYSTEMS.');
    expect(screen.queryByTestId('save-status')).toBeNull();
    // Only the list is read: there is no system to fetch.
    expect(calls.map((c) => c.url)).toEqual(['/api/systems']);
    expect(screen.queryByRole('alert')).toBeNull();
    // Nothing is open, so OPEN goes straight there.
    await userEvent.click(within(screen.getByTestId(`system-${EMBER}`)).getAllByRole('button')[0]);
    await userEvent.click(within(screen.getByTestId(`system-${EMBER}`)).getByText('OPEN'));
    await waitFor(() => expect(onOpenSystem).toHaveBeenCalledWith(EMBER, 'setup'));
  });

  it('EXIT TO MAP still leaves', async () => {
    const { onExit } = open({ systemId: null });
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('looking at a built-in example (4d1b)', () => {
  // Approved mockup builder-examples (2026-10-08): every page shown, everything locked but TRY IT,
  // nothing saved, COPY TO CHANGE IT under a name of the GM's own.
  const look = (page: 'rules' | 'try' | 'features' | 'sheet' = 'rules', over = {}) =>
    open({ systemId: null, example: 'cwn', startPage: page, ...over });
  const banner = () => screen.getByRole('region', { name: 'Example' });

  it('opens it under its own name, marked as an example, with nothing to save or publish', async () => {
    look();
    await screen.findByRole('region', { name: 'Example' });
    expect(within(screen.getByTestId('builder-system')).getByText('CITIES WITHOUT NUMBER')).toBeTruthy();
    expect(within(screen.getByTestId('builder-system')).getByText('EXAMPLE · READ ONLY')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('STATS & RULES');
    for (const label of ['SAVE', 'PUBLISH']) expect((within(sidebar()).getByLabelText(label) as HTMLButtonElement).disabled, label).toBe(true);
    for (const label of ['SETUP', 'WORDS', 'TRY IT', 'PROBLEMS']) expect((within(sidebar()).getByLabelText(label) as HTMLButtonElement).disabled, label).toBe(false);
    expect(calls.map((c) => c.url)).toContain('/api/systems/examples/cwn');
    expect(calls.some((c) => c.url === '/api/systems' || /\/api\/systems\/sys_/.test(c.url))).toBe(false);
  });

  it('shows every page with its boxes and buttons locked, its tabs still there to read', async () => {
    look();
    const strength = await screen.findByLabelText('Strength name');
    await waitFor(() => expect((strength as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByLabelText('Strength sample') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByText('+ GROUP').closest('button') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: 'FORMULAS' }));
    const save = await screen.findByLabelText('Physical save formula');
    await waitFor(() => expect((save as HTMLInputElement).disabled).toBe(true));
    expect((save as HTMLInputElement).value).toBe('16 - (@level + max(@str_mod, @con_mod))');
    expect(screen.getByTestId('locked-page')).toBeTruthy();
  });

  it('locks each page as it is opened from the rail, not only the first', async () => {
    look();
    await waitFor(() => expect((screen.getByLabelText('Strength name') as HTMLInputElement).disabled).toBe(true));
    await userEvent.click(within(sidebar()).getByLabelText('WORDS'));
    const boxes = within(screen.getByTestId('locked-page')).getAllByRole('textbox');
    expect(boxes.length).toBeGreaterThan(10);
    for (const box of boxes) expect((box as HTMLInputElement).disabled).toBe(true);
    // The banner's name box sits outside the page, so a copy can still be named.
    expect((within(banner()).getByLabelText('Name for the copy') as HTMLInputElement).disabled).toBe(false);
  });

  it('opens things out on FEATURES, but switches nothing', async () => {
    look('features');
    const opener = await within(await screen.findByTestId('part-bank')).findByRole('button', { name: /SETTINGS/, expanded: false });
    await userEvent.click(opener);
    await waitFor(() => expect(opener.getAttribute('aria-expanded')).toBe('true'));
    for (const s of screen.getAllByRole('switch')) expect((s as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets the CHARACTER SHEET preview be seen by each viewer, but not customized', async () => {
    look('sheet');
    const others = await screen.findByRole('button', { name: 'EVERYONE ELSE' });
    await waitFor(() => expect((screen.getByRole('button', { name: /CUSTOMIZE/ }) as HTMLButtonElement).disabled).toBe(true));
    expect((others as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(others);
    expect(others.getAttribute('aria-pressed')).toBe('true');
  });

  it('never saves, and says so if anything tries to change it', async () => {
    look();
    const strength = await screen.findByLabelText('Strength name');
    fireEvent.change(strength, { target: { value: 'Brawn' } });
    expect(screen.getByRole('status').textContent).toBe('This is an example: copy it to change it.');
    expect((screen.getByLabelText('Strength name') as HTMLInputElement).value).toBe('Strength');
    await new Promise((r) => setTimeout(r, 50));
    expect(drafts).toEqual([]);
  });

  it('leaves TRY IT usable, without SAVE AS THE SAMPLE CHARACTER', async () => {
    look('try');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Made-up character' })).toBeTruthy());
    const str = await within(screen.getByRole('region', { name: 'Made-up character' })).findByLabelText('Strength');
    expect((str as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(str, { target: { value: '18' } });
    expect(screen.queryByRole('button', { name: 'SAVE AS THE SAMPLE CHARACTER' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    expect((await screen.findByTestId('health-log')).textContent).toContain('DAMAGE 5');
    expect(screen.queryByTestId('locked-page')).toBeNull();
  });

  it('COPY TO CHANGE IT makes it the GM\'s own under the name typed, opened on SETUP', async () => {
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    const { onOpenSystem } = look();
    await screen.findByRole('region', { name: 'Example' });
    const name = within(banner()).getByLabelText('Name for the copy') as HTMLInputElement;
    expect(name.disabled).toBe(false);
    expect(name.placeholder).toBe('Cities Without Number (house rules)');
    await userEvent.click(within(banner()).getByRole('button', { name: 'COPY TO CHANGE IT' }));
    expect(within(banner()).getByRole('alert').textContent).toBe('Give the copy a name.');
    await userEvent.type(name, 'hearth{Enter}');
    expect((await within(banner()).findByRole('alert')).textContent).toBe('Another system is already called Hearth.');
    await userEvent.clear(name);
    await userEvent.type(name, 'Neon Nights');
    await userEvent.click(within(banner()).getByRole('button', { name: 'COPY TO CHANGE IT' }));
    await waitFor(() => expect(onOpenSystem).toHaveBeenCalledWith(COPY, 'setup'));
    expect(posts.at(-1)).toEqual({ name: 'Neon Nights', example: 'cwn' });
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('BACK TO + NEW goes back to where it was picked', async () => {
    look();
    await screen.findByRole('region', { name: 'Example' });
    await userEvent.click(within(banner()).getByRole('button', { name: 'BACK TO + NEW' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('MY SYSTEMS');
    expect(screen.getByRole('tab', { name: '+ NEW' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Example' })).toBeNull();
    // MY SYSTEMS is the GM's own, never locked.
    await new Promise((r) => setTimeout(r, 0));
    expect((screen.getByLabelText('NAME') as HTMLInputElement).disabled).toBe(false);
  });

  it('LOOK FIRST in + NEW asks for it to be opened', async () => {
    const onLookAt = vi.fn();
    open({ systemId: null, onLookAt });
    await userEvent.click(await screen.findByRole('tab', { name: '+ NEW' }));
    await userEvent.click(screen.getByRole('radio', { name: /A BUILT-IN EXAMPLE/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Look at Cities Without Number first' }));
    await waitFor(() => expect(onLookAt).toHaveBeenCalledWith('cwn'));
  });

  it('says so when it is a genre starter, locked and copied the same way', async () => {
    const { onOpenSystem } = look('rules', { example: 'narrative' });
    await screen.findByRole('region', { name: 'Example' });
    expect(within(banner()).getByText('A GENRE STARTER')).toBeTruthy();
    expect(within(screen.getByTestId('builder-system')).getByText('STORY FIRST')).toBeTruthy();
    expect(within(screen.getByTestId('builder-system')).getByText('STARTER · READ ONLY')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Forceful name') as HTMLInputElement).disabled).toBe(true));
    await userEvent.type(within(banner()).getByLabelText('Name for the copy'), 'Quiet Streets');
    await userEvent.click(within(banner()).getByRole('button', { name: 'COPY TO CHANGE IT' }));
    await waitFor(() => expect(onOpenSystem).toHaveBeenCalledWith(COPY, 'setup'));
    expect(posts.at(-1)).toEqual({ name: 'Quiet Streets', example: 'narrative' });
  });

  it('says when the example can\'t be read', async () => {
    look('rules', { example: 'dnd' });
    expect((await screen.findByRole('alert')).textContent).toBe('No such example');
    expect(screen.queryByRole('region', { name: 'Example' })).toBeNull();
  });
});

describe('saving what a page changes', () => {
  const describeIt = async (text: string) => {
    await waitFor(() => expect(screen.getByLabelText('DESCRIPTION')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('DESCRIPTION'), text);
  };

  it('shows the change as unsaved, and SAVE stores it with its problems', async () => {
    draftAnswer = { status: 200, body: { problems: [PROBLEM] } };
    open({ startPage: 'setup' });
    await ready();
    await describeIt('By one fire.');
    expect(screen.getByTestId('save-status').textContent).toBe('DRAFT · UNSAVED CHANGES');
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toMatch(/^DRAFT · SAVED \d\d:\d\d$/));
    expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', description: 'By one fire.' });
    expect(screen.getByText('PROBLEMS: 1')).toBeTruthy();
  });

  it('a rename in SETUP shows in the top bar at once, and the next save keeps it', async () => {
    open({ startPage: 'setup' });
    await ready();
    await waitFor(() => expect(screen.getByLabelText('NAME')).toBeTruthy());
    await userEvent.clear(screen.getByLabelText('NAME'));
    await userEvent.type(screen.getByLabelText('NAME'), 'Emberhold{Enter}');
    await waitFor(() => expect(within(screen.getByTestId('builder-system')).getByText('EMBERHOLD')).toBeTruthy());
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Emberhold' }));
  });

  it('asks before the browser tab closes while a change is unsaved', async () => {
    open({ startPage: 'setup' });
    await ready();
    await describeIt('x');
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('EXIT TO MAP saves first, then leaves', async () => {
    const { onExit } = open({ startPage: 'setup' });
    await ready();
    await describeIt('By one fire.');
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', description: 'By one fire.' });
  });

  it('when that save fails, asks: STAY, TRY AGAIN or EXIT WITHOUT SAVING', async () => {
    draftAnswer = { status: 500, body: { error: 'Could not reach the systems store' } };
    const { onExit } = open({ startPage: 'setup' });
    await ready();
    await describeIt('By one fire.');
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('EXIT.EXE · UNSAVED WORK');
    expect(dialog.textContent).toContain('Your latest changes to Hearth couldn\'t be saved: Could not reach the systems store');
    expect(screen.getByTestId('save-status').textContent).toBe('NOT SAVED: Could not reach the systems store');
    await userEvent.click(within(dialog).getByText('STAY'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    // Still failing: asked again. Then the server answers, and it leaves.
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByText('TRY AGAIN'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(onExit).not.toHaveBeenCalled();
    draftAnswer = { status: 200, body: { problems: [] } };
    await userEvent.click(within(screen.getByRole('dialog')).getByText('TRY AGAIN'));
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  });

  it('EXIT WITHOUT SAVING leaves at once', async () => {
    draftAnswer = { status: 500, body: { error: 'Could not reach the systems store' } };
    const { onExit, onOpenSystem } = open({ startPage: 'setup' });
    await ready();
    await describeIt('x');
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByText('EXIT WITHOUT SAVING'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onOpenSystem).not.toHaveBeenCalled();
  });

  it('PUBLISH saves first, and stops when that fails', async () => {
    draftAnswer = { status: 500, body: { error: 'Could not reach the systems store' } };
    open({ startPage: 'setup' });
    await ready();
    await describeIt('x');
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('NOT SAVED: Could not reach the systems store'));
    expect(calls.some((c) => c.url.endsWith('/publish'))).toBe(false);
  });
});

describe('closing the browser tab', () => {
  it('doesn\'t ask while everything is saved', async () => {
    open();
    await ready();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
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
  afterEach(() => vi.unstubAllGlobals());
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

  it('opens the builder from one SYSTEM BUILDER button under the picker', async () => {
    const opened = vi.fn();
    await ttrpg(opened);
    await userEvent.click(screen.getByText('SYSTEM BUILDER'));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('SYSTEMS.EXE')).toBeNull();
  });

  it('has no button for anyone but the main admin', async () => {
    await ttrpg(undefined);
    expect(screen.queryByText('SYSTEM BUILDER')).toBeNull();
  });

  it('fetches the picker\'s list again when the builder changes a system', async () => {
    await ttrpg(vi.fn());
    await waitFor(() => expect(pickerFetches).toBe(1));
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
    await waitFor(() => expect(pickerFetches).toBe(2));
  });
});
