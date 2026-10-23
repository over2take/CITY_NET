/**
 * Node's October 2026 security release (1.14.10): an out-of-bounds write in its Brotli decoder
 * (CVE-2026-111497) among ten flaws. express.json() decompressed any request body labelled br with
 * that decoder, so anyone who could reach a server could hand it one, signed in or not. Every JSON
 * body now goes through middleware/jsonBody.js, which refuses a compressed one; and a server on a
 * Node without the fixes says so at start (a manual install runs on its machine's own Node).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require_ = createRequire(import.meta.url);
const express = require_('express');
const request = require_('supertest');
const { jsonBody, zipBody } = require_('../middleware/jsonBody');
const { hasSecurityFixes, securityWarning, FIXED } = require_('../utils/nodeVersion');

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const app = (limit) => {
  const a = express();
  a.use(jsonBody(limit));
  a.post('/echo', (req, res) => res.json({ got: req.body }));
  return a;
};
const BODY = JSON.stringify({ username: 'gm', password: 'x' });

describe('a JSON body', () => {
  it('is read as sent', async () => {
    const res = await request(app()).post('/echo').set('Content-Type', 'application/json').send(BODY);
    expect([res.status, res.body]).toEqual([200, { got: { username: 'gm', password: 'x' } }]);
  });

  it('is refused compressed, never handed to a decoder: br, gzip or deflate', async () => {
    for (const [encoding, squeeze] of [['br', zlib.brotliCompressSync], ['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync]]) {
      const res = await request(app()).post('/echo').set('Content-Type', 'application/json').set('Content-Encoding', encoding).send(squeeze(Buffer.from(BODY)));
      expect(res.status, encoding).toBe(415);
      expect(res.body.got, encoding).toBeUndefined();
    }
  });

  it('keeps its size limit', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(200 * 1024) });
    expect((await request(app('100kb')).post('/echo').set('Content-Type', 'application/json').send(big)).status).toBe(413);
    expect((await request(app('2mb')).post('/echo').set('Content-Type', 'application/json').send(big)).status).toBe(200);
  });

  it('a zip too (a system and its pictures): read as sent, refused compressed, kept to its limit', async () => {
    const zipApp = (limit) => {
      const a = express();
      a.post('/zip', zipBody(limit), (req, res) => res.json({ bytes: Buffer.isBuffer(req.body) ? req.body.length : null }));
      return a;
    };
    const zipped = Buffer.from('PK\u0003\u0004 a zip as sent');
    const res = await request(zipApp('1mb')).post('/zip').set('Content-Type', 'application/zip').send(zipped);
    expect([res.status, res.body]).toEqual([200, { bytes: zipped.length }]);
    for (const [encoding, squeeze] of [['br', zlib.brotliCompressSync], ['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync]]) {
      const squeezed = await request(zipApp('1mb')).post('/zip').set('Content-Type', 'application/zip').set('Content-Encoding', encoding).send(squeeze(zipped));
      expect(squeezed.status, encoding).toBe(415);
    }
    expect((await request(zipApp('100kb')).post('/zip').set('Content-Type', 'application/zip').send(Buffer.alloc(200 * 1024))).status).toBe(413);
    // Anything not sent as a zip is left unread.
    expect((await request(zipApp('1mb')).post('/zip').set('Content-Type', 'application/json').send('{}')).body).toEqual({ bytes: null });
  });

  it('is read only by jsonBody, anywhere in the server, so no route can decompress one again', () => {
    const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) return [];
      const p = path.join(dir, e.name);
      return e.isDirectory() ? sources(p) : e.name.endsWith('.js') ? [p] : [];
    });
    const readers = sources(BACKEND).filter((f) => /express\.(json|urlencoded|raw|text)\(|body-?parser/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(BACKEND, f).replace(/\\/g, '/'));
    expect(readers).toEqual(['middleware/jsonBody.js']);
    expect(fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8')).toMatch(/require\('\.\/middleware\/jsonBody'\)\.jsonBody\('2mb'\)/);
  });
});

describe('the Node a server runs on', () => {
  it('has the fixes from 22.23.4, 24.22.1 and 26.12.1 on, and on every later line', () => {
    for (const v of ['v22.23.4', 'v22.23.10', 'v22.24.0', 'v24.22.1', 'v24.23.0', 'v26.12.1', 'v26.13.0', 'v27.0.0', 'v30.1.2']) expect(hasSecurityFixes(v), v).toBe(true);
  });

  it('lacks them before those, on Node 20 and older, on the odd lines between, and on nonsense', () => {
    for (const v of ['v22.23.3', 'v22.22.3', 'v24.22.0', 'v24.9.0', 'v26.12.0', 'v20.19.5', 'v18.20.8', 'v23.11.0', 'v25.2.0', '', 'node', undefined]) expect(hasSecurityFixes(v), String(v)).toBe(false);
  });

  it('is named at start when it lacks them, with what to do, and not otherwise', () => {
    expect(securityWarning('v20.19.5')).toMatch(/^Node\.js v20\.19\.5 is missing the October 2026 security fixes\. Update Node to 24\.22\.1 or newer \(or 22\.23\.4\+\), or run CITY_NET with Docker\.$/);
    expect(securityWarning('v24.22.1')).toBeNull();
  });
});

describe('the Docker images and CI', () => {
  const root = path.join(BACKEND, '..');
  it('run Node 24, which has the fixes', () => {
    for (const f of ['Dockerfile.backend', 'Dockerfile.frontend']) expect(fs.readFileSync(path.join(root, f), 'utf8'), f).toMatch(/^FROM node:24-alpine/m);
    for (const f of ['ci.yml', 'dev-release.yml']) {
      const versions = [...fs.readFileSync(path.join(root, '.github', 'workflows', f), 'utf8').matchAll(/node-version: '(\d+)'/g)].map((m) => m[1]);
      expect(versions.length, f).toBeGreaterThan(0);
      expect(new Set(versions), f).toEqual(new Set(['24']));
    }
  });

  it('and the setup scripts accept only a Node with them: the same versions the server checks', () => {
    // Each script's table of first fixed releases, as it is written there, from the server's own list.
    const sh = fs.readFileSync(path.join(root, 'setup.sh'), 'utf8');
    for (const [line, [, min, patch]] of Object.entries(FIXED)) expect(sh, `setup.sh, Node ${line}`).toContain(`${line}) need_min=${min}; need_pat=${patch} ;;`);
    const ps1 = fs.readFileSync(path.join(root, 'setup.ps1'), 'utf8');
    const table = Object.entries(FIXED).map(([line, v]) => `${line} = [version]'${v.join('.')}'`).join('; ');
    expect(ps1).toContain(`$fixed = @{ ${table} }`);
    for (const text of [sh, ps1]) expect(text).not.toMatch(/v18\+|-ge 18/);
  });
});
