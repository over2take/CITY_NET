import type { InitiativeSystem } from './index';

const stat = (sheet: any, key: string, fallback: number) =>
  Number(sheet?.[key] ?? sheet?.data?.[key] ?? fallback);

function rollInit(sheet: any) {
  const dexMod = stat(sheet, 'dex_mod', 0);
  const roll = Math.floor(Math.random() * 8) + 1;
  const score = dexMod + roll;
  return {
    score,
    breakdown: `DEX MOD(${dexMod}) + 1d8(${roll}) = ${score}`,
    diceResults: { '8': [roll] },
  };
}

export const cwn: InitiativeSystem = {
  key: 'cities_without_number',
  counterLabel: 'ROUND',
  passDecay: false,
  defaultMode: 'side',
  rollNpc: rollInit,
  rollPlayer: rollInit,
};
