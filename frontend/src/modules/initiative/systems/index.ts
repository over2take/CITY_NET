import { generic } from './generic';
import { sr6 } from './sr6';
import { cpr } from './cpr';

export interface RollResult {
  score: number;
  breakdown: string;
  /** Dice to display in the tray — key is sides (as string), value is array of individual rolls */
  diceResults: Record<string, number[]>;
  /** True when an exploding die triggered at least one extra roll */
  exploded?: boolean;
}

export interface RollOptions {
  extraDice?: number;
  explodingInitiative?: boolean;
}

export interface InitiativeSystem {
  key: string;
  counterLabel: string;
  passDecay: boolean;
  rollNpc(sheet?: any, options?: RollOptions): RollResult;
  rollPlayer(sheet?: any, options?: RollOptions): RollResult;
}

const SYSTEMS: Record<string, InitiativeSystem> = {
  generic,
  shadowrun_6e: sr6,
  cyberpunk_red: cpr,
};

export function getInitiativeSystem(key: string): InitiativeSystem {
  return SYSTEMS[key] ?? generic;
}
