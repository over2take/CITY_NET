// The sheet's luck points, as logic (8c6; approved mockup docs/mockups/rule-library.html, section 4, answers 6 and 7): a game made
// in the builder with LUCK on shows its points on the sheet, as Cyberpunk RED's sheet does; clicking them sets some aside for the
// next roll from the sheet, which spends them (the server checks, rolls with them and takes them off, backend luck.js). The rule
// is the server's (runtime.js luckShown, in the template); what is left of the most is worked out on the server too, under the
// sheet's WORKED_KEY. Pure, so the row (components/LuckPoints.tsx) only draws.

export type LuckEach = 'plus' | 'die';
/** The rule as the server shows a sheet it. */
export interface LuckShown { name: string; each: LuckEach; on: 'all' | string[] }
/** A character's: what is left, of the most. */
export interface LuckNow { current: number; most: number }

const whole = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 0 ? v as number : null);

/** What the server worked out for this character, or null where it hasn't (a sheet not read back since). */
export const luckNowOf = (worked: unknown): LuckNow | null => {
  if (!worked || typeof worked !== 'object') return null;
  const l = (worked as { luck?: unknown }).luck;
  if (!l || typeof l !== 'object') return null;
  const current = whole((l as LuckNow).current);
  const most = whole((l as LuckNow).most);
  return current === null || most === null ? null : { current: Math.min(current, most), most };
};

/** The points set aside after clicking the `n`th (1 the first): up to it, or none when it was the last set aside. */
export const armAt = (armed: number, n: number, current: number): number => (n === armed ? 0 : Math.max(0, Math.min(n, current)));

/** What setting points aside means for the next roll, in the strip's words: "2 SET ASIDE · NEXT ROLL +2". */
export const armedWords = (rule: LuckShown, armed: number): string => {
  if (armed <= 0) return '';
  const what = rule.each === 'die' ? `+${armed} ${armed === 1 ? 'DIE' : 'DICE'}` : `+${armed}`;
  return `${armed} SET ASIDE · NEXT ROLL ${what}`;
};

/** Whether points set aside are spent on a roll: every roll, or one of those named. A roll it isn't on keeps them aside. */
export const spendsOn = (rule: LuckShown | null | undefined, rollId: string | undefined): boolean =>
  !!rule && (rule.on === 'all' || (!!rollId && rule.on.includes(rollId)));
