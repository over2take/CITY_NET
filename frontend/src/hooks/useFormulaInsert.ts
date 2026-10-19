import { useRef, useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import { formulaList, withFormula, withCondition, partOf, insertToken, type ConditionPart } from '../sheets/statsRules';

/** Which box of a formula: its text, or one of a condition's IF, THEN and ELSE (5b6a). */
export type FormulaBox = 'formula' | ConditionPart;

/**
 * INSERT for formulas (4b2d, shared 5a3b2): where the cursor last was in which formula's box, and a
 * name put there with the cursor after it (inside a table's or function's parentheses). FORMULAS
 * and the graph view's node panel both use it, so a name inserted either way is the same edit.
 */
export function useFormulaInsert(definition: Definition, edit: (next: Definition) => void) {
  const [cursor, setCursor] = useState<{ id: string; box: FormulaBox; at: number } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const insert = (token: string) => {
    if (!cursor) return;
    const f = formulaList(definition).find((x) => x.id === cursor.id);
    if (!f) return;
    const { box } = cursor;
    const next = insertToken(box === 'formula' ? f.formula ?? '' : partOf(f, box), cursor.at, token);
    edit(box === 'formula' ? withFormula(definition, f.id, { formula: next.text }) : withCondition(definition, f.id, { [box]: next.text }));
    setCursor({ id: f.id, box, at: next.cursor });
    requestAnimationFrame(() => { const el = inputs.current[`${f.id}:${box}`]; if (el) { el.focus(); el.setSelectionRange(next.cursor, next.cursor); } });
  };
  return {
    active: !!cursor,
    insert,
    /** For a formula's text box (or a condition's IF, THEN or ELSE): where its input is, and where its cursor goes. */
    bind: (id: string, box: FormulaBox = 'formula') => ({
      inputRef: (el: HTMLInputElement | null) => { inputs.current[`${id}:${box}`] = el; },
      onCursor: (at: number) => setCursor({ id, box, at }),
    }),
  };
}
