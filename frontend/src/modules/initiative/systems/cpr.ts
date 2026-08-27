import type { InitiativeSystem, RollOptions } from './index';
import { cryptoRng } from './random';
import { getTemplate } from '../../../sheets';
import { sheetEffects, effectiveValue, rollBonus } from '../../../sheets/cyberwareEffects';

// Initiative is rolled here rather than on the server, unlike sheet rolls and attacks: the
// client computes a score and submits it. That is a pre-existing property of this module,
// not something cyberware introduces — but it does mean the chrome has to be applied here
// too, or a character's REF reads one way on their sheet and another when they roll for
// turn order.

/** The CP:R sheet, for resolving what the chrome does. This module is the CP:R one. */
const TEMPLATE = getTemplate('cyberpunk_red');

const stat = (sheet: any, key: string, fallback: number) =>
  Number(sheet?.[key] ?? sheet?.data?.[key] ?? fallback);

/** The sheet's own data, whichever shape the caller passed it in. */
const dataOf = (sheet: any) => (sheet?.data ?? sheet ?? {}) as Record<string, unknown>;

function rollInit(sheet: any, explodingDie = false) {
  const data = dataOf(sheet);
  const effects = sheetEffects(data, TEMPLATE);
  // The REF the sheet shows, not the one stored under it. A cyberarm that raises REF
  // raises what you go on, the same as it raises every other roll built from REF.
  const ref = effects.fields.ref
    ? effectiveValue(effects, 'ref', stat(sheet, 'ref', 5))
    : stat(sheet, 'ref', 5);
  // Chrome aimed at initiative as such, which is not a stat and lands nowhere else.
  const bonus = rollBonus(data, 'Initiative', TEMPLATE);

  const rolls: number[] = [];
  let next = Math.floor(cryptoRng() * 10) + 1;
  rolls.push(next);
  while (explodingDie && next === 10) {
    next = Math.floor(cryptoRng() * 10) + 1;
    rolls.push(next);
  }
  const exploded = rolls.length > 1;
  const rollTotal = rolls.reduce((a, b) => a + b, 0);
  const score = ref + rollTotal + bonus;
  const diceLabel = exploded ? `${rolls.join('+')}[EXPLOD]` : `${rolls[0]}`;
  // Named in the breakdown rather than folded into REF, so a player can see where it came
  // from — the same reason the server sends cyberware as its own term on a sheet roll.
  const chrome = bonus !== 0 ? ` + CHROME(${bonus >= 0 ? '+' : ''}${bonus})` : '';
  return {
    score,
    breakdown: `REF(${ref}) + 1d10(${diceLabel})${chrome} = ${score}`,
    diceResults: { '10': rolls },
    exploded,
  };
}

export const cpr: InitiativeSystem = {
  key: 'cyberpunk_red',
  counterLabel: 'ROUND',
  passDecay: false,
  rollNpc: (sheet, options?: RollOptions) => rollInit(sheet, options?.explodingInitiative),
  rollPlayer: (sheet, options?: RollOptions) => rollInit(sheet, options?.explodingInitiative),
};
