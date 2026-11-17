import React from 'react';
import type { SheetTemplate } from '../sheets/types';
import { flowState } from '../sheets/newCharacterFlow';

// CREATING · CONTINUE over a sheet still being made (7c2): it opens NEW_CHARACTER.EXE where the player left it. One
// line for SHEET.EXE and the standalone sheet tab (8s1c; the user, 2026-11-15: the two identical).

interface Props {
  template: SheetTemplate | null | undefined;
  data: Record<string, unknown> | undefined;
  onContinue?: () => void;
}

export function SheetCreatingLine({ template, data, onContinue }: Props) {
  if (!onContinue || flowState(template ?? null, data) === 'none') return null;
  return (
    <button type="button" onClick={onContinue}
      style={{ background: 'none', border: '1px solid var(--warning)', color: 'var(--warning)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 8px', margin: '4px 0', flexShrink: 0 }}>
      CREATING · CONTINUE
    </button>
  );
}
