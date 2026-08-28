import React, { useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { ImportPreviewWindow, type ImportPreview } from './ImportPreviewWindow';

// Sheet import dialog. Three inputs, one preview, one APPLY:
//   - a fillable character-sheet PDF (form fields extracted server-side)
//   - pasted JSON ({ "ref": 7, "handgun": 5, ... } or an exported sheet)
//   - pasted plain text (stat-block style: 'REF 7', 'Handgun: 5')
// The server maps candidates onto the active system's fields and reports
// what it could not place - nothing is applied until APPLY is clicked.
//
// Applying *replaces* the sheet rather than merging into it, so a skill dropped at the
// source does not linger and a weapon row that no longer exists does not keep its damage.
// That is destructive, so it goes through a confirmation that names what will be lost by
// field, and a player can cancel and write those down first.

interface ImportSheetDialogProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  /** The active system. The dialog otherwise only learns it from a preview coming back,
   *  which is too late to decide what to offer. */
  gameSystem?: string;
  /** The sheet as it stands. Only read to work out what a replace would erase — the
   *  dialog cannot warn about losing something it cannot see. */
  currentData?: Record<string, unknown>;
  /** Apply the mapped fields to the target sheet (socket or admin REST). */
  onApply: (
    fields: Record<string, string | number>,
    opts?: { replace?: boolean; cyberware?: unknown[] },
  ) => Promise<void> | void;
}

const label9: React.CSSProperties = { fontFamily: 'monospace', fontSize: 9, letterSpacing: 0.5 };

export function ImportSheetDialog({ pos, setPos, onClose, onApply, gameSystem, currentData }: ImportSheetDialogProps) {
  const [pasted, setPasted] = useState('');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [previewPos, setPreviewPos] = useState({ x: pos.x + 60, y: pos.y + 60 });


  const runPreview = async (body: FormData | string, isForm: boolean) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    setApplied(false);
    try {
      const res = await fetch('/api/sheets/import/preview', {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body,
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Import failed');
      else setPreview(data);
    } catch {
      setError('Could not reach server');
    }
    setBusy(false);
  };

  const handlePdf = (file: File) => {
    const form = new FormData();
    form.append('pdf', file);
    runPreview(form, true);
  };

  const handlePaste = () => {
    const text = pasted.trim();
    if (!text) return;
    // JSON if it parses, otherwise treat as a stat block
    try {
      JSON.parse(text);
      runPreview(JSON.stringify({ json: text }), false);
    } catch {
      runPreview(JSON.stringify({ text }), false);
    }
  };

  /**
   * A Companion code, fetched server-side and previewed like the other two sources.
   *
   * Its own request rather than `runPreview`, because this is the one source that can fail
   * for reasons outside the app — their service being down is a different thing to say than
   * "could not read that", and a player can act on the difference.
   */
  const handleCode = async () => {
    const clean = code.trim().toUpperCase();
    if (clean.length !== 6) return setError('A Companion code is six characters.');
    setBusy(true);
    setError(null);
    setPreview(null);
    setApplied(false);
    try {
      const res = await fetch('/api/sheets/import/companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean }),
      });
      // An unknown route falls through to the single-page app, so the body is HTML rather
      // than JSON. Parsing that throws, and reporting it as "could not reach server" sends
      // someone hunting a network problem when the real answer is a backend that has not
      // been restarted since this route was added.
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        return setError('The server did not answer with data. If it was just updated, it needs restarting.');
      }
      if (!res.ok) setError(data.error || 'Could not read that code');
      else setPreview(data);
    } catch {
      setError('Could not reach server');
    }
    setBusy(false);
  };

  const handleApply = async () => {
    if (!preview) return;
    setBusy(true);
    await onApply(preview.mapped, { replace: true, cyberware: preview.cyberware });
    setBusy(false);
    setApplied(true);
  };



  return (
    <>
    <DraggableWindow
      title="IMPORT_SHEET"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '340px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        <label style={{ ...label9, color: 'var(--green)', border: '1px solid var(--green)', padding: '6px 8px', textAlign: 'center', cursor: 'pointer' }}>
          <input
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdf(f); e.target.value = ''; }}
          />
          UPLOAD FILLABLE PDF
        </label>
        {/* The blank form the upload above expects. Without it, "upload a fillable PDF"
            assumed you already had one whose field names matched — which players did not.
            Generated per system, so it always asks for what the importer reads. */}
        <a
          href="/api/sheets/import/template.pdf"
          download
          style={{ ...label9, color: 'var(--green)', opacity: 0.8, textAlign: 'center', textDecoration: 'none', border: '1px dashed var(--green)', padding: '4px 8px' }}
        >
          ↓ DOWNLOAD BLANK FORM
        </a>
        {/* Cyberpunk only: the Companion is a Cyberpunk tool, and offering this under
            another system would be a button that could only ever fail. */}
        {gameSystem === 'cyberpunk_red' && (
          <>
            <div style={{ ...label9, opacity: 0.5, textAlign: 'center' }}>— OR ENTER A COMPANION CODE —</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
              <input
                aria-label="Companion code"
                value={code}
                maxLength={6}
                placeholder="000000"
                onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCode(); }}
                style={{
                  flex: 1, minWidth: 0, boxSizing: 'border-box', textAlign: 'center',
                  background: '#001a00', border: '1px solid #1a3a1a', color: 'var(--green)',
                  fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, padding: '0 8px',
                }}
              />
              <button
                className="upload-btn"
                style={{ flex: 1, minWidth: 0, marginTop: 0, fontSize: 9 }}
                disabled={busy || code.trim().length !== 6}
                onClick={handleCode}
              >
                {busy ? 'FETCHING…' : 'FETCH'}
              </button>
            </div>
            <div style={{ ...label9, opacity: 0.4, textAlign: 'center' }}>
              from cyberpunkred.com — export your character to get a code
            </div>
          </>
        )}
        <div style={{ ...label9, opacity: 0.5, textAlign: 'center' }}>— OR PASTE JSON / STAT BLOCK —</div>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'{ "ref": 7, "handgun": 5 }  or  REF 7  Handgun 5 ...'}
          style={{ fontFamily: 'monospace', fontSize: 9, minHeight: 70, background: '#001a00', border: '1px solid #1a3a1a', color: 'var(--green)', padding: 6, resize: 'vertical' }}
        />
        <button className="upload-btn" disabled={busy || !pasted.trim()} onClick={handlePaste} style={{ padding: '5px' }}>
          {busy ? 'READING…' : 'PREVIEW'}
        </button>

        {error && <div style={{ ...label9, color: 'var(--danger)', border: '1px solid var(--danger)', padding: '4px 8px' }}>{error}</div>}

      </div>
    </DraggableWindow>

    {/* Its own window rather than a block under three inputs: this is the thing a player
        has to read before a destructive choice, and it was the thing they could not see. */}
    {preview && (
      <ImportPreviewWindow
        pos={previewPos}
        setPos={setPreviewPos}
        preview={preview}
        currentData={currentData}
        busy={busy}
        applied={applied}
        onApply={handleApply}
        onCancel={() => { setPreview(null); setApplied(false); }}
      />
    )}
    </>
  );
}
