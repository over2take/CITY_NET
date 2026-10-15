const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

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

/**
 * Set IMAGE_TAG in both files under `projectDir` (the helper's half, run as a command).
 *
 * backend/.env must already exist, since the stack cannot start without it; its absence means
 * this is not the directory it was told, and nothing is written. The .env beside the compose
 * file is made if it is missing, because without it compose would still pull the stable images.
 */
function writeChannel(projectDir, tag, deps = {}) {
  const fsx = deps.fs || fs;
  if (!CHANNELS.includes(tag)) throw new Error(`Not a channel: ${tag}`);
  if (!path.isAbsolute(projectDir)) throw new Error('The project directory must be an absolute path');
  const [backendEnv, composeEnv] = ENV_FILES.map((f) => path.join(projectDir, f));
  if (!fsx.existsSync(backendEnv)) throw new Error(`${backendEnv} is missing`);
  for (const file of [backendEnv, composeEnv]) {
    const was = fsx.existsSync(file) ? fsx.readFileSync(file, 'utf8') : '';
    const next = withImageTag(was, tag);
    // Written in place, so the file keeps its owner and permissions.
    if (next !== was) fsx.writeFileSync(file, next);
  }
}

/** The argument list for the helper that runs writeChannel on the host's files. */
function channelHelperArgs(image, projectDir, tag) {
  return [
    'run', '--rm',
    // At its own absolute path, as the update helper mounts it (updater.js buildUpdateHelperArgs).
    '-v', `${projectDir}:${projectDir}`,
    // argv, never a shell string: the directory comes from compose labels.
    image, 'node', SCRIPT_IN_IMAGE, projectDir, tag,
  ];
}

/**
 * The image this container runs, so the helper runs the same code as this file. Falls back to
 * the stable image, which has had this file since it was added.
 */
function ownImage(deps = {}) {
  const read = deps.readFileSync || fs.readFileSync;
  const exec = deps.execSync || execSync;
  try {
    const containerId = read('/etc/hostname', 'utf8').trim();
    const image = exec(`docker inspect ${containerId} --format '{{.Config.Image}}'`, { encoding: 'utf8' }).trim();
    return image || 'over2take/citynet-backend:latest';
  } catch {
    return 'over2take/citynet-backend:latest';
  }
}

/** Where the copy made before following dev builds goes: beside the database, named as other copies are. */
function backupPath(dbPath, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, '');
  return path.join(path.dirname(dbPath), `${path.basename(dbPath)}.before-dev-builds-${stamp}.bak`);
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
  const spawnFn = deps.spawn || spawn;
  const copy = tag === 'dev' ? backupDatabase(db, dbPath, deps.now ? deps.now() : new Date()) : Promise.resolve(null);
  return copy.then((backup) => new Promise((resolve, reject) => {
    const helper = spawnFn('docker', channelHelperArgs(deps.image || ownImage(deps), labels.workingDir, tag), { stdio: 'ignore' });
    helper.on('error', (err) => reject(err));
    helper.on('close', (code) => {
      if (code !== 0) return reject(new Error(`the channel helper exited with code ${code}`));
      process.env.IMAGE_TAG = tag;
      resolve({ channel: tag, backup });
    });
  }));
}

module.exports = {
  CHANNELS, ENV_FILES, SCRIPT_IN_IMAGE,
  withImageTag, writeChannel, channelHelperArgs, ownImage, backupPath, backupDatabase, switchChannel,
};

// The helper's half: node updateChannel.js <project directory> <channel>
if (require.main === module) {
  try {
    writeChannel(process.argv[2], process.argv[3]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
