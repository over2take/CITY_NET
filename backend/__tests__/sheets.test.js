import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import sheetsRouteFactory from '../routes/sheets.js';
import { TEMPLATES, filterPublicData, isValidSystem, getLinkedFields } from '../sheets/templates.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);
// Secure-mode player token: passes authenticate but must NOT reach admin routes
const PLAYER_TOKEN = jwt.sign(
  { username: 'ghost', role: 'player' },
  'test-secret'
);

let db;
let app;
let emitted;

const makeApp = (database) => {
  const application = express();
  application.use(express.json());
  emitted = [];
  const io = { emit: (event, payload) => emitted.push({ event, payload }) };
  application.use('/api/sheets', sheetsRouteFactory(database, io));
  return application;
};

const insertSheet = (database, overrides = {}) => {
  const s = { username: 'GHOST', system: 'cyberpunk_red', data: '{}', is_npc: 0, npc_label: null, ...overrides };
  return run(database,
    `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (?, ?, ?, ?, ?)`,
    [s.username, s.system, s.data, s.is_npc, s.npc_label]
  );
};

const setSystem = (database, system) =>
  run(database, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── Template metadata ────────────────────────────────────────────────────────

describe('sheet template metadata', () => {
  it('knows the shipped systems', () => {
    expect(isValidSystem('generic')).toBe(true);
    expect(isValidSystem('cyberpunk_red')).toBe(true);
    expect(isValidSystem('dnd_hombrew_9000')).toBe(false);
  });

  it('filterPublicData keeps only public fields', () => {
    const data = { handle: 'VIPER', role: 'Rogue', description: 'Ghost of the grid', int: 8, sp_body: 11 };
    const filtered = filterPublicData('cyberpunk_red', data);
    expect(filtered).toEqual({ handle: 'VIPER', role: 'Rogue', description: 'Ghost of the grid' });
  });

  it('filterPublicData never leaks combat fields even if listed public', () => {
    // Defensive: combatFields wins over publicFields by construction
    Object.values(TEMPLATES).forEach(meta => {
      meta.combatFields.forEach(f => {
        const filtered = filterPublicData(
          Object.keys(TEMPLATES).find(k => TEMPLATES[k] === meta),
          { [f]: 99 }
        );
        expect(filtered[f]).toBeUndefined();
      });
    });
  });

  it('filterPublicData tolerates string and object data', () => {
    expect(filterPublicData('cyberpunk_red', '{"handle":"NYX"}')).toEqual({ handle: 'NYX' });
    expect(filterPublicData('cyberpunk_red', null)).toEqual({});
  });

  it('declares hp/hp_max/cash as linked fields on every shipped system', () => {
    Object.keys(TEMPLATES).forEach(system => {
      const linked = getLinkedFields(system);
      expect(linked.hp).toBe('token_hp');
      expect(linked.hp_max).toBe('token_hp_max');
      expect(linked.cash).toBe('bank_balance');
    });
  });
});

// ─── GET /api/sheets/system ───────────────────────────────────────────────────

describe('GET /api/sheets/system', () => {
  it('returns the default system when unset', async () => {
    const res = await request(app).get('/api/sheets/system');
    expect(res.status).toBe(200);
    expect(res.body.system).toBe('generic');
    expect(res.body.systems.map(s => s.id)).toContain('cyberpunk_red');
  });

  it('returns the stored system', async () => {
    await setSystem(db, 'cyberpunk_red');
    const res = await request(app).get('/api/sheets/system');
    expect(res.body.system).toBe('cyberpunk_red');
  });
});

// ─── PUT /api/sheets/system ───────────────────────────────────────────────────

describe('PUT /api/sheets/system', () => {
  it('sets the system and emits gameSystemChanged', async () => {
    const res = await request(app)
      .put('/api/sheets/system')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ system: 'cyberpunk_red' });
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT value FROM global_settings WHERE key = 'game_system'`);
    expect(row.value).toBe('cyberpunk_red');
    expect(emitted.some(e => e.event === 'gameSystemChanged' && e.payload.system === 'cyberpunk_red')).toBe(true);
  });

  it('rejects unknown systems', async () => {
    const res = await request(app)
      .put('/api/sheets/system')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ system: 'calvinball' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated calls', async () => {
    const res = await request(app).put('/api/sheets/system').send({ system: 'generic' });
    expect(res.status).toBe(401);
  });

  it('rejects secure-mode player tokens', async () => {
    const res = await request(app)
      .put('/api/sheets/system')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ system: 'generic' });
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/sheets ──────────────────────────────────────────────────────────

describe('GET /api/sheets (admin list)', () => {
  it('lists player and NPC sheets', async () => {
    await insertSheet(db, { username: 'GHOST' });
    await insertSheet(db, { username: 'admin', is_npc: 1, npc_label: 'Gang Member' });
    const res = await request(app)
      .get('/api/sheets')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const npc = res.body.find(r => r.is_npc === 1);
    expect(npc.npc_label).toBe('Gang Member');
  });

  it('rejects player tokens', async () => {
    const res = await request(app)
      .get('/api/sheets')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/sheets/user/:username ──────────────────────────────────────────

describe('GET /api/sheets/user/:username', () => {
  it('returns the full sheet including combat fields for admin', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'GHOST', data: JSON.stringify({ handle: 'GHOST', sp_body: 11 }) });
    const res = await request(app)
      .get('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sp_body).toBe(11);
  });

  it('404s when the player has no sheet on the active system', async () => {
    await setSystem(db, 'generic');
    await insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red' });
    const res = await request(app)
      .get('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/sheets/user/:username ──────────────────────────────────────────

describe('PUT /api/sheets/user/:username', () => {
  it('merges field patches and emits sheetUpdated', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'GHOST', data: JSON.stringify({ handle: 'GHOST', int: 5 }) });

    const res = await request(app)
      .put('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ fields: { int: 8, ref: 7 } });
    expect(res.status).toBe(200);

    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    const data = JSON.parse(row.data);
    expect(data).toEqual({ handle: 'GHOST', int: 8, ref: 7 });
    expect(emitted.some(e => e.event === 'sheetUpdated' && e.payload.username === 'GHOST')).toBe(true);
  });

  it('never stores linked fields (hp, cash) in the sheet JSON', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'GHOST', data: JSON.stringify({ handle: 'GHOST' }) });

    const res = await request(app)
      .put('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ fields: { hp: 12, hp_max: 40, cash: 9999, int: 6 } });
    expect(res.status).toBe(200);

    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    const data = JSON.parse(row.data);
    expect(data).toEqual({ handle: 'GHOST', int: 6 }); // hp/cash live on token & bank
  });

  it('rejects a missing fields object', async () => {
    const res = await request(app)
      .put('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects player tokens', async () => {
    const res = await request(app)
      .put('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ fields: { int: 10 } });
    expect(res.status).toBe(403);
  });
});

// ─── DB constraints ───────────────────────────────────────────────────────────

describe('character_sheets constraints', () => {
  it('enforces one sheet per player per system', async () => {
    await insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red' });
    await expect(insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red' })).rejects.toThrow();
  });

  it('allows the same player on different systems', async () => {
    await insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red' });
    await insertSheet(db, { username: 'GHOST', system: 'generic' });
    const rows = await all(db, `SELECT * FROM character_sheets WHERE username = 'GHOST'`);
    expect(rows).toHaveLength(2);
  });

  it('allows many NPC sheets under one owner', async () => {
    await insertSheet(db, { username: 'admin', system: 'cyberpunk_red', is_npc: 1, npc_label: 'Gang Member' });
    await insertSheet(db, { username: 'admin', system: 'cyberpunk_red', is_npc: 1, npc_label: 'Fixer' });
    const rows = await all(db, `SELECT * FROM character_sheets WHERE is_npc = 1`);
    expect(rows).toHaveLength(2);
  });
});

// ─── POST /api/sheets/portrait ────────────────────────────────────────────────

describe('POST /api/sheets/portrait', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/sheets/portrait')
      .attach('portrait', Buffer.from('fake-img'), { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('rejects unsupported file extension', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'testadmin', system: 'cyberpunk_red' });
    const res = await request(app)
      .post('/api/sheets/portrait')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('portrait', Buffer.from('fake-img'), { filename: 'p.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
  });

  it('admin uploads portrait for themselves and emits sheetUpdated', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'testadmin', system: 'cyberpunk_red' });
    const res = await request(app)
      .post('/api/sheets/portrait')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('portrait', Buffer.from('fake-png'), { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.portrait_url).toMatch(/^\/uploads\/portraits\/.+\.png$/);
    const evt = emitted.find(e => e.event === 'sheetUpdated');
    expect(evt?.payload.username).toBe('testadmin');
  });

  it('player token uploads own portrait', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'ghost', system: 'cyberpunk_red' });
    const res = await request(app)
      .post('/api/sheets/portrait')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .attach('portrait', Buffer.from('fake-jpg'), { filename: 'me.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.portrait_url).toMatch(/^\/uploads\/portraits\/.+\.jpg$/);
  });

  it('admin uploads portrait for a specific user via ?username=', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red' });
    const res = await request(app)
      .post('/api/sheets/portrait?username=GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('portrait', Buffer.from('fake-webp'), { filename: 'ghost.webp', contentType: 'image/webp' });
    expect(res.status).toBe(200);
    const updated = await get(db, `SELECT portrait_url FROM character_sheets WHERE username = 'GHOST'`);
    expect(updated.portrait_url).toMatch(/\.webp$/);
  });

  it('admin uploads a portrait for an NPC via ?npc_id=', async () => {
    await setSystem(db, 'cyberpunk_red');
    const { lastID } = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('testadmin', 'cyberpunk_red', '{}', 1, 'Gang Member')`);
    const res = await request(app)
      .post(`/api/sheets/portrait?npc_id=${lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('portrait', Buffer.from('fake-png'), { filename: 'npc.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    const updated = await get(db, `SELECT portrait_url FROM character_sheets WHERE id = ?`, [lastID]);
    expect(updated.portrait_url).toMatch(/\.png$/);
  });

  it('npc_id targeting 404s for a missing NPC', async () => {
    const res = await request(app)
      .post('/api/sheets/portrait?npc_id=99999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('portrait', Buffer.from('fake-png'), { filename: 'npc.png', contentType: 'image/png' });
    expect(res.status).toBe(404);
  });
});

// ─── Derived fields (Humanity → EMP) ─────────────────────────────────────────

describe('CP:R Humanity drives EMP', () => {
  it('admin PUT of humanity recomputes emp = floor(humanity/10)', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red', data: JSON.stringify({ emp: 7, emp_max: 7 }) });
    const res = await request(app)
      .put('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ fields: { humanity: 34 } });
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    const data = JSON.parse(row.data);
    expect(data.humanity).toBe(34);
    expect(data.emp).toBe(3);
  });

  it('non-derived fields leave emp alone', async () => {
    await setSystem(db, 'cyberpunk_red');
    await insertSheet(db, { username: 'GHOST', system: 'cyberpunk_red', data: JSON.stringify({ emp: 7 }) });
    await request(app)
      .put('/api/sheets/user/GHOST')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ fields: { cool: 5 } });
    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(row.data).emp).toBe(7);
  });
});
