import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import { SheetRenderer } from './components/SheetRenderer';
import { getTemplate, type CharacterSheet } from './sheets';

// Standalone character-sheet tab (?sheet=true). Gives the player a full
// browser tab for their sheet instead of the in-game floating window.
//
// Auth handshake: the main app writes { userName, playerToken } to
// localStorage under 'sheet_tab_auth' right before window.open; this page
// reads it once and deletes it. Fallback: the remembered userName from a
// simple-mode login. Secure Mode still verifies the token server-side on
// identify - this page can't fake its way in.

const readAuth = (): { userName: string | null; playerToken: string | null; adminToken: string | null } => {
  try {
    const raw = localStorage.getItem('sheet_tab_auth');
    if (raw) {
      localStorage.removeItem('sheet_tab_auth');
      const parsed = JSON.parse(raw);
      if (parsed.userName) {
        return {
          userName: parsed.userName,
          playerToken: parsed.playerToken ?? null,
          adminToken: parsed.adminToken ?? null,
        };
      }
    }
  } catch { /* fall through */ }
  return { userName: localStorage.getItem('userName'), playerToken: null, adminToken: null };
};

export default function SheetPage() {
  const [{ userName, playerToken, adminToken }] = useState(readAuth);
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<any>(null);
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!userName) return;
    const socket = io();
    socketRef.current = socket;

    const identify = () => {
      if (adminToken) {
        socket.emit('identify', { userName, isAdmin: true, token: adminToken });
      } else if (playerToken) {
        socket.emit('identify', { userName, playerToken });
      } else {
        socket.emit('identify', userName);
      }
      socket.emit('requestMySheet');
    };

    socket.on('connect', identify);
    socket.on('authError', (e: { message: string }) => setError(e.message));
    socket.on('sheetData', (data: CharacterSheet) => {
      if (data.username === userName) setSheet(data);
    });
    socket.on('sheetUpdated', (info: { username: string }) => {
      if (info.username === userName) socket.emit('requestMySheet');
    });
    socket.on('gameSystemChanged', () => socket.emit('requestMySheet'));

    return () => { socket.disconnect(); };
  }, [userName, playerToken, adminToken]);

  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    setSheet(prev => prev ? { ...prev, data: { ...prev.data, [fieldId]: value } } : prev);
    const timers = pendingSaves.current;
    const existing = timers.get(fieldId);
    if (existing) clearTimeout(existing);
    timers.set(fieldId, setTimeout(() => {
      timers.delete(fieldId);
      socketRef.current?.emit('updateSheetField', { fieldId, value });
    }, 400));
  }, []);

  const template = sheet ? getTemplate(sheet.system) : null;

  const message = !userName
    ? 'NO OPERATOR IDENTITY FOUND — open this page from CHARACTER_SHEET in the main app.'
    : error
      ? `ACCESS DENIED: ${error} — reopen this page from CHARACTER_SHEET in the main app.`
      : 'ACCESSING RECORD...';

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--background, #050805)', color: 'var(--green, #00ff00)',
      fontFamily: 'monospace', display: 'flex', justifyContent: 'center', padding: '20px 16px',
      boxSizing: 'border-box',
    }}>
      <div style={{ width: '100%', maxWidth: '900px', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid var(--green)', paddingBottom: '8px', marginBottom: '4px',
          letterSpacing: '2px', fontSize: '0.8rem',
        }}>
          <span>CHARACTER_SHEET // {(userName ?? 'UNKNOWN').toUpperCase()}</span>
          {template && (
            <span style={{ border: '1px solid var(--green)', padding: '1px 8px', fontSize: '0.65rem' }}>
              {template.name.toUpperCase()}
            </span>
          )}
        </div>
        {sheet && template ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
            <SheetRenderer template={template} data={sheet.data} portraitUrl={sheet.portrait_url} onFieldChange={handleFieldChange} />
          </div>
        ) : (
          <div style={{ fontSize: '0.75rem', opacity: 0.7, padding: '30px 0', letterSpacing: '1px' }}>{message}</div>
        )}
      </div>
    </div>
  );
}
