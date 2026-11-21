// A condition's EACH TURN at the tracker (8a9c; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19): what
// round 1's BEGIN, an NPC's ROLL and the WAITING ON line show; and on the sheet, under the HP box, the rolls asked of its
// token (8a9c2). The asks come from the server (backend sockets/turnAsks.js):
// every one for the GM, a player's own for them.

import type { EachTurn } from './conditions';

/** A roll waiting on someone (backend tokens/turnEffects.js asksFor). */
export interface TurnAsk {
  id: number;
  sceneKey: string;
  locationId: number;
  /** The player asked, or null for an NPC's (the GM's to roll). */
  player: string | null;
  /** Its name as the log says it: KES, or GANGER (NPC). */
  who: string;
  condition: { id: string; name: string; short?: string; icon?: string };
  /** The effect's name as the log says it: POISONED SAVE. */
  named: string;
  /** What it is in a line: POISONED SAVE, END OF ITS TURN: d20 + @con_mod, 13 or more ends it. */
  says: string;
  moment: string;
  /** What it does each turn, as the system has it. */
  effect: EachTurn;
  /** What it rolls in the asked one's words (8a9c2): End of your turn: d20 + Con mod, 13 or more ends it. */
  yours: string;
  /** The asker's own (YOUR SAVE), not one the GM sees on a player's sheet (KES'S SAVE). */
  mine: boolean;
}

/** An NPC's asks to roll from its row: this scene's, for this row's token. */
export const npcAsksOn = (asks: TurnAsk[], combatantId: string, sceneKey: string | null): TurnAsk[] =>
  asks.filter((a) => !a.player && a.sceneKey === sceneKey && `npc:${a.locationId}` === combatantId);

/** WAITING ON KES'S POISONED SAVE: this scene's asks of players, beside NEXT; null with none. NEXT never waits on them. */
export const waitingLine = (asks: TurnAsk[], sceneKey: string | null): string | null => {
  const waiting = asks.filter((a) => a.player && a.sceneKey === sceneKey).map((a) => `${a.who}'S ${a.named}`);
  return waiting.length ? `WAITING ON ${waiting.join(', ')}` : null;
};

/** What round 1's BEGIN needs to know of the tracker's state. */
export interface BeginState { begun?: boolean; turnEffects?: boolean; newRound?: boolean }

/**
 * Whether the tracker offers BEGIN in NEXT's place: only where the game's conditions act on turns (backend
 * systemBuilder/conditions.js onTurns), until the round has begun; Shadowrun's everyone-rolls-again shows CLEAR first.
 * Elsewhere NEXT starts the round as it always has.
 */
export const beginOffered = (state: BeginState | null | undefined): boolean =>
  !!state && state.turnEffects === true && state.begun === false && !state.newRound;

/** The rolls waiting on a token's sheet (8a9c2): this token's, in the order asked. */
export const asksOnToken = (asks: TurnAsk[], tokenId: number | null | undefined): TurnAsk[] =>
  asks.filter((a) => a.locationId === tokenId);

/** A save, or any other roll. */
const isSave = (a: TurnAsk) => a.effect?.does === 'roll_to_end';

/** POISONED · YOUR SAVE; on a player's sheet as the GM sees it, POISONED · KES'S SAVE. */
export const askHeading = (a: TurnAsk): string =>
  `${a.condition.name.toUpperCase()} · ${a.mine ? 'YOUR' : `${a.who}'S`} ${isSave(a) ? 'SAVE' : 'ROLL'}`;

/** ROLL SAVE for a save, ROLL for the rest. */
export const askButton = (a: TurnAsk): string => (isSave(a) ? 'ROLL SAVE' : 'ROLL');
