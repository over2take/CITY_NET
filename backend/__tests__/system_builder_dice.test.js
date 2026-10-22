import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

/**
 * A system's own dice (6c1a; approved mockup docs/mockups/builder-dice.html, 2026-10-21): symbols
 * with a mark, what each cancels and counts as; dice whose faces show a number, symbols, both or
 * nothing; checked as strictly as the rest of an untrusted file and carried in a .citysys file
 * beside the system, so a builder from before them still installs it.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { LIMITS, symbolsOf, diceOf } = require_('../systemBuilder/diceFaces');
const citysys = require_('../systemBuilder/citysys');
const { randomSystem } = require_('./helpers/randomSystem');

const SYMBOLS = [
  { id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' },
  { id: 'miss', name: 'Miss', mark: '✕', cancels: 'hit' },
  { id: 'edge', name: 'Edge', mark: '◆' },
  { id: 'crit', name: 'Crit', mark: '★', also: 'hit' },
  { id: 'skull', name: 'Skull', icon: 'skull' },
];
const DICE = [
  { id: 'good', name: 'Good', faces: [{}, {}, { s: ['hit'] }, { s: ['hit', 'edge'] }, { s: ['edge', 'edge'] }, { s: ['edge'] }] },
  { id: 'bad', name: 'Bad', color: 'danger', faces: [{}, { s: ['miss'] }, { s: ['miss', 'miss'] }, { s: ['crit'] }] },
  { id: 'fate', name: 'dF', faces: [{ n: 1 }, { n: 1 }, { n: 0 }, { n: 0 }, { n: -1 }, { n: -1 }] },
  { id: 'skull_d6', name: 'Skull die', faces: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { s: ['skull'] }] },
];
const HEARTH = { format: 1, name: 'Hearth', symbols: SYMBOLS, dice: DICE };
const said = (def) => checkDefinition(def).problems.filter((p) => /^(symbol|die|dice)/.test(p.where)).map((p) => `${p.where}: ${p.message}`);
const withSymbol = (patch, i = 0) => ({ ...HEARTH, symbols: SYMBOLS.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
const withDie = (patch, i = 0) => ({ ...HEARTH, dice: DICE.map((d, k) => (k === i ? { ...d, ...patch } : d)) });

describe('a system\'s symbols', () => {
  it('take a mark of a character or two, or a drawn icon, a cancelling pair, and one that also counts as another', () => {
    expect(said(HEARTH)).toEqual([]);
    // An emoji is one mark however many code points make it.
    expect(said(withSymbol({ mark: '👍🏽' }))).toEqual([]);
    expect(said(withSymbol({ mark: 'XX' }))).toEqual([]);
    expect(said({ format: 1, name: 'Plain' })).toEqual([]);
  });

  it('say what is wrong with one, by its id or place', () => {
    expect(said(withSymbol({ mark: 'XYZ' }))).toEqual(['symbol hit, mark: A mark of one or 2 characters']);
    expect(said(withSymbol({ mark: ' ' }))).toEqual(['symbol hit, mark: A mark of one or 2 characters']);
    expect(said(withSymbol({ mark: undefined }))).toEqual(['symbol hit, mark: Needs a mark, an icon or a drawing, to show on the dice']);
    expect(said(withSymbol({ icon: 'unicorn' }, 4))).toEqual(['symbol skull, icon: One of the drawn icons, or an uploaded one']);
    expect(said(withSymbol({ name: '' }))).toEqual([`symbol hit, name: A name of up to ${LIMITS.name} characters`]);
    // MISS, CRIT and the GOOD die's faces, which named it, say so too.
    expect(said(withSymbol({ id: 'Hit Points' }))).toEqual([
      'symbol Hit Points: Ids use lowercase letters, digits and _, starting with a letter',
      'symbol miss, cancels: Not one of this system\'s symbols',
      'symbol crit, also: Not one of this system\'s symbols',
      'die good, face 3, symbol 1: Not one of this system\'s symbols',
      'die good, face 4, symbol 1: Not one of this system\'s symbols',
    ]);
    expect(said(withSymbol({ id: 'miss', cancels: undefined }))).toContain('symbol miss: Defined twice');
    expect(said(withSymbol({ colour: 'red' }))).toEqual(['symbol hit, colour: Not part of a symbol']);
    expect(said({ ...HEARTH, symbols: [...SYMBOLS, 'hit'] })).toEqual(['symbol 6: Must be a symbol']);
    expect(said({ ...HEARTH, symbols: 'hit', dice: undefined })).toEqual(['symbols: Must be a list of symbols']);
    expect(said({ ...HEARTH, symbols: Array.from({ length: LIMITS.symbols + 1 }, (_, i) => ({ id: `s${i}`, name: 'S', mark: 'S' })), dice: undefined }))
      .toEqual([`symbols: At most ${LIMITS.symbols} symbols`]);
  });

  it('cancel and count as only this system\'s other symbols, a pair and one step at a time', () => {
    expect(said(withSymbol({ cancels: 'luck' }))).toEqual(['symbol hit, cancels: Not one of this system\'s symbols']);
    expect(said(withSymbol({ cancels: 'hit' }))).toContain('symbol hit, cancels: A symbol can\'t cancel itself');
    expect(said(withSymbol({ also: 'crit' }, 3))).toEqual(['symbol crit, also: A symbol already counts as itself']);
    // EDGE cancelling HIT, which already cancels MISS.
    expect(said(withSymbol({ cancels: 'hit' }, 2))).toEqual(['symbol edge, cancels: Hit already cancels another symbol']);
    // SKULL counting as CRIT, which already counts as HIT.
    expect(said(withSymbol({ also: 'crit' }, 4))).toEqual(['symbol skull, also: Crit already counts as another symbol']);
  });

  it('look like a picture instead (6c2b1): an uploaded icon, or a 16 by 16 drawing kept in the system', () => {
    const SKULL = ['07e0', '1ff8', '3ffc', '3ffc', '73ce', '6186', '6186', '73ce', '3e7c', '1ff8', '0ff0', '0db0', '0db0', '07e0', '0000', '0000'];
    const upload = `/uploads/condition_icons/${'a'.repeat(64)}.png`;
    expect(said(withSymbol({ icon: upload }, 4))).toEqual([]);
    // A drawing needs no mark: the log writes the name's first letter.
    expect(said(withSymbol({ icon: undefined, drawn: SKULL }, 4))).toEqual([]);
    expect(said(withSymbol({ drawn: SKULL }, 4))).toEqual(['symbol skull, drawn: An icon or a drawing, not both']);
    expect(said(withSymbol({ icon: '/uploads/elsewhere/x.png' }, 4))).toEqual(['symbol skull, icon: One of the drawn icons, or an uploaded one']);
    for (const drawn of [SKULL.slice(1), [...SKULL.slice(1), 'FFFF'], [...SKULL.slice(1), '0fff0'], 'skull']) {
      expect(said(withSymbol({ icon: undefined, drawn }, 4)), JSON.stringify(drawn)).toEqual(['symbol skull, drawn: A drawing of 16 rows, each 4 hex digits']);
    }
    expect(symbolsOf(withSymbol({ icon: undefined, drawn: SKULL }, 4))[4]).toEqual({ id: 'skull', name: 'Skull', drawn: SKULL });
    expect(symbolsOf(withSymbol({ icon: upload }, 4))[4]).toEqual({ id: 'skull', name: 'Skull', icon: upload });
    // Both stored: the icon is what shows.
    expect(symbolsOf(withSymbol({ drawn: SKULL }, 4))[4]).toEqual({ id: 'skull', name: 'Skull', icon: 'skull' });
  });

  it('read whole for the rolls, anything broken left out', () => {
    expect(symbolsOf(HEARTH)).toEqual(SYMBOLS);
    expect(symbolsOf({ symbols: [{ id: 'hit', name: 'Hit', mark: '✶', icon: 'unicorn', cancels: 7 }, { id: 'Bad!' }, null] })).toEqual([{ id: 'hit', name: 'Hit', mark: '✶' }]);
    expect(symbolsOf({})).toEqual([]);
  });
});

describe('a system\'s dice', () => {
  it('say what is wrong with one, by its id or place', () => {
    expect(said(withDie({ faces: [{}] }))).toEqual([`die good, faces: From 2 to ${LIMITS.faces} faces`]);
    expect(said(withDie({ faces: Array.from({ length: LIMITS.faces + 1 }, () => ({})) }))).toEqual([`die good, faces: From 2 to ${LIMITS.faces} faces`]);
    expect(said(withDie({ color: 'red' }))).toEqual(['die good, color: The theme\'s, or danger']);
    expect(said(withDie({ name: 'A'.repeat(LIMITS.name + 1) }))).toEqual([`die good, name: A name of up to ${LIMITS.name} characters`]);
    expect(said(withDie({ id: 'bad' }))).toEqual(['die bad: Defined twice']);
    expect(said(withDie({ sides: 6 }))).toEqual(['die good, sides: Not part of a die']);
    expect(said({ ...HEARTH, dice: { good: DICE[0] } })).toEqual(['dice: Must be a list of dice']);
    expect(said({ ...HEARTH, dice: [...DICE, 6] })).toEqual(['die 5: Must be a die']);
  });

  it('a face: a whole number with its sign, and up to six of this system\'s symbols', () => {
    expect(said(withDie({ faces: [{ n: 1.5 }, { n: 1000 }] }, 2))).toEqual([
      `die fate, face 1, number: A whole number from -${LIMITS.number} to ${LIMITS.number}`,
      `die fate, face 2, number: A whole number from -${LIMITS.number} to ${LIMITS.number}`,
    ]);
    expect(said(withDie({ faces: [{ s: ['hit', 'luck'] }, { s: Array(LIMITS.perFace + 1).fill('hit') }, { text: 'Hit' }, 'hit'] }))).toEqual([
      'die good, face 1, symbol 2: Not one of this system\'s symbols',
      `die good, face 2, symbols: A list of up to ${LIMITS.perFace} symbols`,
      'die good, face 3, text: A face has a number and symbols',
      'die good, face 4: Must be a face',
    ]);
    // A die of symbols needs the system's symbols.
    expect(said({ ...HEARTH, symbols: undefined })).toContain('die good, face 3, symbol 1: Not one of this system\'s symbols');
  });

  it('read whole for the rolls: a number or none on each face, its symbols, and a color', () => {
    const [good, bad, fate] = diceOf(HEARTH);
    expect(good).toEqual({ id: 'good', name: 'Good', color: 'theme', faces: [{ n: null, s: [] }, { n: null, s: [] }, { n: null, s: ['hit'] }, { n: null, s: ['hit', 'edge'] }, { n: null, s: ['edge', 'edge'] }, { n: null, s: ['edge'] }] });
    expect(bad.color).toBe('danger');
    expect(fate.faces.map((f) => f.n)).toEqual([1, 1, 0, 0, -1, -1]);
    expect(diceOf({ dice: [{ id: 'one', faces: [{}] }, { id: 'two', faces: [{ n: 'x' }, { s: [3, 'hit'] }] }] })).toEqual([{ id: 'two', name: 'two', color: 'theme', faces: [{ n: null, s: [] }, { n: null, s: ['hit'] }] }]);
  });
});

describe('dice in a .citysys file', () => {
  const file = (definition) => citysys.buildFile({ definition, version: 2, origin: 'sys_abcdefabcdefabcd' });

  it('travel beside the system, so a builder from before them reads a system it knows', () => {
    const built = file(HEARTH);
    expect([built.symbols, built.dice]).toEqual([SYMBOLS, DICE]);
    expect('symbols' in built.definition || 'dice' in built.definition).toBe(false);
    expect(checkDefinition(built.definition).problems).toEqual([]);
  });

  it('go back into the system when installed here, checked with the rest', () => {
    const read = citysys.readFile(JSON.stringify(file(HEARTH)));
    expect([read.file.definition.symbols, read.file.definition.dice]).toEqual([SYMBOLS, DICE]);
    expect(read.problems).toEqual([]);
    const broken = citysys.readFile(JSON.stringify(file(withDie({ faces: [{ s: ['luck'] }, {}] }))));
    expect(broken.problems.map((p) => p.where)).toEqual(['die good, face 1, symbol 1']);
  });

  it('a system without dice has none in its file', () => {
    const built = file({ format: 1, name: 'Plain' });
    expect('symbols' in built || 'dice' in built).toBe(false);
  });

  it('every random system\'s dice pass, and come back from its file as they went in', () => {
    let withDice = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const def = randomSystem(seed);
      if (def.dice) withDice += 1;
      expect(said(def), `seed ${seed}`).toEqual([]);
      expect(citysys.readFile(JSON.stringify(file(def))).file.definition, `seed ${seed}`).toEqual(def);
    }
    expect(withDice).toBeGreaterThan(10);
  });
});

describe('TEST on the DICE tab, the builder route (6c2a)', () => {
  const express_ = require_('express');
  const request_ = require_('supertest');
  const jwt_ = require_('jsonwebtoken');
  const { makeTestDb } = require_('./helpers/testDb.js');
  const systemsRoute = require_('../routes/systems.js');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const GM = () => jwt_.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, process.env.JWT_SECRET);
  const PLAYER = () => jwt_.sign({ username: 'vex', role: 'player' }, process.env.JWT_SECRET);
  let app;
  const post = (body, token = GM()) => request_(app).post('/api/systems/test-dice').set({ Authorization: `Bearer ${token}` }).send(body);

  beforeEach(async () => {
    const db = await makeTestDb();
    app = express_();
    app.use(express_.json());
    app.use('/api/systems', systemsRoute(db));
  });

  it('throws a handful of a draft\'s own die, each face as the log writes it, its symbols counted and cancelled', async () => {
    const res = await post({ definition: HEARTH, dieId: 'good', count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.faces).toHaveLength(5);
    for (const f of res.body.faces) expect(['·', '✶', '✶◆', '◆◆', '◆']).toContain(f);
    expect(Object.keys(res.body.symbols)).toEqual(['counted', 'left']);
    expect(res.body.historyText).toMatch(/^The test rolled Test \[/);
    // Numbers come back signed on a die with any face below 0.
    const fate = await post({ definition: HEARTH, dieId: 'fate', count: 20 });
    for (const f of fate.body.faces) expect(['+1', '0', '-1']).toContain(f);
    expect(fate.body.total).toBe(fate.body.faces.reduce((n, f) => n + Number(f), 0));
  });

  it('throws one to twenty, four when not asked', async () => {
    expect((await post({ definition: HEARTH, dieId: 'good' })).body.faces).toHaveLength(4);
    expect((await post({ definition: HEARTH, dieId: 'good', count: 99 })).body.faces).toHaveLength(20);
    expect((await post({ definition: HEARTH, dieId: 'good', count: 0 })).body.faces).toHaveLength(1);
  });

  it('refuses a die it hasn\'t, dice with problems, and what isn\'t a system', async () => {
    expect((await post({ definition: HEARTH, dieId: 'nope' })).body).toEqual({ error: 'No such die' });
    const broken = await post({ definition: withDie({ faces: [{ s: ['luck'] }, {}] }), dieId: 'good' });
    expect([broken.status, broken.body]).toEqual([400, { error: 'die good, face 1, symbol 1: Not one of this system\'s symbols' }]);
    expect((await post({ definition: 'nope', dieId: 'good' })).status).toBe(400);
  });

  it('is the main admin\'s, as every builder route is', async () => {
    expect((await post({ definition: HEARTH, dieId: 'good' }, PLAYER())).status).toBe(403);
  });
});

describe('a system\'s own dice in the dice menu (6c4a)', () => {
  const express_ = require_('express');
  const request_ = require_('supertest');
  const runtime = require_('../systemBuilder/runtime');
  const systemDiceRoute = require_('../routes/system_dice.js');
  const { makeTestDb, run } = require_('./helpers/testDb.js');
  const { drain, untilValue } = require_('./helpers/until.js');
  const ID = 'sys_dicedicedicedice';
  let db;
  let socketsFactory;

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(HEARTH);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hearth', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    socketsFactory = (await import('../sockets/index.js')).default;
  });

  it('are listed with a game\'s dice, read-only, each face as the log writes it', async () => {
    const app = express_();
    app.use('/api/system_dice', systemDiceRoute());
    const res = await request_(app).get(`/api/system_dice/${ID}`);
    expect(res.body.map((d) => [d.id, d.name, d.sides, d.locked])).toEqual([['own:good', 'Good', 6, true], ['own:bad', 'Bad', 4, true], ['own:fate', 'dF', 6, true], ['own:skull_d6', 'Skull die', 6, true]]);
    expect(res.body[0].faces.map((f) => f.value)).toEqual(['·', '·', '✶', '✶◆', '◆◆', '◆']);
    expect(res.body[2].faces.map((f) => f.value)).toEqual(['+1', '+1', '0', '0', '-1', '-1']);
    expect(res.body[1].color).toBe('danger');
    // A built-in game, or one never published, has none of its own.
    expect((await request_(app).get('/api/system_dice/cwn')).body).toEqual([]);
    expect((await request_(app).get('/api/system_dice/sys_nothingnothingno')).body).toEqual([]);
  });

  it('roll from the menu as a roll of them does: symbols counted and cancelled, numbers summed', async () => {
    const emitted = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: () => {}, recordAction: () => {} });
    const handlers = {};
    connection({ id: `s-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    const rolled = () => emitted.filter((e) => e.event === 'diceRollBroadcast');

    handlers.requestCustomDiceRoll({ userName: 'kes', dieId: 'own:good', count: 3, color: '#00ff00' });
    const good = await untilValue(() => rolled()[0], Boolean, { label: 'the GOOD dice' });
    expect(good.data.historyString).toMatch(/^kes rolled 3×Good \[\S+ \S+ \S+ = (.+|NOTHING LEFT)\]$/);
    expect(good.data.results.Good).toHaveLength(3);
    for (const f of good.data.results.Good) expect(['·', '✶', '✶◆', '◆◆', '◆']).toContain(f);
    // The tray lands each on the face it rolled (6c4b1).
    const [kind] = good.data.throw.dice;
    expect(kind.landed.map((i) => kind.faces[i].text)).toEqual(good.data.results.Good);
    expect(good.data.throw.symbols.map((s) => s.id)).toEqual(['hit', 'edge']);

    // Numbers only: summed, as any roll is.
    handlers.requestCustomDiceRoll({ userName: 'kes', dieId: 'own:fate', count: 4, color: '#00ff00' });
    const fate = await untilValue(() => rolled()[1], Boolean, { label: 'the Fate dice' });
    expect(fate.data.total).toBe(fate.data.results.dF.reduce((n, f) => n + Number(f), 0));
    expect(fate.data.historyString).toMatch(/^kes rolled 4×dF \[(\S+ ){4}= -?\d+\]$/);

    // A die the system doesn't have rolls nothing.
    handlers.requestCustomDiceRoll({ userName: 'kes', dieId: 'own:nope', count: 1, color: '#00ff00' });
    await drain(db);
    expect(rolled()).toHaveLength(2);
  });
});

describe('rolled from the dice menu, exactly (6c4a)', () => {
  const { rollMenuDice } = require_('../systemBuilder/tableRolls');
  // A face by its place among a die's faces (1 for the first) out of how many.
  const faces = (...plan) => { let i = 0; return () => { const [f, of] = plan[i++ % plan.length]; return (f - 1 + 0.5) / of; }; };

  it('counts the symbols of a die that shows any, and sums one that shows numbers only', () => {
    expect(rollMenuDice({ definition: HEARTH, dieId: 'good', count: 2, rng: faces([4, 6], [3, 6]), who: 'K' }).historyText)
      .toBe('K rolled 2×Good [✶◆ ✶ = 2 HIT, 1 EDGE]');
    expect(rollMenuDice({ definition: HEARTH, dieId: 'bad', count: 1, rng: faces([2, 4]), who: 'K' }).historyText)
      .toBe('K rolled 1×Bad [✕ = 1 MISS]');
    const fate = rollMenuDice({ definition: HEARTH, dieId: 'fate', count: 3, rng: faces([1, 6], [3, 6], [5, 6]), who: 'K' });
    expect([fate.historyText, fate.total]).toEqual(['K rolled 3×dF [+1 0 -1 = 0]', 0]);
    expect(rollMenuDice({ definition: HEARTH, dieId: 'nope', count: 1, rng: faces([1, 6]), who: 'K' })).toBeNull();
  });
});
