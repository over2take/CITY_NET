import React, { useEffect, useRef, useState } from 'react';

// The GM's notes on a location - a building or an NPC token - read and edited in place in
// its window. Shared by BuildingWindow and TokenWindow.
//
// Nothing here decides who may see them: the caller only offers this to the main admin, and
// the server refuses anyone else. The notes never travel with the location itself.

/**
 * The GM's notes: read, and edited in place.
 *
 * Fetched when the tab opens rather than carried with the building, because they are not
 * carried with the building - they never leave the server except through a request that
 * checks for the main admin.
 */
export function GmNotes({ locationId, token }: { locationId: number | undefined; token: string }) {
  const [notes, setNotes] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Guards against a slow answer for the last building landing on this one. */
  const asked = useRef<number | undefined>(undefined);

  useEffect(() => {
    setNotes(null); setDraft(null); setError(null);
    if (locationId === undefined) return;
    asked.current = locationId;
    fetch(`/api/locations/${locationId}/gm-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (asked.current !== locationId) return;
        if (!r.ok) { setError(body.error || 'Could not load the notes.'); return; }
        setNotes(String(body.notes ?? ''));
      })
      .catch(() => { if (asked.current === locationId) setError('Could not load the notes.'); });
  }, [locationId, token]);

  const save = async () => {
    if (draft === null || locationId === undefined) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/locations/${locationId}/gm-notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notes: draft }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.error || 'The notes were not saved.'); return; }
      setNotes(String(body.notes ?? ''));
      setDraft(null);
    } catch {
      setError('The notes were not saved.');
    } finally {
      setSaving(false);
    }
  };

  const small: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '3px 10px' };

  if (error && notes === null) return <span style={{ color: 'var(--danger)' }}>{error}</span>;
  if (notes === null) return <span style={{ opacity: 0.7 }}>LOADING…</span>;

  if (draft !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        <textarea
          aria-label="GM notes"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          style={{
            fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5, minHeight: 200, width: '100%',
            resize: 'vertical', background: 'var(--black)', color: 'var(--green)',
            border: '1px solid var(--dark-green)', padding: 6, boxSizing: 'border-box',
          }}
        />
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="utility-btn" disabled={saving} onClick={save} style={small}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
          <button type="button" className="utility-btn" disabled={saving} onClick={() => { setDraft(null); setError(null); }} style={small}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>{notes || <span style={{ opacity: 0.7 }}>NO NOTES YET</span>}</div>
      <div>
        <button type="button" className="utility-btn" onClick={() => setDraft(notes)} style={small}>
          EDIT NOTES
        </button>
      </div>
    </div>
  );
}
