import type { InitiativeSystem, RollOptions } from './index';

const d6 = () => Math.floor(Math.random() * 6) + 1;
const stat = (sheet: any, key: string) => Number(sheet?.[key] ?? sheet?.data?.[key] ?? 3);

export const sr6: InitiativeSystem = {
  key: 'shadowrun_6e',
  counterLabel: 'PASS',
  passDecay: true,

  rollNpc(sheet) {
    const rea = stat(sheet, 'reaction');
    const int_ = stat(sheet, 'intuition');
    const roll = d6();
    const score = rea + int_ + roll;
    return {
      score,
      breakdown: `REA(${rea}) + INT(${int_}) + 1d6(${roll}) = ${score}`,
      diceResults: { '6': [roll] },
    };
  },

  rollPlayer(sheet, options?: RollOptions) {
    const extraDice = options?.extraDice ?? 0;
    const rea = stat(sheet, 'reaction');
    const int_ = stat(sheet, 'intuition');
    const rolls = Array.from({ length: 1 + extraDice }, d6);
    const rollTotal = rolls.reduce((a, b) => a + b, 0);
    const score = rea + int_ + rollTotal;
    const diceLabel = extraDice > 0 ? `${1 + extraDice}d6(${rolls.join('+')})` : `1d6(${rolls[0]})`;
    return {
      score,
      breakdown: `REA(${rea}) + INT(${int_}) + ${diceLabel} = ${score}`,
      diceResults: { '6': rolls },
    };
  },
};
