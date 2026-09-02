import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { makeTestDb, run } from './helpers/testDb.js';
import sheetsRouteFactory from '../routes/sheets.js';
import { extractPdfFields, getImporter } from '../sheets/importers.js';
import { LAYOUTS, labelsFor, hasTemplate, buildTemplate } from '../sheets/pdfTemplate.js';

process.env.JWT_SECRET = 'test-secret';

let db;
let app;

const makeApp = (database) => {
  const application = express();
  application.use(express.json());
  const io = { emit: () => {} };
  application.use('/api/sheets', sheetsRouteFactory(database, io));
  return application;
};

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cyberpunk_red')`);
});

// Build a small fillable PDF in-memory, like an official character sheet
const buildFormPdf = async (fields) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 800]);
  const form = doc.getForm();
  let y = 760;
  for (const [name, value] of Object.entries(fields)) {
    const tf = form.createTextField(name);
    tf.setText(String(value));
    tf.addToPage(page, { x: 20, y, width: 150, height: 16 });
    y -= 24;
  }
  return Buffer.from(await doc.save());
};

describe('extractPdfFields', () => {
  it('reads text form fields out of a fillable PDF', async () => {
    const pdf = await buildFormPdf({ Handle: 'V', REF: '7' });
    const fields = await extractPdfFields(pdf);
    expect(fields).toEqual({ Handle: 'V', REF: '7' });
  });

  it('returns null for a PDF without form fields', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const fields = await extractPdfFields(Buffer.from(await doc.save()));
    expect(fields).toBeNull();
  });
});

describe('CP:R importer mapping', () => {
  const importer = getImporter('cyberpunk_red');

  it('maps stats, skills, armor and identity via aliases', () => {
    const { mapped, unmapped } = importer.mapFields({
      Handle: 'V', Role: 'Solo', INT: '6', REF: '7', 'SP (Head)': '11',
      Handgun: '5', 'Pilot Air Vehicle (x2)': '2', mystery_field: 'x',
    });
    expect(mapped.name).toBe('V');
    expect(mapped.role).toBe('Solo');
    expect(mapped.int).toBe(6);
    expect(mapped.ref).toBe(7);
    expect(mapped.sp_head_max).toBe(11);
    expect(mapped.sp_head).toBe(11); // max seeds current
    expect(mapped.handgun).toBe(5);
    expect(mapped.pilot_air).toBe(2);
    expect(unmapped.mystery_field).toBe('x');
  });

  /**
   * Vehicles.
   *
   * The Cyberpunk vehicle table cannot ship, so there is no preset picker and a player
   * would otherwise retype a car that already exists on a sheet somewhere else. Their own
   * sheet is their own data, which is what makes this the route the presets cannot be.
   */
  it('maps an unnumbered vehicle onto the first row', () => {
    const { mapped } = importer.mapFields({
      Vehicle: 'Galena', SDP: '50', 'Vehicle SP': '10', Seats: '4',
    });
    // Labels are Cyberpunk's, storage is the app's generic vocabulary.
    expect(mapped.vehicle1_name).toBe('Galena');
    expect(mapped.vehicle1_hp_max).toBe(50);
    expect(mapped.vehicle1_armor).toBe(10);
    expect(mapped.vehicle1_crew).toBe(4);
  });

  it('brings an imported vehicle in undamaged', () => {
    // A sheet saying "SDP 50" means a whole car. Without the seed every import would
    // arrive already wrecked, since a blank current pool reads as zero on the roster.
    const { mapped } = importer.mapFields({ Vehicle: 'Galena', SDP: '50' });
    expect(mapped.vehicle1_hp).toBe(50);
  });

  it('keeps a bare SP as body armour, not the car', () => {
    // On a Cyberpunk sheet, SP is personal armour far more often than it is a vehicle's,
    // and guessing wrong would quietly overwrite the wrong field.
    const { mapped } = importer.mapFields({ 'SP (Body)': '11', 'Vehicle SP': '7' });
    expect(mapped.sp_body_max).toBe(11);
    expect(mapped.vehicle1_armor).toBe(7);
  });

  it('takes a numbered fleet', () => {
    const { mapped } = importer.mapFields({
      Vehicle1: 'Galena', Vehicle1SDP: '50', Vehicle1Seats: '4',
      Vehicle2: 'Quartz', Vehicle2SDP: '35', 'Vehicle2 Hull': 'sportbike',
    });
    expect(mapped.vehicle1_name).toBe('Galena');
    expect(mapped.vehicle2_name).toBe('Quartz');
    expect(mapped.vehicle2_hp_max).toBe(35);
    expect(mapped.vehicle2_hp).toBe(35);
    expect(mapped.vehicle2_type).toBe('sportbike');
  });

  it('skips linked fields (HP, cash) and reports them', () => {
    const { mapped, skipped } = importer.mapFields({ hp: 30, cash: 500, ref: 7 });
    expect(mapped.hp).toBeUndefined();
    expect(mapped.cash).toBeUndefined();
    expect(skipped.hp).toBe(30);
    expect(mapped.ref).toBe(7);
  });

  it('LUCK/EMP single values seed both current and max', () => {
    const { mapped } = importer.mapFields({ LUCK: '6', EMP: '5', Humanity: '50' });
    expect(mapped.luck_max).toBe(6);
    expect(mapped.luck).toBe(6);
    expect(mapped.emp_max).toBe(5);
    expect(mapped.emp).toBe(5);
    expect(mapped.humanity).toBe(50);
    expect(mapped.humanity_max).toBe(50);
  });

  it('rejects non-numeric values for numeric fields', () => {
    const { mapped, unmapped } = importer.mapFields({ REF: 'seven' });
    expect(mapped.ref).toBeUndefined();
    expect(unmapped.REF).toBe('seven');
  });

  it('parses a plain stat block', () => {
    const raw = importer.parseText('HANDLE: Nyx  Role: Netrunner\nINT 8 REF 6 TECH 7\nHandgun: 3  Stealth 4');
    const { mapped } = importer.mapFields(raw);
    expect(mapped.name).toBe('Nyx');
    expect(mapped.int).toBe(8);
    expect(mapped.tech).toBe(7);
    expect(mapped.handgun).toBe(3);
    expect(mapped.stealth).toBe(4);
  });
});

/**
 * The blank form, and the round trip.
 *
 * The dialog always accepted a fillable PDF but there was nowhere to get one — you needed
 * a sheet whose field names happened to match our aliases. These are the tests that make
 * the generated form and the importer one thing rather than two that drift.
 */
describe('the import form', () => {
  const SYSTEMS = Object.keys(LAYOUTS);

  it('covers every system that has an importer, and no others', () => {
    // A form for a system with no importer would be a download that cannot be uploaded.
    expect(SYSTEMS.sort()).toEqual(['cities_without_number', 'cyberpunk_red', 'shadowrun_6e']);
    expect(hasTemplate('generic')).toBe(false);
  });

  it.each(SYSTEMS)('%s names every field something the importer reads back', (system) => {
    // The contract. A label the importer does not recognise is a box the player fills in
    // and loses, and nothing else would catch it.
    const labels = labelsFor(system);
    const { mapped, unmapped, skipped } = getImporter(system)
      .mapFields(Object.fromEntries(labels.map(l => [l, '1'])));

    expect(labels.length).toBeGreaterThan(0);
    // Nothing on the form may be unrecognised. `skipped` counts as recognised: linked
    // fields like CWN's token AC are understood and deliberately routed elsewhere rather
    // than written into sheet JSON, which is not the same as being lost.
    expect(Object.keys(unmapped)).toEqual([]);
    expect(Object.keys(mapped).length + Object.keys(skipped).length)
      .toBeGreaterThanOrEqual(labels.length);
  });

  it.each(SYSTEMS)('%s names each box once', (system) => {
    // A duplicate name is a second box that silently overwrites the first on upload.
    const labels = labelsFor(system);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('asks for the vehicles, which are the part with no preset behind them', () => {
    const labels = labelsFor('cyberpunk_red');
    expect(labels).toContain('Vehicle1Name');
    expect(labels).toContain('Vehicle1SDP');
    expect(labels).toContain('Vehicle1Seats');
  });

  it('builds a PDF whose form fields survive extraction', async () => {
    // Generated, written and read back through the same extractor the upload uses, so
    // this covers the actual path rather than the intention.
    const pdf = await buildTemplate('cyberpunk_red');
    const extracted = await extractPdfFields(pdf);
    const labels = labelsFor('cyberpunk_red');
    labels.forEach(l => expect(extracted).toHaveProperty(l));
  });

  it('round-trips a filled form back into sheet fields', async () => {
    const doc = await PDFDocument.load(await buildTemplate('cyberpunk_red'));
    const form = doc.getForm();
    form.getTextField('Handle').setText('V');
    form.getTextField('REF').setText('7');
    form.getTextField('Vehicle1Name').setText('Galena');
    form.getTextField('Vehicle1SDP').setText('50');
    form.getTextField('Vehicle1Seats').setText('4');

    const raw = await extractPdfFields(Buffer.from(await doc.save()));
    const { mapped } = getImporter('cyberpunk_red').mapFields(raw);

    expect(mapped.name).toBe('V');
    expect(mapped.ref).toBe(7);
    expect(mapped.vehicle1_name).toBe('Galena');
    expect(mapped.vehicle1_hp_max).toBe(50);
    expect(mapped.vehicle1_hp).toBe(50);
    expect(mapped.vehicle1_crew).toBe(4);
  });

  it('brings a CWN armor block in whole, pool included', async () => {
    // Damage Soak is spent in play and written back, so a sheet arriving from paper has
    // no "current" to state. Naming the armor's rating fills the pool as well, the way
    // System Strain Max already seeds System Strain.
    const doc = await PDFDocument.load(await buildTemplate('cities_without_number'));
    const form = doc.getForm();
    form.getTextField('Name').setText('Kestrel');
    form.getTextField('Armor Name').setText('Impact Jacket');
    form.getTextField('Damage Soak').setText('8');
    form.getTextField('TT Mod').setText('1');
    form.getTextField('Lifestyle').setText('-1');

    const raw = await extractPdfFields(Buffer.from(await doc.save()));
    const { mapped, unmapped } = getImporter('cities_without_number').mapFields(raw);

    expect(unmapped).toEqual({});
    expect(mapped.armor_soak).toBe(8);
    expect(mapped.soak_current).toBe(8);
    expect(mapped.armor_trauma_mod).toBe(1);
    expect(mapped.strain_mod).toBe(-1);
  });

  it('keeps a stated soak pool rather than refilling it', () => {
    // A JSON export mid-scene says both numbers. The max seed must not overwrite the one
    // that is already there, or importing a save would hand back armor that was spent.
    const { mapped } = getImporter('cities_without_number')
      .mapFields({ 'Damage Soak': '10', SoakCurrent: '3' });
    expect(mapped.armor_soak).toBe(10);
    expect(mapped.soak_current).toBe(3);
  });

  it('brings both ACs of a piece of armor in', async () => {
    // The book prints ranged first, which is the column `Armor AC` has always been.
    const doc = await PDFDocument.load(await buildTemplate('cities_without_number'));
    const form = doc.getForm();
    form.getTextField('Armor Name').setText('War Harness');
    form.getTextField('Armor AC').setText('13');
    form.getTextField('Armor Melee AC').setText('14');
    form.getTextField('Shield').setText('2');
    form.getTextField('Shield Melee').setText('4');

    const raw = await extractPdfFields(Buffer.from(await doc.save()));
    const { mapped, unmapped } = getImporter('cities_without_number').mapFields(raw);

    expect(unmapped).toEqual({});
    expect(mapped.armor_ac).toBe(13);
    expect(mapped.armor_ac_melee).toBe(14);
    expect(mapped.shield_bonus).toBe(2);
    expect(mapped.shield_bonus_melee).toBe(4);
  });

  it('leaves the melee AC alone on a sheet that names only one', async () => {
    // Every CWN sheet written before the split. Blank means "the same both ways",
    // and importing must not invent a number that changes how the character defends.
    const { mapped } = getImporter('cities_without_number').mapFields({ 'Armor AC': '16' });
    expect(mapped.armor_ac).toBe(16);
    expect(mapped.armor_ac_melee).toBeUndefined();
  });

  it('matches the words the book prints in the weapon columns', async () => {
    // The player fills the form from the book, so Attr arrives as "Str/Dex" and Skill as
    // "Shoot". A near miss is not a visible error - the weapon quietly stops rolling that
    // attribute, or stops resolving at all - so the words are matched rather than left to
    // the player to guess our spelling.
    const map = (raw) => getImporter('cities_without_number').mapFields(raw).mapped;
    expect(map({ Weapon1Attr: 'Str/Dex' }).weapon1_attr).toBe('str_dex');
    expect(map({ Weapon1Attr: 'Dex' }).weapon1_attr).toBe('dex');
    expect(map({ Weapon1Attr: 'Wis' }).weapon1_attr).toBe('wis');
    expect(map({ Weapon1Skill: 'Shoot' }).weapon1_skill).toBe('shoot');
    expect(map({ Weapon1Skill: 'Melee' }).weapon1_skill).toBe('stab');
  });

  it("reads the book's dash as no attribute named", async () => {
    // A dash in the Attr column means the weapon has none, which on the sheet is the
    // same blank that means "take it from the skill".
    const { mapped } = getImporter('cities_without_number').mapFields({ Weapon1Attr: '-' });
    expect(mapped.weapon1_attr).toBeUndefined();
  });

  it('leaves a word it does not know for the player to see', async () => {
    // Rather than guessing. A value that reaches the sheet unrecognised falls back to the
    // skill's attribute at roll time, so nothing breaks - but it is visible and fixable.
    const { mapped } = getImporter('cities_without_number').mapFields({ Weapon1Attr: 'banana' });
    expect(mapped.weapon1_attr).toBe('banana');
  });

  it('carries a whole weapon row through the form', async () => {
    const doc = await PDFDocument.load(await buildTemplate('cities_without_number'));
    const form = doc.getForm();
    form.getTextField('Weapon1Name').setText('Knife');
    form.getTextField('Weapon1Dmg').setText('1d4');
    form.getTextField('Weapon1Skill').setText('Stab');
    form.getTextField('Weapon1Attr').setText('Str/Dex');
    form.getTextField('Weapon1Trauma').setText('d6/x3');
    form.getTextField('Weapon1Shock').setText('1/15');

    const raw = await extractPdfFields(Buffer.from(await doc.save()));
    const { mapped, unmapped } = getImporter('cities_without_number').mapFields(raw);

    expect(unmapped).toEqual({});
    expect(mapped.weapon1_name).toBe('Knife');
    expect(mapped.weapon1_skill).toBe('stab');
    expect(mapped.weapon1_attr).toBe('str_dex');
    expect(mapped.weapon1_shock).toBe('1/15');
  });

  it('offers nothing for a system with no importer behind it', async () => {
    expect(hasTemplate('generic')).toBe(false);
    expect(await buildTemplate('generic')).toBeNull();
  });
});

describe('GET /api/sheets/import/template.pdf', () => {
  it('serves a PDF as a download', async () => {
    const res = await request(app).get('/api/sheets/import/template.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('citynet-cyberpunk_red-import.pdf');
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('says so rather than 500ing when the system has no form', async () => {
    await run(db, `UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'`);
    const res = await request(app).get('/api/sheets/import/template.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/generic/);
  });
});

describe('POST /api/sheets/import/preview', () => {
  it('previews a fillable PDF', async () => {
    const pdf = await buildFormPdf({ Handle: 'V', REF: '7', Handgun: '5' });
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .attach('pdf', pdf, { filename: 'sheet.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('pdf-form');
    expect(res.body.mapped.name).toBe('V');
    expect(res.body.mapped.ref).toBe(7);
    expect(res.body.mapped.handgun).toBe(5);
  });

  it('previews pasted JSON', async () => {
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .send({ json: JSON.stringify({ ref: 7, cool: 5 }) });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('json');
    expect(res.body.mapped).toMatchObject({ ref: 7, cool: 5 });
  });

  it('previews pasted stat-block text', async () => {
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .send({ text: 'REF 7 COOL 5 Handgun: 4' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('text');
    expect(res.body.mapped).toMatchObject({ ref: 7, cool: 5, handgun: 4 });
  });

  it('422s for a flat PDF with a helpful message', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .attach('pdf', Buffer.from(await doc.save()), { filename: 'flat.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/paste/i);
  });

  it('400s when the active system has no importer', async () => {
    await run(db, `UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'`);
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .send({ json: '{"x":1}' });
    expect(res.status).toBe(400);
  });
});

// ─── the Companion route's ceiling ────────────────────────────────────────────

/**
 * The limit exists because this is the one open route that spends our outbound requests
 * on an anonymous caller's say-so. The middleware is tested on its own in
 * `rate_limit.test.js`; what is tested here is that it is actually attached to the route,
 * which is the part that would silently stop being true.
 */
describe('POST /api/sheets/import/companion — rate limit', () => {
  const { companionLimit, COMPANION_LIMIT } = sheetsRouteFactory;

  beforeEach(() => {
    companionLimit.reset();
    // Answers every code with "no such character". Deterministic, and nothing leaves the
    // process — a real call here would be someone else's service in our test suite.
    globalThis.fetch = async () => ({ status: 404, ok: false, text: async () => '{}' });
  });

  const post = (code) => request(app).post('/api/sheets/import/companion').send({ code });

  it('allows a run of honest attempts', async () => {
    // A player who mistypes their code a few times must not be locked out.
    for (let i = 0; i < COMPANION_LIMIT; i++) {
      const res = await post('6LZKP7');
      expect(res.status, `attempt ${i + 1}`).not.toBe(429);
    }
  });

  it('stops a caller who keeps going, and says when to come back', async () => {
    for (let i = 0; i < COMPANION_LIMIT; i++) await post('6LZKP7');

    const res = await post('6LZKP7');
    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('counts codes it never sent anywhere', async () => {
    // A malformed code is refused before any request is made, so it costs us nothing —
    // but a script walking the keyspace would otherwise get unlimited free guesses at
    // which shapes are even accepted.
    for (let i = 0; i < COMPANION_LIMIT; i++) {
      const res = await post('!!');
      expect(res.status).toBe(400);
    }
    expect((await post('6LZKP7')).status).toBe(429);
  });
});

// ─── cyberware travels as rows ────────────────────────────────────────────────

/**
 * The rows were computed and then dropped.
 *
 * `flattenCompanion` learned to read cyberware, but the route answered with `mapped`,
 * `unmapped` and `skipped` only — so a re-import still put no chrome on the sheet, which
 * is exactly what it looked like from the outside.
 */
describe('POST /api/sheets/import/companion — cyberware', () => {
  const companionDoc = (cyber) => ({
    fields: {
      handle: { stringValue: 'Nyx' },
      stats: { mapValue: { fields: { Reflexes: { integerValue: '6' } } } },
      cyberware: { mapValue: { fields: cyber } },
    },
  });

  const piece = (type, hl) => ({
    mapValue: {
      fields: {
        name: { stringValue: '' },
        type: { stringValue: type },
        humanityLoss: { integerValue: String(hl) },
      },
    },
  });

  beforeEach(() => {
    sheetsRouteFactory.companionLimit.reset();
    globalThis.fetch = async (url) => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(
        String(url).includes('code_to_character')
          ? { fields: { character_uuid: { stringValue: 'uuid-1' } } }
          : companionDoc({
              a: piece('NeuroportCyberdeckPort', 3),
              b: piece('LightTattoo', 0),
            }),
      ),
    });
  });

  it('hands the rows back beside the mapped fields', async () => {
    const res = await request(app)
      .post('/api/sheets/import/companion')
      .send({ code: '6LZKP7' });

    expect(res.status).toBe(200);
    expect(res.body.cyberware).toHaveLength(2);
    expect(res.body.cyberware[0].name).toBe('Neuroport Cyberdeck Port');
    expect(res.body.cyberware[0].hl).toBe(3);
  });

  it('says the export does not know where any of it is installed', async () => {
    const res = await request(app)
      .post('/api/sheets/import/companion')
      .send({ code: '6LZKP7' });

    expect(res.body.cyberware.every((r) => r.type === '')).toBe(true);
    expect(res.body.missing.join(' ')).toMatch(/where each piece of cyberware is installed/);
  });

  it('answers with an empty list rather than nothing when there is no chrome', async () => {
    globalThis.fetch = async (url) => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(
        String(url).includes('code_to_character')
          ? { fields: { character_uuid: { stringValue: 'uuid-1' } } }
          : companionDoc({}),
      ),
    });
    const res = await request(app)
      .post('/api/sheets/import/companion')
      .send({ code: '6LZKP7' });

    expect(res.body.cyberware).toEqual([]);
  });
});

describe('the cyberware line from a form or a paste', () => {
  it('becomes rows rather than a field the template no longer has', () => {
    // A paper form cannot hold rows, so it offers one line. The import reads it into rows
    // on the way to the sheet; keeping the line would store it where nothing looks.
    const { getImporter } = require('../sheets/importers.js');
    const { mapped } = getImporter('cyberpunk_red').mapFields({
      cyberware: 'Cybereye (Low Light), Neural Link',
    });
    expect(mapped.cyberware_notes).toBe('Cybereye (Low Light), Neural Link');

    const rows = require('../sheets/cyberware.js').fromNotes(mapped.cyberware_notes);
    expect(rows.map((r) => r.name)).toEqual(['Cybereye (Low Light)', 'Neural Link']);
  });
});
