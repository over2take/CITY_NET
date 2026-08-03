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

describe('docker-compose.yml release channel', () => {
  const compose = () => readRoot('docker-compose.yml');

  it('reads the image tag from IMAGE_TAG and defaults to latest', () => {
    // Hardcoding :latest is what made the DEV flag cosmetic — the check would offer a
    // dev version and compose would then pull the stable one, because the compose file
    // is what decides the image.
    const yml = compose();
    expect(yml).toMatch(/citynet-backend:\$\{IMAGE_TAG:-latest\}/);
    expect(yml).toMatch(/citynet-frontend:\$\{IMAGE_TAG:-latest\}/);
  });

  it('pins no image to a bare :latest', () => {
    // Leaving one service pinned would half-switch a channel: a dev backend against a
    // stable frontend, or the reverse.
    expect(compose()).not.toMatch(/citynet-(backend|frontend):latest/);
  });

  it('still mounts the compose file into the backend, which the updater reads', () => {
    // Its absence is the single likeliest reason an in-app update does nothing, since a
    // container started before this line was added does not have it.
    expect(compose()).toMatch(/\.\/docker-compose\.yml:\/tmp\/docker-compose\.yml:ro/);
  });
});

describe('.env.example release channel', () => {
  const env = () => readRoot('backend/.env.example');

  it('ships the dev channel switched off', () => {
    // Dev builds are unreleased code; nobody should arrive on one by default.
    expect(env()).toMatch(/^DEV=false$/m);
  });

  it('documents both settings, since one without the other misleads', () => {
    const text = env();
    expect(text).toMatch(/^IMAGE_TAG=latest$/m);
    expect(text).toMatch(/IMAGE_TAG=dev/);
  });
});
