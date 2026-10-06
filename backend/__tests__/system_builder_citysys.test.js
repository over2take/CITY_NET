import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

/**
 * Sharing a custom system as a .citysys file: export a published system, preview a file
 * without changing anything, install it as new, as an update, or as a second copy; and delete
 * as a hide, so reinstalling a deleted system's file brings it back with its characters.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const citysys = require_('../systemBuilder/citysys');
const { checkDefinition, LIMITS } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const templates = require_('../sheets/templates');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const PLAYER = jwt.sign({ id: 5, username: 'GHOST', role: 'player' }, 'test-secret');
const gm = { Authorization: `Bearer ${GM}` };

const VAULT = {
  format: 1, name: 'Vault Knights', author: 'Cody', license: 'CC BY 4.0', description: 'Knights in vaults.',
  words: { hp: { singular: 'WOUND' } },
  derived: [{ id: 'guard', formula: '10 + @might' }],
  core: { health: { model: 'wounds', count: 3 } },
};

let db;
let app;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/systems', require_('../routes/systems.js')(db));
  await new Promise((resolve) => runtime.load(db, resolve));
  vi.restoreAllMocks();
});

const create = async (definition = VAULT) => (await request(app).post('/api/systems').set(gm).send({ definition })).body.id;
const publish = (id) => request(app).post(`/api/systems/${id}/publish`).set(gm);
const exported = async (id) => (await request(app).get(`/api/systems/${id}/export`).set(gm)).text;
const preview = (file) => request(app).post('/api/systems/install/preview').set(gm).send({ file });
const install = (file, mode) => request(app).post('/api/systems/install').set(gm).send({ file, mode });
const rows = () => new Promise((resolve) => db.all('SELECT id, name, version, origin, deleted_at FROM custom_systems ORDER BY created_at, id', (e, r) => resolve(r)));
const fileOf = (definition, origin = 'org_vault', version = 3) => JSON.stringify(citysys.buildFile({ definition, version, origin }));

describe('the definition\'s cover fields', () => {
  it('takes an author and a license as free text, with limits', () => {
    expect(checkDefinition(VAULT)).toEqual({ problems: [] });
    expect(checkDefinition({ ...VAULT, author: 'x'.repeat(LIMITS.author + 1), license: 7 }).problems.map((p) => `${p.where}: ${p.message}`))
      .toEqual([`author: Longer than ${LIMITS.author} characters`, 'license: Must be text']);
  });
});

describe('exporting', () => {
  it('writes the published system as a readable file with its cover', async () => {
    const id = await create();
    await publish(id);
    const res = await request(app).get(`/api/systems/${id}/export`).set(gm);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="vault-knights.citysys"');
    expect(res.text).toContain('\n  "manifest": {');
    const file = JSON.parse(res.text);
    expect(file).toMatchObject({
      citysys: 1,
      manifest: { name: 'Vault Knights', author: 'Cody', license: 'CC BY 4.0', version: 1, origin: id },
      definition: VAULT,
    });
    expect(typeof file.manifest.builder).toBe('string');
    expect(Number.isNaN(Date.parse(file.manifest.exported))).toBe(false);
  });

  it('shares the published copy, not a draft being worked on, and nothing unpublished', async () => {
    const id = await create();
    expect((await request(app).get(`/api/systems/${id}/export`).set(gm)).status).toBe(409);
    await publish(id);
    await request(app).put(`/api/systems/${id}/draft`).set(gm).send({ definition: { ...VAULT, description: 'Secret draft' } });
    expect(await exported(id)).not.toContain('Secret draft');
  });

  it('never carries a character or a sheet', async () => {
    const id = await create();
    await publish(id);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['GHOST', id, '{"name":"Sir Ghost-in-the-file"}']);
    expect(await exported(id)).not.toContain('Ghost-in-the-file');
  });

  it('names the file from the system\'s name, safely', () => {
    expect(citysys.fileNameFor('Vault Knights: Ärmor & Ash!')).toBe('vault-knights-armor-ash.citysys');
    expect(citysys.fileNameFor('../../etc')).toBe('etc.citysys');
    expect(citysys.fileNameFor('!!!')).toBe('system.citysys');
  });
});

describe('reading a file', () => {
  it('refuses what cannot be installed at all, saying why', () => {
    const fatal = (text) => citysys.readFile(text).fatal;
    expect(fatal(undefined)).toBe('Not a file');
    expect(fatal('x'.repeat(citysys.MAX_BYTES + 1))).toMatch(/^Larger than/);
    expect(fatal('{nope')).toBe('Not a CITY_NET system file');
    expect(fatal('{"name":"x"}')).toBe('Not a CITY_NET system file');
    expect(fatal(JSON.stringify({ citysys: 2, manifest: {}, definition: {} }))).toBe('Made by a newer CITY_NET (file format 2); update to install it');
    expect(fatal(JSON.stringify({ citysys: 1, manifest: { origin: 'o' } }))).toBe('The file is missing its system');
    expect(fatal(JSON.stringify({ citysys: 1, manifest: { origin: '../x' }, definition: VAULT }))).toBe('The file does not say which system it is');
    expect(fatal(JSON.stringify({ citysys: 1, manifest: {}, definition: VAULT }))).toBe('The file does not say which system it is');
  });

  it('keeps only the cover fields it knows, cut to length, and never trusts the version', () => {
    const text = JSON.stringify({ citysys: 1, manifest: { origin: 'o1', name: 'n'.repeat(200), author: 5, version: -2, script: 'alert(1)' }, definition: VAULT });
    const { file } = citysys.readFile(text);
    expect(file.manifest).toEqual({ name: 'n'.repeat(80), author: '', license: '', builder: '', version: 0, origin: 'o1' });
  });

  it('passes the definition through the editor\'s own checks', () => {
    const { problems } = citysys.readFile(fileOf({ ...VAULT, derived: [{ id: 'a', formula: '@b' }, { id: 'b', formula: '@a' }] }));
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('previewing an install', () => {
  it('says what is inside and changes nothing', async () => {
    const before = await rows();
    const res = await preview(fileOf(VAULT));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Vault Knights',
      manifest: { author: 'Cody', version: 3, origin: 'org_vault' },
      inside: { words: 1, derived: 1, healthModel: 'wounds' },
      problems: [], installed: [], restores: null,
    });
    expect(await rows()).toEqual(before);
  });

  it('refuses a file it cannot read', async () => {
    const res = await preview('not json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Not a CITY_NET system file');
  });
});

describe('installing', () => {
  it('as new: published, runnable, and remembering where it came from', async () => {
    const res = await install(fileOf(VAULT), 'new');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ published: true, problems: [] });
    const row = await get(db, 'SELECT * FROM custom_systems WHERE id = ?', [res.body.id]);
    expect(row).toMatchObject({ name: 'Vault Knights', version: 1, origin: 'org_vault' });
    expect(row.source_hash).toBe(citysys.hashOf(row.draft));
    expect(templates.isValidSystem(res.body.id)).toBe(true);
  });

  it('as new with problems: kept as a draft to fix, never runnable', async () => {
    const broken = { ...VAULT, derived: [{ id: 'a', formula: '@b' }, { id: 'b', formula: '@a' }] };
    const res = await install(fileOf(broken), 'new');
    expect(res.body.published).toBe(false);
    expect(res.body.problems.length).toBeGreaterThan(0);
    expect((await get(db, 'SELECT published, version FROM custom_systems WHERE id = ?', [res.body.id]))).toEqual({ published: null, version: 0 });
    expect(templates.isValidSystem(res.body.id)).toBe(false);
  });

  it('as new when it is already here: asks for update or keep both', async () => {
    const first = (await install(fileOf(VAULT), 'new')).body.id;
    const again = await install(fileOf(VAULT), 'new');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'Already installed. Update it or keep both.', installed: [{ id: first, name: 'Vault Knights' }] });
    expect((await preview(fileOf(VAULT))).body.installed).toEqual([{ id: first, name: 'Vault Knights', version: 1, edited: false }]);
  });

  it('as an update: the same system, its next version, while it has not been changed here', async () => {
    const id = (await install(fileOf(VAULT), 'new')).body.id;
    const v2 = { ...VAULT, description: 'Now with more vaults.' };
    const res = await install(fileOf(v2, 'org_vault', 4), 'update');
    expect(res.body).toMatchObject({ id, published: true });
    expect(await get(db, 'SELECT version, published FROM custom_systems WHERE id = ?', [id])).toMatchObject({ version: 2, published: JSON.stringify(v2) });
    expect(runtime.render(id).name).toBe('Vault Knights');
  });

  it('as an update: refused over changes made here, over problems, and when not installed', async () => {
    expect((await install(fileOf(VAULT), 'update')).status).toBe(404);
    const id = (await install(fileOf(VAULT), 'new')).body.id;
    const broken = { ...VAULT, derived: [{ id: 'a', formula: '@a' }] };
    expect((await install(fileOf(broken), 'update')).status).toBe(409);
    await request(app).put(`/api/systems/${id}/draft`).set(gm).send({ definition: { ...VAULT, description: 'Mine now' } });
    expect((await preview(fileOf(VAULT))).body.installed[0].edited).toBe(true);
    const res = await install(fileOf({ ...VAULT, description: 'Theirs' }), 'update');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This system has been changed here since it was installed. Keep both instead.');
    expect(JSON.parse((await get(db, 'SELECT draft FROM custom_systems WHERE id = ?', [id])).draft).description).toBe('Mine now');
  });

  it('never overwrites a system made here, even from its own file', async () => {
    const id = await create();
    await publish(id);
    const file = await exported(id);
    expect((await preview(file)).body.installed).toEqual([{ id, name: 'Vault Knights', version: 1, edited: true }]);
    expect((await install(file, 'update')).status).toBe(409);
  });

  it('keeping both: a second copy with its own id and origin, so the two never collide', async () => {
    const first = (await install(fileOf(VAULT), 'new')).body.id;
    const copy = (await install(fileOf(VAULT), 'keep_both')).body.id;
    expect(copy).not.toBe(first);
    const [a, b] = await Promise.all([first, copy].map((id) => get(db, 'SELECT origin FROM custom_systems WHERE id = ?', [id])));
    expect(a.origin).toBe('org_vault');
    expect(b.origin).toBe(copy);
    // The original is still the one the file matches.
    expect((await preview(fileOf(VAULT))).body.installed.map((s) => s.id)).toEqual([first]);
  });

  it('is listed as installed, whichever way it came in', async () => {
    const made = await create({ ...VAULT, name: 'Homebrew' });
    const first = (await install(fileOf(VAULT), 'new')).body.id;
    const copy = (await install(fileOf(VAULT), 'keep_both')).body.id;
    const listed = (await request(app).get('/api/systems').set(gm)).body;
    expect(Object.fromEntries(listed.map((s) => [s.id, s.installed]))).toEqual({ [made]: false, [first]: true, [copy]: true });
  });

  it('refuses a mode it does not know', async () => {
    expect((await install(fileOf(VAULT), 'merge')).status).toBe(400);
  });
});

describe('installing under a name already here', () => {
  const nameOf = async (id) => {
    const row = await get(db, 'SELECT name, draft, published, source_hash FROM custom_systems WHERE id = ?', [id]);
    return { name: row.name, draft: JSON.parse(row.draft).name, published: row.published && JSON.parse(row.published).name, edited: citysys.hashOf(row.draft) !== row.source_hash };
  };

  it('installs a different system with the same name as a copy, never refusing it', async () => {
    const mine = await create();
    const res = await install(fileOf(VAULT, 'org_other'), 'new');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Vault Knights copy', published: true });
    // The row, both copies and the running game agree, and it does not count as changed here.
    expect(await nameOf(res.body.id)).toEqual({ name: 'Vault Knights copy', draft: 'Vault Knights copy', published: 'Vault Knights copy', edited: false });
    expect(runtime.render(res.body.id).name).toBe('Vault Knights copy');
    expect((await nameOf(mine)).name).toBe('Vault Knights');
  });

  it('keeps its own name when nothing else has it', async () => {
    const res = await install(fileOf(VAULT), 'new');
    expect(res.body.name).toBe('Vault Knights');
    expect((await get(db, 'SELECT draft FROM custom_systems WHERE id = ?', [res.body.id])).draft).toBe(JSON.stringify(VAULT));
  });

  it('counts on for each further copy, matching names whatever their capitals', async () => {
    await create({ ...VAULT, name: 'VAULT KNIGHTS' });
    expect((await install(fileOf(VAULT), 'new')).body.name).toBe('Vault Knights copy');
    expect((await install(fileOf(VAULT), 'keep_both')).body.name).toBe('Vault Knights copy 02');
    expect((await install(fileOf(VAULT), 'keep_both')).body.name).toBe('Vault Knights copy 03');
  });

  it('names a copy kept beside its original as a copy', async () => {
    await install(fileOf(VAULT), 'new');
    const res = await install(fileOf(VAULT), 'keep_both');
    expect(await nameOf(res.body.id)).toMatchObject({ name: 'Vault Knights copy', draft: 'Vault Knights copy' });
  });

  it('keeps an updated system\'s own name, and its copy name while the other is still here', async () => {
    const id = (await install(fileOf(VAULT), 'new')).body.id;
    expect((await install(fileOf({ ...VAULT, description: 'v2' }, 'org_vault', 4), 'update')).body).toMatchObject({ id, name: 'Vault Knights' });
    const other = await create();
    await request(app).delete(`/api/systems/${id}`).set(gm);
    const back = await install(fileOf(VAULT), 'new');
    expect(back.body).toMatchObject({ id, restored: true, name: 'Vault Knights copy' });
    expect((await install(fileOf({ ...VAULT, description: 'v3' }, 'org_vault', 5), 'update')).body).toMatchObject({ id, name: 'Vault Knights copy' });
    expect((await nameOf(other)).name).toBe('Vault Knights');
  });

  it('installs a copy with problems as a copy too, kept as a draft', async () => {
    await create();
    const res = await install(fileOf({ ...VAULT, derived: [{ id: 'a', formula: '@a' }] }), 'new');
    expect(res.body).toMatchObject({ name: 'Vault Knights copy', published: false });
    expect(await nameOf(res.body.id)).toMatchObject({ name: 'Vault Knights copy', draft: 'Vault Knights copy', published: null });
  });

  it('ignores a deleted system\'s name', async () => {
    const mine = await create();
    await request(app).delete(`/api/systems/${mine}`).set(gm);
    expect((await install(fileOf(VAULT, 'org_other'), 'new')).body.name).toBe('Vault Knights');
  });
});

describe('deleting', () => {
  it('hides the system everywhere but keeps it', async () => {
    const id = (await install(fileOf(VAULT), 'new')).body.id;
    expect((await request(app).delete(`/api/systems/${id}`).set(gm)).status).toBe(200);
    expect((await request(app).get('/api/systems').set(gm)).body.map((s) => s.id)).not.toContain(id);
    expect((await request(app).get(`/api/systems/${id}`).set(gm)).status).toBe(404);
    expect((await request(app).put(`/api/systems/${id}/draft`).set(gm).send({ definition: VAULT })).status).toBe(404);
    expect((await request(app).get(`/api/systems/${id}/export`).set(gm)).status).toBe(404);
    expect((await request(app).delete(`/api/systems/${id}`).set(gm)).status).toBe(404);
    expect(templates.isValidSystem(id)).toBe(false);
    // Still there, for its characters' sake.
    expect((await get(db, 'SELECT deleted_at FROM custom_systems WHERE id = ?', [id])).deleted_at).not.toBeNull();
    // And never loaded again on a restart.
    await new Promise((resolve) => runtime.load(db, resolve));
    expect(templates.isValidSystem(id)).toBe(false);
  });

  it('comes back, under its old id with its characters, when its file is installed again', async () => {
    const id = (await install(fileOf(VAULT), 'new')).body.id;
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['GHOST', id, '{"name":"Sir Ghost"}']);
    await request(app).delete(`/api/systems/${id}`).set(gm);
    expect((await preview(fileOf(VAULT))).body.restores).toEqual({ id, name: 'Vault Knights', replacesChanges: false });
    const res = await install(fileOf(VAULT), 'new');
    expect(res.body).toMatchObject({ id, restored: true, published: true });
    expect(templates.isValidSystem(id)).toBe(true);
    expect((await request(app).get('/api/systems').set(gm)).body.map((s) => s.id)).toContain(id);
    expect((await get(db, 'SELECT data FROM character_sheets WHERE system = ?', [id])).data).toContain('Sir Ghost');
  });

  it('warns when bringing one back would replace changes made here', async () => {
    const id = await create();
    await publish(id);
    const file = await exported(id);
    await request(app).put(`/api/systems/${id}/draft`).set(gm).send({ definition: { ...VAULT, description: 'Unshared work' } });
    await request(app).delete(`/api/systems/${id}`).set(gm);
    expect((await preview(file)).body.restores).toEqual({ id, name: 'Vault Knights', replacesChanges: true });
  });
});

describe('who may', () => {
  it('only the GM exports, previews or installs', async () => {
    const id = (await install(fileOf(VAULT), 'new')).body.id;
    const player = { Authorization: `Bearer ${PLAYER}` };
    expect((await request(app).get(`/api/systems/${id}/export`).set(player)).status).toBe(403);
    expect((await request(app).post('/api/systems/install/preview').set(player).send({ file: fileOf(VAULT) })).status).toBe(403);
    expect((await request(app).post('/api/systems/install').set(player).send({ file: fileOf(VAULT), mode: 'keep_both' })).status).toBe(403);
    expect((await request(app).post('/api/systems/install').send({ file: fileOf(VAULT), mode: 'keep_both' })).status).toBe(401);
  });
});
