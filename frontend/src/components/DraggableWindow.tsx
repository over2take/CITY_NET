import React, { useState, useEffect } from 'react';
import notifyOnIcon from '../assets/Notification-on.svg';
import notifyOffIcon from '../assets/Notification-off.svg';

interface DraggableWindowProps {
  title: string;
  children: React.ReactNode;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  windowStyle?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
  titleControls?: React.ReactNode;
}

export function DraggableWindow({
  title, children, pos, setPos, onClose,
  windowStyle = {}, contentStyle = {},
  notificationsEnabled, onToggleNotifications, titleControls,
}: DraggableWindowProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const windowRef = React.useRef<HTMLDivElement>(null);

  // Clamp position when the browser is resized so panels never escape the viewport.
  useEffect(() => {
    const handleResize = () => {
      const el = windowRef.current;
      if (!el) return;
      const w = el.offsetWidth || 300;
      const h = el.offsetHeight || 200;
      const maxX = Math.max(0, window.innerWidth - w);
      const maxY = Math.max(0, window.innerHeight - h);
      setPos({ x: Math.min(pos.x, maxX), y: Math.min(pos.y, maxY) });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [pos, setPos]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, setPos]);

  return (
    <div ref={windowRef} className="win95-window" style={{ left: `${pos.x}px`, top: `${pos.y}px`, ...windowStyle }}>
      <div className="win95-title-bar" onMouseDown={handleMouseDown}>
        <div className="win95-title-text" style={{ fontWeight: 'bold' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {titleControls}
          {onToggleNotifications && (
            <button
              onClick={onToggleNotifications}
              className="win95-close-btn"
              style={{ background: 'var(--black)', padding: '2px', width: '22px', height: '22px' }}
              title="TOGGLE_NOTIFICATIONS"
            >
              <img
                src={notificationsEnabled ? notifyOnIcon : notifyOffIcon}
                width="14" height="14"
                alt="Notify"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </button>
          )}
          <button className="win95-close-btn" onClick={onClose} style={{ width: '22px', height: '22px' }}>×</button>
        </div>
      </div>
      <div className="win95-content" style={contentStyle}>
        {children}
      </div>
    </div>
  );
}
