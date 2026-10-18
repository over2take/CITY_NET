import { useRef, useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import { formulaList, withFormula, insertToken } from '../sheets/statsRules';

/**
 * INSERT for formulas (4b2d, shared 5a3b2): where the cursor last was in which formula, and a name
 * put there with the cursor after it (inside a table's or function's parentheses). FORMULAS and
 * the graph view's node panel both use it, so a name inserted either way is the same edit.
 */
export function useFormulaInsert(definition: Definition, edit: (next: Definition) => void) {
  const [cursor, setCursor] = useState<{ id: string; at: number } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const insert = (token: string) => {
    if (!cursor) return;
    const f = formulaList(definition).find((x) => x.id === cursor.id);
    if (!f) return;
    const next = insertToken(f.formula ?? '', cursor.at, token);
    edit(withFormula(definition, f.id, { formula: next.text }));
    setCursor({ id: f.id, at: next.cursor });
    requestAnimationFrame(() => { const el = inputs.current[f.id]; if (el) { el.focus(); el.setSelectionRange(next.cursor, next.cursor); } });
  };
  return {
    active: !!cursor,
    insert,
    /** For a formula's text box: where its input is, and where its cursor goes. */
    bind: (id: string) => ({
      inputRef: (el: HTMLInputElement | null) => { inputs.current[id] = el; },
      onCursor: (at: number) => setCursor({ id, at }),
    }),
  };
}
