import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const channel = require('../updateChannel.js');
const sqlite3 = require('sqlite3');

const SCRIPT = path.resolve(__dirname, '..', 'updateChannel.js');

describe('withImageTag: only the IMAGE_TAG line changes', () => {
  it('changes the value of a line that is there, and nothing else', () => {
    const was = 'PORT=5000\n# Which images\nIMAGE_TAG=latest\nJWT_SECRET=x\n';
    expect(channel.withImageTag(was, 'dev')).toBe('PORT=5000\n# Which images\nIMAGE_TAG=dev\nJWT_SECRET=x\n');
  });

  it('keeps Windows line endings', () => {
    expect(channel.withImageTag('A=1\r\nIMAGE_TAG=latest\r\nB=2\r\n', 'dev')).toBe('A=1\r\nIMAGE_TAG=dev\r\nB=2\r\n');
  });

  it('reads an exported or spaced line as the setting it is', () => {
    expect(channel.withImageTag('export IMAGE_TAG=latest\n', 'dev')).toBe('IMAGE_TAG=dev\n');
    expect(channel.withImageTag('  IMAGE_TAG = latest\n', 'dev')).toBe('IMAGE_TAG=dev\n');
  });

  it('changes every active line, so two can never disagree', () => {
    expect(channel.withImageTag('IMAGE_TAG=latest\nX=1\nIMAGE_TAG=1.8.1\n', 'dev')).toBe('IMAGE_TAG=dev\nX=1\nIMAGE_TAG=dev\n');
  });

  it('leaves a comment that mentions it, and adds a real line', () => {
    const was = '#   IMAGE_TAG=dev      development builds\nPORT=5000\n';
    expect(channel.withImageTag(was, 'dev')).toBe(`${was}IMAGE_TAG=dev\n`);
  });

  it('adds the line to a file without one, after a last line with no newline', () => {
    expect(channel.withImageTag('PORT=5000', 'dev')).toBe('PORT=5000\nIMAGE_TAG=dev\n');
    expect(channel.withImageTag('', 'dev')).toBe('IMAGE_TAG=dev\n');
  });

  it('a file already on the channel comes back unchanged', () => {
    const was = 'A=1\nIMAGE_TAG=dev\n';
    expect(channel.withImageTag(was, 'dev')).toBe(was);
  });

  it('does not mistake a longer name for it', () => {
    expect(channel.withImageTag('IMAGE_TAG_OLD=1\n', 'dev')).toBe('IMAGE_TAG_OLD=1\nIMAGE_TAG=dev\n');
  });
});

describe('writeChannel: the two files on the host', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-channel-'));
    fs.mkdirSync(path.join(dir, 'backend'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  it('sets both, and makes the one beside the compose file when it is missing', () => {
    fs.writeFileSync(path.join(dir, 'backend/.env'), 'PORT=5000\nIMAGE_TAG=latest\n');
    channel.writeChannel(dir, 'dev');
    expect(read('backend/.env')).toBe('PORT=5000\nIMAGE_TAG=dev\n');
    expect(read('.env')).toBe('IMAGE_TAG=dev\n');
    channel.writeChannel(dir, 'latest');
    expect(read('backend/.env')).toBe('PORT=5000\nIMAGE_TAG=latest\n');
    expect(read('.env')).toBe('IMAGE_TAG=latest\n');
  });

  it('writes nothing in a directory without backend/.env, which is not the project', () => {
    expect(() => channel.writeChannel(dir, 'dev')).toThrow(/missing/);
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
  });

  it('refuses anything but the two channels, and a relative directory', () => {
    fs.writeFileSync(path.join(dir, 'backend/.env'), 'IMAGE_TAG=latest\n');
    expect(() => channel.writeChannel(dir, '1.8.1')).toThrow(/Not a channel/);
    expect(() => channel.writeChannel('relative/dir', 'dev')).toThrow(/absolute/);
    expect(read('backend/.env')).toBe('IMAGE_TAG=latest\n');
  });

  it('is what the helper runs: node updateChannel.js <directory> <channel>', () => {
    fs.writeFileSync(path.join(dir, 'backend/.env'), 'IMAGE_TAG=latest\n');
    execFileSync(process.execPath, [SCRIPT, dir, 'dev']);
    expect(read('backend/.env')).toBe('IMAGE_TAG=dev\n');
    expect(read('.env')).toBe('IMAGE_TAG=dev\n');
    // A refusal exits non-zero, so the route reports it rather than a switch that never happened.
    expect(() => execFileSync(process.execPath, [SCRIPT, dir, 'nightly'], { stdio: 'ignore' })).toThrow();
  });
});

describe('channelHelperArgs', () => {
  it('mounts the project at its own path and runs this file with argv, no shell', () => {
    const dir = '/opt/city net';
    const args = channel.channelHelperArgs('over2take/citynet-backend:1.14.6', dir, 'dev');
    expect(args).toEqual(['run', '--rm', '-v', `${dir}:${dir}`, 'over2take/citynet-backend:1.14.6', 'node', '/app/updateChannel.js', dir, 'dev']);
    expect(args).not.toContain('sh');
  });

  it('names where this file really is in the backend image', () => {
    // Dockerfile.backend copies backend/ into its WORKDIR; a move or a rename must move this too.
    const dockerfile = fs.readFileSync(path.resolve(__dirname, '..', '..', 'Dockerfile.backend'), 'utf8');
    const workdir = /^WORKDIR\s+(\S+)/m.exec(dockerfile)[1];
    expect(dockerfile).toMatch(/^COPY backend\/ \.$/m);
    expect(channel.SCRIPT_IN_IMAGE).toBe(`${workdir}/${path.basename(SCRIPT)}`);
  });
});

describe('inspectSelf and ownImage', () => {
  const INSPECT = JSON.stringify({
    Config: { Image: 'over2take/citynet-backend:dev', Labels: { 'com.docker.compose.service': 'backend' } },
    Mounts: [{ Source: '/opt/citynet/backend/data', Destination: '/app/data', Mode: 'rw' }],
  });
  const deps = (out) => ({ readFileSync: () => 'abc123\n', execSync: (cmd) => { expect(cmd).toContain('abc123'); return out; } });
  it('reads the image, the compose service and the mounts off this container', () => {
    expect(channel.inspectSelf(deps(INSPECT))).toEqual({
      image: 'over2take/citynet-backend:dev', service: 'backend',
      mounts: [{ source: '/opt/citynet/backend/data', destination: '/app/data' }],
    });
  });
  it('is the image this container runs', () => {
    expect(channel.ownImage(deps(INSPECT))).toBe('over2take/citynet-backend:dev');
  });
  it('falls back to the stable image when docker cannot say', () => {
    expect(channel.ownImage({ readFileSync: () => { throw new Error('no'); } })).toBe('over2take/citynet-backend:latest');
  });
});

describe('the copy made before dev builds', () => {
  it('sits beside the database, named so .dockerignore keeps it out of the image', () => {
    const at = channel.backupPath('/app/data/city.db', new Date('2026-10-14T21:05:09.123Z'));
    expect(at).toBe(path.join('/app/data', 'city.db.before-dev-builds-2026-10-14T21-05-09.bak'));
    const ignore = fs.readFileSync(path.resolve(__dirname, '..', '..', '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/^backend\/city\.db\*$/m);
  });

  it('is a whole, readable copy of the database while it is open', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-copy-'));
    const dbPath = path.join(dir, 'city.db');
    const db = new sqlite3.Database(dbPath);
    const run = (d, sql, p = []) => new Promise((ok, no) => d.run(sql, p, (e) => (e ? no(e) : ok())));
    try {
      await run(db, 'CREATE TABLE t (name TEXT)');
      await run(db, "INSERT INTO t VALUES ('Ash')");
      const copy = await channel.backupDatabase(db, dbPath, new Date('2026-10-14T00:00:00Z'));
      const back = new sqlite3.Database(copy);
      const row = await new Promise((ok, no) => back.get('SELECT name FROM t', (e, r) => (e ? no(e) : ok(r))));
      await new Promise((ok) => back.close(ok));
      expect(row).toEqual({ name: 'Ash' });
    } finally {
      await new Promise((ok) => db.close(ok));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('switchChannel', () => {
  let was;
  beforeEach(() => { was = process.env.IMAGE_TAG; process.env.IMAGE_TAG = 'latest'; });
  afterEach(() => { if (was === undefined) delete process.env.IMAGE_TAG; else process.env.IMAGE_TAG = was; });

  /** A db whose VACUUM INTO is recorded, and a spawn whose helper exits with `code`. */
  const harness = (code, order = []) => ({
    db: { run: (sql, params, cb) => { order.push(`copy ${params[0]}`); cb(null); } },
    spawn: (cmd, args) => {
      order.push(`helper ${args.slice(-2).join(' ')}`);
      const child = new EventEmitter();
      setTimeout(() => child.emit('close', code), 0);
      return child;
    },
  });
  const labels = { workingDir: '/opt/citynet', configFile: '/opt/citynet/docker-compose.yml' };
  const now = () => new Date('2026-10-14T21:05:09Z');

  it('turning dev on copies the database, then writes the files, then follows dev', async () => {
    const order = [];
    const { db, spawn } = harness(0, order);
    const done = await channel.switchChannel({ tag: 'dev', labels, db, dbPath: '/app/data/city.db' }, { spawn, image: 'img', now });
    expect(order).toEqual([`copy ${path.join('/app/data', 'city.db.before-dev-builds-2026-10-14T21-05-09.bak')}`, 'helper /opt/citynet dev']);
    expect(done.channel).toBe('dev');
    expect(process.env.IMAGE_TAG).toBe('dev');
  });

  it('turning it off makes no copy', async () => {
    process.env.IMAGE_TAG = 'dev';
    const order = [];
    const { db, spawn } = harness(0, order);
    const done = await channel.switchChannel({ tag: 'latest', labels, db, dbPath: '/app/data/city.db' }, { spawn, image: 'img' });
    expect(order).toEqual(['helper /opt/citynet latest']);
    expect(done).toEqual({ channel: 'latest', backup: null });
    expect(process.env.IMAGE_TAG).toBe('latest');
  });

  it('a helper that fails switches nothing here either', async () => {
    const { db, spawn } = harness(1);
    await expect(channel.switchChannel({ tag: 'dev', labels, db, dbPath: '/app/data/city.db' }, { spawn, image: 'img', now }))
      .rejects.toThrow(/exited with code 1/);
    expect(process.env.IMAGE_TAG).toBe('latest');
  });

  it('a copy that fails writes no files', async () => {
    const order = [];
    const { spawn } = harness(0, order);
    const db = { run: (sql, params, cb) => cb(new Error('disk full')) };
    await expect(channel.switchChannel({ tag: 'dev', labels, db, dbPath: '/app/data/city.db' }, { spawn, image: 'img', now })).rejects.toThrow(/disk full/);
    expect(order).toEqual([]);
    expect(process.env.IMAGE_TAG).toBe('latest');
  });
});

// ─── GO BACK TO STABLE ────────────────────────────────────────────────────────

describe('newestDevCopy and hostPathOf', () => {
  it('picks the newest copy made before dev builds, and nothing else', () => {
    const names = [
      'city.db', 'city.db.bak', 'city.db.before-bank-accounts-2026-09-30T13-50-55.bak',
      'city.db.before-dev-builds-2026-10-15T09-00-00.bak', 'city.db.before-dev-builds-2026-11-02T18-30-00.bak',
      'city.db.dev-2026-10-20T10-00-00.bak', 'other.db.before-dev-builds-2026-12-01T00-00-00.bak', 'update.log',
    ];
    expect(channel.newestDevCopy(names, 'city.db')).toBe('city.db.before-dev-builds-2026-11-02T18-30-00.bak');
    expect(channel.newestDevCopy(['city.db', 'city.db.bak'], 'city.db')).toBeNull();
  });

  it('finds where a folder comes from on the host', () => {
    const mounts = [{ source: '/srv/up', destination: '/app/uploads' }, { source: '/srv/data', destination: '/app/data' }];
    expect(channel.hostPathOf(mounts, '/app/data')).toBe('/srv/data');
    expect(channel.hostPathOf(mounts, '/app/data/')).toBe('/srv/data');
    expect(channel.hostPathOf(mounts, '/app')).toBeNull();
  });
});

describe('swapBack: the data folder', () => {
  let dir;
  const COPY = 'city.db.before-dev-builds-2026-10-15T09-00-00.bak';
  const STAMP = '2026-10-20T10-00-00';
  const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
  const has = (n) => fs.existsSync(path.join(dir, n));
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-swap-'));
    fs.writeFileSync(path.join(dir, 'city.db'), 'dev data');
    fs.writeFileSync(path.join(dir, 'city.db-journal'), 'dev journal');
    fs.writeFileSync(path.join(dir, COPY), 'stable data');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sets the dev database aside with its side files, and puts the copy back, keeping the copy', () => {
    const aside = channel.swapBack(dir, 'city.db', COPY, STAMP);
    expect(aside).toBe(`city.db.dev-${STAMP}.bak`);
    expect(read('city.db')).toBe('stable data');
    expect(read(aside)).toBe('dev data');
    // Named as SQLite names a journal, so the set-aside database opens whole.
    expect(read(`${aside}-journal`)).toBe('dev journal');
    expect(has('city.db-journal')).toBe(false);
    expect(read(COPY)).toBe('stable data');
  });

  it('moves nothing when the copy is missing', () => {
    fs.rmSync(path.join(dir, COPY));
    expect(() => channel.swapBack(dir, 'city.db', COPY, STAMP)).toThrow(/missing/);
    expect(read('city.db')).toBe('dev data');
    expect(read('city.db-journal')).toBe('dev journal');
  });

  it('a failure part way puts the dev database back as it was', () => {
    const failing = { ...fs, copyFileSync: () => { throw new Error('disk full'); } };
    expect(() => channel.swapBack(dir, 'city.db', COPY, STAMP, { fs: failing })).toThrow(/disk full/);
    expect(read('city.db')).toBe('dev data');
    expect(read('city.db-journal')).toBe('dev journal');
    expect(has(`city.db.dev-${STAMP}.bak`)).toBe(false);
  });
});

describe('revertToStable: the helper steps, in order', () => {
  let project;
  let data;
  const COPY = 'city.db.before-dev-builds-2026-10-15T09-00-00.bak';
  const job = () => ({ projectDir: project, configFile: path.join(project, 'docker-compose.yml'), dataDir: data, dbName: 'city.db', copyName: COPY, service: 'backend', projectName: 'citynet', stamp: '2026-10-20T10-00-00' });
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-revert-'));
    data = path.join(project, 'backend', 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(project, 'backend/.env'), 'IMAGE_TAG=dev\n');
    fs.writeFileSync(path.join(project, '.env'), 'IMAGE_TAG=dev\n');
    fs.writeFileSync(path.join(data, 'city.db'), 'dev data');
    fs.writeFileSync(path.join(data, COPY), 'stable data');
  });
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  /** docker, recorded: each call notes what the files said at that moment. */
  const recorder = (failOn) => {
    const steps = [];
    const run = (args) => {
      const verb = args[args.indexOf('-p') + 2];
      steps.push(`${verb} env=${fs.readFileSync(path.join(project, '.env'), 'utf8').trim()} db=${fs.readFileSync(path.join(data, 'city.db'), 'utf8')}`);
      if (verb === failOn) throw new Error(`${verb} failed`);
    };
    return { steps, run };
  };

  it('downloads stable, writes latest, stops the server, swaps, then starts everything', () => {
    const { steps, run } = recorder();
    channel.revertToStable(job(), { run, say: () => {} });
    expect(steps).toEqual([
      'pull env=IMAGE_TAG=dev db=dev data',
      'stop env=IMAGE_TAG=latest db=dev data',
      'up env=IMAGE_TAG=latest db=stable data',
    ]);
    expect(fs.readFileSync(path.join(project, 'backend/.env'), 'utf8')).toBe('IMAGE_TAG=latest\n');
  });

  it('a download that fails stops nothing and changes nothing', () => {
    const { steps, run } = recorder('pull');
    expect(() => channel.revertToStable(job(), { run, say: () => {} })).toThrow(/pull failed/);
    expect(steps).toHaveLength(1);
    expect(fs.readFileSync(path.join(project, '.env'), 'utf8')).toBe('IMAGE_TAG=dev\n');
    expect(fs.readFileSync(path.join(data, 'city.db'), 'utf8')).toBe('dev data');
  });

  it('once the server is stopped, it is started again even when the swap fails', () => {
    const { steps, run } = recorder();
    const failing = { ...fs, copyFileSync: () => { throw new Error('disk full'); } };
    expect(() => channel.revertToStable(job(), { run, fs: failing, say: () => {} })).toThrow(/disk full/);
    expect(steps.map((s) => s.split(' ')[0])).toEqual(['pull', 'stop', 'up']);
    expect(fs.readFileSync(path.join(data, 'city.db'), 'utf8')).toBe('dev data');
  });

  it('refuses before touching anything when the copy is gone', () => {
    fs.rmSync(path.join(data, COPY));
    const { steps, run } = recorder();
    expect(() => channel.revertToStable(job(), { run, say: () => {} })).toThrow(/missing/);
    expect(steps).toEqual([]);
  });

  it('runs compose against the real compose file, for this project', () => {
    const calls = [];
    channel.revertToStable(job(), { run: (args) => calls.push(args), say: () => {} });
    // By its host path: compose records the -f in the containers' labels, which the next update reads.
    expect(calls[0]).toEqual(['compose', '--project-directory', project, '-f', path.join(project, 'docker-compose.yml'), '-p', 'citynet', 'pull']);
    expect(calls[1].slice(-2)).toEqual(['stop', 'backend']);
    expect(calls[2].slice(-2)).toEqual(['up', '-d']);
  });

  it('is what the helper runs: node updateChannel.js revert ..., exiting non-zero on a refusal', () => {
    fs.rmSync(path.join(data, COPY));
    const j = job();
    let refusal = null;
    try {
      execFileSync(process.execPath, [SCRIPT, 'revert', j.projectDir, j.dataDir, j.dbName, j.copyName, j.service, j.projectName, j.stamp, j.configFile], { stdio: 'pipe' });
    } catch (err) { refusal = err; }
    expect(refusal.status).toBe(1);
    // Refused by the revert, for the reason it has, not by something else reading the arguments.
    expect(String(refusal.stderr)).toContain(`${COPY} is missing`);
    expect(fs.readFileSync(path.join(project, '.env'), 'utf8')).toBe('IMAGE_TAG=dev\n');
  });
});

describe('revertHelperArgs', () => {
  const job = { projectDir: '/opt/citynet', configFile: '/opt/citynet/docker-compose.yml', dataDir: '/opt/citynet/backend/data', dbName: 'city.db', copyName: 'c.bak', service: 'backend', projectName: 'citynet', stamp: 's' };
  const mountsOf = (args) => args.filter((_, i) => args[i - 1] === '-v');

  it('mounts the socket, the project and the compose file each at its own path, and runs this file with argv', () => {
    const args = channel.revertHelperArgs('img:dev', job);
    expect(mountsOf(args)).toEqual(['/var/run/docker.sock:/var/run/docker.sock', '/opt/citynet:/opt/citynet', '/opt/citynet/docker-compose.yml:/opt/citynet/docker-compose.yml:ro']);
    expect(args.slice(args.indexOf('img:dev'))).toEqual(['img:dev', 'node', '/app/updateChannel.js', 'revert', '/opt/citynet', '/opt/citynet/backend/data', 'city.db', 'c.bak', 'backend', 'citynet', 's', '/opt/citynet/docker-compose.yml']);
    expect(args).not.toContain('sh');
    expect(args).not.toContain('/tmp/docker-compose.yml');
  });

  it('gives Docker a Windows host\'s paths in the /x/ form it accepts (as a real install reported them)', () => {
    const args = channel.revertHelperArgs('img:dev', {
      ...job, projectDir: 'X:\\CITY_NET', configFile: 'X:\\CITY_NET\\docker-compose.yml', dataDir: 'X:\\CITY_NET\\backend\\data',
    });
    expect(mountsOf(args)).toEqual(['/var/run/docker.sock:/var/run/docker.sock', '/x/CITY_NET:/x/CITY_NET', '/x/CITY_NET/docker-compose.yml:/x/CITY_NET/docker-compose.yml:ro']);
    expect(args.slice(-8)).toEqual(['/x/CITY_NET', '/x/CITY_NET/backend/data', 'city.db', 'c.bak', 'backend', 'citynet', 's', '/x/CITY_NET/docker-compose.yml']);
  });

  it('mounts a data folder kept outside the project as well', () => {
    expect(mountsOf(channel.revertHelperArgs('img', { ...job, dataDir: '/srv/citynet-data' }))).toContain('/srv/citynet-data:/srv/citynet-data');
    // A sibling whose name only starts the same is outside.
    expect(mountsOf(channel.revertHelperArgs('img', { ...job, dataDir: '/opt/citynet-data' }))).toContain('/opt/citynet-data:/opt/citynet-data');
  });
});

describe('revertPlan', () => {
  const self = { image: 'img:dev', service: 'backend', mounts: [{ source: '/opt/citynet/backend/data', destination: '/app/data' }] };
  const files = (names) => ({ readdirSync: () => names });
  const COPY = 'city.db.before-dev-builds-2026-10-15T09-00-00.bak';

  it('is ready with the newest copy, the host data folder and the service', () => {
    expect(channel.revertPlan('/app/data/city.db', { fs: files(['city.db', COPY]), self }))
      .toEqual({ ok: true, copy: COPY, dataDir: '/opt/citynet/backend/data', service: 'backend', image: 'img:dev' });
  });

  it('says why not: no copy, docker silent, no mounted folder, no compose service', () => {
    expect(channel.revertPlan('/app/data/city.db', { fs: files(['city.db']), self }).error).toMatch(/no copy/);
    expect(channel.revertPlan('/app/data/city.db', { fs: files([COPY]), self: null }).error).toMatch(/Docker could not say/);
    expect(channel.revertPlan('/app/data/city.db', { fs: files([COPY]), self: { ...self, mounts: [] } }).error).toMatch(/not mounted/);
    expect(channel.revertPlan('/app/data/city.db', { fs: files([COPY]), self: { ...self, service: null } }).error).toMatch(/docker compose/);
  });
});

describe('startRevert', () => {
  it('starts the helper detached, so it outlives this server', () => {
    const seen = {};
    const spawn = (cmd, args, opts) => { Object.assign(seen, { cmd, args, opts }); return { unref: () => { seen.unref = true; } }; };
    const plan = { ok: true, copy: 'c.bak', dataDir: '/opt/citynet/backend/data', service: 'backend', image: 'img:dev' };
    const labels = { workingDir: '/opt/citynet', configFile: '/opt/citynet/docker-compose.yml', projectName: 'citynet' };
    channel.startRevert({ plan, labels, dbPath: '/app/data/city.db' }, { spawn, now: () => new Date('2026-10-20T10:00:00Z') });
    expect(seen.cmd).toBe('docker');
    expect(seen.opts.detached).toBe(true);
    expect(seen.unref).toBe(true);
    expect(seen.args.slice(-9)).toEqual(['revert', '/opt/citynet', '/opt/citynet/backend/data', 'city.db', 'c.bak', 'backend', 'citynet', '2026-10-20T10-00-00', '/opt/citynet/docker-compose.yml']);
  });
});
