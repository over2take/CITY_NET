const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const outbound = require('./net/outbound');

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

/**
 * Whether this process can reach a Docker daemon — asked once, then remembered.
 *
 * `GET /api/version` is unauthenticated by design, and it used to run this probe on every
 * request. `execSync` blocks the whole event loop until the daemon answers, so anyone who
 * could reach that endpoint could hold the entire server still simply by asking for it
 * repeatedly. Nothing about the answer can change while the process lives — the socket is
 * mounted at container start or it is not — so the probe belongs to the process, not to
 * the request.
 *
 * The timeout is for the other half of the same problem: a socket that is present but
 * unresponsive would otherwise block for as long as it liked, once.
 */
let dockerAvailable = null;

const probeDocker = (exec) => {
  try {
    exec('docker info', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

function isDockerAvailable(deps = {}) {
  if (dockerAvailable === null) dockerAvailable = probeDocker(deps.execSync || execSync);
  return dockerAvailable;
}

/** Tests only — the memo is process-lifetime by design. */
isDockerAvailable.forget = () => { dockerAvailable = null; };

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
/**
 * What a failed registry read is called.
 *
 * The reasons come back from `outbound` as codes; these are the sentences. Deliberately
 * free of anything the registry said — an upstream message can carry detail we did not
 * choose to publish, and none of it helps an admin who can only retry or wait.
 *
 * `Failed to parse Docker Hub response` is load-bearing: the route matches on it to tell
 * "their answer was nonsense" (a 500) from "we could not reach them" (a 502).
 */
const REGISTRY_FAILURES = {
  BAD_RESPONSE: 'Failed to parse Docker Hub response',
  BAD_URL: 'Refused a malformed registry URL',
  BLOCKED_HOST: 'Refused a registry page pointing off Docker Hub',
  NOT_FOUND: 'Docker Hub has no tag list for this image',
  SERVICE_ERROR: 'Docker Hub refused the request',
  TIMEOUT: 'Docker Hub did not answer in time',
  TOO_LARGE: 'Docker Hub sent more than we are willing to read',
  UNREACHABLE: 'Could not reach Docker Hub',
};

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
  const fetchImpl = opts.fetchImpl;
  const allowDev = opts.allowDev ?? false;
  const maxPages = opts.maxPages ?? MAX_TAG_PAGES;

  const pageUrl = (pathAndQuery) => `https://${REGISTRY_HOST}${pathAndQuery}`;

  const walk = async () => {
    const found = [];
    let url = pageUrl(REGISTRY_PATH);

    for (let page = 0; page < maxPages; page++) {
      const { doc, error } = await outbound.getJson(url, {
        allowHosts: [REGISTRY_HOST],
        fetchImpl,
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      });
      // Rejecting rather than resolving empty: an empty list is indistinguishable from
      // "no releases published", and the route would report that you are up to date.
      if (error) throw new Error(REGISTRY_FAILURES[error] || 'Docker Hub request failed');

      for (const tag of doc?.results ?? []) {
        if (isVersionTag(tag.name, allowDev)) found.push(tag.name);
      }
      // Anything on a later page was updated longer ago, so once this channel has
      // something there is nothing to gain by reading on.
      if (found.length > 0 || !doc?.next) break;

      try {
        // Their payload supplies the path to read next, never the host to read it from.
        // `next` is a full URL, and taking its hostname — as this used to — lets whoever
        // answers choose where we knock next. The allowlist would refuse a foreign host
        // anyway; discarding it here means we never ask.
        const next = new URL(doc.next);
        url = pageUrl(`${next.pathname}${next.search}`);
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
  return [
    'run', '--rm',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${hostWorkingDir}:${hostWorkingDir}`,
    '-v', `${hostConfigFile}:${COMPOSE_FILE}:ro`,
    'over2take/citynet-backend:latest',
    // No `sh -c`. The command used to be assembled into a shell string with the working
    // directory interpolated in double quotes, which reads safe and is not: double quotes
    // stop word-splitting, they do not stop `$(...)` or backticks. Both that path and the
    // project name come from compose labels, so a project directory containing a command
    // substitution would have run it — inside a container holding the Docker socket.
    //
    // Passing argv instead means nothing is ever parsed as shell, which removes the class
    // rather than guarding one instance of it. Each argument arrives as written, spaces
    // and all, so it also fixes a working directory with a space in it.
    'docker', 'compose',
    '--project-directory', hostWorkingDir,
    '-f', COMPOSE_FILE,
    ...projectArgs,
    'up', '-d',
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
      // Two ways out, not one. Running without the socket is a deliberate posture for an
      // install facing the internet — the socket is root on the host, so anything that
      // reaches it can start a privileged container — and telling those operators only to
      // add it reads as a fault to be repaired rather than a choice they already made.
      error: 'The Docker socket is not mounted, so this container cannot update itself. '
        + 'Either update from the host with "docker compose pull && docker compose up -d", '
        + 'or add /var/run/docker.sock to the backend volumes and recreate the stack. '
        + 'Running without it is a supported choice; see UPGRADE.md.',
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
  code: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

/** Phases in which an update is under way and a second one must not start. */
const RUNNING_PHASES = ['pulling', 'restarting'];

/**
 * How long a run may hold the lock before another may take it.
 *
 * A pull that hangs would otherwise deaden the update button for the life of the process,
 * with nothing to clear it — and the phase lives in memory, so the only other way out is
 * the restart the update was supposed to perform. Fifteen minutes is well past a slow
 * pull on a slow line and well short of an afternoon.
 */
const STALE_RUN_MS = 15 * 60 * 1000;

/**
 * The process currently doing the work, while there is one.
 *
 * Kept out of `state` deliberately: `getState` is serialised to a public response, and a
 * ChildProcess has no business anywhere near it.
 */
let activeChild = null;

/**
 * Whether an update is already under way.
 *
 * `runUpdate` used to spawn unconditionally, so a double-click ran two `compose pull`
 * processes and then two privileged helper containers against the same stack, each
 * recreating containers the other was also recreating. The second press also cleared the
 * first run's error, so a failure could be erased before anyone had read it.
 *
 * **A process we can still see holds the lock, however long it has taken.** The elapsed
 * check below cannot tell a hung pull from a slow one — two images over a poor line can
 * take longer than any threshold worth setting — and releasing on time alone would let a
 * second press start a competing update against a stack the first one is still changing.
 * That is the exact failure this guards, so it errs towards staying locked.
 *
 * The cost is that a pull which truly never returns holds the button until the backend
 * restarts. That is recoverable from the host, and the phase lives in memory so a restart
 * clears it. The elapsed check remains for the other case: the child is gone but its
 * events never arrived, where nothing is running and nothing will release the lock.
 */
function isRunning(now = Date.now()) {
  if (!RUNNING_PHASES.includes(state.phase)) return false;
  if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) return true;
  return !(state.startedAt && now - state.startedAt > STALE_RUN_MS);
}

/**
 * What the client is told when an update fails.
 *
 * A stable code and a sentence of ours. The reason it is not the underlying message: the
 * status endpoint is public — the client has to keep reading it across the restart, when
 * nobody is logged in — and `docker compose` writes host paths, image names and absolute
 * directories into its output. None of that helps someone who can only retry or wait, and
 * all of it goes to `backend/data/update.log`, which is on the host where it belongs.
 */
const FAILURES = {
  DOCKER_UNAVAILABLE: 'Could not run docker. See backend/data/update.log.',
  COMPOSE_PULL_FAILED: 'The image pull failed. See backend/data/update.log for the reason.',
  HELPER_FAILED: 'The update helper could not be started. See backend/data/update.log.',
};

/**
 * Public update progress.
 *
 * This used to return the last forty lines of the update log alongside the phase, on an
 * unauthenticated route — and nothing ever displayed them. Forty lines of compose output,
 * including host paths, published to anyone who asked, for no one.
 */
function getState() {
  return { ...state, bootId: BOOT_ID };
}

function resetState() {
  activeChild = null;
  state.phase = 'idle';
  state.code = null;
  state.error = null;
  state.startedAt = null;
  state.finishedAt = null;
}

/** Where the detail goes instead of into the response. */
function note(line) {
  try {
    fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* the log is a convenience, not a dependency */ }
}

function fail(code, detail) {
  state.phase = 'failed';
  state.code = code;
  state.error = FAILURES[code] || 'The update failed. See backend/data/update.log.';
  state.finishedAt = Date.now();
  if (detail) note(`${code}: ${detail}`);
}

/**
 * Pull the new images, then hand off to a helper container to recreate the stack.
 *
 * The helper exists because `up -d` replaces this very container, so whatever runs it
 * has to outlive it. Both steps append to the update log; previously both discarded
 * their output, which left nothing to diagnose when an update quietly did nothing.
 */
function runUpdate(labels, deps = {}) {
  // One clock for the whole decision. Marking the start with the real time while judging
  // staleness by an injected one compares two different clocks, which is only ever true
  // by accident.
  const nowFn = deps.now || Date.now;

  // Refused here as well as at the route. This spawns privileged containers, and a guard
  // that lives only in the caller is one refactor away from not being there.
  if (isRunning(nowFn())) return null;

  const spawnFn = deps.spawn || spawn;
  const open = deps.openSync || fs.openSync;

  state.phase = 'pulling';
  state.code = null;
  state.error = null;
  state.startedAt = nowFn();
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
  activeChild = pull;
  pull.unref();

  pull.on('error', (err) => fail('DOCKER_UNAVAILABLE', err.message));

  pull.on('close', (code) => {
    if (code !== 0) {
      return fail('COMPOSE_PULL_FAILED', `"docker compose pull" exited with code ${code}`);
    }
    state.phase = 'restarting';
    const helper = spawnFn(
      'docker',
      buildUpdateHelperArgs(labels.workingDir, labels.configFile, projectArgs),
      { detached: true, stdio }
    );
    // The lock follows the work: the pull is finished, the helper now holds it.
    activeChild = helper;
    helper.unref();
    helper.on('error', (err) => fail('HELPER_FAILED', err.message));

    // The pull leg records a non-zero exit; this one did not, so a helper whose
    // `compose up` failed left the phase on `restarting` for ever and the client waiting
    // for a restart that was never coming — the exact failure this module was written to
    // stop, still alive in its second half.
    //
    // On success this usually never runs: `up -d` replaces the backend container, so the
    // process watching is gone before the helper finishes. That is why the helper exists,
    // and it is why this only ever fires on the path that matters.
    helper.on('close', (code) => {
      if (code !== 0) fail('HELPER_FAILED', `the update helper exited with code ${code}`);
    });
  });

  return pull;
}

module.exports = {
  COMPOSE_FILE,
  BOOT_ID,
  isDockerAvailable,
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
  isRunning,
  STALE_RUN_MS,
  FAILURES,
  getState,
  resetState,
  logPath,
};
