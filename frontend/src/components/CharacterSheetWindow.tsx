import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { SheetRenderer } from './SheetRenderer';
import { getTemplate, type CharacterSheet } from '../sheets';

// The player's own character sheet. Identity is the socket's registered
// user - the server only ever returns / edits the caller's own sheet.

interface CharacterSheetWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  userName: string;
  playerToken?: string | null;
  adminToken?: string;
}

export function CharacterSheetWindow({ pos, setPos, onClose, socket, userName, playerToken, adminToken }: CharacterSheetWindowProps) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!socket) return;
    const onSheetData = (data: CharacterSheet) => {
      if (data.username === userName) setSheet(data);
    };
    const onSheetUpdated = (info: { username: string }) => {
      // Re-sync when someone else (the admin) edits this sheet
      if (info.username === userName) socket.emit('requestMySheet');
    };
    socket.on('sheetData', onSheetData);
    socket.on('sheetUpdated', onSheetUpdated);
    socket.emit('requestMySheet');
    return () => {
      socket.off('sheetData', onSheetData);
      socket.off('sheetUpdated', onSheetUpdated);
    };
  }, [socket, userName]);

  // Cancel outstanding debounce timers on unmount
  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    setSheet(prev => prev ? { ...prev, data: { ...prev.data, [fieldId]: value } } : prev);
    // Debounced per-field save so typing doesn't spam the socket
    const timers = pendingSaves.current;
    const existing = timers.get(fieldId);
    if (existing) clearTimeout(existing);
    timers.set(fieldId, setTimeout(() => {
      timers.delete(fieldId);
      socket?.emit('updateSheetField', { fieldId, value });
    }, 400));
  }, [socket]);

  const template = sheet ? getTemplate(sheet.system) : null;

  return (
    <DraggableWindow
      title={`CHARACTER_SHEET // ${userName.toUpperCase()}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      titleControls={
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {template && (
            <span style={{ border: '1px solid var(--green)', padding: '0 6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
              {template.name.toUpperCase()}
            </span>
          )}
          <button
            title="Open in new tab"
            aria-label="Open in new tab"
            className="win95-close-btn"
            onClick={() => {
              // Handshake for the standalone tab: it reads and deletes this key
              try {
                localStorage.setItem('sheet_tab_auth', JSON.stringify({
                  userName,
                  playerToken: playerToken ?? null,
                  adminToken: adminToken || null,
                }));
              } catch { /* ignore */ }
              window.open('/?sheet=true', '_blank');
            }}
          >
            ⧉
          </button>
        </span>
      }
      windowStyle={{ width: '520px', maxWidth: '95vw' }}
      contentStyle={{ height: '68vh', display: 'flex', flexDirection: 'column', padding: '4px 10px 0' }}
    >
      {sheet && template ? (
        <SheetRenderer template={template} data={sheet.data} portraitUrl={sheet.portrait_url} onFieldChange={handleFieldChange} />
      ) : (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px' }}>ACCESSING RECORD...</div>
      )}
    </DraggableWindow>
  );
}
