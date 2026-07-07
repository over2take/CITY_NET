import React, { useRef, useState } from 'react';

interface Props {
  current: string;
  latest: string;
  message: string;
  token: string;
  onDismiss: () => void;
  onSkip: () => void;
}

export function UpdateModal({ current, latest, message, token, onDismiss, onSkip }: Props) {
  const [phase, setPhase] = useState<'idle' | 'updating' | 'done'>('idle');
  const [statusMsg, setStatusMsg] = useState('');

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
    setStatusMsg('Update in progress — waiting for server...');
    try {
      await fetch('/api/update', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const poll = async () => {
        try {
          const res = await fetch('/api/version');
          if (!res.ok) throw new Error();
          const data = await res.json();
          if (data.version !== current) {
            window.location.href = `/?v=${Date.now()}`;
            return;
          }
        } catch { /* server restarting */ }
        setTimeout(poll, 3000);
      };
      setTimeout(poll, 10000);
    } catch {
      setStatusMsg('Update failed — try manually from the nav panel');
    }
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

  const btn = (color = 'var(--green, #00ff88)'): React.CSSProperties => ({
    background: 'none',
    border: `1px solid ${color}`,
    color,
    fontFamily: 'monospace',
    fontSize: '0.6rem',
    letterSpacing: '1px',
    padding: '5px 10px',
    cursor: 'pointer',
    flex: 1,
  });

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
          <div style={btnRow}>
            <button style={btn()} onClick={handleUpdate}>UPDATE NOW</button>
            <button style={btn()} onClick={onDismiss}>REMIND ME LATER</button>
            <button style={btn('rgba(0,255,136,0.4)')} onClick={onSkip}>SKIP VERSION</button>
          </div>
        )}

        {phase === 'updating' && (
          <div style={{ marginTop: '16px', fontSize: '0.65rem', opacity: 0.8 }}>{statusMsg}</div>
        )}
      </div>
    </div>
  );
}
