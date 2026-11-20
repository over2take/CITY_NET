import type { InitiativeSystem } from './index';
import { cryptoRng } from './random';

function rollD20() {
  const roll = Math.floor(cryptoRng() * 20) + 1;
  return { score: roll, breakdown: `1d20(${roll}) = ${roll}`, diceResults: { '20': [roll] } };
}

export const generic: InitiativeSystem = {
  key: 'generic',
  // It counts laps of the order: rounds (8a8, by the turn and round agreed 2026-11-19).
  counterLabel: 'ROUND',
  passDecay: false,
  rollNpc: rollD20,
  rollPlayer: rollD20,
};
