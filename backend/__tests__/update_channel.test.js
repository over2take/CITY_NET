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

describe('ownImage', () => {
  const deps = (out) => ({ readFileSync: () => 'abc123\n', execSync: () => out });
  it('is the image this container runs', () => {
    expect(channel.ownImage(deps('over2take/citynet-backend:dev\n'))).toBe('over2take/citynet-backend:dev');
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
