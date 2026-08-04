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
  /** A registry serving the given pages in order. */
  const registry = (pages) => {
    const calls = [];
    let n = 0;
    return {
      calls,
      https: {
        request(options, cb) {
          calls.push(`${options.hostname}${options.path}`);
          const page = pages[n++] ?? { results: [] };
          const handlers = {};
          const upstream = { on: (evt, fn) => { handlers[evt] = fn; return upstream; } };
          const req = {
            on: () => req,
            end: () => {
              cb(upstream);
              process.nextTick(() => {
                handlers.data?.(JSON.stringify(page));
                handlers.end?.();
              });
            },
          };
          return req;
        },
      },
    };
  };

  const page = (names, next = null) => ({ results: names.map((name) => ({ name })), next });

  it('reads one page when that page already has a usable tag', async () => {
    // The normal case. Later pages were updated longer ago, so there is nothing on them
    // worth having once this channel has found something.
    const reg = registry([page(['1.8.0', '1.8.1', 'latest'], 'https://hub.docker.com/v2/x?page=2')]);
    const tags = await updater.fetchVersionTags({ https: reg.https });
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
    const tags = await updater.fetchVersionTags({ https: reg.https, allowDev: false });
    expect(tags[0]).toBe('1.8.1');
    expect(reg.calls).toHaveLength(2);
    expect(reg.calls[1]).toContain('page=2');
  });

  it('stops at the first page for a dev deployment, which can use those tags', async () => {
    const devTags = Array.from({ length: 100 }, (_, i) => `1.9.0-dev.${i + 1}`);
    const reg = registry([page(devTags, 'https://hub.docker.com/v2/x?page=2'), page(['1.8.1'])]);
    const tags = await updater.fetchVersionTags({ https: reg.https, allowDev: true });
    expect(tags[0]).toBe('1.9.0-dev.100');
    expect(reg.calls).toHaveLength(1);
  });

  it('gives up after the page limit rather than following for ever', async () => {
    // A bound, not an open loop: a registry that keeps offering a next page must not be
    // able to hang the request.
    const endless = page(['latest'], 'https://hub.docker.com/v2/x?page=n');
    const reg = registry([endless, endless, endless, endless, endless, endless, endless]);
    const tags = await updater.fetchVersionTags({ https: reg.https, maxPages: 3 });
    expect(tags).toEqual([]);
    expect(reg.calls).toHaveLength(3);
  });

  it('stops when the registry offers no next page', async () => {
    const reg = registry([page(['latest', 'dev'])]);
    const tags = await updater.fetchVersionTags({ https: reg.https });
    expect(tags).toEqual([]);
    expect(reg.calls).toHaveLength(1);
  });

  it('returns tags newest first', async () => {
    const reg = registry([page(['1.8.0', '1.10.0', '1.9.0'])]);
    expect(await updater.fetchVersionTags({ https: reg.https })).toEqual(['1.10.0', '1.9.0', '1.8.0']);
  });

  it('rejects rather than resolving empty when the response is not JSON', async () => {
    // Resolving empty would be indistinguishable from "no releases published", and the
    // route would report you are up to date.
    const https = {
      request(options, cb) {
        const handlers = {};
        const upstream = { on: (evt, fn) => { handlers[evt] = fn; return upstream; } };
        const req = {
          on: () => req,
          end: () => { cb(upstream); process.nextTick(() => { handlers.data?.('<html>'); handlers.end?.(); }); },
        };
        return req;
      },
    };
    await expect(updater.fetchVersionTags({ https })).rejects.toThrow(/parse/i);
  });

  it('rejects when the registry cannot be reached', async () => {
    const https = {
      request() {
        const req = { on: (evt, fn) => { if (evt === 'error') process.nextTick(() => fn(new Error('ENOTFOUND'))); return req; }, end: () => {} };
        return req;
      },
    };
    await expect(updater.fetchVersionTags({ https })).rejects.toThrow(/ENOTFOUND/);
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
    const cmd = args[args.length - 1];
    expect(cmd).toContain('--project-directory "/srv/citynet"');
    expect(cmd).toContain('-p citynet');
    expect(cmd).toContain('up -d');
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
    expect(state.error).toContain('exited with code 1');
  });

  it('records docker being missing entirely', () => {
    const pull = fakeChild();
    updater.runUpdate(labels, { spawn: () => pull, openSync: () => { throw new Error('no log'); } });
    pull.emit('error', new Error('spawn docker ENOENT'));

    expect(updater.getState().phase).toBe('failed');
    expect(updater.getState().error).toContain('ENOENT');
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
