import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

/**
 * README.md's Project Structure, held to the files on disk (4d3b).
 *
 * Every piece is meant to add its README lines (docs/system-builder-plan.md), and that lapsed for
 * a whole phase: on 2026-10-09, 202 files were missing from the tree and 28 lines put a file in a
 * folder it wasn't in. Nothing said so until the user asked. This does: a source or test
 * file the tree doesn't name fails here, as does a tree line naming a file that no longer exists.
 *
 * The tree is read by its own indentation (four characters a level), so each line becomes a full
 * path: backend/systemBuilder/examples.js and frontend/src/sheets/examples.ts are two entries,
 * and one can't stand in for the other.
 */

const REPO = resolve(__dirname, '../..');

/** Where the tree must be complete, and the kinds of file it must name. */
const ROOTS = ['backend', 'frontend/src'];
const CODE = /\.(js|ts|tsx)$/;
/** Never ours to describe: installed packages, uploads and data, generated output. */
const SKIP_DIRS = new Set(['node_modules', 'uploads', 'data', 'dist', 'coverage', 'fixtures']);

/** The Project Structure block's lines. */
const treeLines = (readme) => {
  const start = readme.indexOf('## Project Structure');
  const open = readme.indexOf('```', start);
  const close = readme.indexOf('```', open + 3);
  return readme.slice(open + 3, close).split(/\r?\n/);
};

/**
 * Every path the tree names, from repo root: each line's depth is where its ├── or └── sits, its
 * name what follows up to the comment. "App.css / index.css" names two files.
 */
const treePaths = (readme) => {
  const stack = [];
  const paths = [];
  for (const line of treeLines(readme)) {
    const at = line.search(/[├└]── /);
    if (at < 0) continue;
    const depth = at / 4;
    const name = line.slice(at + 4).split(/\s{2,}#|\s#\s|\s+#$/)[0].trim();
    if (!name) continue;
    stack.length = depth;
    const dir = stack.join('');
    for (const part of name.split(' / ')) {
      const clean = part.trim();
      if (clean.endsWith('/')) stack[depth] = clean;
      else paths.push(dir + clean);
    }
  }
  return paths;
};

/** Files on disk the tree doesn't name. */
const missingFrom = (named, onDisk) => onDisk.filter((f) => !named.has(f));

/** Code files under the roots that the tree names but `exists` can't find. */
const goneFrom = (named, exists) => [...named].filter((p) => CODE.test(p) && ROOTS.some((r) => p.startsWith(`${r}/`)) && !exists(p));

/** Every source and test file under the roots, from repo root, with forward slashes. */
const filesOnDisk = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (CODE.test(entry)) out.push(relative(REPO, full).split(sep).join('/'));
    }
  };
  ROOTS.forEach((r) => walk(join(REPO, r)));
  return out.sort();
};

const README = readFileSync(join(REPO, 'README.md'), 'utf8');

describe('README.md\'s Project Structure', () => {
  const named = new Set(treePaths(README));
  const onDisk = filesOnDisk();

  it('is found, and reads as paths', () => {
    expect(named.size).toBeGreaterThan(400);
    expect(named.has('backend/server.js')).toBe(true);
    expect(named.has('frontend/src/App.tsx')).toBe(true);
    expect(onDisk.length).toBeGreaterThan(500);
  });

  it('names every source and test file', () => {
    const missing = missingFrom(named, onDisk);
    // Named rather than counted, so the failure says what to add: a line in the tree for each,
    // saying what the file is for, in the place its folder is.
    expect(missing, 'Add a line to README.md\'s Project Structure for each').toEqual([]);
  });

  it('names no file that no longer exists', () => {
    const gone = goneFrom(named, (p) => existsSync(join(REPO, p)));
    expect(gone, 'Remove or rename these lines in README.md\'s Project Structure').toEqual([]);
  });
});

describe('reading the tree', () => {
  const sample = [
    '## Project Structure', '', '```', 'CITY_NET/',
    '├── backend/',
    '│   ├── server.js               # Entry # with a hash inside',
    '│   ├── sheets/',
    '│   │   └── examples.js     # One',
    '│   └── __tests__/',
    '│       ├── setup/noNetwork.js  # Nested by name',
    '│       └── a.test.js',
    '├── frontend/',
    '│   └── src/',
    '│       ├── App.css / index.css # Two in one line',
    '│       └── sheets/',
    '│           └── examples.ts',
    '```',
  ].join('\n');

  // The tree is complete today, so the two checks above pass whether or not they look. These are
  // what make them able to fail.
  it('says which files on disk it doesn\'t name', () => {
    const named = new Set(treePaths(sample));
    expect(missingFrom(named, ['backend/server.js', 'backend/sheets/new.js', 'frontend/src/App.css']))
      .toEqual(['backend/sheets/new.js']);
  });

  it('says which of its code files are gone, ignoring folders, other files and other places', () => {
    const named = new Set([...treePaths(sample), 'docs/plan.js', 'frontend/src/logo.svg']);
    const there = new Set(['backend/server.js', 'backend/__tests__/a.test.js', 'frontend/src/sheets/examples.ts']);
    expect(goneFrom(named, (p) => there.has(p))).toEqual(['backend/sheets/examples.js', 'backend/__tests__/setup/noNetwork.js']);
  });

  it('turns each line into its full path, by indentation', () => {
    expect(treePaths(sample)).toEqual([
      'backend/server.js',
      'backend/sheets/examples.js',
      'backend/__tests__/setup/noNetwork.js',
      'backend/__tests__/a.test.js',
      'frontend/src/App.css',
      'frontend/src/index.css',
      'frontend/src/sheets/examples.ts',
    ]);
  });
});
