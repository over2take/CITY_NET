import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { ImportSheetDialog } from './ImportSheetDialog';
import { canImport } from '../sheets/importable';
import { themeRoot } from '../utils/themeRoot';

// IMPORT on a character's own sheet (4h2c), and IMPORT.EXE it opens, one component for SHEET.EXE and the standalone
// sheet tab (8s1b; the user, 2026-11-15: the tab and the window identical, the same windows reused). Offered only where
// the system can import (sheets/importable.ts); what is read goes to the server as 'importSheetFields', as before.

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's socket is untyped throughout
  socket: any;
  system: string | null | undefined;
  data: Record<string, unknown> | undefined;
  /** Where IMPORT.EXE first opens. */
  at: { x: number; y: number };
  className?: string;
  style?: React.CSSProperties;
}

export function SheetImportButton({ socket, system, data, at, className = 'win95-close-btn', style }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(at);
  if (!canImport(system)) return null;
  return (
    <>
      <button type="button" title="Import from PDF / JSON / text" className={className}
        style={style ?? { fontSize: '9px', width: 'auto', padding: '0 5px' }} onClick={() => setOpen(true)}>
        IMPORT
      </button>
      {open && ReactDOM.createPortal(
        <ImportSheetDialog
          gameSystem={system ?? undefined}
          currentData={data}
          pos={pos}
          setPos={setPos}
          onClose={() => setOpen(false)}
          onApply={(fields, opts) => {
            socket?.emit('importSheetFields', { fields, replace: opts?.replace, cyberware: opts?.cyberware, picks: opts?.picks });
          }}
        />,
        // Inside the theme, so IMPORT.EXE takes the theme's colors rather than Classic's.
        themeRoot(),
      )}
    </>
  );
}
