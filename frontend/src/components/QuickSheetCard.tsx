import React, { useEffect, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';

interface QuickSheetFields {
  handle?: string;
  name?: string;
  role?: string;
  description?: string;
  [key: string]: string | number | undefined;
}

interface QuickSheetData {
  username: string;
  system: string;
  portrait_url: string | null;
  exists: boolean;
  fields: QuickSheetFields;
}

interface QuickSheetCardProps {
  username: string;
  socket: any;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
}

const bracketStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  flexShrink: 0,
  border: '2px solid var(--green)',
  borderRadius: 2,
  background: '#001a00',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  position: 'relative',
};

const cornerSize = 8;
const Brackets = () => (
  <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 72 72">
    {/* corners */}
    <line x1="0" y1={cornerSize} x2="0" y2="0" stroke="var(--green)" strokeWidth="3" />
    <line x1="0" y1="0" x2={cornerSize} y2="0" stroke="var(--green)" strokeWidth="3" />
    <line x1={72 - cornerSize} y1="0" x2="72" y2="0" stroke="var(--green)" strokeWidth="3" />
    <line x1="72" y1="0" x2="72" y2={cornerSize} stroke="var(--green)" strokeWidth="3" />
    <line x1="72" y1={72 - cornerSize} x2="72" y2="72" stroke="var(--green)" strokeWidth="3" />
    <line x1="72" y1="72" x2={72 - cornerSize} y2="72" stroke="var(--green)" strokeWidth="3" />
    <line x1={cornerSize} y1="72" x2="0" y2="72" stroke="var(--green)" strokeWidth="3" />
    <line x1="0" y1="72" x2="0" y2={72 - cornerSize} stroke="var(--green)" strokeWidth="3" />
  </svg>
);

export function QuickSheetCard({ username, socket, pos, setPos, onClose }: QuickSheetCardProps) {
  const [data, setData] = useState<QuickSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const listenerRef = useRef<((d: any) => void) | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handler = (d: any) => {
      if (d.username === username) {
        setData(d);
        setLoading(false);
      }
    };
    listenerRef.current = handler;
    socket.on('quickSheetData', handler);
    socket.emit('requestQuickSheet', { username });

    return () => {
      if (listenerRef.current) socket.off('quickSheetData', listenerRef.current);
    };
  }, [socket, username]);

  const fields = data?.fields ?? {};
  const displayName = fields.handle || fields.name || username;
  const role = fields.role;
  const description = fields.description;

  return (
    <DraggableWindow
      title={`ID: ${username.toUpperCase()}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: 260 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ color: 'var(--green)', fontSize: 10, opacity: 0.6, textAlign: 'center', padding: '12px 0' }}>
            FETCHING_IDENT…
          </div>
        ) : !data?.exists ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={bracketStyle}>
                <Brackets />
                <span style={{ fontSize: 22, opacity: 0.25 }}>?</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--green)', fontWeight: 'bold', letterSpacing: 1 }}>
                  {username.toUpperCase()}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#666', marginTop: 4 }}>
                  NO_IDENT_ON_FILE
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={bracketStyle}>
                <Brackets />
                {data.portrait_url ? (
                  <img
                    src={data.portrait_url}
                    alt={displayName}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <span style={{ fontFamily: 'monospace', fontSize: 22, color: 'var(--green)', opacity: 0.35, userSelect: 'none' }}>
                    {displayName[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--green)', fontWeight: 'bold', letterSpacing: 1, wordBreak: 'break-word' }}>
                  {String(displayName).toUpperCase()}
                </div>
                {role && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#aaffaa', marginTop: 3, letterSpacing: 0.5, opacity: 0.8 }}>
                    {String(role).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
            {description && (
              <div style={{
                fontFamily: 'monospace', fontSize: 9, color: '#888',
                lineHeight: 1.5, borderTop: '1px solid #0a2a0a', paddingTop: 8,
                wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              }}>
                {String(description)}
              </div>
            )}
          </>
        )}
      </div>
    </DraggableWindow>
  );
}
