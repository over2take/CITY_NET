import React, { useState, useEffect } from 'react';
import notifyOnIcon from '../assets/Notification-on.svg';
import notifyOffIcon from '../assets/Notification-off.svg';

let zCounter = 2000;

interface DraggableWindowProps {
  title: string;
  centerTitle?: React.ReactNode;
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
  title, centerTitle, children, pos, setPos, onClose,
  windowStyle = {}, contentStyle = {},
  notificationsEnabled, onToggleNotifications, titleControls,
}: DraggableWindowProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [zIndex, setZIndex] = useState(() => ++zCounter);
  const windowRef = React.useRef<HTMLDivElement>(null);

  const bringToFront = () => setZIndex(++zCounter);

  // Keep the window fully inside the viewport. When the window is taller
  // than the viewport, pin its top edge (y=0) so the title bar - and with
  // it dragging and the close button - always stays reachable.
  const clamp = (p: { x: number; y: number }) => {
    const el = windowRef.current;
    const w = el?.offsetWidth || 300;
    const h = el?.offsetHeight || 200;
    return {
      x: Math.max(0, Math.min(p.x, window.innerWidth - w)),
      y: Math.max(0, Math.min(p.y, window.innerHeight - h)),
    };
  };
  const setClampedPos = (p: { x: number; y: number }) => {
    const c = clamp(p);
    if (c.x !== pos.x || c.y !== pos.y) setPos(c);
  };

  // Clamp on mount (a stored/default position may be off-screen for this
  // viewport) and whenever the browser is resized.
  useEffect(() => {
    setClampedPos(pos);
    const handleResize = () => setClampedPos(pos);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) setPos(clamp({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y }));
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
  }, [isDragging, dragOffset, setPos]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={windowRef} className="win95-window" style={{ left: `${pos.x}px`, top: `${pos.y}px`, zIndex, ...windowStyle }}>
      <div className="win95-title-bar" onMouseDown={(e) => { bringToFront(); handleMouseDown(e); }} style={{ position: 'relative' }}>
        <div className="win95-title-text" style={{ fontWeight: 'bold' }}>{title}</div>
        {centerTitle && (
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
            {centerTitle}
          </div>
        )}
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
