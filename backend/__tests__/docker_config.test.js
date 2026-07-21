/**
 * Regression tests for Docker deployment configuration.
 *
 * These guard against silent regressions that caused data loss:
 *  - DB_PATH not baked into Dockerfile → container fell back to ephemeral
 *    /app/city.db on every restart, wiping all map data.
 *  - backend/data/ not excluded from .dockerignore → local dev database
 *    could be baked into a published image.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..', '..');

const readRoot = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Dockerfile.backend', () => {
  it('sets ENV DB_PATH to the mounted data directory', () => {
    const dockerfile = readRoot('Dockerfile.backend');
    expect(dockerfile).toMatch(/^ENV DB_PATH=\/app\/data\/city\.db$/m);
  });

  it('creates /app/data and /app/uploads directories at build time', () => {
    const dockerfile = readRoot('Dockerfile.backend');
    expect(dockerfile).toMatch(/mkdir -p.*\/app\/data/);
    expect(dockerfile).toMatch(/mkdir -p.*\/app\/uploads/);
  });
});

describe('.dockerignore', () => {
  it('excludes backend/data/ so local databases are never baked into the image', () => {
    const ignore = readRoot('.dockerignore');
    const lines = ignore.split('\n').map(l => l.trim());
    expect(lines).toContain('backend/data/');
  });

  it('excludes backend/uploads/ to keep user uploads out of the image', () => {
    const ignore = readRoot('.dockerignore');
    const lines = ignore.split('\n').map(l => l.trim());
    // Accept either "backend/uploads" or "backend/uploads/"
    expect(lines.some(l => l === 'backend/uploads' || l === 'backend/uploads/')).toBe(true);
  });
});

describe('db.js DB_PATH resolution', () => {
  it('uses DB_PATH env var when set', async () => {
    const original = process.env.DB_PATH;
    process.env.DB_PATH = '/tmp/test-override.db';
    // Re-importing db.js is not practical in vitest without a full module
    // reset; instead validate the source directly.
    const src = fs.readFileSync(path.join(root, 'backend', 'db.js'), 'utf8');
    expect(src).toMatch(/process\.env\.DB_PATH/);
    if (original === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = original;
  });

  it('falls back to a local city.db when DB_PATH is not set', () => {
    const src = fs.readFileSync(path.join(root, 'backend', 'db.js'), 'utf8');
    expect(src).toMatch(/DB_PATH.*city\.db/);
  });
});
