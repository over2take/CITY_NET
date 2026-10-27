import type { Definition } from './systemsApi';

// How much of a roll's target players see (6c4h; approved mockup docs/mockups/players-see-target.html,
// 2026-10-24): set for the whole system at the top of the ROLLS tab, and for one roll in its step 3.
// The server decides what each person is sent (backend systemBuilder/tableRolls.js, utils/rollSeen.js);
// this is the builder's side: the choices, their words, and the examples that show what they mean.

export type Seen = 'shown' | 'verdict' | 'gm';

/** The three, in order, with the line under each choice and in its "?". */
export const SEEN_LEVELS: { id: Seen; label: string; line: string }[] = [
  { id: 'shown', label: 'SHOWN', line: 'Players see the target and the verdict: "vs 12: SUCCESS".' },
  { id: 'verdict', label: 'VERDICT ONLY', line: 'Players see SUCCESS or FAILURE, never the number.' },
  { id: 'gm', label: 'GM ONLY', line: 'Players see their total and nothing about the target; you see it all.' },
];

const isSeen = (v: unknown): v is Seen => SEEN_LEVELS.some((l) => l.id === v);
export const seenLabel = (seen: Seen) => SEEN_LEVELS.find((l) => l.id === seen)!.label;
export const seenLine = (seen: Seen) => SEEN_LEVELS.find((l) => l.id === seen)!.line;

/** The system's: SHOWN where it has none, as a system made before the setting has (a new one is made GM ONLY). */
export const systemSeen = (def: Definition): Seen => (isSeen(def.target_seen) ? def.target_seen : 'shown');

/** A roll's own, or the system's. */
export const rollSeen = (def: Definition, roll: { seen?: unknown }): Seen => (isSeen(roll.seen) ? roll.seen : systemSeen(def));

/** The system's setting changed. */
export const withSystemSeen = (def: Definition, seen: Seen): Definition => ({ ...def, target_seen: seen });

/** One roll's own setting, or none (null) to follow the system's. */
export const withRollSeen = (def: Definition, id: string, seen: Seen | null): Definition => ({
  ...def,
  rolls: (Array.isArray(def.rolls) ? def.rolls : []).map((r: { id?: string; seen?: Seen }) => {
    if (!r || r.id !== id) return r;
    const rest = { ...r };
    delete rest.seen;
    return seen ? { ...rest, seen } : rest;
  }),
});

/** Said on the GM's line when players were kept from some of it (backend tableRolls.js HIDDEN). */
export const HIDDEN = ' · HIDDEN FROM PLAYERS';

/**
 * The live example under a choice: a roll of 15 against 12, as a player and as the GM read it.
 * The same words the server writes, so the example can't promise what the table won't do.
 */
export const previewOf = (seen: Seen) => ({
  player: seen === 'shown' ? 'STEALTH 15 — vs 12: SUCCESS' : seen === 'verdict' ? 'STEALTH 15 — SUCCESS' : 'STEALTH 15',
  gm: `STEALTH 15 — vs 12: SUCCESS${seen === 'shown' ? '' : HIDDEN}`,
});

/** The tray's board is 16 characters a line. */
const BOARD = 16;
const fit = (s: string) => s.slice(0, BOARD).padEnd(BOARD, ' ');

/**
 * HELP's WHO SEES THE TARGET (6c4h): KES rolls STEALTH, d20 + 3, against 12; a success also brings
 * the roll's effect SILENT, which says the verdict as plainly as SUCCESS does. What a player and the
 * GM see on the tray's board (two lines of 16) and in the history, at `seen`, for a d20 of `d20`.
 */
export const exampleRoll = (seen: Seen, d20: number) => {
  const total = d20 + 3;
  const verdict = total >= 12 ? 'SUCCESS' : 'FAILURE';
  const effect = verdict === 'SUCCESS' ? ' · SILENT' : '';
  const work = `KES rolled STEALTH [d20 (${d20}) + 3 = ${total}]`;
  const top = fit(`STEALTH${String(total).padStart(BOARD - 'STEALTH'.length)}`);
  const gm = { board: [top, fit(`VS 12 ${verdict}`)], line: `${work} — vs 12: ${verdict}${effect}${seen === 'shown' ? '' : HIDDEN}` };
  const player = seen === 'shown' ? { board: gm.board, line: `${work} — vs 12: ${verdict}${effect}` }
    : seen === 'verdict' ? { board: [top, fit(verdict)], line: `${work} — ${verdict}${effect}` }
      : { board: [top, fit('')], line: work };
  return { total, verdict, player, gm };
};

/** What each setting keeps from players, row by row, for HELP's table. */
export const HIDES: { what: string; seen: Record<Seen, boolean> }[] = [
  { what: 'The dice and the total', seen: { shown: true, verdict: true, gm: true } },
  { what: 'The target ("vs 12")', seen: { shown: true, verdict: false, gm: false } },
  { what: 'SUCCESS or FAILURE', seen: { shown: true, verdict: true, gm: false } },
  { what: 'Effects that come only on a success or a failure', seen: { shown: true, verdict: true, gm: false } },
  { what: 'Bands (MISS, A COST, A HIT): words for the total alone', seen: { shown: true, verdict: true, gm: true } },
  { what: 'Naturals, matches, a glitch: what the dice themselves show', seen: { shown: true, verdict: true, gm: true } },
];
