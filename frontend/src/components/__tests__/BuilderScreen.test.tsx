import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
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
import { standInsForReactFlow } from '../../test/reactFlow';
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
/** What PUBLISH would change (4h4): a first version, unless a test says otherwise. */
let previewAnswer: { status: number; body: unknown };
let draftAnswer: { status: number; body: unknown };
let drafts: unknown[];
let posts: unknown[];
/** Whether the server says the tour was seen (seen, so it stays out of the way, unless a test says), and what was marked. */
let tour: { status: number; seen: boolean };
let tourMarks: boolean[];
/** FORMS or GRAPH on STATS & RULES, as the server keeps it (Phase 5), and what was set. */
let rulesView: 'forms' | 'graph';
let viewMarks: unknown[];
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
  if (url === '/api/systems/tour' && method === 'GET') return json(tour.status, tour.status < 300 ? { seen: tour.seen } : { error: 'Down' });
  if (url === '/api/systems/tour' && method === 'PUT') {
    const { seen } = JSON.parse(String(init!.body));
    tourMarks.push(seen);
    tour = { ...tour, seen };
    return json(200, { seen });
  }
  if (url === '/api/systems/view' && method === 'GET') return json(200, { views: { rules: rulesView } });
  if (url === '/api/systems/view' && method === 'PUT') {
    const body = JSON.parse(String(init!.body));
    viewMarks.push(body);
    rulesView = body.view;
    return json(200, body);
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
  if (url === `/api/systems/${HEARTH}/publish-preview`) return json(previewAnswer.status, previewAnswer.body);
  if (url === `/api/systems/${HEARTH}/publish`) {
    if (publishAnswer.status === 200) served = { ...served, version: served.version + 1 };
    return json(publishAnswer.status, publishAnswer.body);
  }
  return json(404, { error: 'No such route' });
});

beforeEach(() => {
  calls = [];
  tour = { status: 200, seen: true };
  tourMarks = [];
  rulesView = 'forms';
  viewMarks = [];
  served = {
    id: HEARTH, name: 'Hearth', version: 3, updatedAt: '2026-10-06 14:10:00', publishedAt: '2026-10-05 20:00:00',
    draft: { format: 1, name: 'Hearth' }, published: { format: 1, name: 'Hearth' }, problems: [],
  };
  publishAnswer = { status: 200, body: { version: 4 } };
  previewAnswer = { status: 200, body: { first: true, problems: 0 } };
  draftAnswer = { status: 200, body: { problems: [] } };
  drafts = [];
  posts = [];
});
afterEach(() => cleanup());
beforeAll(() => standInsForReactFlow());

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

  // FORMS or GRAPH (Phase 5, 5a3a; approved mockup docs/mockups/builder-graph.html, 2026-10-17).
  describe('STATS & RULES as FORMS or GRAPH', () => {
    const view = () => screen.getByRole('group', { name: 'View' });

    it('offers FORMS and GRAPH on STATS & RULES only, FORMS until GRAPH is picked', async () => {
      open({ startPage: 'rules' });
      await ready();
      expect(within(view()).getByRole('button', { name: 'FORMS' }).getAttribute('aria-pressed')).toBe('true');
      expect(within(view()).getByRole('button', { name: 'GRAPH' }).getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByRole('tab', { name: 'FORMULAS' })).toBeTruthy();
      await userEvent.click(within(sidebar()).getByText('WORDS'));
      expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    });

    it('GRAPH shows the map in place of the forms, and the server remembers it', async () => {
      open({ startPage: 'rules' });
      await ready();
      await userEvent.click(within(view()).getByRole('button', { name: 'GRAPH' }));
      // The map loads on first use (React.lazy): given time, as a busy test run is slow to fetch it.
      expect(await screen.findByTestId('graph-view', {}, { timeout: 5000 })).toBeTruthy();
      expect(screen.queryByRole('tab', { name: 'FORMULAS' })).toBeNull();
      expect(viewMarks).toEqual([{ page: 'rules', view: 'graph' }]);
      await userEvent.click(within(view()).getByRole('button', { name: 'FORMS' }));
      expect(screen.getByRole('tab', { name: 'FORMULAS' })).toBeTruthy();
      expect(viewMarks).toEqual([{ page: 'rules', view: 'graph' }, { page: 'rules', view: 'forms' }]);
    });

    it('opens on GRAPH when that was picked last', async () => {
      rulesView = 'graph';
      open({ startPage: 'rules' });
      await ready();
      // The map loads on first use (React.lazy): given time, as a busy test run is slow to fetch it.
      expect(await screen.findByTestId('graph-view', {}, { timeout: 5000 })).toBeTruthy();
      expect(within(view()).getByRole('button', { name: 'GRAPH' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('a note\'s EDIT IN GRAPH opens the map on that note (5b5)', async () => {
      served = { ...served, draft: { format: 1, name: 'Hearth', stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] }],
        graph: { notes: [{ id: 'n1', on: 'abilities', text: 'Roll 3d6 in order.' }] } } };
      open({ startPage: 'rules' });
      await ready();
      const note = await screen.findByTestId('forms-note-n1');
      await userEvent.click(within(note).getByRole('button', { name: 'EDIT IN GRAPH' }));
      const panel = await screen.findByTestId('graph-panel', {}, { timeout: 5000 });
      expect((within(panel).getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Roll 3d6 in order.');
      expect(within(view()).getByRole('button', { name: 'GRAPH' }).getAttribute('aria-pressed')).toBe('true');
      expect(viewMarks).toEqual([{ page: 'rules', view: 'graph' }]);
      // Back to FORMS and to GRAPH again: the map opens on nothing in particular.
      await userEvent.click(within(view()).getByRole('button', { name: 'FORMS' }));
      await userEvent.click(within(view()).getByRole('button', { name: 'GRAPH' }));
      expect(await screen.findByTestId('graph-view', {}, { timeout: 5000 })).toBeTruthy();
      expect(screen.queryByTestId('graph-panel')).toBeNull();
    });

    it('the map lists the draft\'s problems, the same as PROBLEMS (5b6b)', async () => {
      rulesView = 'graph';
      served = { ...served, draft: { format: 1, name: 'Hearth', derived: [{ id: 'odd', label: 'Odd', formula: '@nowhere' }] },
        problems: [{ where: 'derived odd, formula', message: 'No stat or formula called @nowhere' }] };
      open({ startPage: 'rules' });
      await ready();
      const box = await screen.findByTestId('graph-problems', {}, { timeout: 5000 });
      await userEvent.click(within(box).getByRole('button', { name: /PROBLEMS/ }));
      expect(within(box).getByRole('list', { name: 'Problems' }).textContent).toContain('ODD: No stat or formula called @nowhere');
      expect(within(sidebar()).getByText('PROBLEMS').closest('button')!.textContent).toContain('1');
    });

    it('stays on FORMS when the server can\'t say', async () => {
      open({ startPage: 'rules', fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => (String(input) === '/api/systems/view'
        ? { ok: false, status: 500, json: async () => ({ error: 'Down' }) } : fakeServer(input, init))) as never });
      await ready();
      expect(within(view()).getByRole('button', { name: 'FORMS' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('tab', { name: 'FORMULAS' })).toBeTruthy();
    });
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

  it('RESTS turns a standard rest off, saved like any other change', async () => {
    open({ startPage: 'rests' });
    await ready();
    await userEvent.click(await screen.findByRole('switch', { name: 'End of scene on' }));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', rests: { end_of_scene: { on: false } } }));
  });

  it('RESTS is locked on a built-in example like every other page', async () => {
    open({ systemId: null, example: 'cwn', startPage: 'rests' });
    const sw = await screen.findByRole('switch', { name: 'End of scene on' });
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(true));
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

  it('PARTS turns parts on and off, saved like any other change', async () => {
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
    const pages = within(sidebar()).getAllByRole('button').filter((b) => b.title && !['PUBLISH', 'MY SYSTEMS', 'HELP'].includes(b.textContent!));
    expect(pages.map((b) => b.textContent)).toEqual(['SETUP', 'WORDS', 'PARTS', 'STATS & RULES', 'CHARACTER SHEET', 'NPCS', 'CONDITIONS', 'RESTS', 'HOUSE RULES', 'TRY IT', 'PROBLEMS']);
    expect(pages[1].title).toBe('What the game calls things: HP, credits, skills.');
    await userEvent.click(pages[1]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WORDS');
    expect(pages[1].getAttribute('aria-current')).toBe('page');
    // The list of systems is read only by the pages that use it (MY SYSTEMS; SETUP's character count).
    expect(calls.some((c) => c.url === '/api/systems')).toBe(false);
  });

  it('claims the pointer for the whole screen, which the map\'s overlay otherwise lets through to the map', async () => {
    // Without it, labels, "?" hints, plain buttons and INSTALL A FILE's drop box took no clicks on a
    // real install. jsdom can't lay a page out, so e2e/tests/builder-clicks checks it in a browser.
    open();
    await ready();
    expect(screen.getByTestId('builder-screen').style.pointerEvents).toBe('auto');
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
  it('CLOSE in MY SYSTEMS saves an unsaved change, then closes the system and stays in the builder', async () => {
    const onCloseSystem = vi.fn();
    const { onExit, onOpenSystem } = open({ startPage: 'rules', onCloseSystem });
    await ready();
    await userEvent.click(await screen.findByText('+ GROUP'));
    await userEvent.click(within(sidebar()).getByLabelText('MY SYSTEMS'));
    await waitFor(() => expect(screen.getByTestId(`system-${HEARTH}`)).toBeTruthy());
    await userEvent.click(within(screen.getByTestId(`system-${HEARTH}`)).getByRole('button', { name: 'CLOSE' }));
    await waitFor(() => expect(onCloseSystem).toHaveBeenCalledTimes(1));
    expect(drafts.at(-1)).toEqual({ format: 1, name: 'Hearth', stats: [{ id: 'new_group', label: 'NEW GROUP', stats: [] }] });
    expect(onExit).not.toHaveBeenCalled();
    expect(onOpenSystem).not.toHaveBeenCalled();
  });

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
    // Only the list is read, and whether the tour was seen: there is no system to fetch.
    expect(calls.map((c) => c.url).sort()).toEqual(['/api/systems', '/api/systems/tour']);
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

  it('opens things out on PARTS, but switches nothing', async () => {
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

describe('PUBLISH from v2 on (4h4)', () => {
  const PREVIEW = {
    first: false, from: 3, to: 4, problems: 0, sample: [],
    changes: [{ kind: 'sheet', change: 'removed', id: 'reputation', label: 'Reputation' }],
    characters: [{ kind: 'player', username: 'vex', name: 'Vex', changes: [{ kind: 'sheet', change: 'removed', id: 'reputation', label: 'Reputation', value: 3 }] }],
  };
  const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
  /** What was published: other pages post previews of their own. */
  const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/publish')).map((c) => c.url);

  it('shows what the new version changes first, in place of the open page, and publishes on PUBLISH vN', async () => {
    previewAnswer = { status: 200, body: PREVIEW };
    const told = vi.fn();
    window.addEventListener(SYSTEMS_CHANGED_EVENT, told);
    open({ startPage: 'words', running: HEARTH });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    expect(await screen.findByTestId('publish-preview')).toBeTruthy();
    expect(heading()).toBe('PUBLISH');
    expect(within(sidebar()).getByLabelText('PUBLISH').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/^PUBLISH v4 · WHAT CHANGES FROM v3/)).toBeTruthy();
    expect(screen.getByTestId('who').textContent).toBe('VEX has 3, kept');
    expect(posts()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'PUBLISH v4' }));
    expect(await screen.findByText('Published v4. The game runs it from now on.')).toBeTruthy();
    expect(posts()).toEqual([`/api/systems/${HEARTH}/publish`]);
    expect(heading()).toBe('WORDS');
    expect(screen.queryByTestId('publish-preview')).toBeNull();
    await waitFor(() => expect(within(screen.getByTestId('builder-system')).getByText('PUBLISHED v4')).toBeTruthy());
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener(SYSTEMS_CHANGED_EVENT, told);
  });

  it('goes back to editing without publishing', async () => {
    previewAnswer = { status: 200, body: PREVIEW };
    open({ startPage: 'rests' });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    await screen.findByTestId('publish-preview');
    await userEvent.click(screen.getByRole('button', { name: 'BACK TO EDITING' }));
    expect(heading()).toBe('RESTS');
    expect(screen.queryByTestId('publish-preview')).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('asks again on PUBLISH from the preview, still going back where it came from', async () => {
    previewAnswer = { status: 200, body: PREVIEW };
    open({ startPage: 'npcs' });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    await screen.findByTestId('publish-preview');
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/publish-preview')).length).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: 'BACK TO EDITING' }));
    expect(heading()).toBe('NPCS');
  });

  it('publishes a first version at once, with no preview', async () => {
    open({ startPage: 'words' });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    expect(await screen.findByText(/^Published v4/)).toBeTruthy();
    expect(screen.queryByTestId('publish-preview')).toBeNull();
    expect(heading()).toBe('WORDS');
  });

  it('says so when it can\'t ask, and publishes nothing', async () => {
    previewAnswer = { status: 500, body: { error: 'Could not reach the systems store' } };
    open({ startPage: 'words' });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    expect(await screen.findByText('Could not reach the systems store')).toBeTruthy();
    expect(heading()).toBe('WORDS');
    expect(posts()).toEqual([]);
  });

  it('opens PROBLEMS when the server refuses PUBLISH vN over them, and goes back when it refuses otherwise', async () => {
    previewAnswer = { status: 200, body: PREVIEW };
    publishAnswer = { status: 409, body: { error: 'Fix these before publishing', problems: [PROBLEM] } };
    open({ startPage: 'words' });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    await userEvent.click(await screen.findByRole('button', { name: 'PUBLISH v4' }));
    expect(await screen.findByText('Fix these before publishing')).toBeTruthy();
    expect(heading()).toBe('PROBLEMS');
    publishAnswer = { status: 500, body: { error: 'Could not reach the systems store' } };
    await userEvent.click(within(sidebar()).getByText('RESTS'));
    await userEvent.click(within(sidebar()).getByLabelText('PUBLISH'));
    await userEvent.click(await screen.findByRole('button', { name: 'PUBLISH v4' }));
    expect(await screen.findByText('Could not reach the systems store')).toBeTruthy();
    expect(heading()).toBe('RESTS');
    expect(screen.queryByTestId('publish-preview')).toBeNull();
  });
});

describe('HELP (4i)', () => {
  // Approved mockup builder-help (2026-10-13): HELP on the rail above SAVE, with or without a system.
  const help = () => userEvent.click(within(sidebar()).getByLabelText('HELP'));
  const topic = (title: string) => userEvent.click(within(screen.getByRole('navigation', { name: 'Help topics' })).getByRole('button', { name: title }));

  it('sits on the rail just above SAVE, and opens with no system open, GO TO waiting for one', async () => {
    open({ systemId: null });
    const names = within(sidebar()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.indexOf('HELP')).toBe(names.indexOf('SAVE') - 1);
    expect((within(sidebar()).getByLabelText('HELP') as HTMLButtonElement).disabled).toBe(false);
    await help();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('HELP');
    expect(within(sidebar()).getByLabelText('HELP').getAttribute('aria-current')).toBe('page');
    await topic('SETUP');
    expect((screen.getByRole('button', { name: 'GO TO SETUP' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('GO TO opens the page, and HELP comes back on the same topic', async () => {
    open({ startPage: 'setup' });
    await ready();
    await help();
    await topic('WORDS');
    await userEvent.click(screen.getByRole('button', { name: 'GO TO WORDS' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WORDS');
    await help();
    expect(screen.getByRole('article', { name: 'WORDS' })).toBeTruthy();
  });

  it('works while looking at an example, unlocked, and opens another from EXAMPLES', async () => {
    const onLookAt = vi.fn();
    open({ systemId: null, example: 'cwn', startPage: 'rules', onLookAt });
    await screen.findByRole('region', { name: 'Example' });
    await help();
    expect(screen.queryByRole('region', { name: 'Example' })).toBeNull();
    expect(screen.queryByTestId('locked-page')?.contains(screen.getByTestId('help-page')) ?? false).toBe(false);
    await topic('EXAMPLES');
    await userEvent.click(screen.getByRole('button', { name: 'LOOK AT CYBERPUNK RED' }));
    await waitFor(() => expect(onLookAt).toHaveBeenCalledWith('cpr'));
    await topic('TRY IT');
    expect((screen.getByRole('button', { name: 'GO TO TRY IT' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the tour (4i)', () => {
  // Approved mockup builder-help (2026-10-13): eight steps the first time, each lighting its place on
  // the rail; BACK, NEXT, SKIP THE TOUR; remembered on the server once finished or skipped.
  const dialog = () => screen.queryByRole('dialog', { name: 'The builder tour' });
  const step = () => within(dialog()!).getByText(/^STEP \d OF 8$/).textContent;
  const litNames = () => [...sidebar().querySelectorAll('[data-lit]')].map((b) => b.getAttribute('aria-label'));
  const press = (name: string) => userEvent.click(within(dialog()!).getByRole('button', { name }));

  it('shows the first time, lighting each place down the rail, and is remembered once DONE', async () => {
    tour.seen = false;
    open({ startPage: 'setup' });
    await screen.findByRole('dialog', { name: 'The builder tour' });
    expect(step()).toBe('STEP 1 OF 8');
    expect(within(dialog()!).getByRole('heading').textContent).toBe('WELCOME TO THE SYSTEM BUILDER');
    expect(litNames()).toEqual([]);
    expect(within(dialog()!).queryByRole('button', { name: 'BACK' })).toBeNull();
    expect(document.activeElement).toBe(within(dialog()!).getByRole('button', { name: 'NEXT' }));
    const expected = [['SETUP'], ['WORDS'], ['PARTS'], ['STATS & RULES'], ['CHARACTER SHEET'], ['TRY IT'], ['SAVE', 'PUBLISH']];
    for (const [i, names] of expected.entries()) {
      await press('NEXT');
      expect(step()).toBe(`STEP ${i + 2} OF 8`);
      expect(litNames()).toEqual(names);
      expect(sidebar().getAttribute('data-expanded')).toBe('true');
      expect(sidebar().style.width).toBe('220px');
      expect(screen.getByTestId('tour-arrow')).toBeTruthy();
    }
    expect(tourMarks).toEqual([]);
    await press('DONE');
    expect(dialog()).toBeNull();
    expect(litNames()).toEqual([]);
    await waitFor(() => expect(tourMarks).toEqual([true]));
    // The page under it was never changed.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SETUP');
  });

  it('goes BACK, and ends on SKIP THE TOUR or Escape, remembered either way', async () => {
    tour.seen = false;
    open({ startPage: 'setup' });
    await screen.findByRole('dialog', { name: 'The builder tour' });
    await press('NEXT');
    await press('NEXT');
    await press('BACK');
    expect(step()).toBe('STEP 2 OF 8');
    expect(litNames()).toEqual(['SETUP']);
    await press('SKIP THE TOUR');
    expect(dialog()).toBeNull();
    await waitFor(() => expect(tourMarks).toEqual([true]));
    cleanup();
    tour.seen = false;
    open({ startPage: 'setup' });
    await screen.findByRole('dialog', { name: 'The builder tour' });
    fireEvent.keyDown(within(dialog()!).getByRole('button', { name: 'NEXT' }), { key: 'Escape' });
    expect(dialog()).toBeNull();
    await waitFor(() => expect(tourMarks).toEqual([true, true]));
  });

  it('stays away once seen, or when the server can\'t say', async () => {
    open({ startPage: 'setup' });
    await ready();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/systems/tour')).toBe(true));
    expect(dialog()).toBeNull();
    cleanup();
    tour = { status: 500, seen: false };
    open({ startPage: 'setup' });
    await ready();
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/systems/tour')).toHaveLength(2));
    expect(dialog()).toBeNull();
  });

  it('plays again from START THE TOUR on HELP, with no system open too', async () => {
    open({ systemId: null });
    await userEvent.click(within(sidebar()).getByLabelText('HELP'));
    await userEvent.click(screen.getByRole('button', { name: 'START THE TOUR' }));
    expect(step()).toBe('STEP 1 OF 8');
    await press('NEXT');
    // Pointing at a page that can't be opened yet is still pointing at it.
    expect(litNames()).toEqual(['SETUP']);
    await press('SKIP THE TOUR');
    await waitFor(() => expect(tourMarks).toEqual([true]));
  });
});

describe('HOUSE RULES (4j3b)', () => {
  it('is on the rail after RESTS, and GO TO opens where a thing under a rule lives', async () => {
    served = { ...served, draft: { format: 1, name: 'Hearth', house_rules: [{ id: 'magic', name: 'MAGIC' }], conditions: { hexed: { name: 'Hexed', only_with: 'magic' } } } };
    open({ startPage: 'house_rules' });
    await ready();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('HOUSE RULES');
    await userEvent.click(await screen.findByRole('button', { name: 'Go to Hexed' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CONDITIONS');
    await userEvent.click(within(sidebar()).getByLabelText('HOUSE RULES'));
    await userEvent.click(screen.getByRole('button', { name: '+ RULE' }));
    await userEvent.click(within(sidebar()).getByLabelText('SAVE'));
    await waitFor(() => expect(drafts.at(-1)).toMatchObject({ house_rules: [{ id: 'magic', name: 'MAGIC' }, { id: 'new_rule', name: 'NEW RULE' }] }));
  });
});