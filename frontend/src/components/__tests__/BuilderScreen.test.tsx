import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
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

let served: SystemCopies;
let calls: { url: string; method: string }[];
let publishAnswer: { status: number; body: unknown };

const fakeServer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push({ url, method });
  const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
  if (url === `/api/systems/${HEARTH}` && method === 'GET') return json(200, served);
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
  const onMySystems = vi.fn();
  render(<BuilderScreen token="gm" systemId={HEARTH} running={null} onExit={onExit} onMySystems={onMySystems} fetcher={fakeServer as typeof fetch} {...over} />);
  return { onExit, onMySystems };
};
const sidebar = () => screen.getByRole('navigation', { name: 'Builder' });
const ready = () => waitFor(() => expect(screen.getByTestId('save-status')).toBeTruthy());

describe('the builder', () => {
  it('takes over the window, naming the system, on the page it was opened at', async () => {
    open({ startPage: 'setup' });
    await ready();
    expect(screen.getByTestId('builder-screen').style.position).toBe('fixed');
    expect(within(sidebar()).getByText('HEARTH')).toBeTruthy();
    expect(within(sidebar()).getByText('PUBLISHED v3')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SETUP');
    expect(within(sidebar()).getByText('SETUP').closest('button')!.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/This page arrives in a coming update\./)).toBeTruthy();
    expect(screen.getByTestId('save-status').textContent).toMatch(/^DRAFT · SAVED \d\d:\d\d$/);
  });

  it('lists every page, each saying what it is for, and opens the one picked', async () => {
    open();
    await ready();
    const pages = within(sidebar()).getAllByRole('button').filter((b) => b.title && b.textContent !== 'PUBLISH');
    expect(pages.map((b) => b.textContent)).toEqual(['SETUP', 'WORDS', 'FEATURES', 'STATS & RULES', 'CHARACTER SHEET', 'NPCS', 'TRY IT', 'PROBLEMS0']);
    expect(pages[1].title).toBe('What the game calls things: HP, credits, skills.');
    await userEvent.click(pages[1]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('WORDS');
    expect(pages[1].getAttribute('aria-current')).toBe('page');
  });

  it('a never-published draft says so', async () => {
    served = { ...served, version: 0, published: null };
    open();
    await ready();
    expect(within(sidebar()).getByText('NEVER PUBLISHED')).toBeTruthy();
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
    expect(within(sidebar()).getByText('2 PROBLEMS')).toBeTruthy();
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
    await waitFor(() => expect(within(sidebar()).getByText('PUBLISHED v4')).toBeTruthy());
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
    expect(screen.getByText('PUBLISH').title).toBe('Fix this problem before publishing.');
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
    const { onExit, onMySystems } = open();
    await ready();
    await userEvent.click(screen.getByLabelText('Exit the builder and go back to the map'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onMySystems).not.toHaveBeenCalled();
  });

  it('MY SYSTEMS goes back to SYSTEMS.EXE', async () => {
    const { onExit, onMySystems } = open();
    await ready();
    await userEvent.click(screen.getByText('MY SYSTEMS'));
    expect(onMySystems).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('closing the browser tab doesn\'t ask while everything is saved', async () => {
    open();
    await ready();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
