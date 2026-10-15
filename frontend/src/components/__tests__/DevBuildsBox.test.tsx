import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DevBuildsBox } from '../DevBuildsBox';
import * as updateClient from '../../utils/updateClient';

vi.mock('../../utils/updateClient', () => ({ currentBootId: vi.fn(async () => 'boot-1'), waitForRestart: vi.fn(async () => {}) }));

/** The server as the box sees it: /api/version, and GET and PUT /api/update/channel. */
const serve = ({ isDocker = true, channel = { channel: 'latest', dev: false, canSwitch: true } as Record<string, unknown>, put = null as null | ((dev: boolean) => { status: number; body: unknown }), revert = { status: 200, body: { copy: 'city.db.before-dev-builds-2026-10-15T09-00-00.bak' } as unknown } } = {}) => {
  const puts: (boolean | 'back')[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url === '/api/version') return reply(200, { version: '2.0.0-dev.1', isDocker });
    if (url === '/api/update/revert' && init?.method === 'POST') { puts.push('back'); return reply(revert.status, revert.body); }
    if (url === '/api/update/channel' && init?.method === 'PUT') {
      const { dev } = JSON.parse(String(init.body));
      puts.push(dev);
      return put ? (({ status, body }) => reply(status, body))(put(dev)) : reply(200, { channel: dev ? 'dev' : 'latest', dev, backup: dev ? 'city.db.before-dev-builds-2026-10-14T21-05-09.bak' : null });
    }
    if (url === '/api/update/channel') return reply(200, channel);
    throw new Error(`unexpected ${String(url)}`);
  });
  return puts;
};

const box = async () => screen.findByRole('checkbox', { name: 'LOOK FOR DEV BUILDS' });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('DevBuildsBox', () => {
  it('shows unticked on a stable deployment, and ticked on a dev one', async () => {
    serve();
    const { unmount } = render(<DevBuildsBox token="t" />);
    expect(await box()).not.toBeChecked();
    unmount();
    serve({ channel: { channel: 'dev', dev: true, canSwitch: true } });
    render(<DevBuildsBox token="t" />);
    expect(await box()).toBeChecked();
  });

  it('is not shown off Docker, where nothing pulls images', async () => {
    serve({ isDocker: false });
    render(<DevBuildsBox token="t" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('ticking asks first, and TURN ON switches and names the copy', async () => {
    const puts = serve();
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await box());
    expect(screen.getByText(/may break\. A copy of your database is made first/)).toBeInTheDocument();
    expect(puts).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'TURN ON' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dev builds on. Database copied to city.db.before-dev-builds-2026-10-14T21-05-09.bak');
    expect(puts).toEqual([true]);
    expect(await box()).toBeChecked();
  });

  it('CANCEL leaves it as it was', async () => {
    const puts = serve();
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await box());
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(puts).toEqual([]);
    expect(await box()).not.toBeChecked();
    expect(screen.queryByRole('group', { name: 'Turn on dev builds' })).not.toBeInTheDocument();
  });

  it('unticking goes back to stable without asking', async () => {
    const puts = serve({ channel: { channel: 'dev', dev: true, canSwitch: true } });
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await box());
    expect(await screen.findByRole('status')).toHaveTextContent('Stable releases only');
    expect(puts).toEqual([false]);
    expect(await box()).not.toBeChecked();
  });

  it('a switch the server refused says so, with the line to set by hand, and stays unticked', async () => {
    serve({ put: () => ({ status: 409, body: { error: 'The Docker socket is not mounted.', manual: 'Set IMAGE_TAG=dev by hand.' } }) });
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await box());
    await userEvent.click(screen.getByRole('button', { name: 'TURN ON' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The Docker socket is not mounted. Set IMAGE_TAG=dev by hand.');
    expect(await box()).not.toBeChecked();
  });

  it('where the app cannot switch, the box is greyed with the line to set by hand', async () => {
    serve({ channel: { channel: 'latest', dev: false, canSwitch: false, reason: 'no socket', manual: 'Set IMAGE_TAG=dev in backend/.env.' } });
    render(<DevBuildsBox token="t" />);
    expect(await box()).toBeDisabled();
    expect(screen.getByText('Set IMAGE_TAG=dev in backend/.env.')).toBeInTheDocument();
  });
});

describe('DevBuildsBox: GO BACK TO STABLE', () => {
  const COPY = 'city.db.before-dev-builds-2026-10-15T09-00-00.bak';
  const onDev = { channel: 'dev', dev: true, canSwitch: true, devBuild: true, copy: COPY };
  beforeEach(() => {
    vi.mocked(updateClient.currentBootId).mockResolvedValue('boot-1');
    vi.mocked(updateClient.waitForRestart).mockReset().mockResolvedValue(undefined);
  });

  it('is offered on a dev build only', async () => {
    serve({ channel: { channel: 'dev', dev: true, canSwitch: true, devBuild: false } });
    const { unmount } = render(<DevBuildsBox token="t" />);
    await box();
    expect(screen.queryByRole('button', { name: 'GO BACK TO STABLE' })).not.toBeInTheDocument();
    unmount();
    serve({ channel: onDev });
    render(<DevBuildsBox token="t" />);
    expect(await screen.findByRole('button', { name: 'GO BACK TO STABLE' })).toBeInTheDocument();
  });

  it('asks first, naming the copy and saying nothing is deleted; CANCEL does nothing', async () => {
    const calls = serve({ channel: onDev });
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await screen.findByRole('button', { name: 'GO BACK TO STABLE' }));
    const ask = screen.getByRole('group', { name: 'Go back to stable' });
    expect(ask).toHaveTextContent(COPY);
    expect(ask).toHaveTextContent('Anything done since is set aside in a copy, not deleted.');
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'GO BACK TO STABLE' })).toBeInTheDocument();
  });

  it('GO BACK asks the server, then waits for the restart from the boot id it had', async () => {
    const calls = serve({ channel: onDev });
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await screen.findByRole('button', { name: 'GO BACK TO STABLE' }));
    await userEvent.click(screen.getByRole('button', { name: 'GO BACK' }));
    await waitFor(() => expect(updateClient.waitForRestart).toHaveBeenCalled());
    expect(calls).toEqual(['back']);
    expect(vi.mocked(updateClient.waitForRestart).mock.calls[0][0]).toMatchObject({ bootId: 'boot-1', currentVersion: '2.0.0-dev.1' });
    expect(screen.getByRole('status')).toHaveTextContent('Going back to stable');
  });

  it('a restart that fails is said, with what to run', async () => {
    vi.mocked(updateClient.waitForRestart).mockImplementation(async (o) => o.onFailed('Going back to stable did not finish.', 'docker compose up -d'));
    serve({ channel: onDev });
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await screen.findByRole('button', { name: 'GO BACK TO STABLE' }));
    await userEvent.click(screen.getByRole('button', { name: 'GO BACK' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Going back to stable did not finish. docker compose up -d');
  });

  it('a refusal is said with the steps by hand, and nothing waits for a restart', async () => {
    serve({ channel: onDev, revert: { status: 409, body: { error: 'The database folder is not mounted from the host.', manual: 'Set IMAGE_TAG=latest by hand.' } } });
    render(<DevBuildsBox token="t" />);
    await userEvent.click(await screen.findByRole('button', { name: 'GO BACK TO STABLE' }));
    await userEvent.click(screen.getByRole('button', { name: 'GO BACK' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The database folder is not mounted from the host. Set IMAGE_TAG=latest by hand.');
    expect(updateClient.waitForRestart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'GO BACK TO STABLE' })).toBeInTheDocument();
  });

  it('with no copy to put back, says so instead of offering it', async () => {
    serve({ channel: { ...onDev, copy: null } });
    render(<DevBuildsBox token="t" />);
    expect(await screen.findByText('No copy from before dev builds to go back to.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'GO BACK TO STABLE' })).not.toBeInTheDocument();
  });
});
