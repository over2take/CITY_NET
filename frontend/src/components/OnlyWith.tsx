import React, { useId } from 'react';
import type { Definition } from '../sheets/systemsApi';
import { houseRuleList } from '../sheets/houseRules';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';

// ONLY WITH (4j4a; approved mockup docs/mockups/optional-rules.html, 2026-10-14): the house rule a
// part on PARTS, a sheet section or a condition waits on, picked where it lives; "always" is none.
// Nothing to pick in a system with no house rules, so nothing is shown there, unless something
// still names one since deleted (shown GONE, to clear). A name and its box, as a pair, so it sits in
// a page's own grid or column.

interface Props {
  definition: Definition;
  /** The rule it waits on, or none. */
  value: string | undefined;
  onChange: (rule: string | null) => void;
  /** The name's style, as the page's other names. */
  style?: React.CSSProperties;
  /** A name in a grid of names beside their fields (FieldName). */
  beside?: boolean;
  selectStyle?: React.CSSProperties;
  /** Its name, words and "none", where it is used for something else (a formula's WITH A RULE). */
  label?: string;
  hint?: string;
  none?: string;
}

export function OnlyWith({ definition, value, onChange, style, beside, selectStyle, label = 'ONLY WITH', hint = HINTS['only.with'], none = '— always —' }: Props) {
  const id = useId();
  const rules = houseRuleList(definition);
  if (!rules.length && !value) return null;
  return (
    <>
      <FieldName htmlFor={id} hint={hint} style={style} beside={beside}>{label}</FieldName>
      <select id={id} value={value ?? ''} style={selectStyle} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{none}</option>
        {rules.map((r) => <option key={r.id} value={r.id}>{(r.name.trim() || r.id).toUpperCase()}</option>)}
        {value && !rules.some((r) => r.id === value) && <option value={value}>{value.toUpperCase()} (GONE)</option>}
      </select>
    </>
  );
}
