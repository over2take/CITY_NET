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

  it('treats a missing segment as zero', () => {
    expect(updater.isNewerVersion('1.9', '1.8.7')).toBe(true);
    expect(updater.isNewerVersion('1.8', '1.8.0')).toBe(false);
  });

  it('refuses anything it cannot parse rather than guessing', () => {
    // 'dev' is what a build without APP_VERSION reports; offering it an update to
    // whatever the registry has would be acting on nothing.
    expect(updater.isNewerVersion('latest', '1.8.0')).toBe(false);
    expect(updater.isNewerVersion('1.8.1', 'dev')).toBe(false);
    expect(updater.isNewerVersion('', '1.0.0')).toBe(false);
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
