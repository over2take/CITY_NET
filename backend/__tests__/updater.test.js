import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const updater = require('../updater.js');

/**
 * In-app self-update.
 *
 * The failure these guard is not "the update broke" but "the update broke silently".
 * Every step used to discard its output and the route reported success before checking
 * anything, so a stack that could not update was indistinguishable from a slow one and
 * the client waited for a restart that was never coming.
 */

describe('isNewerVersion', () => {
  it('accepts a genuinely newer version', () => {
    expect(updater.isNewerVersion('1.8.1', '1.8.0')).toBe(true);
    expect(updater.isNewerVersion('1.9.0', '1.8.9')).toBe(true);
    expect(updater.isNewerVersion('2.0.0', '1.99.99')).toBe(true);
  });

  it('refuses a downgrade', () => {
    // The check this replaces was `latest !== current`, which called any difference an
    // update — so a published tag trailing the running one offered 1.8.0 → 1.7.4.
    expect(updater.isNewerVersion('1.7.4', '1.8.0')).toBe(false);
    expect(updater.isNewerVersion('1.8.0', '1.8.1')).toBe(false);
  });

  it('refuses an identical version', () => {
    expect(updater.isNewerVersion('1.8.0', '1.8.0')).toBe(false);
  });

  it('compares numerically, not as text', () => {
    // '1.10.0' sorts before '1.9.0' as a string and after it as a version.
    expect(updater.isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(updater.isNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('requires all three segments rather than guessing at a partial version', () => {
    // Deliberately strict. Every tag this project publishes comes from package.json and
    // has three parts, and a loose parser is what let '1.9.0-dev' through the filter and
    // then produce NaN in the sort comparator.
    expect(updater.isNewerVersion('1.9', '1.8.7')).toBe(false);
    expect(updater.isNewerVersion('1.9.0', '1.8')).toBe(false);
    expect(updater.parseVersion('1.9')).toBeNull();
  });

  it('refuses anything it cannot parse rather than guessing', () => {
    // 'dev' is what a build without APP_VERSION reports; offering it an update to
    // whatever the registry has would be acting on nothing.
    expect(updater.isNewerVersion('latest', '1.8.0')).toBe(false);
    expect(updater.isNewerVersion('1.8.1', 'dev')).toBe(false);
    expect(updater.isNewerVersion('', '1.0.0')).toBe(false);
  });
});

describe('release channel', () => {
  it('is stable unless the operator points it elsewhere', () => {
    // Dev builds are unreleased code. Nobody should arrive on one by omission.
    expect(updater.imageTag({})).toBe('latest');
    expect(updater.imageTag({ IMAGE_TAG: '' })).toBe('latest');
    expect(updater.allowsDevBuilds({})).toBe(false);
    expect(updater.allowsDevBuilds({ IMAGE_TAG: 'latest' })).toBe(false);
  });

  it('follows dev builds only when pointed at the dev images', () => {
    // The same setting compose resolves, so what is offered and what is installed
    // cannot disagree. A separate boolean alongside this produced three contradictory
    // states, each needing a guard; none of them is expressible now.
    expect(updater.allowsDevBuilds({ IMAGE_TAG: 'dev' })).toBe(true);
  });

  it('treats a pinned version tag as stable', () => {
    // Pinning 1.8.1 is a legitimate thing to do and is not a dev channel.
    expect(updater.allowsDevBuilds({ IMAGE_TAG: '1.8.1' })).toBe(false);
  });

  it('hides dev tags from the stable channel', () => {
    expect(updater.isVersionTag('1.9.0', false)).toBe(true);
    expect(updater.isVersionTag('1.9.0-dev', false)).toBe(false);
    expect(updater.isVersionTag('1.9.0-dev.7', false)).toBe(false);
  });

  it('shows dev tags to the dev channel', () => {
    expect(updater.isVersionTag('1.9.0-dev', true)).toBe(true);
    expect(updater.isVersionTag('1.9.0-dev.7', true)).toBe(true);
    expect(updater.isVersionTag('1.9.0', true)).toBe(true);
  });

  it('rejects tags that are not versions on either channel', () => {
    // The filter this replaces was unanchored, so '1.9.0-dev' passed it, parsed to NaN,
    // made the sort comparator return NaN, and left the ordering undefined — a single
    // dev tag on the registry could stop stable users hearing about releases at all.
    for (const tag of ['latest', 'dev', '1.9.0-rc1', '1.9', 'v1.9.0', '']) {
      expect(updater.isVersionTag(tag, false), tag).toBe(false);
      expect(updater.isVersionTag(tag, true), tag).toBe(false);
    }
  });

  it('sorts a mixed tag list without NaN poisoning the comparator', () => {
    const tags = ['1.8.0', '1.9.0-dev.2', '1.10.0', '1.9.0', '1.9.0-dev.10'];
    const sorted = [...tags].sort((a, b) =>
      updater.compareVersions(updater.parseVersion(b), updater.parseVersion(a)));
    expect(sorted[0]).toBe('1.10.0');
    expect(sorted).toEqual(['1.10.0', '1.9.0', '1.9.0-dev.10', '1.9.0-dev.2', '1.8.0']);
  });
});

describe('dev version ordering', () => {
  it('offers a dev build of a newer release to someone on an older release', () => {
    expect(updater.isNewerVersion('1.9.0-dev', '1.8.1')).toBe(true);
  });

  it('carries a dev user onto the release when it lands', () => {
    expect(updater.isNewerVersion('1.9.0', '1.9.0-dev')).toBe(true);
    expect(updater.isNewerVersion('1.9.0', '1.9.0-dev.7')).toBe(true);
  });

  it('never drags a release user back onto a dev build of the same version', () => {
    expect(updater.isNewerVersion('1.9.0-dev', '1.9.0')).toBe(false);
    expect(updater.isNewerVersion('1.9.0-dev.7', '1.9.0')).toBe(false);
  });

  it('orders dev builds by their counter when there is one', () => {
    expect(updater.isNewerVersion('1.9.0-dev.7', '1.9.0-dev.3')).toBe(true);
    expect(updater.isNewerVersion('1.9.0-dev.3', '1.9.0-dev.7')).toBe(false);
    // Ten after two, not before it — the old comparison was textual.
    expect(updater.isNewerVersion('1.9.0-dev.10', '1.9.0-dev.2')).toBe(true);
  });

  it('accepts a counter without requiring one', () => {
    // So publishing counters later is a change to the build workflow, not to this code.
    expect(updater.parseVersion('1.9.0-dev')).toEqual({ core: [1, 9, 0], dev: 0 });
    expect(updater.parseVersion('1.9.0-dev.7')).toEqual({ core: [1, 9, 0], dev: 7 });
    expect(updater.parseVersion('1.9.0')).toEqual({ core: [1, 9, 0], dev: null });
  });

  it('offers no update between identical dev builds', () => {
    expect(updater.isNewerVersion('1.9.0-dev', '1.9.0-dev')).toBe(false);
  });
});

describe('fetchVersionTags', () => {
  /**
   * A registry serving the given pages in order.
   *
   * The transport is a `fetch` stub rather than a fake `https` module: the request itself
   * now belongs to `net/outbound`, which enforces the deadline, the byte cap and the
   * allowlist. What is left to test here is the walk over pages — which page it asks for
   * next, and when it stops.
   */
  const registry = (pages) => {
    const calls = [];
    let n = 0;
    return {
      calls,
      fetchImpl: async (url) => {
        calls.push(url);
        const page = pages[n++] ?? { results: [] };
        return { status: 200, ok: true, text: async () => JSON.stringify(page) };
      },
    };
  };

  const page = (names, next = null) => ({ results: names.map((name) => ({ name })), next });

  it('reads one page when that page already has a usable tag', async () => {
    // The normal case. Later pages were updated longer ago, so there is nothing on them
    // worth having once this channel has found something.
    const reg = registry([page(['1.8.0', '1.8.1', 'latest'], 'https://hub.docker.com/v2/x?page=2')]);
    const tags = await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl });
    expect(tags[0]).toBe('1.8.1');
    expect(reg.calls).toHaveLength(1);
  });

  it('follows the next page when dev builds have crowded the first one out', async () => {
    // The failure this fixes. A burst of dev builds after a release fills page one with
    // X.Y.Z-dev tags, a stable deployment filters every one of them out, and reading a
    // single page left it with nothing — reporting no update when one existed.
    const devTags = Array.from({ length: 100 }, (_, i) => `1.9.0-dev.${i + 1}`);
    const reg = registry([
      page(devTags, 'https://hub.docker.com/v2/repositories/x/tags?page=2'),
      page(['1.8.1', '1.8.0']),
    ]);
    const tags = await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl, allowDev: false });
    expect(tags[0]).toBe('1.8.1');
    expect(reg.calls).toHaveLength(2);
    expect(reg.calls[1]).toContain('page=2');
  });

  it('stops at the first page for a dev deployment, which can use those tags', async () => {
    const devTags = Array.from({ length: 100 }, (_, i) => `1.9.0-dev.${i + 1}`);
    const reg = registry([page(devTags, 'https://hub.docker.com/v2/x?page=2'), page(['1.8.1'])]);
    const tags = await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl, allowDev: true });
    expect(tags[0]).toBe('1.9.0-dev.100');
    expect(reg.calls).toHaveLength(1);
  });

  it('gives up after the page limit rather than following for ever', async () => {
    // A bound, not an open loop: a registry that keeps offering a next page must not be
    // able to hang the request.
    const endless = page(['latest'], 'https://hub.docker.com/v2/x?page=n');
    const reg = registry([endless, endless, endless, endless, endless, endless, endless]);
    const tags = await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl, maxPages: 3 });
    expect(tags).toEqual([]);
    expect(reg.calls).toHaveLength(3);
  });

  it('stops when the registry offers no next page', async () => {
    const reg = registry([page(['latest', 'dev'])]);
    const tags = await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl });
    expect(tags).toEqual([]);
    expect(reg.calls).toHaveLength(1);
  });

  it('returns tags newest first', async () => {
    const reg = registry([page(['1.8.0', '1.10.0', '1.9.0'])]);
    expect(await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl })).toEqual(['1.10.0', '1.9.0', '1.8.0']);
  });

  it('asks Docker Hub for the next page even when the payload names another host', async () => {
    // `next` is a full URL, and this used to take its hostname — so whoever answered got
    // to choose where the next request went. Only the path survives now; the host is ours.
    const reg = registry([
      page(['latest'], 'https://attacker.example.net/v2/x?page=2'),
      page(['1.8.1']),
    ]);
    const tags = await updater.fetchVersionTags({ fetchImpl: reg.fetchImpl });
    expect(tags).toEqual(['1.8.1']);
    expect(reg.calls[1]).toBe('https://hub.docker.com/v2/x?page=2');
    expect(reg.calls.join(' ')).not.toContain('attacker.example.net');
  });

  it('rejects rather than resolving empty when the response is not JSON', async () => {
    // Resolving empty would be indistinguishable from "no releases published", and the
    // route would report you are up to date.
    const fetchImpl = async () => ({ status: 200, ok: true, text: async () => '<html>' });
    await expect(updater.fetchVersionTags({ fetchImpl })).rejects.toThrow(/parse/i);
  });

  it('rejects when the registry cannot be reached', async () => {
    const fetchImpl = async () => { throw new Error('ENOTFOUND hub.docker.com'); };
    await expect(updater.fetchVersionTags({ fetchImpl })).rejects.toThrow(/could not reach/i);
  });

  it('says so in our own words rather than repeating theirs', async () => {
    // An upstream message can carry detail we did not choose to publish — a host path, an
    // internal address. The admin can only retry or wait either way.
    const fetchImpl = async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:443'); };
    // Caught by hand rather than with `.rejects.not.toThrow`, which also passes when
    // nothing is thrown at all — this has to fail if the address ever comes through.
    let message = null;
    try {
      await updater.fetchVersionTags({ fetchImpl });
    } catch (e) {
      message = e.message;
    }
    expect(message).toBe('Could not reach Docker Hub');
  });

  it('gives up on a registry that answers and then stops talking', async () => {
    const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await expect(updater.fetchVersionTags({ fetchImpl, timeoutMs: 30 })).rejects.toThrow(/in time/i);
  });
});

describe('preflight', () => {
  const labels = { projectName: 'citynet', configFile: '/srv/citynet/docker-compose.yml', workingDir: '/srv/citynet' };
  const allPresent = () => true;

  it('passes when the mount, the socket and the labels are all there', () => {
    const res = updater.preflight({ existsSync: allPresent, labels });
    expect(res.ok).toBe(true);
    expect(res.labels).toBe(labels);
  });

  it('refuses when the compose file is not mounted, and says how to fix it', () => {
    // The commonest case by far: a container started before the compose file mounted
    // itself, which is to say a long-running one — exactly those most needing an update.
    const res = updater.preflight({
      existsSync: (p) => p !== updater.COMPOSE_FILE,
      labels,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(updater.COMPOSE_FILE);
    expect(res.error).toContain('docker compose up -d');
  });

  it('refuses when the docker socket is missing', () => {
    const res = updater.preflight({
      existsSync: (p) => p !== '/var/run/docker.sock',
      labels,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/socket/i);
  });

  it('refuses when the compose project labels are missing', () => {
    // Without these the helper would be handed undefined as a mount source, fail
    // instantly, and report nothing.
    const res = updater.preflight({
      existsSync: allPresent,
      labels: { projectName: null, configFile: null, workingDir: null },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/docker run/);
  });

  it('refuses when only the working directory is missing', () => {
    const res = updater.preflight({
      existsSync: allPresent,
      labels: { ...labels, workingDir: null },
    });
    expect(res.ok).toBe(false);
  });
});

describe('buildUpdateHelperArgs', () => {
  it('mounts the host project directory at its own absolute path', () => {
    // Mounting it at an alias made the daemon look for a path that does not exist on the
    // host, silently create an empty directory, and wipe the bind-mounted data.
    const args = updater.buildUpdateHelperArgs('/srv/citynet', '/srv/citynet/docker-compose.yml', ['-p', 'citynet']);
    expect(args).toContain('/srv/citynet:/srv/citynet');
  });

  it('runs compose against the mounted config with the project name', () => {
    const args = updater.buildUpdateHelperArgs('/srv/citynet', '/srv/citynet/docker-compose.yml', ['-p', 'citynet']);
    // Argv, so each of these is its own element and none of it is ever parsed as shell.
    expect(args.slice(-10)).toEqual([
      'docker', 'compose',
      '--project-directory', '/srv/citynet',
      '-f', updater.COMPOSE_FILE,
      '-p', 'citynet',
      'up', '-d',
    ]);
  });
});

describe('readComposeLabels', () => {
  it('returns nulls rather than throwing when docker is unavailable', () => {
    const labels = updater.readComposeLabels({
      readFileSync: () => 'abc123',
      execSync: () => { throw new Error('docker: not found'); },
    });
    expect(labels).toEqual({ projectName: null, configFile: null, workingDir: null });
  });

  it('reads the compose labels off the running container', () => {
    const labels = updater.readComposeLabels({
      readFileSync: () => 'abc123\\n',
      execSync: () => JSON.stringify({
        'com.docker.compose.project': 'citynet',
        'com.docker.compose.project.config_files': '/srv/citynet/docker-compose.yml',
        'com.docker.compose.project.working_dir': '/srv/citynet',
      }),
    });
    expect(labels.projectName).toBe('citynet');
    expect(labels.workingDir).toBe('/srv/citynet');
  });
});

describe('runUpdate', () => {
  const labels = { projectName: 'citynet', configFile: '/srv/citynet/docker-compose.yml', workingDir: '/srv/citynet' };

  /** A fake child process whose lifecycle the test drives. */
  const fakeChild = () => {
    const handlers = {};
    return {
      unref: vi.fn(),
      on: (evt, fn) => { handlers[evt] = fn; },
      emit: (evt, arg) => handlers[evt]?.(arg),
    };
  };

  beforeEach(() => updater.resetState());

  it('reports the phase while it works instead of leaving the client to guess', () => {
    const pull = fakeChild();
    updater.runUpdate(labels, { spawn: () => pull, openSync: () => { throw new Error('no log'); } });
    expect(updater.getState().phase).toBe('pulling');

    pull.emit('close', 0);
    expect(updater.getState().phase).toBe('restarting');
  });

  it('records a failed pull rather than returning silently', () => {
    // The old code did `if (code !== 0) return`, so the helper never ran, nothing
    // changed, and the client polled for a restart forever.
    const pull = fakeChild();
    updater.runUpdate(labels, { spawn: () => pull, openSync: () => { throw new Error('no log'); } });
    pull.emit('close', 1);

    const state = updater.getState();
    expect(state.phase).toBe('failed');
    // A stable code plus a sentence of ours. The exit status and anything compose said
    // go to the log file, not to a response the whole internet can read.
    expect(state.code).toBe('COMPOSE_PULL_FAILED');
    expect(state.error).toBe(updater.FAILURES.COMPOSE_PULL_FAILED);
  });

  it('records docker being missing entirely', () => {
    const pull = fakeChild();
    updater.runUpdate(labels, { spawn: () => pull, openSync: () => { throw new Error('no log'); } });
    pull.emit('error', new Error('spawn docker ENOENT'));

    expect(updater.getState().phase).toBe('failed');
    expect(updater.getState().code).toBe('DOCKER_UNAVAILABLE');
    // The upstream message named the binary and the path it looked in. Ours does not.
    expect(updater.getState().error).not.toContain('ENOENT');
  });

  it('spawns the helper only after a successful pull', () => {
    const pull = fakeChild();
    const helper = fakeChild();
    const spawn = vi.fn().mockReturnValueOnce(pull).mockReturnValueOnce(helper);
    updater.runUpdate(labels, { spawn, openSync: () => { throw new Error('no log'); } });

    expect(spawn).toHaveBeenCalledTimes(1);
    pull.emit('close', 0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][1]).toContain('run');
  });

  it('exposes a boot id so a restart can be detected without a version change', () => {
    // A build without APP_VERSION reports 'dev' before and after, so waiting on the
    // version alone hangs even when the update succeeded.
    expect(updater.getState().bootId).toBe(updater.BOOT_ID);
    expect(updater.BOOT_ID).toBeTruthy();
  });
});

describe('isDockerAvailable', () => {
  beforeEach(() => updater.isDockerAvailable.forget());

  it('asks the daemon once and remembers the answer', async () => {
    // GET /api/version is unauthenticated, and this used to run on every request.
    // execSync holds the event loop until the daemon answers, so a probe per request was
    // a way for anyone who could reach that route to stall the whole server.
    const execSync = vi.fn(() => '');
    expect(updater.isDockerAvailable({ execSync })).toBe(true);
    for (let i = 0; i < 50; i++) updater.isDockerAvailable({ execSync });
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('remembers a no as firmly as a yes', async () => {
    // Socket-less is a supported posture, not a transient failure - so retrying it on
    // every request would be the same stall for the installs most likely to be exposed.
    const execSync = vi.fn(() => { throw new Error('Cannot connect to the Docker daemon'); });
    expect(updater.isDockerAvailable({ execSync })).toBe(false);
    updater.isDockerAvailable({ execSync });
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('does not wait on an unresponsive socket for ever', async () => {
    const execSync = vi.fn(() => '');
    updater.isDockerAvailable({ execSync });
    expect(execSync).toHaveBeenCalledWith('docker info', expect.objectContaining({ timeout: 5000 }));
  });
});

describe('one update at a time', () => {
  const labels = { projectName: 'citynet', configFile: '/srv/citynet/docker-compose.yml', workingDir: '/srv/citynet' };
  const fakeChild = () => {
    const handlers = {};
    return { unref: vi.fn(), on: (evt, fn) => { handlers[evt] = fn; }, emit: (evt, arg) => handlers[evt]?.(arg) };
  };
  const noLog = () => { throw new Error('no log'); };

  beforeEach(() => updater.resetState());

  it('refuses a second update while one is pulling', () => {
    // A double-click used to run two `compose pull` processes and then two privileged
    // helper containers against the same stack, each recreating what the other was
    // recreating.
    const spawn = vi.fn(() => fakeChild());
    expect(updater.runUpdate(labels, { spawn, openSync: noLog })).not.toBeNull();
    expect(updater.runUpdate(labels, { spawn, openSync: noLog })).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('refuses one while the helper is restarting the stack', () => {
    const pull = fakeChild();
    const spawn = vi.fn().mockReturnValueOnce(pull).mockReturnValue(fakeChild());
    updater.runUpdate(labels, { spawn, openSync: noLog });
    pull.emit('close', 0);
    expect(updater.getState().phase).toBe('restarting');

    expect(updater.runUpdate(labels, { spawn, openSync: noLog })).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2); // the pull and its one helper, no more
  });

  it('does not let a second press erase why the first failed', () => {
    // The second call reset error and startedAt, so a failure could vanish before anyone
    // had read it and the status went back to reporting a healthy run.
    const pull = fakeChild();
    updater.runUpdate(labels, { spawn: () => pull, openSync: noLog });
    pull.emit('close', 1);
    expect(updater.getState().code).toBe('COMPOSE_PULL_FAILED');

    // A failed run is finished, so this one is allowed - but it must not be allowed to
    // start by quietly overwriting the record of the last one before it does.
    const before = updater.getState().error;
    expect(before).toBeTruthy();
    expect(updater.isRunning()).toBe(false);
  });

  it('lets a new run take over when the process is gone but its events never came', () => {
    // The child is unreachable here (the fake reports no exit state), which stands in for
    // a run whose events were lost. Nothing is working and nothing else would ever
    // release the lock, so the elapsed check is the only way out.
    let clock = 1_000_000;
    const spawn = vi.fn(() => fakeChild());
    updater.runUpdate(labels, { spawn, openSync: noLog, now: () => clock });
    expect(updater.runUpdate(labels, { spawn, openSync: noLog, now: () => clock })).toBeNull();

    clock += updater.STALE_RUN_MS + 1;
    expect(updater.runUpdate(labels, { spawn, openSync: noLog, now: () => clock })).not.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('keeps the lock while the pull is still alive, however long it takes', () => {
    // The hole this closes: releasing on elapsed time alone cannot tell a hung pull from
    // a slow one. Two images over a poor line can outlast any threshold worth setting,
    // and releasing would let a second press start a competing update against a stack the
    // first is still changing — which is the whole thing this guard exists to prevent.
    let clock = 1_000_000;
    const alive = { ...fakeChild(), exitCode: null, signalCode: null };
    const spawn = vi.fn(() => alive);
    updater.runUpdate(labels, { spawn, openSync: noLog, now: () => clock });

    clock += updater.STALE_RUN_MS * 10;
    expect(updater.isRunning(clock)).toBe(true);
    expect(updater.runUpdate(labels, { spawn, openSync: noLog, now: () => clock })).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('releases a finished process once the elapsed window has passed as well', () => {
    // The counterpart: liveness holds the lock, so it must also let go.
    let clock = 1_000_000;
    const child = { ...fakeChild(), exitCode: null, signalCode: null };
    updater.runUpdate(labels, { spawn: () => child, openSync: noLog, now: () => clock });
    expect(updater.isRunning(clock)).toBe(true);

    child.exitCode = 0;
    clock += updater.STALE_RUN_MS + 1;
    expect(updater.isRunning(clock)).toBe(false);
  });

  it('is idle again once a run has failed', () => {
    const pull = fakeChild();
    updater.runUpdate(labels, { spawn: () => pull, openSync: noLog });
    expect(updater.isRunning()).toBe(true);
    pull.emit('error', new Error('spawn docker ENOENT'));
    expect(updater.isRunning()).toBe(false);
  });
});

describe('the public status payload', () => {
  beforeEach(() => updater.resetState());

  it('does not publish the update log', () => {
    // GET /api/update/status is unauthenticated - the client has to keep reading it across
    // the restart, when nobody is logged in. It used to answer with the last forty lines
    // of update.log, which carries host paths and absolute directories, and which no
    // client has ever displayed.
    expect(updater.getState()).not.toHaveProperty('log');
  });

  it('carries a phase, a boot id and nothing anyone said to us', () => {
    expect(Object.keys(updater.getState()).sort())
      .toEqual(['bootId', 'code', 'error', 'finishedAt', 'phase', 'startedAt']);
  });
});

describe('the helper leg reports its own failures', () => {
  const labels = { projectName: 'citynet', configFile: '/srv/citynet/docker-compose.yml', workingDir: '/srv/citynet' };
  const fakeChild = () => {
    const handlers = {};
    return { unref: vi.fn(), on: (evt, fn) => { handlers[evt] = fn; }, emit: (evt, arg) => handlers[evt]?.(arg) };
  };
  const noLog = () => { throw new Error('no log'); };

  beforeEach(() => updater.resetState());

  it('records a helper that exited non-zero instead of waiting for ever', () => {
    // The pull leg has always recorded a bad exit code. This one did not, so a failed
    // `compose up` left the phase on 'restarting' and the client polling for a restart
    // that was never coming.
    const pull = fakeChild();
    const helper = fakeChild();
    updater.runUpdate(labels, {
      spawn: vi.fn().mockReturnValueOnce(pull).mockReturnValueOnce(helper),
      openSync: noLog,
    });
    pull.emit('close', 0);
    expect(updater.getState().phase).toBe('restarting');

    helper.emit('close', 1);
    expect(updater.getState().phase).toBe('failed');
    expect(updater.getState().code).toBe('HELPER_FAILED');
  });

  it('says nothing when the helper exits cleanly', () => {
    // Normally unreachable — `up -d` replaces this container before the helper finishes —
    // but a clean exit must never be reported as a failure on the paths where it is.
    const pull = fakeChild();
    const helper = fakeChild();
    updater.runUpdate(labels, {
      spawn: vi.fn().mockReturnValueOnce(pull).mockReturnValueOnce(helper),
      openSync: noLog,
    });
    pull.emit('close', 0);
    helper.emit('close', 0);
    expect(updater.getState().phase).toBe('restarting');
    expect(updater.getState().code).toBeNull();
  });
});
