import { describe, it, expect } from 'vitest';
import { canMoveToken, parseGrant, describeGrant, isGrantable, GRANTABLE_SHAPES } from '../tokenControl';

/**
 * The client's copy of the movement rule.
 *
 * The server is authoritative and checks this on every move; this side exists so the map
 * does not offer a drag that would be silently refused. The first block is what makes
 * mirroring safe - it walks the same rows through both copies and fails here if they ever
 * disagree, rather than in somebody's game.
 */

const friendly = (over = {}) => ({ shape: 'friendly_rhombus', owner: 'SYSTEM', controllers: null, ...over });
const enemy = (over = {}) => ({ shape: 'enemy_rhombus', owner: 'SYSTEM', controllers: null, ...over });
const player = (over = {}) => ({ shape: 'rhombus', owner: 'alice', controllers: null, ...over });
const grant = (g: unknown) => JSON.stringify(g);

describe('the mirror agrees with the server', () => {
  const ROWS = [
    friendly(),
    friendly({ controllers: grant({ all: false, users: ['bob'] }) }),
    friendly({ controllers: grant({ all: true, users: [] }) }),
    friendly({ controllers: grant({ all: true, users: ['bob'] }) }),
    friendly({ controllers: 'not json' }),
    friendly({ controllers: '[1,2]' }),
    friendly({ owner: 'cody' }),
    enemy({ controllers: grant({ all: true, users: ['bob'] }) }),
    player({ controllers: grant({ all: true, users: [] }) }),
  ];
  const VIEWERS = [
    { isAdmin: true, userName: 'gm' },
    { userName: 'alice' },
    { userName: 'bob' },
    { userName: 'carol' },
    { userName: 'cody' },
    {},
  ];

  it('answers every row the same way for every viewer', async () => {
    const backend = await import('../../../../backend/sockets/tokenControl.js');
    for (const row of ROWS) {
      for (const viewer of VIEWERS) {
        const label = `${row.shape} ${String(row.controllers)} / ${viewer.userName ?? 'anon'}`;
        expect(canMoveToken(row, viewer), label).toBe(backend.canMove(row, viewer));
      }
    }
  });

  it('reads a stored grant the same way', async () => {
    const backend = await import('../../../../backend/sockets/tokenControl.js');
    for (const raw of [null, undefined, '', 'not json', '[1,2]', '42',
      grant({ all: true }), grant({ all: 'yes', users: ['bob', 42, ' carol '] })]) {
      expect(parseGrant(raw), String(raw)).toEqual(backend.parse(raw));
    }
  });

  it('agrees on which shapes can carry a grant', async () => {
    const backend = await import('../../../../backend/sockets/tokenControl.js');
    expect(GRANTABLE_SHAPES).toEqual(backend.GRANTABLE_SHAPES);
  });
});

describe('what the map will let you drag', () => {
  it('lets an admin drag anything', () => {
    for (const row of [friendly(), enemy(), player()]) {
      expect(canMoveToken(row, { isAdmin: true, userName: 'gm' })).toBe(true);
    }
  });

  it('lets a named player drag a shared friendly', () => {
    expect(canMoveToken(friendly({ controllers: grant({ all: false, users: ['bob'] }) }), { userName: 'bob' })).toBe(true);
  });

  it('does not let them drag an enemy that somehow carries a grant', () => {
    expect(canMoveToken(enemy({ controllers: grant({ all: true, users: [] }) }), { userName: 'bob' })).toBe(false);
  });

  it('fails closed on an unreadable grant', () => {
    // Offering a drag the server would refuse is worse than not offering it.
    expect(canMoveToken(friendly({ controllers: '{oops' }), { userName: 'bob' })).toBe(false);
  });

  it('still lets a player drag their own token', () => {
    expect(canMoveToken(player(), { userName: 'alice' })).toBe(true);
    expect(canMoveToken(player(), { userName: 'bob' })).toBe(false);
  });

  it('handles a viewer with no name at all', () => {
    expect(canMoveToken(friendly({ controllers: grant({ all: false, users: ['bob'] }) }), {})).toBe(false);
    // Open to everyone still means everyone, including a spectator with no name.
    expect(canMoveToken(friendly({ controllers: grant({ all: true, users: [] }) }), {})).toBe(true);
  });
});

describe('the line the admin panel shows', () => {
  it('says nobody when nobody is named', () => {
    expect(describeGrant(friendly())).toBe('NOBODY — admin only');
  });

  it('names the players who have it', () => {
    expect(describeGrant(friendly({ controllers: grant({ all: false, users: ['bob', 'carol'] }) })))
      .toBe('bob, carol');
  });

  it('says all players when it is open', () => {
    expect(describeGrant(friendly({ controllers: grant({ all: true, users: [] }) }))).toBe('ALL PLAYERS');
  });

  it('mentions both when both are set', () => {
    expect(describeGrant(friendly({ controllers: grant({ all: true, users: ['bob'] }) })))
      .toBe('ALL PLAYERS (+1 named)');
  });

  it('explains why an enemy cannot be shared', () => {
    expect(describeGrant(enemy())).toBe('Only friendly NPCs can be shared.');
  });
});

describe('isGrantable', () => {
  it('is friendly NPCs and nothing else', () => {
    expect(isGrantable(friendly())).toBe(true);
    expect(isGrantable(enemy())).toBe(false);
    expect(isGrantable(player())).toBe(false);
    expect(isGrantable(null)).toBe(false);
    expect(isGrantable({})).toBe(false);
  });
});
