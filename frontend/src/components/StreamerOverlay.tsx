import { useEffect, useState } from 'react';
import type { DirectorState } from '../types';

interface DiceEvent {
  id: string;
  userName: string;
  total: number;
  expression: string;
  breakdown: string;
  color: string;
}

// Broadcast HUD for the spectator window: scene title chyron, dice lower-third,
// optional cinematic letterbox. Pure DOM — sits on top of the Canvas.
export function StreamerOverlay({ socket, directorState }: { socket: any; directorState: DirectorState }) {
  const [diceEvents, setDiceEvents] = useState<DiceEvent[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onRoll = (data: { userName: string; results: Record<string, number[]>; modifiers: number[]; color: string; total: number }) => {
      const parts = Object.entries(data.results || {})
        .filter(([, rolls]) => rolls.length > 0)
        .map(([sides, rolls]) => `${rolls.length}D${sides}`);
      const modTotal = (data.modifiers || []).reduce((a, b) => a + b, 0);
      let expression = parts.join(' + ');
      if (modTotal !== 0) expression += ` ${modTotal > 0 ? '+' : '−'} ${Math.abs(modTotal)}`;
      const breakdown = Object.values(data.results || {}).flat().join(' · ');

      const id = Math.random().toString(36).slice(2, 9);
      setDiceEvents(prev => [...prev.slice(-2), { id, userName: data.userName, total: data.total, expression, breakdown, color: data.color || '#00ff00' }]);
      setTimeout(() => setDiceEvents(prev => prev.filter(e => e.id !== id)), 8000);
    };
    socket.on('diceRollBroadcast', onRoll);
    return () => { socket.off('diceRollBroadcast', onRoll); };
  }, [socket]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5000, fontFamily: 'monospace' }}>
      <style>{`
        @keyframes streamer-slide-in { from { transform: translateX(-110%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes streamer-chyron-in { from { transform: translateY(-150%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* Cinematic letterbox */}
      {directorState.letterbox && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '10vh', background: '#000' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '10vh', background: '#000' }} />
        </>
      )}

      {/* Scene title chyron */}
      {directorState.sceneTitle && (
        <div style={{
          position: 'absolute', top: directorState.letterbox ? 'calc(10vh + 16px)' : '24px', left: '24px',
          animation: 'streamer-chyron-in 0.5s ease-out both',
          background: 'rgba(0, 10, 0, 0.82)', border: '1px solid var(--green, #00ff00)',
          borderLeft: '4px solid var(--green, #00ff00)', padding: '8px 18px',
          color: 'var(--green, #00ff00)', letterSpacing: '3px', fontSize: '15px',
          textTransform: 'uppercase', textShadow: '0 0 8px rgba(0,255,0,0.7)',
        }}>
          {directorState.sceneTitle}
        </div>
      )}

      {/* Dice lower-thirds */}
      <div style={{
        position: 'absolute', bottom: directorState.letterbox ? 'calc(10vh + 16px)' : '32px', left: '24px',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}>
        {diceEvents.map(e => (
          <div key={e.id} style={{
            animation: 'streamer-slide-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
            display: 'flex', alignItems: 'center', gap: '14px',
            background: 'rgba(0, 10, 0, 0.85)', border: `1px solid ${e.color}`,
            borderLeft: `4px solid ${e.color}`, padding: '10px 18px', minWidth: '260px',
          }}>
            <div style={{ fontSize: '30px', fontWeight: 'bold', color: e.color, textShadow: `0 0 10px ${e.color}` }}>
              {e.total}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ color: '#fff', fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase' }}>{e.userName}</div>
              <div style={{ color: e.color, fontSize: '11px', letterSpacing: '1px', opacity: 0.9 }}>{e.expression}</div>
              {e.breakdown && <div style={{ color: '#888', fontSize: '10px', letterSpacing: '1px' }}>{e.breakdown}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
