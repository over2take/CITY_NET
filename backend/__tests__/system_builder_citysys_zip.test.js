import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

/**
 * Sharing a custom system as a zip with its uploaded pictures (decided with the user, 2026-10-23):
 * each picture named for what it is, IMAGES.txt saying where each is used, and the GM's choice at
 * EXPORT to leave them out, when the file drops their addresses so the system falls back cleanly.
 * Installing a zip stores only the pictures the system names, under their own hashes, and never
 * unpacks anything else or past the size the zip claims.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { zipSync, unzipSync, strToU8, strFromU8 } = require_('fflate');
const citysys = require_('../systemBuilder/citysys');
const zip = require_('../systemBuilder/citysysZip');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const PLAYER = jwt.sign({ id: 5, username: 'GHOST', role: 'player' }, 'test-secret');
const gm = { Authorization: `Bearer ${GM}` };

/** A picture as an upload stores it: its bytes, and the address its hash gives it. */
const picture = (folder, ext = 'png') => {
  const bytes = crypto.randomBytes(300);
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${ext}`;
  return { bytes, folder, name, address: `/uploads/${folder}/${name}` };
};

/** A system with a picture for a symbol, a condition of its own, a standard one, and a currency. */
const systemWith = (p) => ({
  format: 1, name: 'Ember Line',
  symbols: [
    { id: 'hit', name: 'Hit', icon: p.hit.address },
    { id: 'edge', name: 'Edge', mark: '◆' },
    { id: 'skull', name: 'Skull', drawn: ['07e0', '1ff8', '3ffc', '3ffc', '73ce', '6186', '6186', '73ce', '3e7c', '1ff8', '0ff0', '0db0', '0db0', '07e0', '0000', '0000'] },
  ],
  dice: [
    { id: 'good', name: 'Good', faces: [{}, { s: ['hit'] }, { s: ['hit', 'edge'] }, { s: ['skull'] }] },
    { id: 'bad', name: 'Bad', faces: [{}, { s: ['skull'] }, {}, { s: ['hit'] }] },
  ],
  conditions: {
    glitching: { name: 'Glitching', short: 'GLITCH', icon: p.glitching.address },
    bleeding: { icon: p.bleeding.address },
  },
  currencies: [{ id: 'scrip', name: 'Scrip', icon: p.scrip.address }, { id: 'favor', name: 'Favor', icon: '🪙' }],
});
const pictures = () => ({
  hit: picture('condition_icons'), glitching: picture('condition_icons', 'svg'),
  bleeding: picture('condition_icons', 'webp'), scrip: picture('currency_icons'),
});

describe('the pictures a system names', () => {
  const p = pictures();
  const def = systemWith(p);

  it('are its uploads only, each with where a symbol shows on the dice', () => {
    expect(checkDefinition(def).problems).toEqual([]);
    expect(zip.uploadsIn(def)).toEqual([
      { kind: 'symbols', id: 'hit', name: 'Hit', address: p.hit.address, used: 'Good faces 2, 3; Bad face 4' },
      { kind: 'conditions', id: 'glitching', name: 'Glitching', address: p.glitching.address, used: '' },
      // A standard condition by the name it has.
      { kind: 'conditions', id: 'bleeding', name: 'Bleeding', address: p.bleeding.address, used: '' },
      { kind: 'currencies', id: 'scrip', name: 'Scrip', address: p.scrip.address, used: '' },
    ]);
    expect(zip.uploadsIn({ format: 1, name: 'Plain' })).toEqual([]);
    expect(zip.uploadsIn(null)).toEqual([]);
  });

  it('left out, fall back cleanly: drawings, marks and built-in icons stay', () => {
    const out = zip.withoutUploads(def);
    // A symbol needs something on the dice: its name's first letter, as the log writes it.
    expect(out.symbols).toEqual([{ id: 'hit', name: 'Hit', mark: 'H' }, def.symbols[1], def.symbols[2]]);
    // One with a mark of its own keeps it.
    expect(zip.withoutUploads({ ...def, symbols: [{ id: 'hit', name: 'Hit', mark: '✶', icon: p.hit.address }] }).symbols).toEqual([{ id: 'hit', name: 'Hit', mark: '✶' }]);
    expect(out.conditions).toEqual({ glitching: { name: 'Glitching', short: 'GLITCH' }, bleeding: {} });
    expect(out.currencies).toEqual([{ id: 'scrip', name: 'Scrip' }, { id: 'favor', name: 'Favor', icon: '🪙' }]);
    expect(checkDefinition(out).problems).toEqual([]);
    // Only those named, where asked.
    expect(zip.withoutUploads(def, new Set([p.scrip.address])).symbols[0].icon).toBe(p.hit.address);
    // The definition itself is untouched.
    expect(def.symbols[0].icon).toBe(p.hit.address);
  });
});

describe('a zip made and read back', () => {
  let root;
  const p = pictures();
  const def = systemWith(p);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'citysys-zip-'));
    for (const x of Object.values(p)) { fs.mkdirSync(path.join(root, x.folder), { recursive: true }); fs.writeFileSync(path.join(root, x.folder, x.name), x.bytes); }
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('holds the file unchanged, the pictures named for what they are, and IMAGES.txt', () => {
    const made = zip.buildZip({ definition: def, version: 4, origin: 'org_ember', root });
    expect([made.fileName, made.images]).toEqual(['ember-line.zip', 4]);
    const inside = unzipSync(new Uint8Array(made.bytes));
    expect(Object.keys(inside).sort()).toEqual([
      'IMAGES.txt', 'ember-line.citysys', 'images/conditions/bleeding.webp', 'images/conditions/glitching.svg',
      'images/currencies/scrip.png', 'images/symbols/hit.png',
    ]);
    expect(Buffer.from(inside['images/symbols/hit.png'])).toEqual(p.hit.bytes);
    // Every address as it was: an upload's address is its picture's hash.
    const read = citysys.readFile(strFromU8(inside['ember-line.citysys']));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.symbols[0].icon).toBe(p.hit.address);
    expect(strFromU8(inside['IMAGES.txt'])).toContain('images/symbols/hit.png  HIT: Good faces 2, 3; Bad face 4');
    expect(strFromU8(inside['IMAGES.txt'])).toContain('images/currencies/scrip.png  SCRIP');
  });

  it('read back, gives the file and each picture under its own hash, the ones the system names', () => {
    const made = zip.buildZip({ definition: def, version: 4, origin: 'org_ember', root });
    const read = zip.readZip(made.bytes);
    expect(citysys.readFile(read.text).file.manifest.origin).toBe('org_ember');
    const named = zip.imagesFor(citysys.readFile(read.text).file.definition, read.images);
    expect(named.map((x) => `${x.folder}/${x.name}`).sort()).toEqual(Object.values(p).map((x) => `${x.folder}/${x.name}`).sort());
    // Stored where the addresses find them.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'citysys-zip-'));
    try {
      zip.storeImages(named, elsewhere);
      for (const x of Object.values(p)) expect(fs.readFileSync(path.join(elsewhere, x.folder, x.name))).toEqual(x.bytes);
    } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
  });

  it('leaves out a picture no longer on disk, and its address with it', () => {
    fs.rmSync(path.join(root, p.scrip.folder, p.scrip.name));
    const made = zip.buildZip({ definition: def, version: 4, origin: 'org_ember', root });
    const inside = unzipSync(new Uint8Array(made.bytes));
    expect(made.images).toBe(3);
    expect(inside['images/currencies/scrip.png']).toBeUndefined();
    const sent = JSON.parse(strFromU8(inside['ember-line.citysys']));
    expect(sent.definition.currencies[0]).toEqual({ id: 'scrip', name: 'Scrip' });
    expect(sent.symbols[0].icon).toBe(p.hit.address);
  });

  it('is nothing for a system without pictures, or with none left on disk', () => {
    expect(zip.buildZip({ definition: { format: 1, name: 'Plain' }, version: 1, origin: 'o', root })).toBeNull();
    expect(zip.buildZip({ definition: def, version: 1, origin: 'o', root: path.join(root, 'nothing') })).toBeNull();
  });

  it('two things sharing one picture send it once each, under their own names', () => {
    const shared = { ...def, conditions: { glitching: { name: 'Glitching', icon: p.hit.address }, hacked: { name: 'Hacked', icon: p.hit.address } } };
    const inside = unzipSync(new Uint8Array(zip.buildZip({ definition: shared, version: 1, origin: 'o', root }).bytes));
    expect(Object.keys(inside).filter((k) => k.startsWith('images/conditions/')).sort()).toEqual(['images/conditions/glitching.png', 'images/conditions/hacked.png']);
    // Installing stores it once.
    const read = zip.readZip(zip.buildZip({ definition: shared, version: 1, origin: 'o', root }).bytes);
    expect(zip.imagesFor(shared, read.images).filter((x) => x.name === p.hit.name)).toHaveLength(1);
  });
});

describe('a zip someone sent', () => {
  const file = JSON.stringify(citysys.buildFile({ definition: { format: 1, name: 'Sent' }, version: 1, origin: 'org_sent' }));
  const zipOf = (files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));
  /**
   * The zip with `name`'s compressed data broken, so unpacking it throws: a zip with it still
   * read shows the entry was never unpacked, not merely dropped afterwards.
   */
  const brokenAt = (bytes, name) => {
    const at = bytes.indexOf(Buffer.from(name)) - 30;
    expect(bytes.readUInt32LE(at)).toBe(0x04034b50);
    bytes[at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28)] = 0xff;
    return bytes;
  };
  const deflated = (text) => [strToU8(text), { level: 9 }];

  it('is refused when it isn\'t one, is empty, too large, or holds no system or two', () => {
    expect(zip.readZip(Buffer.from('not a zip at all')).fatal).toBe('Not a zip file CITY_NET can read');
    expect(zip.readZip(Buffer.alloc(0)).fatal).toBe('Not a file');
    expect(zip.readZip('text').fatal).toBe('Not a file');
    expect(zip.readZip(Buffer.alloc(zip.LIMITS.zipBytes + 1)).fatal).toBe('Larger than 16 MB');
    expect(zip.readZip(zipOf({ 'IMAGES.txt': 'x' })).fatal).toBe('The zip has no .citysys file in it');
    expect(zip.readZip(zipOf({ 'a.citysys': file, 'b.citysys': file })).fatal).toBe('The zip holds more than one system; share one at a time');
    expect(zip.readZip(zipOf({ 'a.citysys': 'x'.repeat(citysys.MAX_BYTES + 1) })).fatal).toMatch(/^a\.citysys is larger than \d+ KB$/);
  });

  it('never unpacks anything but its system and pictures in their places', () => {
    const p = picture('condition_icons');
    const read = zip.readZip(zipOf({
      'sent.citysys': file,
      'images/symbols/hit.png': p.bytes,
      'images/symbols/hit.gif': p.bytes,
      'images/../../escape.png': p.bytes,
      'images/symbols/deeper/hit.png': p.bytes,
      'images/other/hit.png': p.bytes,
      'server.js': 'process.exit()',
      'nested/sent.citysys': file,
    }));
    expect(read.fatal).toBeUndefined();
    expect(read.images.map((x) => `${x.folder}/${x.name}`)).toEqual([`condition_icons/${p.name}`]);
    // Never unpacked at all: broken past unpacking, it is still read.
    for (const name of ['server.js', 'images/other/x.png', 'images/symbols/deeper/x.png', 'images/../../x.png']) {
      const sent = brokenAt(Buffer.from(zipSync({ 'sent.citysys': strToU8(file), [name]: deflated('x'.repeat(2000)) })), name);
      expect(zip.readZip(sent).fatal, name).toBeUndefined();
    }
    // A picture in its place is unpacked, so the same break is found.
    const found = brokenAt(Buffer.from(zipSync({ 'sent.citysys': strToU8(file), 'images/symbols/x.png': deflated('x'.repeat(2000)) })), 'images/symbols/x.png');
    expect(zip.readZip(found).fatal).toBe('Not a zip file CITY_NET can read');
  });

  it('never unpacks a picture past the size of an upload, nor more than its own size says', () => {
    const big = crypto.randomBytes(zip.LIMITS.imageBytes + 1);
    expect(zip.readZip(zipOf({ 'sent.citysys': file, 'images/symbols/big.png': big })).images).toEqual([]);
    // A zip claiming 1 KB for 10 MB: unpacked to 1 KB at most, so its hash names nothing.
    const lying = zipOf({ 'sent.citysys': file, 'images/symbols/hit.png': new Uint8Array(10 * 1024 * 1024) });
    for (let i = 0; i < lying.length - 4; i += 1) {
      if (lying.readUInt32LE(i) === 0x04034b50) lying.writeUInt32LE(1024, i + 22);
      if (lying.readUInt32LE(i) === 0x02014b50) lying.writeUInt32LE(1024, i + 24);
    }
    const read = zip.readZip(lying);
    expect(read.images.every((x) => x.bytes.length <= 1024)).toBe(true);
  });

  it('is refused with more pictures than a system can name', () => {
    const many = Object.fromEntries(Array.from({ length: zip.LIMITS.images + 1 }, (_, i) => [`images/symbols/s${i}.png`, crypto.randomBytes(8)]));
    expect(zip.readZip(zipOf({ 'sent.citysys': file, ...many })).fatal).toBe(`More than ${zip.LIMITS.images} pictures`);
    // And the ones past the limit are never unpacked: the last, broken, is still not found broken.
    const last = `images/symbols/s${zip.LIMITS.images}.png`;
    const sent = brokenAt(Buffer.from(zipSync({ 'sent.citysys': strToU8(file), ...many, [last]: deflated('x'.repeat(2000)) })), last);
    expect(zip.readZip(sent).fatal).toBe(`More than ${zip.LIMITS.images} pictures`);
  });

  it('stores only the pictures its system names, in the folder its address says', () => {
    const named = picture('currency_icons');
    const stray = picture('condition_icons');
    const def = { format: 1, name: 'Sent', currencies: [{ id: 'scrip', name: 'Scrip', icon: named.address }] };
    const read = zip.readZip(zipOf({
      'sent.citysys': JSON.stringify(citysys.buildFile({ definition: def, version: 1, origin: 'o' })),
      'images/currencies/scrip.png': named.bytes,
      'images/currencies/stray.png': stray.bytes,
      // The right picture in the wrong kind's place lands in the wrong folder, which names nothing.
      'images/symbols/scrip.png': named.bytes,
    }));
    expect(zip.imagesFor(def, read.images).map((x) => `${x.folder}/${x.name}`)).toEqual([`currency_icons/${named.name}`]);
  });
});

describe('through the routes', () => {
  const UPLOADS = zip.UPLOADS;
  let db;
  let app;
  let made = [];
  const keep = (x) => { fs.mkdirSync(path.join(UPLOADS, x.folder), { recursive: true }); fs.writeFileSync(path.join(UPLOADS, x.folder, x.name), x.bytes); made.push(x); };
  const there = (x) => fs.existsSync(path.join(UPLOADS, x.folder, x.name));

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/systems', require_('../routes/systems.js')(db));
    await new Promise((resolve) => runtime.load(db, resolve));
  });
  afterEach(() => { for (const x of made) fs.rmSync(path.join(UPLOADS, x.folder, x.name), { force: true }); made = []; });

  const published = async (definition) => {
    const id = (await request(app).post('/api/systems').set(gm).send({ definition })).body.id;
    expect((await request(app).post(`/api/systems/${id}/publish`).set(gm)).status).toBe(200);
    return id;
  };
  const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

  it('lists how many pictures EXPORT can send, from the published copy', async () => {
    const p = pictures();
    Object.values(p).forEach(keep);
    const id = await published(systemWith(p));
    const listed = (await request(app).get('/api/systems').set(gm)).body.find((s) => s.id === id);
    expect(listed.images).toBe(4);
  });

  it('exports a zip with ?images=1, and the .citysys without its pictures otherwise', async () => {
    const p = pictures();
    Object.values(p).forEach(keep);
    const id = await published(systemWith(p));
    const zipped = await request(app).get(`/api/systems/${id}/export?images=1`).set(gm).buffer(true).parse(binary);
    expect(zipped.status).toBe(200);
    expect(zipped.headers['content-type']).toBe('application/zip');
    expect(zipped.headers['content-disposition']).toBe('attachment; filename="ember-line.zip"');
    expect(Object.keys(unzipSync(new Uint8Array(zipped.body)))).toContain('images/symbols/hit.png');

    const plain = await request(app).get(`/api/systems/${id}/export`).set(gm);
    expect(plain.headers['content-disposition']).toBe('attachment; filename="ember-line.citysys"');
    const file = JSON.parse(plain.text);
    expect(file.symbols[0]).toEqual({ id: 'hit', name: 'Hit', mark: 'H' });
    // And it installs published, with nothing to fix.
    expect(citysys.readFile(plain.text).problems).toEqual([]);
    expect(file.definition.currencies[0]).toEqual({ id: 'scrip', name: 'Scrip' });
    // A system without pictures is its .citysys either way.
    const bare = await published({ format: 1, name: 'Bare' });
    expect((await request(app).get(`/api/systems/${bare}/export?images=1`).set(gm)).headers['content-disposition']).toBe('attachment; filename="bare.citysys"');
  });

  it('installs a zip on a server without its pictures, and they show again', async () => {
    const p = pictures();
    Object.values(p).forEach(keep);
    const id = await published(systemWith(p));
    const bytes = (await request(app).get(`/api/systems/${id}/export?images=1`).set(gm).buffer(true).parse(binary)).body;
    // As if on another server: the pictures aren't here.
    for (const x of Object.values(p)) fs.rmSync(path.join(UPLOADS, x.folder, x.name));

    const seen = await request(app).post('/api/systems/install/zip/preview').set(gm).set('Content-Type', 'application/zip').send(bytes);
    expect(seen.status).toBe(200);
    expect([seen.body.name, seen.body.inside.images]).toEqual(['Ember Line', 4]);
    expect(Object.values(p).some(there)).toBe(false);

    const done = await request(app).post('/api/systems/install/zip?mode=keep_both').set(gm).set('Content-Type', 'application/zip').send(bytes);
    expect(done.status).toBe(200);
    expect([done.body.published, done.body.images]).toEqual([true, 4]);
    for (const x of Object.values(p)) expect(fs.readFileSync(path.join(UPLOADS, x.folder, x.name))).toEqual(x.bytes);
    const copy = (await request(app).get(`/api/systems/${done.body.id}`).set(gm)).body;
    expect(copy.published.symbols[0].icon).toBe(p.hit.address);
  });

  it('stores nothing when the install is refused', async () => {
    const p = pictures();
    Object.values(p).forEach(keep);
    const id = await published(systemWith(p));
    const bytes = (await request(app).get(`/api/systems/${id}/export?images=1`).set(gm).buffer(true).parse(binary)).body;
    for (const x of Object.values(p)) fs.rmSync(path.join(UPLOADS, x.folder, x.name));
    // Already installed here, so installing it as new is refused.
    const refused = await request(app).post('/api/systems/install/zip?mode=new').set(gm).set('Content-Type', 'application/zip').send(bytes);
    expect(refused.status).toBe(409);
    expect(Object.values(p).some(there)).toBe(false);
  });

  it('refuses what isn\'t a zip it can read, and anyone but the GM', async () => {
    const bad = await request(app).post('/api/systems/install/zip/preview').set(gm).set('Content-Type', 'application/zip').send(Buffer.from('nope'));
    expect([bad.status, bad.body.error]).toEqual([400, 'Not a zip file CITY_NET can read']);
    const sentAsJson = await request(app).post('/api/systems/install/zip?mode=new').set(gm).send({ file: 'x' });
    expect([sentAsJson.status, sentAsJson.body.error]).toEqual([400, 'Not a file']);
    const player = { Authorization: `Bearer ${PLAYER}` };
    expect((await request(app).post('/api/systems/install/zip/preview').set(player).set('Content-Type', 'application/zip').send(Buffer.from('x'))).status).toBe(403);
    expect((await request(app).post('/api/systems/install/zip?mode=new').set(player).set('Content-Type', 'application/zip').send(Buffer.from('x'))).status).toBe(403);
  });
});
