import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { DraggableWindow } from './DraggableWindow';
import { SheetRenderer } from './SheetRenderer';
import { ImportSheetDialog } from './ImportSheetDialog';
import { getTemplate, getMaxPairs, type CharacterSheet } from '../sheets';

// Admin view/edit of an NPC or player sheet. Unlike the player window
// (socket-based, self-only), this goes through the admin REST routes:
// NPC mode:    GET/PUT /api/sheets/npcs/:id
// player mode: GET/PUT /api/sheets/user/:username (set playerUsername)

interface NpcSheetWindowProps {
  token: string;
  /** NPC mode: sheet id in the NPC library. Ignored when playerUsername is set. */
  npcId: number;
  npcLabel: string;
  /** Player mode: view/edit this player's active-system sheet instead. */
  playerUsername?: string;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  /** When provided, the window re-fetches on dataUpdated so linked token HP
   *  stays live (attacks, HIT_POINTS edits). */
  socket?: any;
}

export function NpcSheetWindow({ token, npcId, npcLabel, playerUsername, pos, setPos, onClose, socket }: NpcSheetWindowProps) {
  const apiPath = playerUsername
    ? `/api/sheets/user/${encodeURIComponent(playerUsername)}`
    : `/api/sheets/npcs/${npcId}`;
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPos, setImportPos] = useState({ x: pos.x + 60, y: pos.y + 60 });
  const [reloadKey, setReloadKey] = useState(0);
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch(apiPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (!res.ok) return setError(playerUsername ? 'NO_SHEET_FOR_THIS_PLAYER_ON_THE_ACTIVE_SYSTEM' : 'NPC_RECORD_NOT_FOUND');
      const fresh: CharacterSheet = await res.json();
      // Don't stomp fields with a pending debounced edit
      setSheet(prev => {
        if (!prev || pendingSaves.current.size === 0) return fresh;
        const merged = { ...fresh.data };
        pendingSaves.current.forEach((_t, fieldId) => {
          if (prev.data[fieldId] !== undefined) merged[fieldId] = prev.data[fieldId];
        });
        return { ...fresh, data: merged };
      });
    };
    load();
    if (socket) {
      // Token HP is linked - re-fetch when locations change (attacks, HIT_POINTS)
      socket.on('dataUpdated', load);
      // Player sheets also change through the player's own socket edits
      const onSheetUpdated = (info: { username: string }) => {
        if (playerUsername && info.username === playerUsername) load();
      };
      socket.on('sheetUpdated', onSheetUpdated);
      return () => {
        cancelled = true;
        socket.off('dataUpdated', load);
        socket.off('sheetUpdated', onSheetUpdated);
      };
    }
    return () => { cancelled = true; };
  }, [npcId, playerUsername, token, socket, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel outstanding debounce timers on unmount
  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const saveFields = useCallback(async (fields: Record<string, string | number>) => {
    await fetch(apiPath, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  }, [apiPath, token]);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    let clampedCur: { fieldId: string; value: number } | null = null;
    setSheet(prev => {
      if (!prev) return prev;
      const template = getTemplate(prev.system);
      const pairs = getMaxPairs(template);
      const curField = pairs[fieldId]; // non-null when fieldId is a max field
      const data = { ...prev.data, [fieldId]: value };
      if (curField !== undefined && data[curField] !== undefined) {
        const newMax = Number(value);
        if (Number(data[curField]) > newMax) {
          data[curField] = newMax;
          clampedCur = { fieldId: curField, value: newMax };
        }
      }
      return { ...prev, data };
    });
    const timers = pendingSaves.current;
    const existing = timers.get(fieldId);
    if (existing) clearTimeout(existing);
    timers.set(fieldId, setTimeout(() => {
      timers.delete(fieldId);
      const fields: Record<string, string | number> = { [fieldId]: value };
      if (clampedCur) fields[clampedCur.fieldId] = clampedCur.value;
      saveFields(fields);
    }, 400));
  }, [saveFields]);

  const handlePortraitUpload = useCallback(async (file: File) => {
    const form = new FormData();
    form.append('portrait', file);
    const res = await fetch(playerUsername ? `/api/sheets/portrait?username=${encodeURIComponent(playerUsername)}` : `/api/sheets/portrait?npc_id=${npcId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (res.ok) {
      const { portrait_url } = await res.json();
      setSheet(prev => (prev ? { ...prev, portrait_url } : prev));
    }
  }, [npcId, playerUsername, token]);

  const template = sheet ? getTemplate(sheet.system) : null;

  return (
    <>
    <DraggableWindow
      title={playerUsername ? `CHARACTER_SHEET // ${playerUsername.toUpperCase()} [ADMIN]` : `NPC_SHEET // ${npcLabel.toUpperCase()}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      titleControls={
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            title="Import from PDF / JSON / text"
            className="win95-close-btn"
            style={{ fontSize: '9px', width: 'auto', padding: '0 5px' }}
            onClick={() => setIsImportOpen(true)}
          >
            IMPORT
          </button>
          {template && (
            <span style={{ border: '1px solid var(--green)', padding: '0 6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
              {template.name.toUpperCase()}
            </span>
          )}
        </span>
      }
      windowStyle={{
        width: '520px', height: '74vh',
        minWidth: '360px', maxWidth: '520px', minHeight: '320px', maxHeight: '92vh',
        resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
      contentStyle={{ flex: 1, minHeight: 0, maxHeight: 'none', display: 'flex', flexDirection: 'column', padding: '4px 10px 0' }}
    >
      {sheet && template ? (
        <SheetRenderer
          template={template}
          data={sheet.data}
          portraitUrl={sheet.portrait_url}
          onFieldChange={handleFieldChange}
          onPortraitUpload={handlePortraitUpload}
        />
      ) : (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px' }}>
          {error ?? 'ACCESSING RECORD...'}
        </div>
      )}
    </DraggableWindow>
    {isImportOpen && ReactDOM.createPortal(
      <ImportSheetDialog
        pos={importPos}
        setPos={setImportPos}
        onClose={() => setIsImportOpen(false)}
        onApply={async (fields) => {
          await saveFields(fields);
          setReloadKey(k => k + 1);
        }}
      />,
      document.body
    )}
    </>
  );
}
