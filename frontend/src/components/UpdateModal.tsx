import React, { useRef, useState } from 'react';

interface Props {
  current: string;
  latest: string;
  message: string;
  token: string;
  isDocker: boolean;
  onDismiss: () => void;
  onSkip: () => void;
}

export function UpdateModal({ current, latest, message, token, isDocker, onDismiss, onSkip }: Props) {
  const [phase, setPhase] = useState<'idle' | 'updating' | 'failed' | 'done'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [detail, setDetail] = useState('');

  // Draggable
  const modalRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: Math.max(0, window.innerWidth / 2 - 180), y: 80 });

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  };
  const onMouseUp = () => { dragging.current = false; };
  React.useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  /**
   * How long to wait for the server to come back before calling it a failure.
   *
   * A pull and a container recreate is minutes, not seconds, on a slow connection. But
   * it is bounded: the previous version polled every three seconds forever, so a stack
   * that could not update looked identical to one still working, and sat on
   * "WAITING FOR SERVER" indefinitely.
   */
  const DEADLINE_MS = 6 * 60 * 1000;

  const handleUpdate = async () => {
    setPhase('updating');
    setStatusMsg('UPDATE IN PROGRESS — WAITING FOR SERVER...');
    setDetail('');

    let bootId = '';
    try {
      const before = await (await fetch('/api/version')).json();
      bootId = before.bootId ?? '';
    } catch { /* carry on; the restart check falls back to the version */ }

    try {
      const res = await fetch('/api/update', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        // Preflight refused it and said why — much the commonest case being a container
        // started before the compose file mounted itself.
        const body = await res.json().catch(() => ({}));
        setPhase('failed');
        setStatusMsg('UPDATE CANNOT RUN');
        setDetail(body.error || `Server returned ${res.status}.`);
        return;
      }
    } catch (e) {
      setPhase('failed');
      setStatusMsg('UPDATE FAILED TO START');
      setDetail(e instanceof Error ? e.message : 'The server could not be reached.');
      return;
    }

    const deadline = Date.now() + DEADLINE_MS;
    const poll = async () => {
      // The server reports its own failures now, so ask before assuming it is just slow.
      try {
        const st = await (await fetch('/api/update/status')).json();
        if (st.phase === 'failed') {
          setPhase('failed');
          setStatusMsg('UPDATE FAILED');
          setDetail(st.error || 'No reason given.');
          return;
        }
      } catch { /* the server is restarting, which is the point */ }

      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          const data = await res.json();
          // A restart is what matters. Waiting on the version alone hangs forever on a
          // build without APP_VERSION, which reports 'dev' before and after.
          const restarted = bootId ? data.bootId && data.bootId !== bootId : data.version !== current;
          if (restarted) {
            window.location.href = `/?v=${Date.now()}`;
            return;
          }
        }
      } catch { /* server restarting */ }

      if (Date.now() > deadline) {
        setPhase('failed');
        setStatusMsg('UPDATE TIMED OUT');
        setDetail('The server did not come back within six minutes. It may still be pulling — '
          + 'check "docker compose ps" on the host, and backend/data/update.log for what happened.');
        return;
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 10000);
  };

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    zIndex: 1000,
    width: 340,
    background: 'var(--bg, #0a0a0a)',
    border: '1px solid var(--green, #00ff88)',
    fontFamily: 'monospace',
    color: 'var(--green, #00ff88)',
    boxShadow: '0 0 20px rgba(0,255,136,0.15)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid var(--green, #00ff88)',
    cursor: 'grab',
    userSelect: 'none',
    fontSize: '0.65rem',
    letterSpacing: '2px',
    opacity: 0.8,
  };

  const bodyStyle: React.CSSProperties = {
    padding: '16px 12px',
    fontSize: '0.7rem',
    lineHeight: 1.6,
  };

  const btnRow: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    marginTop: '16px',
    flexWrap: 'wrap',
  };

  return (
    <div ref={modalRef} style={panelStyle}>
      <div style={headerStyle} onMouseDown={onMouseDown}>
        <span>SYSTEM_UPDATE</span>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--green, #00ff88)', cursor: 'pointer', fontSize: '0.8rem', opacity: 0.6 }}>×</button>
      </div>
      <div style={bodyStyle}>
        <div style={{ marginBottom: '8px', opacity: 0.7 }}>{message}</div>
        <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>
          running: <span style={{ opacity: 1 }}>{current}</span>
          {' → '}
          available: <span style={{ opacity: 1 }}>{latest}</span>
        </div>
        <div style={{ marginTop: '8px', fontSize: '0.6rem', opacity: 0.5 }}>
          <a
            href="https://github.com/over2take/CITY_NET/blob/main/README.md#updating"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--green, #00ff88)' }}
          >
            README ↗
          </a>
        </div>

        {phase === 'idle' && (
          <>
            {isDocker ? (
              <div style={btnRow}>
                <button className="modal-btn" onClick={handleUpdate}>UPDATE NOW</button>
                <button className="modal-btn" onClick={onDismiss}>REMIND ME LATER</button>
                <button className="modal-btn muted" onClick={onSkip}>SKIP VERSION</button>
              </div>
            ) : (
              <>
                <div style={{ marginTop: '12px', fontSize: '0.65rem', opacity: 0.7 }}>
                  Manual install — pull the latest from the repo to update.
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.6rem', opacity: 0.5 }}>
                  <a
                    href="https://github.com/over2take/CITY_NET/blob/main/README.md#installation"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--green, #00ff88)' }}
                  >
                    INSTALL INSTRUCTIONS ↗
                  </a>
                </div>
                <div style={btnRow}>
                  <button className="modal-btn" onClick={onDismiss}>REMIND ME LATER</button>
                  <button className="modal-btn muted" onClick={onSkip}>SKIP VERSION</button>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'updating' && (
          <div style={{ marginTop: '16px', fontSize: '0.65rem', opacity: 0.8 }}>{statusMsg}</div>
        )}

        {phase === 'failed' && (
          <>
            <div style={{ marginTop: '16px', fontSize: '0.65rem', color: 'var(--danger, #ff4444)' }}>{statusMsg}</div>
            <div style={{ marginTop: '6px', fontSize: '0.6rem', opacity: 0.75, lineHeight: 1.5 }}>{detail}</div>
            <div style={btnRow}>
              <button className="modal-btn" onClick={() => setPhase('idle')}>BACK</button>
              <button className="modal-btn muted" onClick={onDismiss}>CLOSE</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
