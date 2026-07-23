import React, { useRef, useEffect, useState } from 'react';
import type { Combatant } from '../hooks/useInitiative';

interface Props {
  combatant: Combatant;
  index: number;
  isActive: boolean;
  isAdmin: boolean;
  onRemove: (id: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
}

export function InitiativeCombatantRow({ combatant, index, isActive, isAdmin, onRemove, onDragStart, onDragOver, onDrop }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showExplod, setShowExplod] = useState(combatant.exploded ?? false);

  useEffect(() => {
    if (combatant.exploded) {
      setShowExplod(true);
      const t = setTimeout(() => setShowExplod(false), 1400);
      return () => clearTimeout(t);
    }
  }, [combatant.id, combatant.exploded]);

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 6px',
    borderBottom: '1px solid var(--dark-green)',
    background: isActive ? 'rgba(0,255,0,0.08)' : 'transparent',
    borderLeft: isActive ? '2px solid var(--green)' : '2px solid transparent',
    cursor: isAdmin ? 'grab' : 'default',
    userSelect: 'none',
  };

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      className={showExplod ? 'initiative-explod-row' : undefined}
      draggable={isAdmin}
      onDragStart={() => isAdmin && onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); isAdmin && onDragOver(index); }}
      onDrop={() => isAdmin && onDrop()}
    >
      {/* Portrait */}
      <div style={{ width: 28, height: 28, borderRadius: 2, overflow: 'hidden', flexShrink: 0, background: 'rgba(0,40,0,0.6)', border: '1px solid var(--dark-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {combatant.portraitUrl
          ? <img src={combatant.portraitUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <span style={{ fontSize: '0.6rem', color: 'var(--dark-green)' }}>{combatant.isNpc ? '◆' : '◈'}</span>
        }
      </div>

      {/* Name */}
      <span title={combatant.name.toUpperCase()} style={{ flex: 1, fontSize: '0.75rem', color: isActive ? 'var(--green)' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isActive && '▶ '}{combatant.name.toUpperCase()}
      </span>

      {/* Score */}
      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isActive ? 'var(--green)' : 'inherit', minWidth: 24, textAlign: 'right' }}>
        {combatant.score}
      </span>


      {/* EXPLOD badge */}
      {showExplod && (
        <span style={{ fontSize: '0.55rem', letterSpacing: '1px', color: '#ffffff', background: 'var(--green)', padding: '1px 4px', borderRadius: 2, fontWeight: 'bold', flexShrink: 0 }}>
          EXPLOD
        </span>
      )}

      {/* Admin trash */}
      {isAdmin && (
        <button
          onClick={() => onRemove(combatant.id)}
          title="REMOVE"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: '0.7rem', padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff4444')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
        >
          ✕
        </button>
      )}
    </div>
  );
}
