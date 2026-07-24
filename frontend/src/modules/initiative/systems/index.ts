import { generic } from './generic';
import { sr6 } from './sr6';
import { cpr } from './cpr';
import { cwn } from './cwn';

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
  /** Default initiative mode for this system. Individual mode if omitted. */
  defaultMode?: 'individual' | 'side';
  rollNpc(sheet?: any, options?: RollOptions): RollResult;
  rollPlayer(sheet?: any, options?: RollOptions): RollResult;
}

const SYSTEMS: Record<string, InitiativeSystem> = {
  generic,
  shadowrun_6e: sr6,
  cyberpunk_red: cpr,
  cities_without_number: cwn,
};

export function getInitiativeSystem(key: string): InitiativeSystem {
  return SYSTEMS[key] ?? generic;
}
