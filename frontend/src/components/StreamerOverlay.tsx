import { useEffect, useState } from 'react';
import type { DirectorState, Location } from '../types';
import { HeartMonitor, PersonSVG, INJURY_ZONES } from './HitPoints';

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
export function StreamerOverlay({ socket, directorState, selectedLocation, battleMapLabel }: { socket: any; directorState: DirectorState; selectedLocation: Location | null; battleMapLabel?: string | null }) {
  const [diceEvents, setDiceEvents] = useState<DiceEvent[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onRoll = (data: { userName: string; results: Record<string, number[]>; modifiers: number[]; color: string; total: number }) => {
      // Delay matches the DiceTray rolling animation (5s) so the result isn't
      // spoiled on stream before the roller sees it themselves.
      setTimeout(() => {
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
      }, 5000);
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

      {/* Battle map floor designation */}
      {battleMapLabel && (
        <div style={{
          position: 'absolute', top: directorState.letterbox ? 'calc(10vh + 16px)' : '20px', left: '50%', transform: 'translateX(-50%)',
          animation: 'streamer-chyron-in 0.5s ease-out both',
          color: 'var(--green, #00ff00)', fontSize: '2em', fontWeight: 'bold',
          textShadow: 'var(--glow)', letterSpacing: '3px', textTransform: 'uppercase',
        }}>
          {battleMapLabel}
        </div>
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

      {/* Selected object info card — mirrors the admin's selection */}
      {selectedLocation && (() => {
        const isRhombus = ['rhombus', 'enemy_rhombus', 'friendly_rhombus'].includes(selectedLocation.shape);
        const title = selectedLocation.name
          || (selectedLocation.shape === 'enemy_rhombus' ? 'HOSTILE_NODE'
          : selectedLocation.shape === 'friendly_rhombus' ? 'FRIENDLY_NPC'
          : selectedLocation.shape === 'rhombus' ? 'TACTICAL_BEACON' : 'DATA_POINT');
        return (
          <div style={{
            position: 'absolute', top: directorState.letterbox ? 'calc(10vh + 16px)' : '24px', right: '24px',
            animation: 'streamer-chyron-in 0.4s ease-out both',
            width: '300px', border: '1px solid var(--green, #00ff00)', background: 'rgba(0, 5, 0, 0.9)',
            boxShadow: '0 0 15px rgba(0,255,0,0.25)',
          }}>
            <div style={{ background: 'var(--green, #00ff00)', color: '#000', fontWeight: 'bold', padding: '6px 12px', fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase' }}>
              {title}
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div>
                <span style={{ color: '#fff', fontWeight: 'bold', letterSpacing: '1px' }}>{isRhombus ? 'DATA_DESCRIPTION: ' : 'DESCRIPTION: '}</span>
                <span style={{ color: 'var(--green, #00ff00)' }}>{selectedLocation.description || 'NO_DATA'}</span>
              </div>
              {!isRhombus && (
                <div>
                  <span style={{ color: '#fff', fontWeight: 'bold', letterSpacing: '1px' }}>RESIDENTS: </span>
                  <span style={{ color: 'var(--green, #00ff00)' }}>{selectedLocation.npcs || 'UNKNOWN'}</span>
                </div>
              )}
              {!isRhombus && selectedLocation.district_name && (
                <div>
                  <span style={{ color: '#fff', fontWeight: 'bold', letterSpacing: '1px' }}>DISTRICT: </span>
                  <span style={{ color: 'var(--green, #00ff00)' }}>{selectedLocation.district_name}</span>
                </div>
              )}
              {isRhombus && (() => {
                const hpCurrent = selectedLocation.hp_current ?? 0;
                const hpMax = selectedLocation.hp_max ?? 0;
                const isDead = hpCurrent <= 0;
                const hpPct = hpMax > 0 ? Math.max(0, Math.min(1, hpCurrent / hpMax)) : 0;
                const hpColor = isDead ? '#ff3333' : hpPct > 0.5 ? 'var(--green)' : hpPct > 0.25 ? '#ffaa00' : '#ff3333';
                const injuries: Record<string, boolean> = (() => {
                  try { return JSON.parse((selectedLocation as any).injuries || '{}'); } catch { return {}; }
                })();
                const hasInjuries = Object.values(injuries).some(Boolean);
                return (
                  <>
                    <div style={{ borderTop: '1px solid #0a2a0a', paddingTop: '8px' }}>
                      <HeartMonitor color={hpColor} flatline={isDead} />
                    </div>
                    {hasInjuries && (
                      <div style={{ borderTop: '1px solid #0a2a0a', paddingTop: '8px' }}>
                        <div style={{ fontSize: '9px', color: '#555', letterSpacing: '1px', textAlign: 'center', marginBottom: '6px' }}>INJURY_MAP</div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <div style={{ position: 'relative', width: '90px', height: '105px' }}>
                            <PersonSVG color='var(--green)' style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.4, pointerEvents: 'none' }} />
                            {Object.keys(INJURY_ZONES).map(zone => (
                              <div key={zone} style={{
                                position: 'absolute',
                                background: injuries[zone] ? 'rgba(255,0,0,0.3)' : 'transparent',
                                border: injuries[zone] ? '1px solid rgba(255,50,50,0.7)' : '1px solid transparent',
                                borderRadius: '3px',
                                pointerEvents: 'none',
                                ...INJURY_ZONES[zone],
                              }} />
                            ))}
                          </div>
                        </div>
                        {(['blind', 'bleeding'] as const).filter(c => injuries[c]).map(cond => (
                          <div key={cond} style={{ textAlign: 'center', color: '#ff3333', fontSize: '10px', letterSpacing: '1px', marginTop: '4px' }}>
                            ⚠ {cond.toUpperCase()}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        );
      })()}

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
