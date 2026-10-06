import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BuilderScreen } from '../BuilderScreen';
import { SYSTEMS_CHANGED_EVENT } from '../../sheets/systemsLibrary';
import type { SystemCopies } from '../../sheets/systemsApi';

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
  unpublishedChanges: false, installed: false, problemCount: 0, ...over,
});
const LIBRARY = [row(HEARTH, 'Hearth', { version: 3 }), row(EMBER, 'Ember', { installed: true, problemCount: 1 })];

let served: SystemCopies;
let calls: { url: string; method: string }[];
let publishAnswer: { status: number; body: unknown };

const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ url, method });
  const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
  if (url === `/api/systems/${HEARTH}` && method === 'GET') return json(200, served);
  if (url === '/api/systems' && method === 'GET') return json(200, LIBRARY);
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
});
afterEach(() => cleanup());

const open = (over: Partial<React.ComponentProps<typeof BuilderScreen>> = {}) => {
  const onExit = vi.fn();
  const onOpenSystem = vi.fn();
  const onManageSystems = vi.fn();
  render(<BuilderScreen token="gm" systemId={HEARTH} running={null} onExit={onExit} onOpenSystem={onOpenSystem}
    onManageSystems={onManageSystems} fetcher={fakeServer as typeof fetch} {...over} />);
  return { onExit, onOpenSystem, onManageSystems };
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
    expect(screen.getByText(/This page arrives in a coming update\./)).toBeTruthy();
    expect(screen.getByTestId('save-status').textContent).toMatch(/^DRAFT · SAVED \d\d:\d\d$/);
  });

  it('lists every page, each saying what it is for, and opens the one picked', async () => {
    open();
    await ready();
    const pages = within(sidebar()).getAllByRole('button').filter((b) => b.title && !['PUBLISH', 'MY SYSTEMS'].includes(b.textContent!));
    expect(pages.map((b) => b.textContent)).toEqual(['SETUP', 'WORDS', 'FEATURES', 'STATS & RULES', 'CHARACTER SHEET', 'NPCS', 'TRY IT', 'PROBLEMS']);
    expect(pages[1].title).toBe('What the game calls things: HP, credits, skills.');
    await userEvent.click(pages[1]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WORDS');
    expect(pages[1].getAttribute('aria-current')).toBe('page');
    // The list of systems is fetched for MY SYSTEMS alone.
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
    const { onExit, onManageSystems, onOpenSystem } = open();
    await ready();
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onManageSystems).not.toHaveBeenCalled();
    expect(onOpenSystem).not.toHaveBeenCalled();
  });
});

describe('MY SYSTEMS', () => {
  const openList = async (over = {}) => {
    const props = open(over);
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('MY SYSTEMS'));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Your systems' })).toBeTruthy());
    return props;
  };
  const entries = () => within(screen.getByRole('group', { name: 'Your systems' })).getAllByRole('button') as HTMLButtonElement[];

  it('is a page of the builder, listing every system with its badges, this one marked', async () => {
    const { onExit, onManageSystems } = await openList({ running: HEARTH });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('MY SYSTEMS');
    expect(within(sidebar()).getByLabelText('MY SYSTEMS').getAttribute('aria-current')).toBe('page');
    expect(entries().map((b) => b.textContent)).toEqual([
      'HEARTHOPEN NOWRUNNINGPUBLISHED v3',
      'EMBERv2PUBLISHED v21 PROBLEMINSTALLED',
    ]);
    expect(entries()[0].disabled).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    expect(onManageSystems).not.toHaveBeenCalled();
  });

  it('opens another system here, saving first', async () => {
    const { onOpenSystem, onExit } = await openList();
    await userEvent.click(entries()[1]);
    expect(onOpenSystem).toHaveBeenCalledWith(EMBER);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('sends renaming, copying, sharing and installing to SYSTEMS.EXE', async () => {
    const { onManageSystems, onOpenSystem } = await openList();
    await userEvent.click(screen.getByText('OPEN SYSTEMS.EXE'));
    expect(onManageSystems).toHaveBeenCalledTimes(1);
    expect(onOpenSystem).not.toHaveBeenCalled();
  });

  it('says when the list can\'t be read', async () => {
    const down = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (String(input) === '/api/systems'
      ? { ok: false, status: 500, json: async () => ({ error: 'Could not reach the systems store' }) } as unknown as Response
      : fakeServer(input, init)));
    open({ fetcher: down as typeof fetch });
    await ready();
    await userEvent.click(within(sidebar()).getByLabelText('MY SYSTEMS'));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the systems store');
  });

  it('closing the browser tab doesn\'t ask while everything is saved', async () => {
    open();
    await ready();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
