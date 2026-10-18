import { useEffect, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import { formulaList, problemsByFormula } from '../sheets/statsRules';
import { withHouseRuleOn } from '../sheets/houseRules';

/** Worked out values and mistakes, by formula. */
export type Tried = { values: Record<string, number>; problems: Record<string, string> };

/** How long after the last change the live values are asked for. */
export const PREVIEW_DELAY_MS = 400;

/**
 * A draft's formulas worked out for its sample character a moment after editing stops, by the
 * server (POST /api/systems/preview-values), so it is the game's own engine: `preview` as the
 * draft stands, and `tried`, by house rule, with each rule an alternative follows on (4j4b).
 * STATS & RULES' FORMULAS tab and the graph view (5a3) both show these.
 */
export function usePreviewValues(definition: Definition, api?: ReturnType<typeof systemsApi>): { preview: Tried | null; tried: Record<string, Tried> } {
  const [preview, setPreview] = useState<Tried | null>(null);
  const [tried, setTried] = useState<Record<string, Tried>>({});
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewValues(definition).then((r) => {
        if (live && r.ok) setPreview({ values: r.value.values, problems: problemsByFormula(r.value.problems) });
      });
      for (const rule of new Set(formulaList(definition).map((f) => f.alternative?.rule).filter((x): x is string => !!x))) {
        api.previewValues(withHouseRuleOn(definition, rule)).then((r) => {
          if (live && r.ok) setTried((was) => ({ ...was, [rule]: { values: r.value.values, problems: problemsByFormula(r.value.problems) } }));
        });
      }
    }, PREVIEW_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition]);
  return { preview, tried };
}
