import React, { useState } from 'react';
import { DraggableWindow } from './DraggableWindow';

// Sheet import dialog. Three inputs, one preview, one APPLY:
//   - a fillable character-sheet PDF (form fields extracted server-side)
//   - pasted JSON ({ "ref": 7, "handgun": 5, ... } or an exported sheet)
//   - pasted plain text (stat-block style: 'REF 7', 'Handgun: 5')
// The server maps candidates onto the active system's fields and reports
// what it could not place - nothing is applied until APPLY is clicked.

interface Preview {
  system: string;
  source: string;
  mapped: Record<string, string | number>;
  unmapped: Record<string, unknown>;
  skipped: Record<string, unknown>;
  /** What the source had no way to provide — a Companion export carries no vehicle
   *  stats, no weapon damage. Shown so a gap does not read as a failure. */
  missing?: string[];
}

interface ImportSheetDialogProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  /** The active system. The dialog otherwise only learns it from a preview coming back,
   *  which is too late to decide what to offer. */
  gameSystem?: string;
  /** Apply the mapped fields to the target sheet (socket or admin REST). */
  onApply: (fields: Record<string, string | number>) => Promise<void> | void;
}

const label9: React.CSSProperties = { fontFamily: 'monospace', fontSize: 9, letterSpacing: 0.5 };

export function ImportSheetDialog({ pos, setPos, onClose, onApply, gameSystem }: ImportSheetDialogProps) {
  const [pasted, setPasted] = useState('');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

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
      const data = await res.json();
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
    await onApply(preview.mapped);
    setBusy(false);
    setApplied(true);
  };

  const mappedCount = preview ? Object.keys(preview.mapped).length : 0;
  const unmappedKeys = preview ? Object.keys(preview.unmapped) : [];
  const skippedKeys = preview ? Object.keys(preview.skipped) : [];

  return (
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

        {error && <div style={{ ...label9, color: '#ff3333', border: '1px solid #ff3333', padding: '4px 8px' }}>{error}</div>}

        {preview && (
          <div style={{ border: '1px solid var(--green)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ ...label9, color: 'var(--green)' }}>
              {mappedCount} FIELD{mappedCount === 1 ? '' : 'S'} RECOGNIZED ({preview.source.toUpperCase()})
            </div>
            <div style={{ ...label9, opacity: 0.8, maxHeight: 90, overflowY: 'auto', wordBreak: 'break-word' }}>
              {Object.entries(preview.mapped).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(' · ')}
            </div>
            {skippedKeys.length > 0 && (
              <div style={{ ...label9, color: '#ffcc00' }}>
                SKIPPED (LINKED TO TOKEN/BANK): {skippedKeys.join(', ')}
              </div>
            )}
            {unmappedKeys.length > 0 && (
              <div style={{ ...label9, opacity: 0.55, maxHeight: 60, overflowY: 'auto' }}>
                NOT RECOGNIZED: {unmappedKeys.slice(0, 30).join(', ')}{unmappedKeys.length > 30 ? '…' : ''}
              </div>
            )}
            {/* Different from NOT RECOGNIZED: this is what the source never held, not what
                we failed to read. A Companion export names a car but carries no SDP, and a
                player who is not told that reads the gap as a broken import. */}
            {preview.missing && preview.missing.length > 0 && (
              <div style={{ ...label9, color: '#00ccff' }}>
                TYPE IN YOURSELF: {preview.missing.join(' · ')}
              </div>
            )}
            <button
              className="upload-btn"
              disabled={busy || mappedCount === 0 || applied}
              onClick={handleApply}
              style={{ padding: '6px', backgroundColor: applied ? 'var(--dark-green)' : 'var(--green)', color: applied ? 'var(--green)' : '#000', fontWeight: 'bold' }}
            >
              {applied ? '✓ APPLIED' : `APPLY ${mappedCount} FIELDS TO SHEET`}
            </button>
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
