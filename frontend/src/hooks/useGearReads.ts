import { useEffect, useEffectEvent, useState } from 'react';
import type { GearDiceRead } from '../sheets/gearDice';

/** How long the lines wait after the last change before asking (8e1): a burst of typing or saves asks once. */
export const READ_WAIT_MS = 250;

/**
 * What the server reads of every DAMAGE and DICE on a sheet's gear, at once (8e1; sockets readGearLines): by text, asked
 * again when the texts or the sheet (`version`) change, the last answers kept meanwhile so the numbers never blink. With
 * nobody to ask, nothing.
 */
export function useGearReads(texts: string[], read: ((texts: string[]) => Promise<GearDiceRead[] | null>) | undefined, version: unknown): Map<string, GearDiceRead> {
  const [reads, setReads] = useState<Map<string, GearDiceRead>>(() => new Map());
  const key = JSON.stringify(texts);
  const ask = useEffectEvent((list: string[]) => (read ? read(list) : Promise.resolve(null)));
  // A reader coming (or going) asks again.
  const asking = !!read;
  useEffect(() => {
    const list = JSON.parse(key) as string[];
    if (!list.length) return;
    let live = true;
    const timer = setTimeout(() => {
      void ask(list).then((answers) => {
        if (!live || !answers) return;
        setReads(new Map(list.map((t, i) => [t, answers[i]] as [string, GearDiceRead])));
      });
    }, READ_WAIT_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [key, asking, version]);
  return reads;
}
