const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');
const { dockerPath } = require('./dockerPath');

/**
 * The LOOK FOR DEV BUILDS box: which release channel this deployment follows, switched from
 * inside the app.
 *
 * The channel is `IMAGE_TAG` (updater.js imageTag), and it lives in two files on the host:
 * backend/.env, which becomes this container's environment, and the .env beside
 * docker-compose.yml, which compose reads to pick the images. Before this, following dev
 * builds meant editing both by hand and pulling once from a terminal.
 *
 * This container cannot write either file: backend/.env is mounted read-only and the other is
 * not mounted at all. So the edit is made by a short-lived helper container with the project
 * directory mounted, the same way the update's own helper gets at it, running this file's
 * command-line half. Only the IMAGE_TAG line is touched; everything else in the files stays
 * exactly as it was.
 */

/** The channels the box switches between. A pinned version is left to the files themselves. */
const CHANNELS = ['dev', 'latest'];

/** Where this file is inside the backend image (Dockerfile.backend copies backend/ to /app). */
const SCRIPT_IN_IMAGE = '/app/updateChannel.js';

/** The two files, relative to the project directory on the host. */
const ENV_FILES = ['backend/.env', '.env'];

/** An active IMAGE_TAG line: a comment that mentions it is not one. */
const TAG_LINE = /^[ \t]*(?:export[ \t]+)?IMAGE_TAG[ \t]*=.*$/;

/**
 * An env file's text with IMAGE_TAG set to `tag`.
 *
 * Every active IMAGE_TAG line is changed, so two can never disagree; with none, one is added at
 * the end. Line endings are kept as the file has them, and nothing else is reordered or
 * rewritten.
 */
function withImageTag(text, tag) {
  const source = String(text ?? '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!TAG_LINE.test(line)) return line;
    found = true;
    return `IMAGE_TAG=${tag}`;
  });
  if (found) return next.join(eol);
  if (!source) return `IMAGE_TAG=${tag}${eol}`;
  const ends = /\r?\n$/.test(source);
  return `${source}${ends ? '' : eol}IMAGE_TAG=${tag}${eol}`;
}

/** A stamp for a file name: the time to the second, with nothing a file system minds. */
const stampOf = (now) => now.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, '');

// ─── docker-compose.yml from before 1.8.1 ────────────────────────────────────
//
// IMAGE_TAG only reaches the images where docker-compose.yml names them `:${IMAGE_TAG:-latest}`,
// which it has since 1.8.1. An in-app update replaces images, never this file, so an install set
// up earlier still names them `:latest`, and there IMAGE_TAG changes nothing: a real install on dev
// builds pulled and restarted on the stable images every time. Its two CITY_NET image lines are
// changed to follow IMAGE_TAG, and nothing else in the file (ports, DuckDNS) is touched.

/** A CITY_NET image line: indentation, the image (any registry), its tag if any, the line's end. */
const CITYNET_IMAGE = /^([ \t]*image:[ \t]*["']?)(\S*?citynet-(?:backend|frontend))(?::([^\s"'/]+))?(["']?[ \t]*)$/;

/** Whether every CITY_NET image in a compose file follows IMAGE_TAG (true when it names none). */
function followsTag(text) {
  return String(text ?? '').split(/\r?\n/).every((line) => {
    const m = CITYNET_IMAGE.exec(line);
    return !m || /\$\{IMAGE_TAG/.test(m[3] || '');
  });
}

/** A compose file's text with its CITY_NET images following IMAGE_TAG; line endings kept. */
function withTaggedImages(text) {
  const source = String(text ?? '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  return source.split(/\r?\n/).map((line) => {
    const m = CITYNET_IMAGE.exec(line);
    if (!m || /\$\{IMAGE_TAG/.test(m[3] || '')) return line;
    return `${m[1]}${m[2]}:\${IMAGE_TAG:-latest}${m[4]}`;
  }).join(eol);
}

/**
 * Set IMAGE_TAG in both files under `projectDir` (the helper's half, run as a command), and make
 * `composeFile`'s images follow it if they don't, keeping the original beside it.
 *
 * backend/.env must already exist, since the stack cannot start without it; its absence means
 * this is not the directory it was told, and nothing is written. The .env beside the compose
 * file is made if it is missing, because without it compose would still pull the stable images.
 */
function writeChannel(projectDir, tag, deps = {}, composeFile = null) {
  const fsx = deps.fs || fs;
  if (!CHANNELS.includes(tag)) throw new Error(`Not a channel: ${tag}`);
  if (!path.isAbsolute(projectDir)) throw new Error('The project directory must be an absolute path');
  const [backendEnv, composeEnv] = ENV_FILES.map((f) => path.join(projectDir, f));
  if (!fsx.existsSync(backendEnv)) throw new Error(`${backendEnv} is missing`);
  for (const file of [backendEnv, composeEnv]) {
    const was = fsx.existsSync(file) ? fsx.readFileSync(file, 'utf8') : '';
    const next = withImageTag(was, tag);
    // Written in place, so the file keeps its owner and permissions (and a container with it
    // mounted sees the change).
    if (next !== was) fsx.writeFileSync(file, next);
  }
  if (composeFile && fsx.existsSync(composeFile)) {
    const was = fsx.readFileSync(composeFile, 'utf8');
    const next = withTaggedImages(was);
    if (next !== was) {
      fsx.copyFileSync(composeFile, `${composeFile}.before-dev-builds-${stampOf(deps.now ? deps.now() : new Date())}.bak`);
      fsx.writeFileSync(composeFile, next);
    }
  }
}

/** The argument list for the helper that runs writeChannel on the host's files. */
function channelHelperArgs(image, reportedProjectDir, tag, reportedComposeFile = null) {
  // As Docker accepts them from in here: a Windows host's `X:\...` becomes `/x/...` (dockerPath.js).
  const projectDir = dockerPath(reportedProjectDir);
  const composeFile = reportedComposeFile ? dockerPath(reportedComposeFile) : null;
  return [
    'run', '--rm',
    // At its own absolute path, as the update helper mounts it (updater.js buildUpdateHelperArgs).
    '-v', `${projectDir}:${projectDir}`,
    // The compose file too, writable, at its own path (it is usually inside the project already).
    ...(composeFile ? ['-v', `${composeFile}:${composeFile}`] : []),
    // argv, never a shell string: the directory comes from compose labels.
    image, 'node', SCRIPT_IN_IMAGE, projectDir, tag, ...(composeFile ? [composeFile] : []),
  ];
}

/**
 * This container as Docker sees it: its image, its compose service, and its mounts (where each
 * of its folders comes from on the host). Null when Docker can't say.
 */
function inspectSelf(deps = {}) {
  const read = deps.readFileSync || fs.readFileSync;
  const exec = deps.execSync || execSync;
  try {
    const containerId = read('/etc/hostname', 'utf8').trim();
    const self = JSON.parse(exec(`docker inspect ${containerId} --format '{{json .}}'`, { encoding: 'utf8' }));
    const config = self.Config || {};
    return {
      image: config.Image || null,
      service: (config.Labels || {})['com.docker.compose.service'] || null,
      mounts: Array.isArray(self.Mounts) ? self.Mounts.map((m) => ({ source: m.Source, destination: m.Destination })) : [],
    };
  } catch {
    return null;
  }
}

/**
 * The image this container runs, so the helper runs the same code as this file. Falls back to
 * the stable image, which has had this file since it was added.
 */
function ownImage(deps = {}) {
  const self = inspectSelf(deps);
  return (self && self.image) || 'over2take/citynet-backend:latest';
}

/** Where the copy made before following dev builds goes: beside the database, named as other copies are. */
function backupPath(dbPath, now = new Date()) {
  return path.join(path.dirname(dbPath), `${path.basename(dbPath)}.before-dev-builds-${stampOf(now)}.bak`);
}

/**
 * A whole copy of the database, consistent while the server is running (SQLite's VACUUM INTO
 * writes a snapshot, where copying the file could catch it mid-write). Resolves the copy's path.
 */
function backupDatabase(db, dbPath, now = new Date()) {
  const to = backupPath(dbPath, now);
  return new Promise((resolve, reject) => {
    db.run('VACUUM INTO ?', [to], (err) => (err ? reject(err) : resolve(to)));
  });
}

/**
 * Switch this deployment to `tag`: a copy of the database first when it is dev, then the two
 * files, then this process's own IMAGE_TAG, so the next update check and the update itself
 * follow the new channel before any restart. Resolves { channel, backup }.
 */
function switchChannel({ tag, labels, db, dbPath }, deps = {}) {
  if (!CHANNELS.includes(tag)) return Promise.reject(new Error(`Not a channel: ${tag}`));
  const copy = tag === 'dev' ? backupDatabase(db, dbPath, deps.now ? deps.now() : new Date()) : Promise.resolve(null);
  return copy.then((backup) => syncChannel({ tag, labels }, deps).then(() => ({ channel: tag, backup })));
}

/**
 * The helper run for `tag`: both .env files set, and the compose file's images made to follow
 * IMAGE_TAG if they don't. Then this process follows `tag` too. No database copy; the box makes
 * one when dev builds are turned on, and an update on dev builds calls this to put the files in
 * step before it pulls anything.
 */
function syncChannel({ tag, labels }, deps = {}) {
  if (!CHANNELS.includes(tag)) return Promise.reject(new Error(`Not a channel: ${tag}`));
  const spawnFn = deps.spawn || spawn;
  return new Promise((resolve, reject) => {
    const args = channelHelperArgs(deps.image || ownImage(deps), labels.workingDir, tag, labels.configFile || null);
    const helper = spawnFn('docker', args, { stdio: 'ignore' });
    helper.on('error', (err) => reject(err));
    helper.on('close', (code) => {
      if (code !== 0) return reject(new Error(`the channel helper exited with code ${code}`));
      process.env.IMAGE_TAG = tag;
      resolve();
    });
  });
}

// ─── GO BACK TO STABLE ────────────────────────────────────────────────────────
//
// A dev build may change how the database stores things, and no stable release has been tested
// on data a dev build has changed. So going back puts back the copy made when dev builds were
// turned on, after setting the dev database aside beside it (never deleted). The server can't
// swap a database it has open, and it is stopped part way, so the whole thing is done by a
// helper container, detached, that outlives it: pull stable, write `latest`, stop the server,
// swap the files, start everything on stable.

/** SQLite's own files beside a database, which go wherever the database goes. */
const SIDE_FILES = ['-journal', '-wal', '-shm'];

/** The newest copy made before dev builds were turned on, among a data folder's file names, or null. */
function newestDevCopy(names, dbName) {
  const prefix = `${dbName}.before-dev-builds-`;
  // The stamp is an ISO time, so the names sort in time order.
  const copies = names.filter((n) => n.startsWith(prefix) && n.endsWith('.bak')).sort();
  return copies.length ? copies[copies.length - 1] : null;
}

/** Where `containerDir` comes from on the host, read off this container's mounts, or null. */
function hostPathOf(mounts, containerDir) {
  const plain = (p) => path.posix.normalize(String(p)).replace(/(.)\/$/, '$1');
  const found = (mounts || []).find((m) => plain(m.destination) === plain(containerDir));
  return found ? found.source : null;
}

/**
 * In `dataDir`: the dev database set aside as <db>.dev-<stamp>.bak with its side files (named so
 * SQLite still finds them, should it be opened again), and the copy put back as the database. The
 * copy itself stays. A failure part way puts the dev database back as it was. Returns the name the
 * dev database was set aside as.
 */
function swapBack(dataDir, dbName, copyName, stamp, deps = {}) {
  const fsx = deps.fs || fs;
  const at = (n) => path.join(dataDir, n);
  if (!fsx.existsSync(at(copyName))) throw new Error(`${copyName} is missing`);
  const aside = `${dbName}.dev-${stamp}.bak`;
  const moved = [];
  try {
    for (const suffix of ['', ...SIDE_FILES]) {
      if (!fsx.existsSync(at(dbName + suffix))) continue;
      fsx.renameSync(at(dbName + suffix), at(aside + suffix));
      moved.push(suffix);
    }
    fsx.copyFileSync(at(copyName), at(dbName));
  } catch (err) {
    if (moved.includes('') && fsx.existsSync(at(dbName))) fsx.unlinkSync(at(dbName));
    for (const suffix of moved) fsx.renameSync(at(aside + suffix), at(dbName + suffix));
    throw err;
  }
  return aside;
}

/**
 * The helper's whole job, in order. Nothing is stopped until stable is downloaded and `latest`
 * is written, and once the server is stopped, everything is started again whatever happened.
 */
function revertToStable({ projectDir, configFile, dataDir, dbName, copyName, service, projectName, stamp }, deps = {}) {
  const fsx = deps.fs || fs;
  const env = { ...process.env, IMAGE_TAG: 'latest' };
  const run = deps.run || ((args) => execFileSync('docker', args, { stdio: 'inherit', env }));
  const say = deps.say || ((line) => console.log(`[go back to stable] ${line}`));
  if (!fsx.existsSync(path.join(dataDir, copyName))) throw new Error(`${copyName} is missing`);
  if (!service) throw new Error('The server\'s compose service is unknown');
  if (!configFile) throw new Error('The compose file is unknown');
  // The compose file by its host path, as the update's own helper gives it (updater.js): compose
  // records the -f it is given in the containers' labels, which the next update reads.
  const compose = ['compose', '--project-directory', projectDir, '-f', configFile, ...(projectName ? ['-p', projectName] : [])];
  say('downloading the stable release');
  run([...compose, 'pull']);
  writeChannel(projectDir, 'latest', deps);
  say(`stopping ${service}`);
  run([...compose, 'stop', service]);
  try {
    const aside = swapBack(dataDir, dbName, copyName, stamp, deps);
    say(`dev database set aside as ${aside}; ${copyName} put back as ${dbName}`);
  } finally {
    say('starting the stable release');
    run([...compose, 'up', '-d']);
  }
}

/** Whether `inner` is `outer` or inside it, as host paths. */
const within = (inner, outer) => inner === outer || inner.startsWith(`${outer.replace(/\/$/, '')}/`);

/**
 * The argument list for the helper that runs revertToStable. Every host path as Docker accepts it
 * from in here (dockerPath.js: a Windows host's X:\ becomes /x/), each mounted at its own path.
 */
function revertHelperArgs(image, { projectDir: reportedProjectDir, configFile: reportedConfigFile, dataDir: reportedDataDir, dbName, copyName, service, projectName, stamp }) {
  const projectDir = dockerPath(reportedProjectDir);
  const configFile = dockerPath(reportedConfigFile);
  const dataDir = dockerPath(reportedDataDir);
  return [
    'run', '--rm',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${projectDir}:${projectDir}`,
    '-v', `${configFile}:${configFile}:ro`,
    // The data folder is usually inside the project, and so already there.
    ...(within(dataDir, projectDir) ? [] : ['-v', `${dataDir}:${dataDir}`]),
    image, 'node', SCRIPT_IN_IMAGE, 'revert', projectDir, dataDir, dbName, copyName, service, projectName || '', stamp, configFile,
  ];
}

/**
 * What going back would use, or why it can't: { ok: true, copy, dataDir, service, image } or
 * { ok: false, error }. Read from this container, so nothing is assumed about the layout.
 */
function revertPlan(dbPath, deps = {}) {
  const fsx = deps.fs || fs;
  let names = [];
  try { names = fsx.readdirSync(path.dirname(dbPath)); } catch { /* no folder, no copy */ }
  const copy = newestDevCopy(names, path.basename(dbPath));
  if (!copy) return { ok: false, error: 'There is no copy from before dev builds were turned on to go back to.' };
  const self = deps.self !== undefined ? deps.self : inspectSelf(deps);
  if (!self) return { ok: false, error: 'Docker could not say how this server is set up.', copy };
  const dataDir = hostPathOf(self.mounts, path.dirname(dbPath));
  if (!dataDir) return { ok: false, error: 'The database folder is not mounted from the host, so there is nothing to put back.', copy };
  if (!self.service) return { ok: false, error: 'This server was not started by docker compose.', copy };
  return { ok: true, copy, dataDir, service: self.service, image: self.image || 'over2take/citynet-backend:latest' };
}

/** Start the helper, detached: it stops this server part way, so it can't be waited for here. */
function startRevert({ plan, labels, dbPath, out = 'ignore' }, deps = {}) {
  const spawnFn = deps.spawn || spawn;
  const now = deps.now ? deps.now() : new Date();
  const args = revertHelperArgs(plan.image, {
    projectDir: labels.workingDir,
    configFile: labels.configFile,
    dataDir: plan.dataDir,
    dbName: path.basename(dbPath),
    copyName: plan.copy,
    service: plan.service,
    projectName: labels.projectName,
    stamp: stampOf(now),
  });
  const helper = spawnFn('docker', args, { detached: true, stdio: out === 'ignore' ? 'ignore' : ['ignore', out, out] });
  helper.unref();
  return helper;
}

module.exports = {
  CHANNELS, ENV_FILES, SCRIPT_IN_IMAGE, SIDE_FILES,
  withImageTag, followsTag, withTaggedImages, writeChannel, channelHelperArgs, inspectSelf, ownImage, backupPath, backupDatabase,
  switchChannel, syncChannel,
  newestDevCopy, hostPathOf, swapBack, revertToStable, revertHelperArgs, revertPlan, startRevert,
};

// The helper's half:
//   node updateChannel.js <project directory> <channel> [<compose file>]
//   node updateChannel.js revert <project directory> <data directory> <db> <copy> <service> <project name> <stamp> <compose file>
if (require.main === module) {
  try {
    const [first, ...rest] = process.argv.slice(2);
    if (first === 'revert') {
      const [projectDir, dataDir, dbName, copyName, service, projectName, stamp, configFile] = rest;
      revertToStable({ projectDir, configFile, dataDir, dbName, copyName, service, projectName, stamp });
    } else {
      writeChannel(first, rest[0], {}, rest[1] || null);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
