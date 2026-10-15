#!/usr/bin/env node
// The in-app updater, end to end, on real Docker.
//
// Every other updater test replaces Docker with a stand-in, and the stand-ins shared the code's
// wrong assumptions: a Windows server's X:\ paths failed every helper, and after one in-app update
// the next one failed because the stack's labels named a file only the helper had. Neither showed
// until a real install hit it. This builds the real server image from this checkout, starts a
// throwaway install from the real docker-compose.yml, and drives the real updater through the
// server's own API, checking a value in the database survives each step:
//
//   1. an in-app update, then a second one straight after (the case that broke);
//   2. LOOK FOR DEV BUILDS ticked: a copy of the database, IMAGE_TAG=dev in both .env files,
//      and an update onto the dev build;
//   3. the box unticked: IMAGE_TAG=latest in both files.
//
// Images come from a local registry instead of Docker Hub, so nothing is published and nothing
// is downloaded but the registry itself and an nginx stand-in for the frontend (the updater
// restarts the frontend but never looks inside it). Runs the same on Linux, Mac and Windows
// (Docker Desktop); CI runs it on Linux. node docker-test/updater-journey.mjs [--keep]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'cnupdtest';
const REGISTRY = 'cnupdtest-registry';
const REG = 'localhost:5099';
const APP_PORT = '18099';
const ADMIN = { username: 'docker_test_gm', password: 'docker-test-only-password' };
const MARKER = { key: 'docker_test_marker', value: `kept-${Date.now()}` };
const KEEP = process.argv.includes('--keep');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`\n== ${text}`);
const ok = (text) => console.log(`   ok  ${text}`);
const fail = (text) => { throw new Error(text); };

/** Docker, its output returned. Without IMAGE_TAG from this shell, which would outrank the .env files. */
const docker = (args, opts = {}) => {
  const env = { ...process.env };
  delete env.IMAGE_TAG;
  return execFileSync('docker', args, { encoding: 'utf8', cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
};
const quietly = (args, opts) => { try { return docker(args, opts); } catch { return ''; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-updater-'));
const data = path.join(dir, 'backend', 'data');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// ─── The images ──────────────────────────────────────────────────────────────

/** The real server image, as release builds it, with `version` baked in, pushed under each tag. */
const publishBackend = (version, ...tags) => {
  const image = `${REG}/citynet-backend`;
  docker(['build', '-q', '-f', 'Dockerfile.backend', '--build-arg', `APP_VERSION=${version}`, '-t', `${image}:${version}`, '.'], { cwd: ROOT });
  docker(['push', '-q', `${image}:${version}`]);
  for (const tag of tags) {
    docker(['tag', `${image}:${version}`, `${image}:${tag}`]);
    docker(['push', '-q', `${image}:${tag}`]);
  }
};

const publishFrontend = () => {
  docker(['pull', '-q', 'nginx:alpine']);
  for (const tag of ['latest', 'dev']) {
    docker(['tag', 'nginx:alpine', `${REG}/citynet-frontend:${tag}`]);
    docker(['push', '-q', `${REG}/citynet-frontend:${tag}`]);
  }
};

// ─── The install ─────────────────────────────────────────────────────────────

/**
 * docker-compose.yml as shipped, its images from the local registry, without DuckDNS or builds;
 * then as an install from before 1.8.1 still has it, its images written as `:latest` rather than
 * following IMAGE_TAG (an in-app update replaces images, never this file, so many installs do).
 */
const testCompose = () => {
  let yml = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').replace(/\r\n/g, '\n');
  yml = yml.replaceAll('over2take/citynet-', `${REG}/citynet-`);
  // An install pulls what is published; it never builds.
  yml = yml.replace(/\n {4}build:\n {6}context: \.\n {6}dockerfile: Dockerfile\.(backend|frontend)/g, '');
  // DuckDNS needs a real account, and the updater treats it like any other service.
  yml = yml.replace(/\n {2}# ── DuckDNS[\s\S]*$/, '\n');
  if (!yml.includes(`${REG}/citynet-backend:\${IMAGE_TAG:-latest}`) || /build:|duckdns/i.test(yml)) {
    fail('Could not make the test compose file from docker-compose.yml; has its shape changed?');
  }
  return yml.replaceAll(':${IMAGE_TAG:-latest}', ':latest');
};

const backendId = () => quietly(['ps', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--filter', 'label=com.docker.compose.service=backend']);

/** The server's own API, called from inside its container (the install publishes only the frontend). */
const api = (method, url, body, token) => {
  const id = backendId();
  if (!id) return null;
  const code = 'const [m,u,b,t]=JSON.parse(process.argv[1]);fetch("http://127.0.0.1:5000"+u,{method:m,headers:{"Content-Type":"application/json",...(t?{Authorization:"Bearer "+t}:{})},body:b===null?undefined:JSON.stringify(b)}).then(async r=>console.log(JSON.stringify({status:r.status,text:await r.text()}))).catch(()=>console.log("null"))';
  const out = quietly(['exec', id, 'node', '-e', code, JSON.stringify([method, url, body ?? null, token ?? null])]);
  const reply = out ? JSON.parse(out.split('\n').pop()) : null;
  if (!reply) return null;
  let json = reply.text;
  try { json = JSON.parse(reply.text); } catch { /* text it is */ }
  return { status: reply.status, body: json };
};

const waitFor = async (label, test, seconds = 360) => {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const got = await test();
    if (got) return got;
    await sleep(2000);
  }
  return fail(`Timed out waiting for ${label}`);
};

const version = () => api('GET', '/api/version')?.body?.version;

/**
 * An in-app update, as the UPDATE NOW button starts it, waited for until `to` is running. A server
 * that restarts on another version fails at once (a real install came back on the version it left).
 */
const update = async (token, to) => {
  const from = api('GET', '/api/version')?.body?.bootId;
  const started = api('POST', '/api/update', null, token);
  if (!started || started.status !== 200) fail(`POST /api/update answered ${started && started.status}: ${JSON.stringify(started && started.body)}`);
  await waitFor(`the server to come back as ${to}`, async () => {
    const st = api('GET', '/api/update/status');
    if (st && st.body && st.body.phase === 'failed') fail(`The update failed: ${st.body.error}`);
    const now = api('GET', '/api/version')?.body;
    if (now && now.bootId && now.bootId !== from && now.version !== to) fail(`The server restarted on ${now.version}, not ${to}`);
    return now && now.version === to;
  }, 240);
};

/** Whether the install's docker-compose.yml has its CITY_NET images following IMAGE_TAG. */
const composeFollowsTag = () => {
  const images = read('docker-compose.yml').split(/\r?\n/).filter((l) => /^\s*image:.*citynet-(backend|frontend)/.test(l));
  return images.length === 2 && images.every((l) => l.includes('${IMAGE_TAG'));
};

/** The value written at the start, still in the database. */
const markerKept = (token) => {
  const rows = api('GET', '/api/settings', null, token)?.body;
  const row = Array.isArray(rows) && rows.find((r) => r.key === MARKER.key);
  if (!row || row.value !== MARKER.value) fail(`The database lost its marker (${JSON.stringify(row)})`);
};

const tagIn = (file) => {
  const lines = read(file).split(/\r?\n/).filter((l) => /^\s*(export\s+)?IMAGE_TAG\s*=/.test(l));
  return lines.map((l) => l.split('=')[1].trim()).join(',');
};

const noFailureLogged = () => {
  const log = fs.existsSync(path.join(data, 'update.log')) ? fs.readFileSync(path.join(data, 'update.log'), 'utf8') : '';
  if (/FAILED/.test(log)) fail(`update.log records a failure:\n${log.split('\n').filter((l) => /FAILED|Error/.test(l)).join('\n')}`);
};

// ─── The journey ─────────────────────────────────────────────────────────────

const run = async () => {
  step(`A local registry, and the images (${REG})`);
  // Anything an interrupted run left behind (Docker stopped part way, say).
  const leftovers = quietly(['ps', '-aq', '--filter', `label=com.docker.compose.project=${PROJECT}`]).split('\n').filter(Boolean);
  if (leftovers.length) quietly(['rm', '-f', ...leftovers]);
  quietly(['rm', '-f', REGISTRY]);
  docker(['run', '-d', '--name', REGISTRY, '-p', '5099:5000', 'registry:2']);
  publishFrontend();
  publishBackend('1.0.0', 'latest');
  ok('server 1.0.0 built from this checkout and published as latest');

  step(`A throwaway install from docker-compose.yml, in ${dir}`);
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(dir, 'backend', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), testCompose());
  const env = `JWT_SECRET=docker-test-secret-not-for-anything-else\nADMIN_USER=${ADMIN.username}\nADMIN_PASS=${ADMIN.password}\nSECURE_MODE=true\nIMAGE_TAG=latest\n`;
  fs.writeFileSync(path.join(dir, 'backend', '.env'), env);
  // As the setup steps make it: backend/.env copied beside the compose file, with the port.
  fs.writeFileSync(path.join(dir, '.env'), `${env}APP_PORT=${APP_PORT}\n`);
  docker(['compose', '-p', PROJECT, 'up', '-d'], { cwd: dir });
  await waitFor('the server to start', async () => version() === '1.0.0', 120);
  const token = await waitFor('the GM to sign in', async () => api('POST', '/api/login', ADMIN)?.body?.token, 60);
  const wrote = api('POST', '/api/settings', MARKER, token);
  if (!wrote || wrote.status !== 200) fail(`Could not write the marker: ${JSON.stringify(wrote)}`);
  ok('running 1.0.0, the GM signed in, a marker written to the database');

  step('An in-app update to 1.0.1');
  publishBackend('1.0.1', 'latest');
  await update(token, '1.0.1');
  markerKept(token);
  noFailureLogged();
  ok('updated in the app to 1.0.1, the marker kept');

  step('A second in-app update straight after, to 1.0.2 (the one that failed on a real install)');
  publishBackend('1.0.2', 'latest');
  await update(token, '1.0.2');
  markerKept(token);
  noFailureLogged();
  ok('updated again in the app to 1.0.2, the marker kept');

  step('Dev builds turned on by an earlier version, its docker-compose.yml older than 1.8.1');
  // As a real install was found: both .env files saying dev, the server reading dev, and the
  // compose file still naming its images :latest, so nothing it was told could reach a dev build.
  for (const f of ['backend/.env', '.env']) fs.writeFileSync(path.join(dir, f), read(f).replace(/^IMAGE_TAG=.*$/m, 'IMAGE_TAG=dev'));
  docker(['compose', '-p', PROJECT, 'up', '-d', '--force-recreate'], { cwd: dir });
  await waitFor('the server to come back after the restart', async () => version() === '1.0.2', 120);
  if (composeFollowsTag()) fail('The test install\'s compose file should still name its images :latest here');
  ok('IMAGE_TAG=dev in both files, still 1.0.2, the images written :latest');

  step('An in-app update onto the dev build, from there');
  publishBackend('1.0.3-dev.1', 'dev');
  await update(token, '1.0.3-dev.1');
  markerKept(token);
  noFailureLogged();
  if (!composeFollowsTag()) fail('docker-compose.yml still names its images :latest');
  if (!fs.readdirSync(dir).some((n) => n.startsWith('docker-compose.yml.before-dev-builds-'))) fail('No copy of the original docker-compose.yml was kept');
  ok('running the dev build 1.0.3-dev.1, the compose file now following IMAGE_TAG (the original kept), the marker kept');

  step('LOOK FOR DEV BUILDS unticked, then ticked');
  const off1 = api('PUT', '/api/update/channel', { dev: false }, token);
  if (!off1 || off1.status !== 200 || tagIn('backend/.env') !== 'latest' || tagIn('.env') !== 'latest') fail(`Unticking: ${JSON.stringify(off1 && off1.body)}`);
  const on = api('PUT', '/api/update/channel', { dev: true }, token);
  if (!on || on.status !== 200) fail(`Turning dev builds on answered ${on && on.status}: ${JSON.stringify(on && on.body)}`);
  if (tagIn('backend/.env') !== 'dev' || tagIn('.env') !== 'dev') fail(`IMAGE_TAG after ticking: backend/.env=${tagIn('backend/.env')} .env=${tagIn('.env')}`);
  if (!fs.readdirSync(data).some((n) => n.startsWith('city.db.before-dev-builds-'))) fail('No copy of the database was made before dev builds');
  ok(`IMAGE_TAG=dev in both .env files, the database copied (${on.body.backup})`);

  step('LOOK FOR DEV BUILDS unticked');
  const off = api('PUT', '/api/update/channel', { dev: false }, token);
  if (!off || off.status !== 200) fail(`Turning dev builds off answered ${off && off.status}: ${JSON.stringify(off && off.body)}`);
  if (tagIn('backend/.env') !== 'latest' || tagIn('.env') !== 'latest') fail(`IMAGE_TAG after unticking: backend/.env=${tagIn('backend/.env')} .env=${tagIn('.env')}`);
  ok('IMAGE_TAG=latest in both .env files');
};

const cleanUp = () => {
  quietly(['compose', '-p', PROJECT, 'down', '--remove-orphans'], { cwd: dir });
  quietly(['rm', '-f', REGISTRY]);
  const images = quietly(['images', '--format', '{{.Repository}}:{{.Tag}}']).split('\n').filter((i) => i.startsWith(`${REG}/`));
  if (images.length) quietly(['rmi', ...images]);
  // Files the server wrote as root in a Linux container are removed from inside one.
  quietly(['run', '--rm', '-v', `${dir}:/work`, 'alpine:3.20', 'rm', '-rf', '/work/backend']);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left in the temp folder */ }
};

try {
  await run();
  console.log('\nPASSED: two in-app updates in a row, an old compose file brought onto dev builds, dev builds on and off, the data kept throughout.');
  if (!KEEP) cleanUp();
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  console.error('\n-- server log --');
  console.error(quietly(['compose', '-p', PROJECT, 'logs', '--tail', '60', 'backend'], { cwd: dir }));
  const log = path.join(data, 'update.log');
  if (fs.existsSync(log)) console.error(`\n-- update.log --\n${fs.readFileSync(log, 'utf8').split('\n').filter((l) => !/Downloading|Extracting|Waiting|Verifying/.test(l)).slice(-40).join('\n')}`);
  if (KEEP) console.error(`\nKept for a look: ${dir} (docker compose -p ${PROJECT} ...)`);
  else cleanUp();
  process.exit(1);
}
