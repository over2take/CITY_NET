import React, { useState, useEffect } from 'react';
import { DraggableWindow } from './DraggableWindow';
import type { Location } from '../types';
// Inline SVGs so we can tint them with CSS `color` (currentColor)
export const PersonSVG = ({ color = 'currentColor', style }: { color?: string; style?: React.CSSProperties }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill={color} style={style}>
    <path d="M128 68a28 28 0 1 0-28-28a28 28 0 0 0 28 28m0-48a20 20 0 1 1-20 20a20 20 0 0 1 20-20m87.42 116.78l-45.25-51.3a28 28 0 0 0-21-9.48h-42.34a28 28 0 0 0-21 9.48l-45.25 51.3a16 16 0 0 0 22.56 22.69L89 138.7l-19.7 74.88a16 16 0 0 0 29.08 13.35L128 176l29.58 51a16 16 0 0 0 29.08-13.35L167 138.7l25.9 20.77a16 16 0 0 0 22.56-22.69Zm-5.76 16.87a8 8 0 0 1-11.31 0a3 3 0 0 0-.33-.29l-35.51-28.48a4 4 0 0 0-6.38 4.13L179 215.94a4 4 0 0 0 .24.67a8 8 0 1 1-14.5 6.76c-.05-.11-.11-.21-.17-.32L131.46 166a4 4 0 0 0-6.92 0l-33.12 57.05c-.06.11-.12.21-.17.32a8 8 0 1 1-14.5-6.76a4 4 0 0 0 .24-.67L99.87 129a4 4 0 0 0-6.38-4.13L58 153.36a3 3 0 0 0-.33.29a8 8 0 0 1-11.31-11.31l.17-.18l45.3-51.39a20 20 0 0 1 15-6.77h42.34a20 20 0 0 1 15 6.77l45.32 51.39l.17.18a8 8 0 0 1 0 11.31" />
  </svg>
);

const EyeSVG = ({ color = 'currentColor', size = 18 }: { color?: string; size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill={color} width={size} height={size}>
    <path d="M243.66 126.38c-.34-.76-8.52-18.89-26.83-37.2C199.87 72.22 170.7 52 128 52S56.13 72.22 39.17 89.18c-18.31 18.31-26.49 36.44-26.83 37.2a4.08 4.08 0 0 0 0 3.25c.34.77 8.52 18.89 26.83 37.2c17 17 46.14 37.17 88.83 37.17s71.87-20.21 88.83-37.17c18.31-18.31 26.49-36.43 26.83-37.2a4.08 4.08 0 0 0 0-3.25m-32.7 35c-23.07 23-51 34.62-83 34.62s-59.89-11.65-83-34.62A135.7 135.7 0 0 1 20.44 128A135.7 135.7 0 0 1 45 94.62C68.11 71.65 96 60 128 60s59.89 11.65 83 34.62A135.8 135.8 0 0 1 235.56 128A135.7 135.7 0 0 1 211 161.38ZM128 84a44 44 0 1 0 44 44a44.05 44.05 0 0 0-44-44m0 80a36 36 0 1 1 36-36a36 36 0 0 1-36 36" />
  </svg>
);

const BloodSVG = ({ color = 'currentColor', size = 18 }: { color?: string; size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width={size} height={size}>
    <g fill={color}>
      <path d="M15.465 31.398a1 1 0 1 0-1.902.62a11.53 11.53 0 0 0 4.178 5.767a11.48 11.48 0 0 0 6.759 2.203c.552 0 1-.449 1-1.003s-.448-1.003-1-1.003a9.5 9.5 0 0 1-5.584-1.82a9.53 9.53 0 0 1-3.451-4.764" />
      <path fillRule="evenodd" d="m24 4l-.69.66l-.004.004l-.009.008l-.032.032l-.122.119q-.16.157-.456.455a72 72 0 0 0-6.492 7.621C12.681 17.68 9 24.082 9 30.08C9 37.845 15.796 44 24 44s15-6.155 15-13.92c0-6-3.681-12.401-7.195-17.18a72 72 0 0 0-6.492-7.622a42 42 0 0 0-.578-.574l-.032-.032l-.01-.008zm-1.451 4.334A64 64 0 0 1 24 6.8a70 70 0 0 1 6.195 7.29C33.681 18.832 37 24.777 37 30.08c0 6.503-5.74 11.914-13 11.914S11 36.583 11 30.08c0-5.303 3.319-11.248 6.805-15.99a70 70 0 0 1 4.744-5.756" clipRule="evenodd" />
    </g>
  </svg>
);

interface HitPointsMenuProps {
  targetRhombus: Location | null;
  token: string;
  refreshLocations: () => void;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  /** Active game system - CWN shows the STIM_HEAL (+1 STRAIN) button. */
  gameSystem?: string;
}

const BODY_PARTS = ['head', 'right_arm', 'torso', 'left_arm', 'right_leg', 'left_leg'] as const;
type BodyPart = typeof BODY_PARTS[number];
type StatusFlag = 'blind' | 'bleeding';
type InjuryMap = Partial<Record<BodyPart | StatusFlag, boolean>>;

const PART_LABELS: Record<BodyPart, string> = {
  head:      'HEAD',
  right_arm: 'R.ARM',
  torso:     'TORSO',
  left_arm:  'L.ARM',
  right_leg: 'R.LEG',
  left_leg:  'L.LEG',
};

const baseBtn: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.5px',
  cursor: 'pointer', border: '1px solid #333', background: '#111',
  color: '#666', borderRadius: '3px', padding: '6px 5px',
  transition: 'all 0.15s', userSelect: 'none',
};
const injuredBtn: React.CSSProperties = {
  ...baseBtn, background: '#3a0000', border: '1px solid #ff3333',
  color: '#ff3333', textShadow: '0 0 6px #ff3333',
};
const iconBtn = (active: boolean): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: '9px', cursor: 'pointer',
  borderRadius: '3px', userSelect: 'none', transition: 'all 0.15s',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  gap: '4px', padding: '6px 10px',
  background: active ? '#3a0000' : '#001a00',
  border: active ? '1px solid #ff3333' : '1px solid var(--green)',
  color: active ? '#ff3333' : 'var(--green)',
  textShadow: active ? '0 0 6px #ff3333' : '0 0 4px var(--green)',
});

const hitZone = (injured: boolean | undefined): React.CSSProperties => ({
  position: 'absolute',
  background: injured ? 'rgba(255,0,0,0.18)' : 'transparent',
  border: injured ? '1px solid rgba(255,50,50,0.5)' : '1px solid transparent',
  borderRadius: '3px',
  cursor: 'pointer',
  transition: 'background 0.15s, border 0.15s',
});

export function HitPointsMenu({ targetRhombus, token, refreshLocations, pos, setPos, onClose, gameSystem }: HitPointsMenuProps) {
  const [actionAmount, setActionAmount] = useState(0);
  const [tempAmount, setTempAmount] = useState(0);
  const [maxAmount, setMaxAmount] = useState(0);
  const [injuriesOpen, setInjuriesOpen] = useState(false);
  const [injuries, setInjuries] = useState<InjuryMap>({});
  const [healMsg, setHealMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!targetRhombus) return;
    try {
      const raw = (targetRhombus as any).injuries;
      setInjuries(raw ? JSON.parse(raw) : {});
    } catch { setInjuries({}); }
  }, [targetRhombus?.id, (targetRhombus as any)?.injuries]);

  const saveInjuries = async (next: InjuryMap) => {
    if (!targetRhombus) return;
    setInjuries(next);
    await fetch(`/api/locations/${targetRhombus.id}/injuries`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ injuries: next }),
    });
  };

  const toggleInjury = (key: BodyPart | StatusFlag) =>
    saveInjuries({ ...injuries, [key]: !injuries[key] });

  const updateHealth = async (action: string, amount: number) => {
    if (!targetRhombus) return;
    const bodyData: any = { action, amount };
    if (action === 'set_temp') bodyData.hp_temp = amount;
    if (action === 'set_max') bodyData.hp_max = amount;
    const res = await fetch(`/api/locations/${targetRhombus.id}/health`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(bodyData),
    });
    if (action === 'stim_heal') {
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setHealMsg(body?.error ?? 'STRAIN MAXED — NO STIM BENEFIT');
      } else if (res.ok) {
        setHealMsg('STIM HEAL — +1 STRAIN');
      }
      setTimeout(() => setHealMsg(null), 3000);
    }
    refreshLocations();
  };

  const anyInjured = Object.values(injuries).some(Boolean);


  return (
    <>
    <DraggableWindow
      title={targetRhombus ? `HP: ${targetRhombus.name || 'UNKNOWN'}` : 'HIT_POINTS'}
      pos={pos} setPos={setPos} onClose={onClose}
      windowStyle={{ width: '300px', minHeight: '400px', overflow: 'visible' }}
      contentStyle={{ overflow: 'visible' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px' }}>

        {!targetRhombus ? (
          <div style={{ textAlign: 'center', opacity: 0.7, padding: '20px' }}>NO_TARGET_ACQUIRED</div>
        ) : (<>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <div style={{ fontSize: '2rem', color: 'var(--green)', textShadow: 'var(--glow)', fontWeight: 'bold' }}>
              {targetRhombus.hp_current || 0} / {targetRhombus.hp_max || 0}
            </div>
            <button
              onClick={() => setInjuriesOpen(o => !o)}
              title="INJURIES"
              style={{
                background: injuriesOpen ? 'var(--green)' : 'transparent',
                border: '1px solid var(--green)',
                borderRadius: '3px',
                padding: '4px 6px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <PersonSVG color={injuriesOpen ? '#000' : 'var(--green)'} style={{ width: 18, height: 18, display: 'block' }} />
            </button>
          </div>
            {(targetRhombus.hp_temp ?? 0) > 0 && (
              <div style={{ color: '#00ccff', fontSize: '0.85rem', textShadow: '0 0 6px #00ccff' }}>+ {targetRhombus.hp_temp} TEMP</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <input type="number" placeholder="0" value={actionAmount || ''} onChange={e => setActionAmount(parseInt(e.target.value) || 0)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="upload-btn" onClick={() => updateHealth('heal', actionAmount)} style={{ flex: 1 }}>HEAL</button>
              <button className="upload-btn danger-btn" onClick={() => updateHealth('damage', actionAmount)} style={{ flex: 1 }}>DAMAGE</button>
            </div>
            {gameSystem === 'cities_without_number' && (
              <button
                className="upload-btn"
                title="Field healing (stims, medkits): heals and adds +1 System Strain to the character's sheet. Refused when strain is maxed - no stim benefit. Use HEAL for natural/rest healing."
                onClick={() => updateHealth('stim_heal', actionAmount)}
                disabled={!!healMsg}
                style={{
                  width: '100%',
                  color: healMsg?.includes('MAXED') ? '#ff3333' : '#ffcc00',
                  borderColor: healMsg?.includes('MAXED') ? '#ff3333' : '#ffcc00',
                }}
              >
                {healMsg ?? 'STIM_HEAL (+1 STRAIN)'}
              </button>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {token !== '' && (
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>MAX_HP</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input type="number" placeholder="0" value={maxAmount || ''} onChange={e => setMaxAmount(parseInt(e.target.value) || 0)} style={{ flex: 1 }} />
                  <button className="upload-btn" style={{ minWidth: 'auto', padding: '0 15px' }} onClick={() => updateHealth('set_max', maxAmount)}>SET</button>
                </div>
              </div>
            )}
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>TEMP_HP</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="number" placeholder="0" max="100"
                  value={tempAmount || ''}
                  onChange={e => { let val = parseInt(e.target.value) || 0; if (val > 100) val = 100; setTempAmount(val); }}
                  style={{ flex: 1 }}
                />
                <button className="upload-btn" style={{ minWidth: 'auto', padding: '0 15px' }} onClick={() => updateHealth('set_temp', tempAmount)}>SET</button>
              </div>
            </div>
          </div>
        </>)}
      </div>

    </DraggableWindow>

    {/* Injuries slide-out panel — sibling of DraggableWindow, tracks pos so it moves with dragging */}
    {injuriesOpen && targetRhombus && (
      <div style={{
        position: 'absolute',
        left: `${pos.x + 298}px`,
        top: `${pos.y + 2}px`,
        width: '195px',
        background: 'var(--black)',
        border: '2px solid var(--green)',
        borderLeft: 'none',
        padding: '8px 8px 6px',
        display: 'flex', flexDirection: 'column', gap: '4px',
        boxSizing: 'border-box',
        zIndex: 999,
      }}>
        <div style={{ fontSize: '9px', color: '#555', fontFamily: 'monospace', letterSpacing: '1px', textAlign: 'center' }}>
          INJURY_MAP
        </div>

        <div style={{ position: 'relative', width: '130px', height: '148px', margin: '0 auto' }}>
          <PersonSVG color="var(--green)" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, pointerEvents: 'none' }} />
          <button title="HEAD" onClick={() => toggleInjury('head')} style={{ ...hitZone(injuries.head), left: '38%', top: '9%', width: '24%', height: '20%' }} />
          <button title="TORSO" onClick={() => toggleInjury('torso')} style={{ ...hitZone(injuries.torso), left: '33%', top: '29%', width: '34%', height: '35%' }} />
          <button title="R.ARM" onClick={() => toggleInjury('right_arm')} style={{ ...hitZone(injuries.right_arm), left: '6%', top: '29%', width: '26%', height: '35%' }} />
          <button title="L.ARM" onClick={() => toggleInjury('left_arm')} style={{ ...hitZone(injuries.left_arm), left: '68%', top: '29%', width: '26%', height: '35%' }} />
          <button title="R.LEG" onClick={() => toggleInjury('right_leg')} style={{ ...hitZone(injuries.right_leg), left: '26%', top: '65%', width: '22%', height: '30%' }} />
          <button title="L.LEG" onClick={() => toggleInjury('left_leg')} style={{ ...hitZone(injuries.left_leg), left: '52%', top: '65%', width: '22%', height: '30%' }} />
        </div>

        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '2px' }}>
          <button style={iconBtn(!!injuries.blind)} onClick={() => toggleInjury('blind')} title="BLIND">
            <EyeSVG color={injuries.blind ? '#ff3333' : 'var(--green)'} />
            <span style={{ fontSize: '8px' }}>BLIND</span>
          </button>
          <button style={iconBtn(!!injuries.bleeding)} onClick={() => toggleInjury('bleeding')} title="BLEEDING">
            <BloodSVG color={injuries.bleeding ? '#ff3333' : 'var(--green)'} />
            <span style={{ fontSize: '8px' }}>BLEED</span>
          </button>
        </div>

        {anyInjured && (
          <button
            className="utility-btn danger-btn"
            style={{ width: '80%', fontSize: '9px', marginTop: '2px', alignSelf: 'center' }}
            onClick={() => saveInjuries({})}
          >
            CLEAR ALL
          </button>
        )}
      </div>
    )}
    </>
  );
}

// ─── Read-only health review window ───────────────────────────────────────────

interface HealthReviewWindowProps {
  location: Location & { injuries?: string };
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  /** CWN: any player viewing a downed character can attempt to stabilize
   *  them (an ally's Main Action - the server rolls the CLICKING user's
   *  Heal skill). Needs the socket and the active system to show. */
  socket?: any;
  gameSystem?: string;
  /** Called after emitting a roll so the app can pop the dice tray. */
  onRolled?: () => void;
}

export function HeartMonitor({ color, flatline }: { color: string; flatline: boolean }) {
  return (
    <div style={{ width: '100%', height: '50px', overflow: 'hidden', background: '#000', borderRadius: '3px', border: '1px solid #0a2a0a' }}>
      <style>{`
        @keyframes ekg-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .ekg-live { animation: ekg-scroll 2.4s linear infinite; width: 200%; display: block; }
        .ekg-dead { width: 100%; display: block; }
      `}</style>
      {flatline ? (
        <svg className="ekg-dead" height="50" viewBox="0 0 280 50"
          style={{ filter: `drop-shadow(0 0 2px ${color})` }}>
          <line x1="0" y1="25" x2="280" y2="25" stroke={color} strokeWidth="1.5" />
        </svg>
      ) : (
        <svg className="ekg-live" height="50" viewBox="0 0 560 50" preserveAspectRatio="none"
          style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
          <polyline points="0,25 27,25 34,20 42,25 49,25 56,5 60,45 64,5 68,25 80,30 87,25 127,25 280,25"
            fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
          <polyline points="280,25 307,25 314,20 322,25 329,25 336,5 340,45 344,5 348,25 360,30 367,25 407,25 560,25"
            fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export const INJURY_ZONES: Record<string, React.CSSProperties> = {
  head:      { left: '38%', top: '9%',  width: '24%', height: '20%' },
  torso:     { left: '33%', top: '29%', width: '34%', height: '35%' },
  right_arm: { left: '6%',  top: '29%', width: '26%', height: '35%' },
  left_arm:  { left: '68%', top: '29%', width: '26%', height: '35%' },
  right_leg: { left: '26%', top: '65%', width: '22%', height: '30%' },
  left_leg:  { left: '52%', top: '65%', width: '22%', height: '30%' },
};

export function HealthReviewWindow({ location, pos, setPos, onClose, socket, gameSystem, onRolled }: HealthReviewWindowProps) {
  const [reviewInjuriesOpen, setReviewInjuriesOpen] = useState(false);

  const injuries: Record<string, boolean> = (() => {
    try { return JSON.parse((location as any).injuries || '{}'); } catch { return {}; }
  })();

  const hpCurrent = location.hp_current ?? 0;
  const hpMax = location.hp_max ?? 0;
  const hpTemp = location.hp_temp ?? 0;
  const hpPct = hpMax > 0 ? Math.max(0, Math.min(1, hpCurrent / hpMax)) : 0;
  const isDead = hpCurrent <= 0;
  const hpColor = isDead ? '#ff3333' : hpPct > 0.5 ? 'var(--green)' : hpPct > 0.25 ? '#ffaa00' : '#ff3333';

  return (
    <DraggableWindow
      title={`HEALTH: ${(location.owner || 'UNKNOWN').toUpperCase()}`}
      pos={pos} setPos={setPos} onClose={onClose}
      windowStyle={{ width: '280px' }}
      contentStyle={{ overflowY: 'visible' }}
    >
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* Injury map toggle */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setReviewInjuriesOpen(o => !o)}
            title="VIEW INJURIES"
            style={{
              background: reviewInjuriesOpen ? 'var(--green)' : 'transparent',
              border: '1px solid var(--green)',
              borderRadius: '3px', padding: '4px 6px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <PersonSVG color={reviewInjuriesOpen ? '#000' : 'var(--green)'} style={{ width: 16, height: 16, display: 'block' }} />
          </button>
        </div>

        {/* Heart monitor — flatlines at 0 HP */}
        <HeartMonitor color={hpColor} flatline={isDead} />

        {/* CWN: downed player - any viewer can attempt the stabilize check
            (rolls the viewer's own Heal skill server-side) */}
        {gameSystem === 'cities_without_number' && isDead && socket && location.shape === 'rhombus' && location.owner && (
          <button
            onClick={() => {
              socket.emit('requestStabilize', { targetUsername: location.owner });
              onRolled?.();
            }}
            title="An ally's Main Action: 2d6 + YOUR Heal + INT mod vs 8 + rounds down. Success: they recover to 1 HP with the Frail condition."
            style={{
              alignSelf: 'center', background: 'none', border: '1px solid #ff3333', color: '#ff3333',
              fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '1px', padding: '4px 14px',
              cursor: 'pointer', animation: 'death-pulse 1.2s ease-in-out infinite',
            }}
          >
            STABILIZE (YOUR HEAL CHECK)
          </button>
        )}

        {/* Temp HP */}
        {hpTemp > 0 && (
          <div style={{ textAlign: 'center', color: '#00ccff', fontSize: '0.8rem', textShadow: '0 0 6px #00ccff' }}>
            + {hpTemp} TEMP
          </div>
        )}

        {/* Injury map — slides open below, same width as window */}
        <div style={{
          overflow: 'hidden',
          maxHeight: reviewInjuriesOpen ? '400px' : '0px',
          transition: 'max-height 0.3s ease',
        }}>
          <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '9px', color: '#555', fontFamily: 'monospace', letterSpacing: '1px', textAlign: 'center' }}>
              INJURY_MAP
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center' }}>
              {/* Body silhouette */}
              <div style={{ position: 'relative', width: '110px', height: '128px', flexShrink: 0 }}>
                <PersonSVG color="var(--green)" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, pointerEvents: 'none' }} />
                {Object.keys(INJURY_ZONES).map(zone => (
                  <div key={zone} title={zone.replace('_', ' ').toUpperCase()} style={{
                    position: 'absolute',
                    background: injuries[zone] ? 'rgba(255,0,0,0.25)' : 'transparent',
                    border: injuries[zone] ? '1px solid rgba(255,50,50,0.6)' : '1px solid transparent',
                    borderRadius: '3px',
                    pointerEvents: 'none',
                    ...INJURY_ZONES[zone],
                  }} />
                ))}
              </div>

              {/* BLIND / BLEED vertically centered alongside body */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(['blind', 'bleeding'] as const).map(cond => {
                  const active = !!injuries[cond];
                  return (
                    <div key={cond} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                      padding: '6px 10px',
                      border: `1px solid ${active ? '#ff3333' : 'var(--green)'}`,
                      background: active ? '#3a0000' : '#001a00',
                      borderRadius: '3px',
                    }}>
                      {cond === 'blind'
                        ? <EyeSVG color={active ? '#ff3333' : 'var(--green)'} />
                        : <BloodSVG color={active ? '#ff3333' : 'var(--green)'} />}
                      <span style={{ fontSize: '8px', color: active ? '#ff3333' : 'var(--green)', fontFamily: 'monospace' }}>
                        {cond === 'blind' ? 'BLIND' : 'BLEED'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

      </div>
    </DraggableWindow>
  );
}
