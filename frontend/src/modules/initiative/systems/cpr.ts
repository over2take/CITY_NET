import type { InitiativeSystem } from './index';

const stat = (sheet: any, key: string, fallback: number) =>
  Number(sheet?.[key] ?? sheet?.data?.[key] ?? fallback);

export const cpr: InitiativeSystem = {
  key: 'cyberpunk_red',
  counterLabel: 'ROUND',
  passDecay: false,

  rollNpc(sheet) {
    const ref = stat(sheet, 'ref', 5);
    const base = Math.ceil(ref / 2);
    const roll = Math.floor(Math.random() * 10) + 1;
    const score = base + roll;
    return {
      score,
      breakdown: `REF/2(${base}) + 1d10(${roll}) = ${score}`,
      diceResults: { '10': [roll] },
    };
  },

  rollPlayer(sheet) {
    const ref = stat(sheet, 'ref', 5);
    const base = Math.ceil(ref / 2);
    const roll = Math.floor(Math.random() * 10) + 1;
    const score = base + roll;
    return {
      score,
      breakdown: `REF/2(${base}) + 1d10(${roll}) = ${score}`,
      diceResults: { '10': [roll] },
    };
  },
};
