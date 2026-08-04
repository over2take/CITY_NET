const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

/**
 * In-app self-update.
 *
 * The pieces here were previously inline in the admin route, where every failure was
 * silent: both child processes ran with `stdio: 'ignore'`, the route answered "Update
 * started" before knowing whether anything would work, and a non-zero exit from the
 * pull simply returned. The client polled for a version change forever, so a stack that
 * could not update looked exactly like one that was taking a while — which is how an
 * instance sits on WAITING FOR SERVER indefinitely.
 *
 * So: check first and say why not, record what happened, and let the client ask.
 */

/** Where the compose file is mounted inside the backend container. */
const COMPOSE_FILE = '/tmp/docker-compose.yml';

/** Identifies this process. A restart is what the client is really waiting for. */
const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Update log, on the data volume so it survives the container being replaced. */
function logPath() {
  const dbPath = process.env.DB_PATH || '/app/data/city.db';
  return path.join(path.dirname(dbPath), 'update.log');
}

/**
 * A released version, or a dev build of one.
 *
 * Dev builds are tagged `X.Y.Z-dev`, optionally with a counter — `1.9.0-dev.7`. The
 * counter is accepted but not required, so publishing one later is a change to the
 * build workflow and not to this code.
 *
 * Returns null for anything else, `dev` and `latest` included. That matters: a build
 * without APP_VERSION reports `dev`, and there is no honest way to say whether some
 * numbered release is newer than an unknown.
 */
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-dev(?:\.(\d+))?)?$/.exec(String(v).trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    // null means a release; a number means a dev build of that release.
    dev: m[4] !== undefined ? Number(m[4]) : (/-dev/.test(v) ? 0 : null),
  };
}

/** True when this tag is one the given channel should consider at all. */
function isVersionTag(tag, allowDev) {
  const parsed = parseVersion(tag);
  if (!parsed) return false;
  return allowDev || parsed.dev === null;
}

/**
 * Order two parsed versions. Negative when `a` is older.
 *
 * `1.9.0-dev` precedes `1.9.0`, which is the rule that lets a dev user be carried onto
 * the release when it lands, and stops a release user being dragged back onto a dev
 * build of the same version.
 */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (a.dev === null && b.dev === null) return 0;
  if (a.dev === null) return 1;
  if (b.dev === null) return -1;
  return a.dev - b.dev;
}

/**
 * True when `candidate` is strictly newer than `current`.
 *
 * The check this replaces was `latest !== current`, which treats any difference as an
 * update — so a host publishing an older tag than the one running offers a downgrade,
 * and the modal duly reported "1.8.0 → 1.7.4". Harmless to ignore by hand, not harmless
 * to act on.
 */
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  return compareVersions(a, b) > 0;
}

/**
 * The image tag this deployment runs, and the only thing that selects a channel.
 *
 * Compose resolves `${IMAGE_TAG:-latest}` to decide which image is pulled, so this is
 * already the authority on what a deployment *is* — and anything else claiming to
 * select a channel can only agree with it or contradict it.
 *
 * An earlier version had a separate `DEV` boolean alongside it. Two settings saying the
 * same thing produced three contradictory states, each needing its own guard: offering
 * a dev version and installing stable, offering a release and installing dev under its
 * name, and a nag loop that could never settle. None of them is expressible now.
 */
function imageTag(env = process.env) {
  return String(env.IMAGE_TAG ?? '').trim() || 'latest';
}

/**
 * Whether this deployment follows development builds.
 *
 * Stable unless the operator has deliberately pointed it at the dev images, which is
 * the same decision as which images get pulled, made once.
 */
function allowsDevBuilds(env = process.env) {
  return imageTag(env) === 'dev';
}

/** The registry listing the update check reads. */
const REGISTRY_HOST = 'hub.docker.com';
const REGISTRY_PATH = '/v2/repositories/over2take/citynet-frontend/tags?page_size=100';

/**
 * How many pages of tags to read before giving up.
 *
 * Five is 500 tags, far more than this project will accumulate between releases, and a
 * bound rather than an open loop so a registry misbehaving cannot hang the request.
 */
const MAX_TAG_PAGES = 5;

/**
 * Every version tag the given channel can use, newest first.
 *
 * Reads one page and then keeps going only while it has found nothing usable. That
 * matters because the listing is ordered by recency, not by version: a burst of dev
 * builds after a release fills the first page with `X.Y.Z-dev.N` tags, and a stable
 * deployment filters every one of them out. Reading a single page, as this used to,
 * would leave it with an empty list and report no update available — silently, only for
 * people on the stable channel, and only once enough dev builds had accumulated.
 *
 * Normally it stops after one request, because the newest release is on the first page.
 */
function fetchVersionTags(opts = {}) {
  const httpsMod = opts.https || require('https');
  const allowDev = opts.allowDev ?? false;
  const maxPages = opts.maxPages ?? MAX_TAG_PAGES;

  const readPage = (host, path) => new Promise((resolve, reject) => {
    const req = httpsMod.request({ hostname: host, path, method: 'GET' }, (upstream) => {
      let body = '';
      upstream.on('data', (chunk) => { body += chunk; });
      upstream.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Failed to parse Docker Hub response'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });

  const walk = async () => {
    const found = [];
    let host = REGISTRY_HOST;
    let path = REGISTRY_PATH;

    for (let page = 0; page < maxPages; page++) {
      const data = await readPage(host, path);
      for (const tag of data?.results ?? []) {
        if (isVersionTag(tag.name, allowDev)) found.push(tag.name);
      }
      // Anything on a later page was updated longer ago, so once this channel has
      // something there is nothing to gain by reading on.
      if (found.length > 0 || !data?.next) break;

      try {
        const next = new URL(data.next);
        host = next.hostname;
        path = `${next.pathname}${next.search}`;
      } catch {
        break;
      }
    }

    return found.sort((a, b) => compareVersions(parseVersion(b), parseVersion(a)));
  };

  return walk();
}

/**
 * Build the docker-run argument list for the self-update helper container.
 *
 * The host project directory MUST be mounted at its own absolute path, not at
 * an alias like /project. Compose passes volume host-paths straight to the
 * Docker daemon; if those paths don't exist on the host the daemon silently
 * creates a new empty directory, wiping existing bind-mount data (issue that
 * caused data loss on in-app updates prior to 1.6.3).
 */
function buildUpdateHelperArgs(hostWorkingDir, hostConfigFile, projectArgs) {
  const projectArgsStr = projectArgs.join(' ');
  return [
    'run', '--rm',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${hostWorkingDir}:${hostWorkingDir}`,
    '-v', `${hostConfigFile}:${COMPOSE_FILE}:ro`,
    'over2take/citynet-backend:latest',
    'sh', '-c',
    `docker compose --project-directory "${hostWorkingDir}" -f ${COMPOSE_FILE} ${projectArgsStr} up -d`,
  ];
}

/**
 * Read the compose project name and host paths from this container's own labels.
 *
 * A stack started with plain `docker run`, or by a compose old enough not to set these,
 * has none of them — and the helper would then be handed `undefined` as a mount source,
 * fail instantly, and report nothing.
 */
function readComposeLabels(deps = {}) {
  const read = deps.readFileSync || fs.readFileSync;
  const exec = deps.execSync || execSync;
  try {
    const containerId = read('/etc/hostname', 'utf8').trim();
    const labels = JSON.parse(exec(
      `docker inspect ${containerId} --format '{{json .Config.Labels}}'`,
      { encoding: 'utf8' }
    ).trim());
    return {
      projectName: labels['com.docker.compose.project'] || null,
      configFile: labels['com.docker.compose.project.config_files'] || null,
      workingDir: labels['com.docker.compose.project.working_dir'] || null,
    };
  } catch {
    return { projectName: null, configFile: null, workingDir: null };
  }
}

/**
 * Everything that must be true before an update can possibly work.
 *
 * Each failure names the thing that is missing and what to do about it, because the
 * commonest cause is a container started from an older compose file that predates the
 * self-mount — which is to say, exactly the long-running instances most in need of
 * updating.
 */
function preflight(deps = {}) {
  const exists = deps.existsSync || fs.existsSync;
  const labels = deps.labels || readComposeLabels(deps);

  if (!exists(COMPOSE_FILE)) {
    return {
      ok: false,
      error: `${COMPOSE_FILE} is not mounted in this container, so the update cannot read your compose file. `
        + 'This container predates that mount. Run "docker compose pull && docker compose up -d" '
        + 'on the host once; in-app updates will work from then on.',
    };
  }

  if (!exists('/var/run/docker.sock')) {
    return {
      ok: false,
      error: 'The Docker socket is not mounted, so this container cannot manage the stack. '
        + 'Add /var/run/docker.sock to the backend volumes and recreate it.',
    };
  }

  if (!labels.workingDir || !labels.configFile) {
    return {
      ok: false,
      error: 'This container is missing its compose project labels, so the update cannot locate '
        + 'the project on the host. That happens when the stack was started with "docker run" '
        + 'rather than "docker compose up". Start it with compose and try again.',
    };
  }

  return { ok: true, labels };
}

/** Update progress, so the client can be told rather than left guessing. */
const state = {
  phase: 'idle',
  error: null,
  startedAt: null,
  finishedAt: null,
};

function getState() {
  let log = '';
  try {
    const raw = fs.readFileSync(logPath(), 'utf8');
    log = raw.split('\n').slice(-40).join('\n');
  } catch { /* no log yet */ }
  return { ...state, bootId: BOOT_ID, log };
}

function resetState() {
  state.phase = 'idle';
  state.error = null;
  state.startedAt = null;
  state.finishedAt = null;
}

function fail(error) {
  state.phase = 'failed';
  state.error = error;
  state.finishedAt = Date.now();
}

/**
 * Pull the new images, then hand off to a helper container to recreate the stack.
 *
 * The helper exists because `up -d` replaces this very container, so whatever runs it
 * has to outlive it. Both steps append to the update log; previously both discarded
 * their output, which left nothing to diagnose when an update quietly did nothing.
 */
function runUpdate(labels, deps = {}) {
  const spawnFn = deps.spawn || spawn;
  const open = deps.openSync || fs.openSync;

  state.phase = 'pulling';
  state.error = null;
  state.startedAt = Date.now();
  state.finishedAt = null;

  let out;
  try {
    out = open(logPath(), 'a');
  } catch {
    out = 'ignore';
  }
  const stdio = out === 'ignore' ? 'ignore' : ['ignore', out, out];

  const projectArgs = labels.projectName ? ['-p', labels.projectName] : [];
  const composeArgs = ['compose', '-f', COMPOSE_FILE, ...projectArgs];

  const pull = spawnFn('docker', [...composeArgs, 'pull'], { detached: true, stdio });
  pull.unref();

  pull.on('error', (err) => fail(`Could not run docker: ${err.message}`));

  pull.on('close', (code) => {
    if (code !== 0) {
      return fail(`"docker compose pull" exited with code ${code}. See update.log for the reason.`);
    }
    state.phase = 'restarting';
    const helper = spawnFn(
      'docker',
      buildUpdateHelperArgs(labels.workingDir, labels.configFile, projectArgs),
      { detached: true, stdio }
    );
    helper.unref();
    helper.on('error', (err) => fail(`Could not start the update helper: ${err.message}`));
  });

  return pull;
}

module.exports = {
  COMPOSE_FILE,
  BOOT_ID,
  parseVersion,
  compareVersions,
  isVersionTag,
  imageTag,
  allowsDevBuilds,
  fetchVersionTags,
  REGISTRY_HOST,
  REGISTRY_PATH,
  MAX_TAG_PAGES,
  isNewerVersion,
  buildUpdateHelperArgs,
  readComposeLabels,
  preflight,
  runUpdate,
  getState,
  resetState,
  logPath,
};
