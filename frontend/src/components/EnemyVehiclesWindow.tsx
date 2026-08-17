import React, { useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { VehicleArt } from './vehicleArt';
import { seatAnchor, hullColor, type VehicleLook } from './VehiclesWindow';
import type { EnemyVehicle, EnemyCrew } from '../hooks/useEnemyVehicles';

/**
 * The GM's enemy vehicles.
 *
 * A sibling of the player window rather than a mode of it, for the same reason the server
 * side is a sibling: these are keyed by NPC sheet id, not by username. Sharing the component
 * would mean threading two shapes of occupant through every dropdown to save a diagram.
 *
 * What *is* shared is the geometry and the colours — `seatAnchor` and `hullColor` are
 * imported, so a car reads the same on both windows and a hull at a quarter looks as urgent
 * here as it does there.
 *
 * GM-only, which is what this window is for: the roster never reaches a player's client, so
 * nothing here has to reason about what may be shown to whom.
 */

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  vehicles: EnemyVehicle[];
  crew: EnemyCrew[];
  /** Resolves a vehicle's stored type to its wireframe, as on the player window. */
  look: (type: string) => VehicleLook;
  /** Asked for on open, since an NPC sheet may have been edited while this was shut. */
  refresh: () => void;
}

const key = (v: EnemyVehicle) => `${v.sheetId}:${v.index}`;

/** Grouped by the NPC's folder: a campaign of antagonists is not one flat list. */
const groupLabel = (v: EnemyVehicle) => v.folder ?? 'UNFILED';

export function EnemyVehiclesWindow({ pos, setPos, onClose, socket, vehicles, crew, look, refresh }: Props) {
  const [selected, setSelected] = useState<string>('');
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!socket) return;
    const onError = (e: { message: string }) => setError(e?.message ?? 'REFUSED');
    socket.on('vehicleSeatingError', onError);
    return () => { socket.off('vehicleSeatingError', onError); };
  }, [socket]);

  const current = vehicles.find(v => key(v) === selected) ?? vehicles[0];
  const act = (event: string, payload: Record<string, unknown>) => {
    setError(null);
    socket?.emit(event, payload);
  };

  const { art } = look(current?.type ?? '');
  const rows = Math.floor((current?.seats.length ?? 4) / 2) + ((current?.seats.length ?? 4) % 2);
  const diagram = Math.min(480, Math.max(220, Math.round((rows * 30) / 0.6) + 50));

  return (
    <DraggableWindow
      title="ENEMY VEHICLES"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      // The class caps max-width at 400px and a max beats a width, so it has to be raised
      // here or the window never grows past the cap whatever width it is given.
      windowStyle={{ width: `${Math.max(400, diagram + 56)}px`, maxWidth: '96vw' }}
      contentStyle={{ maxHeight: '84vh' }}
    >
      {vehicles.length === 0 ? (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px 4px' }}>
          NO ENEMY VEHICLES. Fill one in on the GEAR tab of an NPC sheet — it needs an HP
          maximum before it counts. NPC sheets keep them between sessions.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <select
            aria-label="Enemy vehicle"
            value={current ? key(current) : ''}
            onChange={(e) => setSelected(e.target.value)}
            style={{ background: 'rgba(0,10,0,0.7)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px' }}
          >
            {[...new Set(vehicles.map(groupLabel))].map(folder => (
              <optgroup key={folder} label={folder}>
                {vehicles.filter(v => groupLabel(v) === folder).map(v => (
                  <option key={key(v)} value={key(v)}>
                    {v.name.toUpperCase()} · {v.owner.toUpperCase()}{v.destroyed ? ' · WRECKED' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {current && (
            <>
              <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', letterSpacing: '1px', flexWrap: 'wrap' }}>
                <span>AC {current.ac}</span>
                <span>AR {current.armorRating}</span>
                <span style={{ opacity: 0.6 }}>{current.crew} SEATS</span>
                <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={current.moving}
                    onChange={(e) => act('setEnemyVehicleMoving', { sheetId: current.sheetId, vehicleIndex: current.index, moving: e.target.checked })}
                  />
                  MOVING
                </label>
              </div>

              {(() => {
                const pct = current.hpMax > 0 ? Math.max(0, Math.min(1, current.hp / current.hpMax)) : 0;
                const color = hullColor(current.hp, current.hpMax);
                const send = (sign: number) => {
                  if (!amount) return;
                  act('setEnemyVehicleHp', {
                    sheetId: current.sheetId,
                    vehicleIndex: current.index,
                    delta: sign * Math.abs(amount),
                  });
                  setAmount(0);
                };
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', letterSpacing: '1px', color }}>
                      <span>{current.destroyed ? 'WRECKED' : 'HULL'}</span>
                      <span>{current.hp} / {current.hpMax}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Hull"
                      aria-valuenow={current.hp}
                      aria-valuemin={0}
                      aria-valuemax={current.hpMax}
                      style={{ height: '8px', background: 'rgba(0,0,0,0.6)', border: `1px solid ${color}`, borderRadius: '2px', overflow: 'hidden' }}
                    >
                      <div style={{ width: `${pct * 100}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label="Hull amount"
                        placeholder="0"
                        value={amount || ''}
                        onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0)}
                        style={{
                          flex: 1, minWidth: 0, boxSizing: 'border-box',
                          background: 'rgba(0,10,0,0.7)', color: 'var(--green)',
                          border: '1px solid var(--green)', fontFamily: 'inherit',
                          fontSize: '0.75rem', padding: '0 8px', textAlign: 'center',
                        }}
                      />
                      {/* `.win95-window .upload-btn` carries a 15px top margin, which in a
                          flex row leaves the buttons sitting low against a full-height box. */}
                      <button className="upload-btn" style={{ flex: 1, minWidth: 0, marginTop: 0 }} onClick={() => send(+1)}>REPAIR</button>
                      <button className="upload-btn danger-btn" style={{ flex: 1, minWidth: 0, marginTop: 0 }} onClick={() => send(-1)}>DAMAGE</button>
                    </div>
                  </div>
                );
              })()}

              {/* The diagram is read-only for now: seating an NPC needs an occupancy field
                  keyed by sheet id, which the player path spells as a username. Until then
                  this shows the shape and how many places it has. */}
              <div style={{ position: 'relative', width: `${diagram}px`, height: `${diagram}px`, margin: '0 auto', color: 'var(--green)' }}>
                <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <VehicleArt layout={art} />
                  {current.seats.map((seatId, i) => {
                    const a = seatAnchor(i, current.seats.length);
                    return (
                      <g key={seatId}>
                        <circle cx={a.x} cy={a.y} r={2.4} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.7} />
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div style={{ fontSize: '0.6rem', opacity: 0.5, letterSpacing: '1px', textAlign: 'center' }}>
                {crew.length} NPC{crew.length === 1 ? '' : 'S'} AVAILABLE · SEATING TO COME
              </div>
            </>
          )}

          {error && (
            <div style={{ fontSize: '0.65rem', color: '#ff4444', letterSpacing: '1px' }}>
              {error.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}
    </DraggableWindow>
  );
}
