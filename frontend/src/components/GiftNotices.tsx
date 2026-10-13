import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { themeRoot } from '../utils/themeRoot';
import { useWords } from '../sheets/words';
import { noticeText, type AskSocket, type ReceivedNotice } from '../sheets/giveItems';

// What a player sees when the GM gives them something (4g4c; approved mockup
// docs/mockups/give-item.html, 2026-10-12): "THE GM GAVE YOU HEAVY PISTOL ×1", with the GM's note.
// Only the player given it is sent 'itemReceived' (backend sockets/index.js, to their screens alone),
// so a gift can be a secret. It is already on their sheet; this says so. Each stays until closed,
// so a player away from the keys still sees it; the last few are kept.

/** How many notices stay up at once, newest first. */
export const NOTICES_KEPT = 3;

interface Props {
  socket: Pick<AskSocket, 'on' | 'off'> | null;
  /** The running game, for its word for the GM. */
  system: string | null | undefined;
}

export function GiftNotices({ socket, system }: Props) {
  const word = useWords(system);
  const [notices, setNotices] = useState<(ReceivedNotice & { n: number })[]>([]);

  useEffect(() => {
    if (!socket) return;
    let count = 0;
    const heard = (notice: ReceivedNotice) => {
      count += 1;
      const n = count;
      setNotices((prev) => [{ ...notice, n }, ...prev].slice(0, NOTICES_KEPT));
    };
    socket.on('itemReceived', heard);
    return () => { socket.off('itemReceived', heard); };
  }, [socket]);

  if (!notices.length) return null;
  const dismiss = (n: number) => setNotices((prev) => prev.filter((x) => x.n !== n));

  return createPortal(
    <div data-testid="gift-notices" style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 3000,
      display: 'flex', flexDirection: 'column', gap: 6, width: 'min(420px, calc(100vw - 32px))' }}>
      {notices.map((g) => (
        <div key={g.n} role="status" style={{
          fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '8px 10px', background: 'var(--black)',
          border: '1px solid var(--warning)', color: 'var(--warning)', display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>{noticeText(g, word('gm', 'short', 'GM'))}</span>
            {g.note && <span style={{ color: 'var(--green)', letterSpacing: 0, fontSize: 12 }}>“{g.note}”</span>}
            <span style={{ color: 'var(--grid-section)', letterSpacing: 0 }}>It's on your sheet.</span>
          </div>
          <button type="button" className="win95-close-btn" aria-label="Dismiss" onClick={() => dismiss(g.n)}>✕</button>
        </div>
      ))}
    </div>,
    themeRoot(),
  );
}
