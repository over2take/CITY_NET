/**
 * What a browser is allowed to do with a file somebody uploaded.
 *
 * This is tested end to end through `express.static` rather than by calling the function,
 * because the thing worth pinning is that a file on disk comes back with these headers on
 * it — not that a helper sets two properties. The route allowlists and this are two halves
 * of one answer: the allowlist decides what gets written, this decides what it can do once
 * it is, and only the second is still true for anything written before the first existed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { setUploadHeaders } = require('../middleware/uploadHeaders.js');

let dir;
let app;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-uploads-'));
  fs.writeFileSync(path.join(dir, 'map.png'), 'not really a png');
  // Stands in for anything already on disk from before the allowlists existed, or
  // anything that ever gets past one.
  fs.writeFileSync(path.join(dir, 'legacy.html'), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(dir, 'map.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

  app = express();
  app.use('/uploads', express.static(dir, { setHeaders: setUploadHeaders }));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('files served out of /uploads', () => {
  it('cannot reach anything of ours, even when served as a page', async () => {
    // `sandbox` with no allow-list puts the response in an opaque origin: no cookies, no
    // localStorage, no same-origin fetch. A stored HTML file becomes inert rather than a
    // script running as this site.
    const res = await request(app).get('/uploads/legacy.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe('sandbox');
  });

  it('is not re-interpreted as HTML by a helpful browser', async () => {
    const res = await request(app).get('/uploads/map.png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sandboxes SVG, which is what lets the upload routes accept it', async () => {
    // Script in an SVG cannot run when it is the source of an `<img>`; it can when the
    // file is opened directly. Closing that here rather than by refusing the format keeps
    // a legitimate map format available to a GM.
    const res = await request(app).get('/uploads/map.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe('sandbox');
  });

  it('puts the headers on every file, not only the suspicious ones', async () => {
    // A rule that has to guess which files are dangerous is a rule that will guess wrong.
    for (const file of ['map.png', 'legacy.html', 'map.svg']) {
      const res = await request(app).get(`/uploads/${file}`);
      expect(res.headers['content-security-policy'], file).toBe('sandbox');
      expect(res.headers['x-content-type-options'], file).toBe('nosniff');
    }
  });
});
