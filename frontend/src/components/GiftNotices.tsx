import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { themeRoot } from '../utils/themeRoot';
import { useWords } from '../sheets/words';
import { noticeText, type AskSocket, type ReceivedNotice } from '../sheets/giveItems';

// What a player sees when the GM gives them something (4g4c; approved mockup
// docs/mockups/give-item.html, 2026-10-12): "THE GM GAVE YOU HEAVY PISTOL ×1", with the GM's note.
// Only the player given it is sent 'itemReceived' (backend sockets/index.js, to their screens alone),
// so a gift can be a secret. It is already on their sheet; this says so.
//
// One box, each gift a row in it, newest first (the user, 2026-11-22: separate boxes "stack and look bad"); each row goes
// 5 seconds after it came ("can we have these time out after 5 seconds?"), held while the pointer or focus is on the box,
// so a player reading one doesn't lose it; ✕ closes them all. A row fades in, and fades out before it goes (the user: it
// "blinks out of existence"), the box with its last; ✕ is at once, the player's own choice. No fades where motion is
// turned down (App.css).

/** How many gifts the box lists at once, newest first. */
export const NOTICES_KEPT = 3;
/** How long each gift is said before it goes, in ms. */
export const NOTICE_MS = 5000;
/** How often a gift held on the screen looks again whether it may go. */
const HELD_RECHECK_MS = 500;
/** How long a gift takes to fade out before it goes, in ms (the fade in App.css .gift-row.leaving). */
export const FADE_MS = 400;

interface Props {
  socket: Pick<AskSocket, 'on' | 'off'> | null;
  /** The running game, for its word for the GM. */
  system: string | null | undefined;
}

export function GiftNotices({ socket, system }: Props) {
  const word = useWords(system);
  const [notices, setNotices] = useState<(ReceivedNotice & { n: number; leaving?: true })[]>([]);
  // The pointer or focus on the box: what is being read isn't taken away.
  const held = useRef(false);

  useEffect(() => {
    if (!socket) return;
    let count = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const heard = (notice: ReceivedNotice) => {
      count += 1;
      const n = count;
      setNotices((prev) => [{ ...notice, n }, ...prev].slice(0, NOTICES_KEPT));
      // Its time up: faded out, then gone.
      const go = () => {
        if (held.current) { later(go, HELD_RECHECK_MS); return; }
        setNotices((prev) => prev.map((x) => (x.n === n ? { ...x, leaving: true as const } : x)));
        later(() => setNotices((prev) => prev.filter((x) => x.n !== n)), FADE_MS);
      };
      later(go, NOTICE_MS);
    };
    socket.on('itemReceived', heard);
    return () => { socket.off('itemReceived', heard); timers.forEach(clearTimeout); };
  }, [socket]);

  if (!notices.length) return null;
  // The last going: the box fades with it.
  const allLeaving = notices.every((g) => g.leaving);

  return createPortal(
    <div data-testid="gift-notices" role="status" className={allLeaving ? 'gift-box leaving' : 'gift-box'} onMouseEnter={() => { held.current = true; }} onMouseLeave={() => { held.current = false; }}
      onFocus={() => { held.current = true; }} onBlur={() => { held.current = false; }}
      style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, width: 'min(420px, calc(100vw - 32px))',
        fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '8px 10px', background: 'var(--black)',
        border: '1px solid var(--warning)', color: 'var(--warning)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div role="list" aria-label="Given to you" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {notices.map((g, i) => (
          <div key={g.n} role="listitem" className={g.leaving ? 'gift-row leaving' : 'gift-row'} style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(i > 0 ? { borderTop: '1px dashed var(--dark-green)', paddingTop: 6 } : {}) }}>
            <span>{noticeText(g, word('gm', 'short', 'GM'))}</span>
            {g.note && <span style={{ color: 'var(--green)', letterSpacing: 0, fontSize: 12 }}>“{g.note}”</span>}
          </div>
        ))}
        <span style={{ color: 'var(--grid-section)', letterSpacing: 0 }}>{notices.length > 1 ? "They're on your sheet." : "It's on your sheet."}</span>
      </div>
      <button type="button" className="win95-close-btn" aria-label="Dismiss" onClick={() => setNotices([])}>✕</button>
    </div>,
    themeRoot(),
  );
}
