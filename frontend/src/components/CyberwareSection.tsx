import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SheetSection, SheetTemplate, SheetFieldValue } from '../sheets/types';
import { readRows, totalHumanityLoss, needsPlacing } from '../sheets/cyberwareRows';
import { CyberwareWindow } from './CyberwareWindow';
import { themeRoot } from '../utils/themeRoot';

// The cyberware section of the sheet: a summary, and the way in.
//
// This replaces a textarea that held a comma-separated line of names. The line was all we
// could offer while the Companion import brought nothing back; it now carries a name and a
// humanity cost per piece, so the chrome deserves a table and a diagram — and neither fits
// in a sheet tab beside everything else. So the detail lives in a window and this says
// enough to know whether to open it.
//
// The window is owned here rather than plumbed down from the app: it is a view onto one
// sheet field, and every caller that renders a sheet would otherwise have to carry a prop
// through for it. It is portalled, though — rendered in place it inherits the character
// sheet's bounds and is clipped by them, which hides half the diagram.
//
// Into the themed container rather than the body: the themes are variables set by a class
// on `.crt-container`, so a window mounted outside it renders in Classic green whatever
// the rest of the app is wearing. See utils/themeRoot.

interface Props {
  section: SheetSection;
  /** The system's sheet, which is where the modifier pickers get their stats and skills. */
  template?: SheetTemplate;
  data: Record<string, unknown>;
  readOnly?: boolean;
  onFieldChange: (fieldId: string, value: SheetFieldValue) => void;
  /** Whose sheet this is, for the window title. */
  who?: string;
}

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 9, letterSpacing: 1 };

export function CyberwareSection({ data, template, readOnly, onFieldChange, who }: Props) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => readRows(data), [data]);

  const hl = totalHumanityLoss(rows);
  // No eddies total here. What the chrome cost is money already spent — it changes nothing
  // and answers no question this line is for, whereas humanity loss is live and drives EMP.
  // The price stays in the window, where the table has a column for it and can sort by it.
  // The same question the window and the body diagram ask. Counting a row as placed
  // because it has a type read "8 INSTALLED" over a body with nothing on it — a Cyberleg
  // that is in neither leg is owned, not installed.
  const unfiled = rows.filter(needsPlacing).length;
  const installed = rows.length - unfiled;

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ ...mono, color: 'var(--cyan)' }}>
          {rows.length === 0
            ? 'NO CYBERWARE'
            : `${installed} INSTALLED · HUMANITY LOSS ${hl}`}
        </span>
        <button type="button" className="utility-btn" onClick={() => setOpen(true)}>
          {readOnly ? 'VIEW' : 'OPEN'} AUGMENTATION
        </button>
      </div>

      {unfiled > 0 && (
        // Worth saying on the sheet rather than only inside the window: an import lands
        // everything unfiled, and nothing else would tell you there is filing to do.
        <div style={{ ...mono, color: 'var(--cyan)', paddingTop: 4 }}>
          {unfiled} PIECE{unfiled === 1 ? '' : 'S'} NOT YET PLACED ON THE BODY
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ ...mono, color: 'var(--grid-section)', paddingTop: 4, letterSpacing: 0, fontSize: 10 }}>
          {rows.slice(0, 6).map((r) => r.name).join(', ')}
          {rows.length > 6 ? `, and ${rows.length - 6} more` : ''}
        </div>
      )}

      {open && createPortal(
        <CyberwareWindow
          data={data}
          template={template}
          readOnly={readOnly}
          onFieldChange={onFieldChange}
          onClose={() => setOpen(false)}
          who={who}
        />,
        themeRoot(),
      )}
    </div>
  );
}
