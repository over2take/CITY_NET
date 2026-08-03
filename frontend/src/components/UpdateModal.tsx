import React, { useRef, useState } from 'react';

interface Props {
  current: string;
  latest: string;
  message: string;
  /** A release-channel contradiction, shown regardless of whether an update exists. */
  warning?: string;
  token: string;
  isDocker: boolean;
  onDismiss: () => void;
  onSkip: () => void;
}

export function UpdateModal({ current, latest, message, warning, token, isDocker, onDismiss, onSkip }: Props) {
  const [phase, setPhase] = useState<'idle' | 'updating' | 'failed' | 'done'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [detail, setDetail] = useState('');
  const [command, setCommand] = useState('');

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

  /** Long enough that a normal pull has not finished, short enough to reassure. */
  const REASSURE_MS = 45 * 1000;

  /** What to run on the host when the container cannot update itself. */
  const MANUAL_COMMAND = 'docker compose pull && docker compose up -d';

  /**
   * Does the server behind this page have the self-checking updater?
   *
   * A container from before it has no `/api/update/status`, and asking is the one
   * reliable way to find out — its `/api/update` cheerfully answers "Update started"
   * and then does nothing, which is the whole failure being guarded against here.
   *
   * The shape is checked, not just the status code: a setup that serves index.html for
   * unknown paths would otherwise answer 200 with a page and look modern.
   */
  const hasModernUpdater = async () => {
    try {
      const res = await fetch('/api/update/status');
      if (!res.ok) return false;
      const data = await res.json();
      return typeof data?.phase === 'string';
    } catch {
      return false;
    }
  };

  const handleUpdate = async () => {
    setPhase('updating');
    setStatusMsg('CHECKING SERVER...');
    setDetail('');

    if (!(await hasModernUpdater())) {
      // Told immediately rather than after a six-minute wait for a restart that this
      // container was never going to perform.
      setPhase('failed');
      setStatusMsg('THIS CONTAINER CANNOT UPDATE ITSELF');
      setDetail('It was built before the self-updating backend, so the in-app update would '
        + 'report success and then do nothing. Run this on the host, in the folder holding '
        + 'docker-compose.yml — after that, in-app updates work.');
      setCommand(MANUAL_COMMAND);
      return;
    }

    setStatusMsg('UPDATE IN PROGRESS — WAITING FOR SERVER...');

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

    const started = Date.now();
    const deadline = started + DEADLINE_MS;
    const poll = async () => {
      if (Date.now() - started > REASSURE_MS) {
        setStatusMsg('STILL WORKING — PULLING IMAGES, THIS CAN TAKE A FEW MINUTES...');
      }
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
        setDetail('The server did not come back within six minutes. Check backend/data/update.log '
          + 'for what happened, then recreate the stack from the host:');
        setCommand(MANUAL_COMMAND);
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
        {warning && (
          <div
            style={{
              margin: '8px 0', padding: '6px 8px', fontSize: '0.6rem', lineHeight: 1.5,
              border: '1px solid var(--danger, #ff4444)', color: 'var(--danger, #ff4444)',
            }}
          >
            {warning}
          </div>
        )}
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
            {command && (
              <div
                style={{
                  marginTop: '8px', padding: '6px 8px', fontSize: '0.6rem',
                  border: '1px solid var(--green, #00ff88)', background: 'rgba(0,0,0,0.4)',
                  userSelect: 'all', wordBreak: 'break-all',
                }}
              >
                {command}
              </div>
            )}
            <div style={btnRow}>
              <button className="modal-btn" onClick={() => { setPhase('idle'); setCommand(''); }}>BACK</button>
              <button className="modal-btn muted" onClick={onDismiss}>CLOSE</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
