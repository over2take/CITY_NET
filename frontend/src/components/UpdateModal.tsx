import React, { useRef, useState } from 'react';
import { startUpdate, waitForRestart, currentBootId } from '../utils/updateClient';

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

  const handleUpdate = async () => {
    setPhase('updating');
    setStatusMsg('CHECKING SERVER...');
    setDetail('');
    setCommand('');

    const bootId = await currentBootId();
    const started = await startUpdate(token);
    if (!started.ok) {
      setPhase('failed');
      setStatusMsg(started.command ? 'THIS CONTAINER CANNOT UPDATE ITSELF' : 'UPDATE CANNOT RUN');
      setDetail(started.error ?? '');
      setCommand(started.command ?? '');
      return;
    }

    setStatusMsg('UPDATE IN PROGRESS — WAITING FOR SERVER...');
    await waitForRestart({
      bootId,
      currentVersion: current,
      onRestart: () => { window.location.href = `/?v=${Date.now()}`; },
      onStillWorking: () => setStatusMsg('STILL WORKING — PULLING IMAGES, THIS CAN TAKE A FEW MINUTES...'),
      onFailed: (error, cmd) => {
        setPhase('failed');
        setStatusMsg('UPDATE FAILED');
        setDetail(error);
        setCommand(cmd ?? '');
      },
    });
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
            href="https://github.com/over2take/CITY_NET/blob/main/UPGRADE.md"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--green, #00ff88)' }}
          >
            UPGRADE GUIDE ↗
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
