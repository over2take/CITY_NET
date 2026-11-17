import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import { SheetRenderer } from './components/SheetRenderer';
import { usePlayerSheet, uploadSheetPortrait } from './hooks/usePlayerSheet';
import { useCustomTemplates } from './hooks/useCustomTemplates';
import { THEMES } from './theme/themes';
import { withCreationLocks } from './sheets/newCharacterFlow';
import { LIVE_THEME_KEY } from './utils/liveTheme';
import { SheetImportButton } from './components/SheetImportButton';
import { GiftNotices } from './components/GiftNotices';
import { SheetCreatingLine } from './components/SheetCreatingLine';
import { LevelUpWindow } from './components/LevelUpWindow';
import { NewCharacterWindow } from './components/NewCharacterWindow';
import { VehicleBadgeButton } from './components/VehicleBadgeButton';
import { askMainWindow, askOfLink, ASK_WORDS, type MainWindowAsk } from './utils/mainWindow';

// Standalone character-sheet tab (?sheet=true). Gives the player a full
// browser tab for their sheet instead of the in-game floating window.
// All sheet behavior lives in usePlayerSheet, shared with the in-game
// window (CharacterSheetWindow) - this file only owns the tab chrome.
//
// Auth handshake: the main app writes { userName, playerToken, theme } to
// localStorage under 'sheet_tab_auth' right before window.open; this page
// reads it once and deletes it. Fallback: the remembered userName from a
// simple-mode login. Secure Mode still verifies the token server-side on
// identify - this page can't fake its way in.
//
// Identical to the window (8s1a, the user's call 2026-11-15): every play prop comes from usePlayerSheet's
// `sheetProps`, spread whole as the window spreads it. The handshake is kept for the life of the tab
// (sessionStorage), so a refresh stays signed in; the page is a `.crt-container` like the app's, so what
// floats (hints, pickers, dialogs) takes the theme; and the theme follows the main app's as it changes.
//
// 8s1b: IMPORT and IMPORT.EXE as the window has them (SheetImportButton), and what the GM gives said here too
// (GiftNotices, the main app's own). A roll from here opens and throws in the main app's dice tray, which opens for
// any roll of this account (App rollOpensTray); this page only says the result once it has landed.
//
// 8s1c: LEVEL UP READY opens LEVEL_UP.EXE here, and CREATING · CONTINUE NEW_CHARACTER.EXE, the main app's own
// windows, as SHEET.EXE opens them (App.tsx). The dice tray they would open beside is the main app's.
//
// 8s1d: BANK, HEALTH and VEHICLES lean on the map, so a linked field or the VEHICLES section asks the main app to
// open its own (utils/mainWindow.ts) and this page says whether it did. The vehicle you sit in shows in the header
// with DISEMBARK, as in SHEET.EXE's title.

const validTheme = (t: unknown): string | null =>
  typeof t === 'string' && t in THEMES ? t : null;

/** The handshake, kept for the life of this tab so a refresh is still signed in. */
const TAB_AUTH_KEY = 'sheet_tab_auth';

const readAuth = (): { userName: string | null; playerToken: string | null; adminToken: string | null; theme: string } => {
  // Theme: the handshake carries the main app's active theme; fall back to
  // the login-screen pick, then the classic default.
  let fallbackTheme = 'classic';
  try { fallbackTheme = validTheme(localStorage.getItem('citynet_theme')) ?? 'classic'; } catch { /* private mode */ }
  try {
    // A new handshake from the main app, else the one this tab was opened with, kept across a refresh.
    const fresh = localStorage.getItem(TAB_AUTH_KEY);
    if (fresh) {
      localStorage.removeItem(TAB_AUTH_KEY);
      try { sessionStorage.setItem(TAB_AUTH_KEY, fresh); } catch { /* private mode */ }
    }
    const raw = fresh ?? sessionStorage.getItem(TAB_AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.userName) {
        return {
          userName: parsed.userName,
          playerToken: parsed.playerToken ?? null,
          adminToken: parsed.adminToken ?? null,
          theme: validTheme(parsed.theme) ?? fallbackTheme,
        };
      }
    }
  } catch { /* fall through */ }
  return { userName: localStorage.getItem('userName'), playerToken: null, adminToken: null, theme: fallbackTheme };
};

export default function SheetPage() {
  const [{ userName, playerToken, adminToken, theme: opened }] = useState(readAuth);
  const [theme, setTheme] = useState(opened);
  const [error, setError] = useState<string | null>(null);
  /** Whether the live connection is down: what is changed meanwhile isn't reaching the table. */
  const [lost, setLost] = useState(false);
  // LEVEL_UP.EXE and NEW_CHARACTER.EXE on this tab (8s1c), where they are, as the main app holds them.
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [levelUpPos, setLevelUpPos] = useState(() => ({ x: Math.max(16, window.innerWidth / 2 - 200), y: 100 }));
  const [newCharacterOpen, setNewCharacterOpen] = useState(false);
  const [newCharacterPos, setNewCharacterPos] = useState(() => ({ x: Math.max(16, window.innerWidth / 2 - 240), y: 80 }));
  // What the main app was last asked to open (8s1d), and whether it said it did.
  const [asked, setAsked] = useState<{ what: MainWindowAsk; opened: boolean | null } | null>(null);
  const askMain = useCallback((what: MainWindowAsk) => {
    if (!userName) return;
    setAsked({ what, opened: null });
    void askMainWindow(what, userName).then((opened) => setAsked((a) => (a?.what === what ? { what, opened } : a)));
  }, [userName]);

  // The theme as the main app changes it, while this tab is open.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const next = e.key === LIVE_THEME_KEY ? validTheme(e.newValue) : null;
      if (next) setTheme(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const [lastRoll, setLastRoll] = useState<string | null>(null);
  const [socket, setSocket] = useState<any>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    if (!userName) return;
    const s = io();
    socketRef.current = s;

    const identify = () => {
      if (adminToken) {
        s.emit('identify', { userName, isAdmin: true, token: adminToken });
      } else if (playerToken) {
        s.emit('identify', { userName, playerToken });
      } else {
        s.emit('identify', userName);
      }
      s.emit('requestMySheet');
    };

    s.on('connect', () => { setLost(false); identify(); });
    s.on('disconnect', () => setLost(true));
    s.on('authError', (e: { message: string }) => setError(e.message));
    // No dice tray on this page — delay matches the 5s dice animation in the main app. Only this player's own rolls:
    // the broadcast is everyone's, and the line used to show whoever rolled last.
    s.on('diceRollBroadcast', (roll: { historyString?: string; account?: string }) => {
      if (roll?.historyString && roll.account === userName) setTimeout(() => setLastRoll(roll.historyString!), 5000);
    });
    setSocket(s);

    return () => { s.disconnect(); };
  }, [userName, playerToken, adminToken]);

  // Every play prop from the shared hook, spread whole, as the window's are (8s1a).
  const { sheet, template, handleFieldChange, handleFieldsChange, sheetProps } = usePlayerSheet(socket, userName);
  // A custom system's sheet is drawn once its template arrives (sheets/customTemplates.ts).
  useCustomTemplates(sheet?.system);

  const handlePortraitUpload = useCallback(
    (file: File) => uploadSheetPortrait(adminToken || playerToken, file),
    [adminToken, playerToken],
  );

  const message = !userName
    ? 'NO OPERATOR IDENTITY FOUND — open this page from CHARACTER_SHEET in the main app.'
    : error
      ? `ACCESS DENIED: ${error} — reopen this page from CHARACTER_SHEET in the main app.`
      : 'ACCESSING RECORD...';

  return (
    // A `.crt-container` as the app's is, so what floats is drawn inside the theme (themeRoot); sized as a page here.
    <div className={`crt-container theme-${theme}`} style={{
      width: '100%', height: 'auto', minHeight: '100vh', background: 'var(--black, #050805)', color: 'var(--green, #00ff00)',
      fontFamily: 'monospace', display: 'flex', justifyContent: 'center', padding: '20px 16px',
      boxSizing: 'border-box',
    }}>
      {/* Fills the tab rather than sitting in a 900px column with the rest of a monitor
          empty either side - this page exists BECAUSE someone wanted more room than the
          in-app window gives. The cap is only there to stop an ultrawide stretching a
          notes box to a line nobody can read the end of. */}
      <div style={{ width: '100%', maxWidth: '1600px', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid var(--green)', paddingBottom: '8px', marginBottom: '4px',
          letterSpacing: '2px', fontSize: '0.8rem',
        }}>
          <span>CHARACTER_SHEET // {(userName ?? 'UNKNOWN').toUpperCase()}</span>
          <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {userName && (
              <VehicleBadgeButton vehicle={sheet?.inVehicle} occupant={userName} userName={userName}
                onDisembark={(occupant) => socket?.emit('seatOut', { occupant })} />
            )}
            <SheetImportButton socket={socket} system={sheet?.system} data={sheet?.data} at={{ x: 120, y: 80 }}
              className="utility-btn" style={{ fontSize: '0.6rem', padding: '1px 8px', letterSpacing: '1px' }} />
            {template && (
              <span style={{ border: '1px solid var(--green)', padding: '1px 8px', fontSize: '0.65rem' }}>
                {template.name.toUpperCase()}
              </span>
            )}
          </span>
        </div>
        <GiftNotices socket={socket} system={sheet?.system} />
        {lost && (
          <div role="alert" style={{
            border: '1px solid var(--danger)', color: 'var(--danger)', padding: '4px 10px', marginBottom: '4px', fontSize: '0.7rem', letterSpacing: '1px',
          }}>
            CONNECTION LOST · RECONNECTING… What you change now won&apos;t reach the table until it is back.
          </div>
        )}
        {lastRoll && (
          <div style={{
            border: '1px solid var(--green)', background: 'color-mix(in srgb, var(--black) 50%, transparent)',
            padding: '4px 10px', marginBottom: '4px', fontSize: '0.7rem', letterSpacing: '1px',
          }}>
            ⌁ {lastRoll}
          </div>
        )}
        {asked && (
          <div role="status" aria-label="Main window" style={{
            border: `1px solid ${asked.opened === false ? 'var(--warning)' : 'var(--green)'}`,
            color: asked.opened === false ? 'var(--warning)' : 'var(--green)',
            padding: '4px 10px', marginBottom: '4px', fontSize: '0.7rem', letterSpacing: '1px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
          }}>
            <span>
              {asked.opened === null && `ASKING YOUR MAIN WINDOW TO OPEN ${ASK_WORDS[asked.what]}…`}
              {asked.opened === true && `OPENED IN YOUR MAIN WINDOW: ${ASK_WORDS[asked.what]}`}
              {asked.opened === false && `${ASK_WORDS[asked.what]} opens in the main window: open CITY_NET there, signed in as you, and try again.`}
            </span>
            <button type="button" aria-label="Dismiss" onClick={() => setAsked(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
          </div>
        )}
        <SheetCreatingLine template={template} data={sheet?.data}
          onContinue={() => { socket?.emit('creationAction', { kind: 'open' }); setNewCharacterOpen(true); }} />
        {sheet && template ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
            <SheetRenderer
              template={withCreationLocks(template, sheet.data)}
              data={sheet.data}
              portraitUrl={sheet.portrait_url}
              onFieldChange={handleFieldChange}
              onFieldsChange={handleFieldsChange}
              gm={!!adminToken}
              onPortraitUpload={(adminToken || playerToken) ? handlePortraitUpload : undefined}
              onLevelUp={() => setLevelUpOpen(true)}
              onOpenLink={(source) => askMain(askOfLink(source))}
              onSectionAction={(id) => { if (id === 'vehicles') askMain('vehicles'); }}
              {...sheetProps}
            />
          </div>
        ) : (
          <div style={{ fontSize: '0.75rem', opacity: 0.7, padding: '30px 0', letterSpacing: '1px' }}>{message}</div>
        )}
      </div>
      {userName && levelUpOpen && (
        <LevelUpWindow pos={levelUpPos} setPos={setLevelUpPos} socket={socket} userName={userName}
          onLeave={() => setLevelUpOpen(false)} onDone={() => setLevelUpOpen(false)} />
      )}
      {userName && newCharacterOpen && (
        <NewCharacterWindow pos={newCharacterPos} setPos={setNewCharacterPos} socket={socket} userName={userName}
          authToken={adminToken || playerToken} onLeave={() => setNewCharacterOpen(false)} onDone={() => setNewCharacterOpen(false)} />
      )}
    </div>
  );
}
