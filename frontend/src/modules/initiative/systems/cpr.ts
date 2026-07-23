import type { InitiativeSystem } from './index';

const stat = (sheet: any, key: string, fallback: number) =>
  Number(sheet?.[key] ?? sheet?.data?.[key] ?? fallback);

function rollInit(sheet: any) {
  const ref = stat(sheet, 'ref', 5);
  const rolls: number[] = [];
  let next = Math.floor(Math.random() * 10) + 1;
  rolls.push(next);
  while (next === 10) {
    next = Math.floor(Math.random() * 10) + 1;
    rolls.push(next);
  }
  const exploded = rolls.length > 1;
  const rollTotal = rolls.reduce((a, b) => a + b, 0);
  const score = ref + rollTotal;
  const diceLabel = exploded ? `${rolls.join('+')}[EXPLOD]` : `${rolls[0]}`;
  return {
    score,
    breakdown: `REF(${ref}) + 1d10(${diceLabel}) = ${score}`,
    diceResults: { '10': rolls },
    exploded,
  };
}

export const cpr: InitiativeSystem = {
  key: 'cyberpunk_red',
  counterLabel: 'ROUND',
  passDecay: false,
  rollNpc: rollInit,
  rollPlayer: rollInit,
};
