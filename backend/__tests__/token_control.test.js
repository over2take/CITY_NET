import { describe, it, expect } from 'vitest';

const tokenControl = require('../sockets/tokenControl');

/**
 * Who may move a token.
 *
 * The rule used to be one expression in two socket handlers - an admin, or the player whose
 * name is in `owner` - which left no way to let a player move a friendly NPC at all.
 * A grant adds movers; it never takes the admin's control away, and it never reaches a
 * token whose shape is not meant to carry one.
 */

const friendly = (over = {}) => ({ shape: 'friendly_rhombus', owner: 'SYSTEM', controllers: null, ...over });
const enemy = (over = {}) => ({ shape: 'enemy_rhombus', owner: 'SYSTEM', controllers: null, ...over });
const player = (over = {}) => ({ shape: 'rhombus', owner: 'alice', controllers: null, ...over });

const grant = (g) => JSON.stringify(g);

describe('the admin never loses control', () => {
  it('moves anything, granted or not', () => {
    const admin = { isAdmin: true, userName: 'gm' };
    for (const row of [friendly(), enemy(), player(), friendly({ controllers: grant({ all: false, users: [] }) })]) {
      expect(tokenControl.canMove(row, admin)).toBe(true);
    }
  });

  it('still moves a friendly that has been handed to somebody else', () => {
    // Sharing is not transferring. This is the assertion that says so.
    const row = friendly({ controllers: grant({ all: false, users: ['bob'] }) });
    expect(tokenControl.canMove(row, { isAdmin: true, userName: 'gm' })).toBe(true);
  });
});

describe('an owner still moves their own token', () => {
  it('lets the named owner move it', () => {
    expect(tokenControl.canMove(player(), { userName: 'alice' })).toBe(true);
  });

  it('does not let anyone else', () => {
    expect(tokenControl.canMove(player(), { userName: 'bob' })).toBe(false);
  });

  it('works on an NPC placed under an admin name, as it always did', () => {
    // NPC rows carry whoever placed them rather than a sentinel, which is exactly why the
    // grant needed a column of its own instead of reusing `owner`.
    expect(tokenControl.canMove(friendly({ owner: 'cody' }), { userName: 'cody' })).toBe(true);
  });
});

describe('a friendly NPC can be shared', () => {
  it('lets a named player move it', () => {
    const row = friendly({ controllers: grant({ all: false, users: ['bob'] }) });
    expect(tokenControl.canMove(row, { userName: 'bob' })).toBe(true);
  });

  it('does not let a player who was not named', () => {
    const row = friendly({ controllers: grant({ all: false, users: ['bob'] }) });
    expect(tokenControl.canMove(row, { userName: 'carol' })).toBe(false);
  });

  it('lets everyone when it is opened up', () => {
    const row = friendly({ controllers: grant({ all: true, users: [] }) });
    expect(tokenControl.canMove(row, { userName: 'carol' })).toBe(true);
    expect(tokenControl.canMove(row, { userName: 'dave' })).toBe(true);
  });

  it('takes named players and everyone together', () => {
    // "specific players and/or all players" - the two are not exclusive, and `all` wins.
    const row = friendly({ controllers: grant({ all: true, users: ['bob'] }) });
    expect(tokenControl.canMove(row, { userName: 'bob' })).toBe(true);
    expect(tokenControl.canMove(row, { userName: 'zoe' })).toBe(true);
  });

  it('shuts again when the grant is taken back', () => {
    const row = friendly({ controllers: grant({ all: false, users: [] }) });
    expect(tokenControl.canMove(row, { userName: 'bob' })).toBe(false);
  });
});

describe('the grant reaches friendly NPCs alone', () => {
  it('does nothing on an enemy, however it got there', () => {
    // Enemies stay with the GM. Enforced where the decision is made, so a grant that
    // somehow lands on an enemy row - an import, a restore, a hand-edited db - is inert.
    for (const g of [{ all: true, users: [] }, { all: false, users: ['bob'] }]) {
      expect(tokenControl.canMove(enemy({ controllers: grant(g) }), { userName: 'bob' })).toBe(false);
    }
  });

  it('does nothing on a player token', () => {
    // A player's own rhombus is theirs; sharing it is a different feature nobody asked for.
    const row = player({ controllers: grant({ all: true, users: [] }) });
    expect(tokenControl.canMove(row, { userName: 'bob' })).toBe(false);
  });

  it('says which shapes can carry one', () => {
    expect(tokenControl.GRANTABLE_SHAPES).toEqual(['friendly_rhombus']);
    expect(tokenControl.isGrantable(friendly())).toBe(true);
    expect(tokenControl.isGrantable(enemy())).toBe(false);
    expect(tokenControl.isGrantable(player())).toBe(false);
  });
});

describe('reading a stored grant', () => {
  it('reads nothing as nobody', () => {
    // Every token that existed before this feature.
    for (const raw of [null, undefined, '']) {
      expect(tokenControl.parse(raw)).toEqual({ all: false, users: [] });
    }
  });

  it('fails closed on anything it cannot read', () => {
    // A malformed grant must never open a token up. Storage is free-form JSON on rows
    // that get imported, restored and hand-edited.
    for (const raw of ['not json', '[1,2]', '{"all":', 'null', '42']) {
      expect(tokenControl.parse(raw), String(raw)).toEqual({ all: false, users: [] });
      expect(tokenControl.canMove(friendly({ controllers: raw }), { userName: 'bob' })).toBe(false);
    }
  });

  it('ignores junk inside a list of names', () => {
    const parsed = tokenControl.parse(grant({ all: false, users: ['bob', '', 42, null, '  carol  '] }));
    expect(parsed.users).toEqual(['bob', 'carol']);
  });

  it('treats a missing users list as no names', () => {
    expect(tokenControl.parse(grant({ all: true }))).toEqual({ all: true, users: [] });
  });

  it('only reads `all` as true when it really is', () => {
    // Not truthiness: a stray "false" string must not open the token.
    for (const v of ['false', 'true', 1, 0, null]) {
      expect(tokenControl.parse(grant({ all: v, users: [] })).all, String(v)).toBe(false);
    }
  });

  it('needs a name to match a name', () => {
    const row = friendly({ controllers: grant({ all: false, users: ['bob'] }) });
    expect(tokenControl.canMove(row, {})).toBe(false);
    expect(tokenControl.canMove(row, { userName: '' })).toBe(false);
  });
});

describe('writing a grant back', () => {
  it('stores nothing when nothing is granted', () => {
    // So the common case leaves no JSON behind, and an ungranted token reads exactly like
    // one from before the column existed.
    expect(tokenControl.serialize({ all: false, users: [] })).toBeNull();
    expect(tokenControl.serialize(null)).toBeNull();
  });

  it('round-trips what it stores', () => {
    const stored = tokenControl.serialize({ all: false, users: ['bob', 'carol'] });
    expect(tokenControl.parse(stored)).toEqual({ all: false, users: ['bob', 'carol'] });
  });

  it('names each player once', () => {
    const stored = tokenControl.serialize({ all: false, users: ['bob', 'bob', 'carol'] });
    expect(tokenControl.parse(stored).users).toEqual(['bob', 'carol']);
  });

  it('normalizes on the way in, so what is stored is what will be read', () => {
    const stored = tokenControl.serialize({ all: 'yes', users: ['bob', 99] });
    expect(tokenControl.parse(stored)).toEqual({ all: false, users: ['bob'] });
  });
});

describe('describing a grant for the UI', () => {
  it('reports a friendly as shareable, with who has it', () => {
    const row = friendly({ controllers: grant({ all: false, users: ['bob'] }) });
    expect(tokenControl.describe(row)).toEqual({ grantable: true, all: false, users: ['bob'] });
  });

  it('reports an enemy as not shareable, and names nobody', () => {
    const row = enemy({ controllers: grant({ all: true, users: ['bob'] }) });
    expect(tokenControl.describe(row)).toEqual({ grantable: false, all: false, users: [] });
  });
});
