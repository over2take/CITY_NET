// A condition's EACH TURN at the tracker (8a9c; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19): what
// round 1's BEGIN, an NPC's ROLL and the WAITING ON line show. The asks come from the server (backend sockets/turnAsks.js):
// every one for the GM, a player's own for them.

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
