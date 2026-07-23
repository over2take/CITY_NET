import { generic } from './generic';
import { sr6 } from './sr6';

export interface RollResult {
  score: number;
  breakdown: string;
  /** Dice to display in the tray — key is sides (as string), value is array of individual rolls */
  diceResults: Record<string, number[]>;
}

export interface InitiativeSystem {
  key: string;
  counterLabel: string;
  passDecay: boolean;
  rollNpc(sheet?: any): RollResult;
  rollPlayer(sheet?: any, extraDice?: number): RollResult;
}

const SYSTEMS: Record<string, InitiativeSystem> = {
  generic,
  shadowrun_6e: sr6,
};

export function getInitiativeSystem(key: string): InitiativeSystem {
  return SYSTEMS[key] ?? generic;
}
