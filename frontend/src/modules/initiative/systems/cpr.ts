import type { InitiativeSystem } from './index';

const stat = (sheet: any, key: string, fallback: number) =>
  Number(sheet?.[key] ?? sheet?.data?.[key] ?? fallback);

function rollInit(sheet: any) {
  const ref = stat(sheet, 'ref', 5);
  const roll = Math.floor(Math.random() * 10) + 1;
  const score = ref + roll;
  return {
    score,
    breakdown: `REF(${ref}) + 1d10(${roll}) = ${score}`,
    diceResults: { '10': [roll] },
  };
}

export const cpr: InitiativeSystem = {
  key: 'cyberpunk_red',
  counterLabel: 'ROUND',
  passDecay: false,
  rollNpc: rollInit,
  rollPlayer: rollInit,
};
