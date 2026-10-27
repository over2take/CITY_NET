import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  SEEN_LEVELS, systemSeen, rollSeen, withSystemSeen, withRollSeen, previewOf, exampleRoll, HIDDEN, HIDES, type Seen,
} from '../targetSeen';
import { withRollAgainst } from '../rolls';
import type { Definition } from '../systemsApi';

/**
 * The builder's side of who sees a roll's target (6c4h): the three settings, a roll's own over the
 * system's, and the examples that show them, held to the server's own engine so an example can't
 * promise what the table won't do.
 */

const req = createRequire(import.meta.url);
const { SEEN, checkRoll } = req('../../../../backend/systemBuilder/rollStyles.js');
const { rollField, HIDDEN: SERVER_HIDDEN } = req('../../../../backend/systemBuilder/tableRolls.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const STEALTH = { id: 'stealth', label: 'Stealth', dice: [{ count: '1', sides: 20, name: 'Luck' }], add: '3', against: '12', by: ['sneak'],
  effects: [{ name: 'Luck', face: 17, when: 'success', label: 'Silent' }] };
const SYSTEM: Definition = { format: 1, name: 'Neon', stats: [{ id: 'skills', label: 'Skills', stats: [{ id: 'sneak', label: 'Sneak' }] }], rolls: [STEALTH] };
const problems = (def: Definition) => checkDefinition(def).problems;

/** What the server sends for STEALTH on a d20 of `face` at `seen`: the GM's words after the dice, and the players'. */
const server = (seen: Seen, face: number) => {
  const made = rollField({ definition: { ...SYSTEM, target_seen: seen }, data: {}, fieldId: 'sneak', rng: () => (face - 0.5) / 20, who: 'KES' });
  const said = (line: string) => (line.includes(' — ') ? line.slice(line.indexOf(' — ')) : '');
  return { gm: said(made.historyText), player: said(made.players ? made.players.historyText : made.historyText) };
};
const said = (line: string) => (line.includes(' — ') ? line.slice(line.indexOf(' — ')) : '');

describe('the settings', () => {
  it('are the server\'s three, in its order', () => {
    expect(SEEN_LEVELS.map((l) => l.id)).toEqual(SEEN);
    expect(HIDDEN).toBe(SERVER_HIDDEN);
  });

  it('a system without one is SHOWN, as one made before the setting is; a roll\'s own wins', () => {
    expect(systemSeen(SYSTEM)).toBe('shown');
    expect(systemSeen({ ...SYSTEM, target_seen: 'gm' })).toBe('gm');
    expect(systemSeen({ ...SYSTEM, target_seen: 'nonsense' })).toBe('shown');
    expect(rollSeen({ ...SYSTEM, target_seen: 'gm' }, STEALTH)).toBe('gm');
    expect(rollSeen({ ...SYSTEM, target_seen: 'gm' }, { ...STEALTH, seen: 'shown' })).toBe('shown');
  });

  it('are set for the system and for one roll, and a roll can go back to the system\'s, all as the server accepts', () => {
    const gm = withSystemSeen(SYSTEM, 'gm');
    expect(gm.target_seen).toBe('gm');
    const own = withRollSeen(gm, 'stealth', 'verdict');
    expect((own.rolls as { seen?: string }[])[0].seen).toBe('verdict');
    expect(problems(own)).toEqual([]);
    const back = withRollSeen(own, 'stealth', null);
    expect((back.rolls as object[])[0]).toEqual(STEALTH);
    expect(problems(back)).toEqual([]);
  });

  it('a roll\'s own goes with its target: clearing AGAINST leaves nothing the server would refuse', () => {
    const own = withRollSeen(SYSTEM, 'stealth', 'gm');
    const cleared = withRollAgainst(own, 'stealth', '');
    expect((cleared.rolls as { seen?: string; against?: string }[])[0]).not.toHaveProperty('seen');
    expect(problems(cleared)).toEqual([]);
    // As the server would have it otherwise.
    const noTarget: Record<string, unknown> = { ...STEALTH, seen: 'gm' };
    delete noTarget.against;
    expect(checkRoll(noTarget).map((p: { message: string }) => p.message)).toContain('Who sees the target needs a target');
  });
});

describe('the examples, held to the server', () => {
  it('the preview under a choice says what the server would, for each setting', () => {
    for (const seen of SEEN as Seen[]) {
      const preview = previewOf(seen);
      // The server's words for a success, 9 + 3 against 12, a face that brings no effect, as the preview has none.
      const sent = server(seen, 9);
      expect(said(preview.player), seen).toBe(sent.player);
      expect(said(preview.gm), seen).toBe(sent.gm);
    }
  });

  it('HELP\'s STEALTH roll says what the server would, success and failure, at every setting', () => {
    for (const seen of SEEN as Seen[]) {
      for (const face of [17, 3]) {
        const made = exampleRoll(seen, face);
        const sent = server(seen, face);
        expect(said(made.player.line), `${seen} ${face}`).toBe(sent.player);
        expect(said(made.gm.line), `${seen} ${face}`).toBe(sent.gm);
        expect(made.total).toBe(face + 3);
      }
    }
  });

  it('draws two lines of 16 for each tray, the verdict on the player\'s only where they may see it', () => {
    for (const seen of SEEN as Seen[]) {
      const made = exampleRoll(seen, 17);
      for (const b of [made.player.board, made.gm.board]) expect(b.map((l) => l.length)).toEqual([16, 16]);
      expect(made.gm.board).toEqual(['STEALTH       20', 'VS 12 SUCCESS   ']);
    }
    expect(exampleRoll('shown', 17).player.board[1]).toBe('VS 12 SUCCESS   ');
    expect(exampleRoll('verdict', 17).player.board[1]).toBe('SUCCESS         ');
    expect(exampleRoll('gm', 17).player.board[1].trim()).toBe('');
  });

  it('the table of what each setting keeps agrees with the examples', () => {
    const row = (what: string) => HIDES.find((h) => h.what.startsWith(what))!.seen;
    for (const seen of SEEN as Seen[]) {
      const player = exampleRoll(seen, 17).player.line;
      expect(player.includes('vs 12'), seen).toBe(row('The target')[seen]);
      expect(player.includes('SUCCESS'), seen).toBe(row('SUCCESS or FAILURE')[seen]);
      expect(player.includes('SILENT'), seen).toBe(row('Effects')[seen]);
    }
  });
});
