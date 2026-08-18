import React from 'react';
import { DraggableWindow } from './DraggableWindow';

/**
 * What an import would do, as its own window.
 *
 * It began inline under the import dialog's three inputs, which put it below the fold of a
 * pane that scrolls at 300px — so the one thing a player has to read before making a
 * destructive choice was the one thing they could not see.
 *
 * The window *is* the confirmation. Applying replaces the sheet, and everything needed to
 * decide is on screen at once: what was recognised, what this source could never provide,
 * and which of your fields would be cleared. One deliberate act in a window of its own,
 * rather than a warning stacked under a form.
 */

export interface ImportPreview {
  system: string;
  source: string;
  mapped: Record<string, string | number>;
  unmapped: Record<string, unknown>;
  skipped: Record<string, unknown>;
  /** What the source had no way to provide — an export names a car but carries no SDP. */
  missing?: string[];
}

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  preview: ImportPreview;
  /** The sheet as it stands, to work out what a replace would erase. */
  currentData?: Record<string, unknown>;
  busy?: boolean;
  applied?: boolean;
  onApply: () => void;
  onCancel: () => void;
}

const label9: React.CSSProperties = { fontFamily: 'monospace', fontSize: 9, letterSpacing: 0.5 };

/**
 * Occupancy survives a replace, so it is not a loss.
 *
 * Which car a player is sitting in is not character data, and re-importing a sheet says
 * nothing about it — the server keeps these, and claiming otherwise here would be a warning
 * about something that is not going to happen.
 */
const KEPT = ['in_vehicle', 'ride_owner', 'ride_vehicle', 'vehicle_seat'];

/** Everything on the sheet now that this import does not carry — named, not counted. */
export const lossesFrom = (
  preview: ImportPreview,
  currentData?: Record<string, unknown>,
): string[] => (currentData
  ? Object.entries(currentData)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .filter(([k]) => !(k in preview.mapped))
      .filter(([k]) => !KEPT.includes(k))
      .map(([k]) => k)
  : []);

export function ImportPreviewWindow({ pos, setPos, preview, currentData, busy, applied, onApply, onCancel }: Props) {
  const mapped = Object.entries(preview.mapped);
  const unmappedKeys = Object.keys(preview.unmapped);
  const skippedKeys = Object.keys(preview.skipped);
  const losses = lossesFrom(preview, currentData);

  const row: React.CSSProperties = { ...label9, maxHeight: 96, overflowY: 'auto', wordBreak: 'break-word' };

  return (
    <DraggableWindow
      title="IMPORT_PREVIEW"
      pos={pos}
      setPos={setPos}
      onClose={onCancel}
      windowStyle={{ width: '380px', maxWidth: '96vw' }}
      contentStyle={{ maxHeight: '80vh' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        <div style={{ ...label9, color: 'var(--green)' }}>
          {mapped.length} FIELD{mapped.length === 1 ? '' : 'S'} RECOGNIZED ({preview.source.toUpperCase()})
        </div>
        <div style={{ ...row, opacity: 0.8 }}>
          {mapped.map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(' · ')}
        </div>

        {skippedKeys.length > 0 && (
          <div style={{ ...label9, color: '#ffcc00' }}>
            SKIPPED (LINKED TO TOKEN/BANK): {skippedKeys.join(', ')}
          </div>
        )}

        {unmappedKeys.length > 0 && (
          <div style={{ ...row, opacity: 0.55 }}>
            NOT RECOGNIZED: {unmappedKeys.slice(0, 30).join(', ')}{unmappedKeys.length > 30 ? '…' : ''}
          </div>
        )}

        {/* Different from NOT RECOGNIZED: this is what the source never held, not what we
            failed to read. A player not told the difference reads a gap as a broken import. */}
        {preview.missing && preview.missing.length > 0 && (
          <div style={{ ...label9, color: '#00ccff' }}>
            TYPE IN YOURSELF: {preview.missing.join(' · ')}
          </div>
        )}

        <div style={{ border: '1px solid #ff3333', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...label9, color: '#ff3333' }}>
            THIS REPLACES THE SHEET — everything not in this import is cleared.
          </div>
          {losses.length > 0 ? (
            <div style={{ ...row, opacity: 0.85 }}>
              YOU WILL LOSE: {losses.slice(0, 40).join(', ')}{losses.length > 40 ? `, and ${losses.length - 40} more` : ''}
            </div>
          ) : (
            <div style={{ ...label9, opacity: 0.7 }}>Nothing on the sheet would be lost.</div>
          )}
          <div style={{ ...label9, opacity: 0.6 }}>Cancel if you need to write any of it down first.</div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="upload-btn danger-btn"
            style={{ flex: 1, marginTop: 0, padding: '6px', fontWeight: 'bold' }}
            disabled={busy || applied || mapped.length === 0}
            onClick={onApply}
          >
            {applied ? '✓ APPLIED' : `REPLACE SHEET WITH ${mapped.length} FIELDS`}
          </button>
          <button className="utility-btn" style={{ flex: 1, padding: '6px' }} onClick={onCancel}>
            {applied ? 'CLOSE' : 'CANCEL'}
          </button>
        </div>
      </div>
    </DraggableWindow>
  );
}
