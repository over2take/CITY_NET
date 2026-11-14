import { useEffect, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import type { FormulaKind, FormulaRead } from '../sheets/formulaBox';
import { PREVIEW_DELAY_MS } from './usePreviewValues';

/** The most formulas one request reads (backend systemBuilder/formulaPreview.js MOST). */
const PER_REQUEST = 20;

/** One formula to read: a key of the caller's own, its text, and what it is. */
export interface FormulaToRead { key: string; text: string; kind: FormulaKind }

/**
 * Many formulas read by the server at once (formula box 3): STATS & RULES lists every formula, so it
 * asks once a moment after typing stops, twenty to a request, not once per box. Each answer is kept
 * with the text it was for, and given back only while that is still the text: an answer for older
 * text is never shown. Empty texts are never asked about.
 */
export function useFormulaReads(definition: Definition, api: Pick<ReturnType<typeof systemsApi>, 'previewFormulas'> | undefined, items: FormulaToRead[]): Record<string, FormulaRead | null> {
  const [answers, setAnswers] = useState<Record<string, { text: string; read: FormulaRead }>>({});
  const asked = items.filter((i) => i.text.trim());
  const signature = JSON.stringify(asked);

  useEffect(() => {
    // An api without the call (a page given only what it draws with) reads nothing.
    if (typeof api?.previewFormulas !== 'function' || !asked.length) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      for (let at = 0; at < asked.length; at += PER_REQUEST) {
        const part = asked.slice(at, at + PER_REQUEST);
        api!.previewFormulas(definition, part.map(({ text, kind }) => ({ text, kind }))).then((r) => {
          const results = r.ok ? r.value?.results : undefined;
          if (!live || !Array.isArray(results)) return;
          setAnswers((prev) => {
            const next = { ...prev };
            part.forEach((item, i) => { const read = results[i]; if (read) next[item.key] = { text: item.text, read }; });
            return next;
          });
        });
      }
    }, PREVIEW_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
    // The texts asked are in the signature; the definition decides what each name means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, definition, signature]);

  return Object.fromEntries(items.map((i) => [i.key, answers[i.key]?.text === i.text ? answers[i.key].read : null]));
}
