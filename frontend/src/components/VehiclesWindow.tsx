import React, { useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { VehicleArt } from './vehicleArt';
import { getPreset } from '../sheets/vehiclePresets';

/**
 * Who is in which vehicle.
 *
 * Shared rather than per-sheet: a car with four people in it is one thing the table looks
 * at together, and the old version had each passenger declare their own seat on their own
 * sheet with nothing reconciling them.
 *
 * Every write goes to the server, which owns the rules — a seat has to exist on the
 * vehicle, and only you or the GM can take you out of one. Nothing here is trusted.
 */

export interface RosterVehicle {
  owner: string;
  index: number;
  name: string;
  type: string;
  ac: number;
  armorRating: number;
  hp: number;
  hpMax: number;
  moving: boolean;
  destroyed: boolean;
  crew: number;
  seats: string[];
  /** seat id -> username */
  occupants: Record<string, string>;
}

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  userName: string;
  isAdmin?: boolean;
  vehicles: RosterVehicle[];
  players: string[];
}

/** Seat labels come from the book vehicle; anything past those is numbered. */
const seatLabel = (vehicle: RosterVehicle, seatId: string, i: number) => {
  const named = getPreset(vehicle.type)?.seatNames?.[i];
  return named ?? (seatId === 'driver' ? 'DRIVER' : `CREW ${i + 1}`);
};

/**
 * Where each seat's marker and label sit, as percentages of the diagram.
 *
 * Generated rather than hand-placed: crews run from one to sixteen, and sixteen
 * hand-tuned anchors per vehicle would be a lot of numbers to get subtly wrong. The
 * driver takes the nose; everyone else fills alternating sides down the hull.
 */
const seatAnchor = (i: number, total: number) => {
  if (i === 0) return { x: 50, y: 16, side: 'left' as const };
  const rows = Math.ceil((total - 1) / 2);
  const row = Math.floor((i - 1) / 2);
  const left = (i - 1) % 2 === 0;
  const top = 34;
  const span = 52;
  const y = rows <= 1 ? top + span / 2 : top + (span * row) / (rows - 1);
  return { x: left ? 36 : 64, y, side: left ? ('left' as const) : ('right' as const) };
};

export function VehiclesWindow({ pos, setPos, onClose, socket, userName, isAdmin, vehicles, players }: Props) {
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;
    const onError = (e: { message: string }) => setError(e?.message ?? 'REFUSED');
    socket.on('vehicleSeatingError', onError);
    return () => { socket.off('vehicleSeatingError', onError); };
  }, [socket]);

  const key = (v: RosterVehicle) => `${v.owner}:${v.index}`;
  const current = vehicles.find(v => key(v) === selected) ?? vehicles[0];

  // Clearing the error on any successful change keeps a stale refusal from sitting there.
  const act = (event: string, payload: Record<string, unknown>) => {
    setError(null);
    socket?.emit(event, payload);
  };

  const setSeat = (vehicle: RosterVehicle, seat: string, occupant: string) => {
    const sitting = vehicle.occupants[seat];
    if (!occupant) {
      if (!sitting) return;
      // Only the occupant or the GM may empty a seat. Refusing here as well as on the
      // server saves a round trip for the common case of clicking the wrong row.
      if (sitting !== userName && !isAdmin) return setError('NOT_YOURS');
      return act('seatOut', { occupant: sitting });
    }
    act('seatIn', { occupant, owner: vehicle.owner, vehicleIndex: vehicle.index, seat });
  };

  const art = getPreset(current?.type ?? '')?.art ?? 'car';

  return (
    <DraggableWindow
      title="VEHICLES"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '470px' }}
    >
      {vehicles.length === 0 ? (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px 4px' }}>
          NO VEHICLES. Fill one in on the GEAR tab of a character sheet — it needs an HP
          maximum before it counts as a vehicle.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <select
            aria-label="Vehicle"
            className="sheet-input"
            value={current ? key(current) : ''}
            onChange={(e) => setSelected(e.target.value)}
            style={{ background: 'rgba(0,10,0,0.7)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px' }}
          >
            {vehicles.map(v => (
              <option key={key(v)} value={key(v)}>
                {v.name.toUpperCase()} · {v.owner.toUpperCase()}{v.destroyed ? ' · WRECKED' : ''}
              </option>
            ))}
          </select>

          {current && (
            <>
              <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', letterSpacing: '1px', flexWrap: 'wrap' }}>
                <span>AC {current.ac}</span>
                <span>AR {current.armorRating}</span>
                <span>{current.hp}/{current.hpMax} HP</span>
                <span style={{ opacity: 0.6 }}>{Object.keys(current.occupants).length}/{current.crew} ABOARD</span>
                <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={current.moving}
                    onChange={(e) => act('setVehicleMoving', { owner: current.owner, vehicleIndex: current.index, moving: e.target.checked })}
                  />
                  MOVING
                </label>
              </div>

              <div style={{ position: 'relative', width: '100%', aspectRatio: '1', color: 'var(--green)' }}>
                <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <VehicleArt layout={art} />
                  {current.seats.map((seatId, i) => {
                    const a = seatAnchor(i, current.seats.length);
                    const edge = a.side === 'left' ? 4 : 96;
                    return (
                      <g key={seatId}>
                        <path
                          d={`M${a.x} ${a.y} L${edge} ${a.y}`}
                          fill="none"
                          stroke="#ffcc00"
                          strokeWidth={0.4}
                          opacity={0.55}
                        />
                        <circle
                          cx={a.x}
                          cy={a.y}
                          r={2.4}
                          fill={current.occupants[seatId] ? '#ffcc00' : 'rgba(0,0,0,0.8)'}
                          stroke="#ffcc00"
                          strokeWidth={1}
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* The controls sit over the diagram, at the end of each leader line. */}
                {current.seats.map((seatId, i) => {
                  const a = seatAnchor(i, current.seats.length);
                  const sitting = current.occupants[seatId] ?? '';
                  const mine = sitting === userName;
                  return (
                    <div
                      key={seatId}
                      style={{
                        position: 'absolute',
                        top: `${a.y}%`,
                        [a.side === 'left' ? 'left' : 'right']: 0,
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: a.side === 'left' ? 'flex-start' : 'flex-end',
                        gap: '1px',
                      } as React.CSSProperties}
                    >
                      <span style={{ fontSize: '0.5rem', letterSpacing: '1px', color: '#ffcc00', opacity: 0.85 }}>
                        {seatLabel(current, seatId, i)}
                      </span>
                      <select
                        aria-label={seatLabel(current, seatId, i)}
                        value={sitting}
                        onChange={(e) => setSeat(current, seatId, e.target.value)}
                        style={{
                          background: 'rgba(0,10,0,0.85)',
                          color: mine ? '#ffcc00' : 'var(--green)',
                          border: `1px solid ${sitting ? '#ffcc00' : 'var(--dark-green)'}`,
                          fontFamily: 'inherit', fontSize: '0.6rem', padding: '1px 2px', maxWidth: '104px',
                        }}
                      >
                        <option value="">— EMPTY —</option>
                        {players.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>

              {current.destroyed && (
                <div style={{ fontSize: '0.65rem', color: '#ff4444', letterSpacing: '1px' }}>
                  WRECKED — it is no longer cover for anyone inside it.
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{ fontSize: '0.65rem', color: '#ff4444' }}>
              {error === 'NOT_YOURS'
                ? 'ONLY THAT PLAYER — OR THE GM — CAN TAKE THEM OUT.'
                : error.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}
    </DraggableWindow>
  );
}
