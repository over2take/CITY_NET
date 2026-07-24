import type { InitiativeSystem } from './index';

function rollD20() {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { score: roll, breakdown: `1d20(${roll}) = ${roll}`, diceResults: { '20': [roll] } };
}

export const generic: InitiativeSystem = {
  key: 'generic',
  counterLabel: 'TURN',
  passDecay: false,
  rollNpc: rollD20,
  rollPlayer: rollD20,
};
