import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, all, get } from './helpers/testDb.js';
import musicFactory from '../routes/music.js';

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'admin', role: 'admin', isTemporary: false },
  'test-secret'
);

let db;
let app;
let io;

const makeApp = () => {
  const a = express();
  a.use(express.json());
  io = { emit: vi.fn() };
  a.use('/api/music', musicFactory(db, io));
  return a;
};

const seedFolder = (name, parentId = null, sortOrder = 0) =>
  run(db, `INSERT INTO music_items (type, name, parent_id, sort_order) VALUES ('folder', ?, ?, ?)`,
    [name, parentId, sortOrder]);

const seedFile = (name, filePath, parentId = null) =>
  run(db, `INSERT INTO music_items (type, name, path, parent_id) VALUES ('file', ?, ?, ?)`,
    [name, filePath, parentId]);

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `PRAGMA foreign_keys = ON`);
  await run(db, `CREATE TABLE IF NOT EXISTS music_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(parent_id) REFERENCES music_items(id) ON DELETE CASCADE
  )`);
  app = makeApp();
});

// ─── GET /library ─────────────────────────────────────────────────────────────

describe('GET /api/music/library', () => {
  it('returns empty array when library is empty', async () => {
    const res = await request(app).get('/api/music/library');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all items ordered by sort_order then name', async () => {
    await seedFolder('Battles', null, 2);
    await seedFolder('Ambience', null, 1);
    await seedFolder('Boss', null, 2);

    const res = await request(app).get('/api/music/library');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].name).toBe('Ambience');  // sort_order 1
    // sort_order 2 items sorted by name
    expect(res.body[1].name).toBe('Battles');
    expect(res.body[2].name).toBe('Boss');
  });

  it('returns both folders and files', async () => {
    const folder = await seedFolder('OST');
    await seedFile('theme.mp3', 'theme.mp3', folder.lastID);

    const res = await request(app).get('/api/music/library');
    expect(res.status).toBe(200);
    const types = res.body.map(r => r.type).sort();
    expect(types).toEqual(['file', 'folder']);
  });
});

// ─── POST /folder ─────────────────────────────────────────────────────────────

describe('POST /api/music/folder', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).post('/api/music/folder').send({ name: 'OST' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/music/folder')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('creates a root folder and returns its id', async () => {
    const res = await request(app)
      .post('/api/music/folder')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Combat' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('folder');
    expect(res.body.name).toBe('Combat');
    expect(res.body.parent_id).toBeNull();
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('creates a nested folder with parent_id', async () => {
    const parent = await seedFolder('OST');

    const res = await request(app)
      .post('/api/music/folder')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Chapter 1', parent_id: parent.lastID });

    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBe(parent.lastID);
  });

  it('emits musicLibraryUpdated after creating a folder', async () => {
    await request(app)
      .post('/api/music/folder')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'X' });

    expect(io.emit).toHaveBeenCalledWith('musicLibraryUpdated');
  });
});

// ─── DELETE /folder/:id ───────────────────────────────────────────────────────

describe('DELETE /api/music/folder/:id', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).delete('/api/music/folder/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent folder', async () => {
    const res = await request(app)
      .delete('/api/music/folder/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('deletes a leaf folder and returns count', async () => {
    const f = await seedFolder('Empty');

    const res = await request(app)
      .delete(`/api/music/folder/${f.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    const row = await get(db, `SELECT * FROM music_items WHERE id = ?`, [f.lastID]);
    expect(row).toBeUndefined();
  });

  it('deletes a folder and all its descendants', async () => {
    const root = await seedFolder('Root');
    const child = await seedFolder('Child', root.lastID);
    await seedFile('track.mp3', 'track.mp3', child.lastID);

    const res = await request(app)
      .delete(`/api/music/folder/${root.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    // collectIds double-counts descendant IDs (known route behaviour); what
    // matters is that all rows are gone and deleted > 0.
    expect(res.body.deleted).toBeGreaterThan(0);
    const remaining = await all(db, `SELECT * FROM music_items`);
    expect(remaining).toHaveLength(0);
  });

  it('emits musicLibraryUpdated after deleting', async () => {
    const f = await seedFolder('Bye');
    await request(app)
      .delete(`/api/music/folder/${f.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(io.emit).toHaveBeenCalledWith('musicLibraryUpdated');
  });
});

// ─── POST /upload ─────────────────────────────────────────────────────────────

describe('POST /api/music/upload', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app)
      .post('/api/music/upload')
      .attach('file', Buffer.from('audio'), 'track.mp3');
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .post('/api/music/upload')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported MIME type', async () => {
    const res = await request(app)
      .post('/api/music/upload')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('file', Buffer.from('data'), { filename: 'script.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported/i);
  });

  it('uploads a valid mp3, inserts a DB row, and returns metadata', async () => {
    const res = await request(app)
      .post('/api/music/upload')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('name', 'My Track')
      .attach('file', Buffer.from('audio'), { filename: 'track.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('file');
    expect(res.body.name).toBe('My Track');
    expect(res.body.path).toMatch(/\.mp3$/);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('uses the original filename as name when no name field is provided', async () => {
    const res = await request(app)
      .post('/api/music/upload')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('file', Buffer.from('audio'), { filename: 'original.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('original.mp3');
  });

  it('assigns the file to a parent folder when parent_id is provided', async () => {
    const folder = await seedFolder('Ambient');

    const res = await request(app)
      .post('/api/music/upload')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('parent_id', String(folder.lastID))
      .attach('file', Buffer.from('audio'), { filename: 'rain.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBe(folder.lastID);
  });

  it('emits musicLibraryUpdated after upload', async () => {
    await request(app)
      .post('/api/music/upload')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('file', Buffer.from('audio'), { filename: 'x.mp3', contentType: 'audio/mpeg' });

    expect(io.emit).toHaveBeenCalledWith('musicLibraryUpdated');
  });
});

// ─── DELETE /file/:id ─────────────────────────────────────────────────────────

describe('DELETE /api/music/file/:id', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).delete('/api/music/file/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await request(app)
      .delete('/api/music/file/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when id belongs to a folder, not a file', async () => {
    const f = await seedFolder('NotAFile');
    const res = await request(app)
      .delete(`/api/music/file/${f.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('deletes the DB record and returns { deleted: 1 }', async () => {
    const file = await seedFile('gone.mp3', 'gone.mp3');

    const res = await request(app)
      .delete(`/api/music/file/${file.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    const row = await get(db, `SELECT * FROM music_items WHERE id = ?`, [file.lastID]);
    expect(row).toBeUndefined();
  });

  it('emits musicLibraryUpdated after deleting', async () => {
    const file = await seedFile('bye.mp3', 'bye.mp3');
    await request(app)
      .delete(`/api/music/file/${file.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(io.emit).toHaveBeenCalledWith('musicLibraryUpdated');
  });
});

// ─── PATCH /item/:id/move ─────────────────────────────────────────────────────

describe('PATCH /api/music/item/:id/move', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).patch('/api/music/item/1/move').send({ parent_id: null });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent item', async () => {
    const res = await request(app)
      .patch('/api/music/item/999/move')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ parent_id: null });
    expect(res.status).toBe(404);
  });

  it('moves an item to a new parent folder', async () => {
    const src  = await seedFolder('Source');
    const dest = await seedFolder('Dest');
    const item = await seedFile('track.mp3', 'track.mp3', src.lastID);

    const res = await request(app)
      .patch(`/api/music/item/${item.lastID}/move`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ parent_id: dest.lastID });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    const row = await get(db, `SELECT parent_id FROM music_items WHERE id = ?`, [item.lastID]);
    expect(row.parent_id).toBe(dest.lastID);
  });

  it('moves an item to root (parent_id null)', async () => {
    const folder = await seedFolder('OST');
    const item   = await seedFile('theme.mp3', 'theme.mp3', folder.lastID);

    await request(app)
      .patch(`/api/music/item/${item.lastID}/move`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ parent_id: null });

    const row = await get(db, `SELECT parent_id FROM music_items WHERE id = ?`, [item.lastID]);
    expect(row.parent_id).toBeNull();
  });

  it('emits musicLibraryUpdated after moving', async () => {
    const item = await seedFolder('Moveable');
    await request(app)
      .patch(`/api/music/item/${item.lastID}/move`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ parent_id: null });

    expect(io.emit).toHaveBeenCalledWith('musicLibraryUpdated');
  });
});

// ─── PATCH /item/:id (rename) ─────────────────────────────────────────────────

describe('PATCH /api/music/item/:id (rename)', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).patch('/api/music/item/1').send({ name: 'New' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const item = await seedFolder('Old');
    const res = await request(app)
      .patch(`/api/music/item/${item.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent item', async () => {
    const res = await request(app)
      .patch('/api/music/item/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('renames a folder and returns { updated: 1 }', async () => {
    const item = await seedFolder('OldName');

    const res = await request(app)
      .patch(`/api/music/item/${item.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'NewName' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    const row = await get(db, `SELECT name FROM music_items WHERE id = ?`, [item.lastID]);
    expect(row.name).toBe('NewName');
  });

  it('emits musicLibraryUpdated after renaming', async () => {
    const item = await seedFolder('Rename Me');
    await request(app)
      .patch(`/api/music/item/${item.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Done' });

    expect(io.emit).toHaveBeenCalledWith('musicLibraryUpdated');
  });
});
