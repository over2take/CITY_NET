import type { InitiativeSystem } from './index';
import { cryptoRng } from './random';

function rollD20() {
  const roll = Math.floor(cryptoRng() * 20) + 1;
  return { score: roll, breakdown: `1d20(${roll}) = ${roll}`, diceResults: { '20': [roll] } };
}

export const generic: InitiativeSystem = {
  key: 'generic',
  counterLabel: 'TURN',
  passDecay: false,
  rollNpc: rollD20,
  rollPlayer: rollD20,
};
