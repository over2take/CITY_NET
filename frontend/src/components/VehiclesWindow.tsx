import React, { useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { VehicleArt } from './vehicleArt';

/**
 * Who is in which vehicle.
 *
 * Shared rather than per-sheet: a car with four people in it is one thing the table looks
 * at together, and the old version had each passenger declare their own seat on their own
 * sheet with nothing reconciling them.
 *
 * Every write goes to the server, which owns the rules — a seat has to exist on the
 * vehicle, and only you or the GM can take you out of one. Nothing here is trusted.
 *
 * System-agnostic. What a vehicle type *looks like* and what its seats are *called* are the
 * only two things that vary between rulesets, and both arrive through `look` — so this file
 * holds no game system's data and the second system to want a seating diagram does not have
 * to fork it.
 */

/** What a vehicle type looks like, resolved by whoever owns the game system. */
export interface VehicleLook {
  /** Wireframe key, passed straight to `VehicleArt`. */
  art: string;
  /** Named positions in order. Seats past the end of this list are numbered. */
  seatNames?: string[];
}

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
  ownerName: string;
  crew: number;
  seats: string[];
  /** seat id -> username */
  occupants: Record<string, string>;
  /** seat id -> the friendly NPC token riding in it. */
  guests?: Record<string, { locationId: number; name: string; shape: string }>;
}

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  userName: string;
  isAdmin?: boolean;
  vehicles: RosterVehicle[];
  /** Login name and character name: the first is the key, the second is the label. */
  players: { username: string; name: string }[];
  /** Resolves a vehicle's `type` to its wireframe and seat names. The one seam a game
   *  system reaches through — without it this component would have to know one. */
  look: (type: string) => VehicleLook;
  /** Friendly NPCs on this map level, offered alongside the people at the table. */
  guestTokens?: { locationId: number; name: string; shape: string }[];
}

/**
 * A seat's value has to say *what kind* of occupant it is, not just which one.
 *
 * A username and a token id are both just strings in a dropdown, and a player called "12"
 * would otherwise be indistinguishable from token 12. Prefixing is cheaper than a parallel
 * lookup and cannot go stale.
 */
const asPlayer = (username: string) => `p:${username}`;
const asGuest = (locationId: number) => `t:${locationId}`;

/** Friendlies read blue, the same as in the GM's window, so the colour means one thing. */
const FRIENDLY = '#00ccff';

/** Seat labels come from the vehicle's own list; anything past it is numbered. */
const seatLabel = (named: string | undefined, seatId: string, i: number) =>
  named ?? (seatId === 'driver' ? 'DRIVER' : `CREW ${i + 1}`);

/** Rows of seats a vehicle draws: pairs from the front, plus a lone one at the back. */
export const seatRows = (total: number) => Math.floor(total / 2) + (total % 2);

/**
 * Where each seat's marker and label sit, as percentages of the diagram.
 *
 * Seats pair off from the front, so the first two are the front bench — driver on the
 * left, shotgun beside them — rather than the driver sitting alone at the nose with the
 * passenger behind. An odd seat left at the end goes down the centre line at the back,
 * which is where a rear gunner or a lone rider belongs.
 *
 * Generated rather than hand-placed: crews run from one to sixteen, and sixteen tuned
 * positions per vehicle would be a lot of numbers to get subtly wrong.
 */
export const seatAnchor = (i: number, total: number) => {
  const rows = seatRows(total);
  const top = 22;
  const span = 60;
  const rowY = (r: number) => (rows <= 1 ? top + span / 2 : top + (span * r) / (rows - 1));

  // The odd seat out sits alone, so it takes the centre line rather than a side.
  if (total % 2 === 1 && i === total - 1) {
    return { x: 50, y: rowY(rows - 1), side: 'left' as const };
  }
  const left = i % 2 === 0;
  return { x: left ? 36 : 64, y: rowY(Math.floor(i / 2)), side: left ? ('left' as const) : ('right' as const) };
};

/**
 * Hull colour by how much of it is left — the same thresholds the character health
 * windows use, so a car at a quarter reads as urgently as a person at a quarter.
 */
export const hullColor = (hp: number, hpMax: number) => {
  if (hp <= 0) return 'var(--danger)';
  const pct = hpMax > 0 ? hp / hpMax : 0;
  return pct > 0.5 ? 'var(--green)' : pct > 0.25 ? 'var(--warning)' : 'var(--danger)';
};

export function VehiclesWindow({ pos, setPos, onClose, socket, userName, isAdmin, vehicles, players, look, guestTokens = [] }: Props) {
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [ramArmed, setRamArmed] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onError = (e: { message: string }) => setError(e?.message ?? 'REFUSED');
    socket.on('vehicleSeatingError', onError);
    return () => { socket.off('vehicleSeatingError', onError); };
  }, [socket]);

  const key = (v: RosterVehicle) => `${v.owner}:${v.index}`;
  const current = vehicles.find(v => key(v) === selected) ?? vehicles[0];

  // Ramming is the driver's action, and the server decides that from the seat rather than
  // from anything sent — this only works out whether to draw the button.
  const driving = vehicles.find(v => v.occupants?.driver === userName && !v.destroyed);
  const canRam = !!driving && !!current && key(driving) !== key(current);

  // Disarms itself when the selection moves, so an armed RAM cannot be pointed at a
  // different car by the dropdown and fired by a click meant for the first one.
  useEffect(() => { setRamArmed(false); }, [selected, driving && key(driving)]);

  // Clearing the error on any successful change keeps a stale refusal from sitting there.
  const act = (event: string, payload: Record<string, unknown>) => {
    setError(null);
    socket?.emit(event, payload);
  };

  const setSeat = (vehicle: RosterVehicle, seat: string, value: string) => {
    const sitting = vehicle.occupants[seat];
    const guest = vehicle.guests?.[seat];
    if (!value) {
      // An NPC has no autonomy to protect, so anyone may turn one out — which is also what
      // lets the GM undo an invite they dislike.
      if (guest) return act('unseatGuest', { guestId: guest.locationId, owner: vehicle.owner });
      if (!sitting) return;
      // Only the occupant or the GM may empty a seat. Refusing here as well as on the
      // server saves a round trip for the common case of clicking the wrong row.
      if (sitting !== userName && !isAdmin) return setError('NOT_YOURS');
      return act('seatOut', { occupant: sitting });
    }
    if (value.startsWith('t:')) {
      return act('seatIn', {
        guestId: Number(value.slice(2)),
        owner: vehicle.owner, vehicleIndex: vehicle.index, seat,
      });
    }
    act('seatIn', { occupant: value.slice(2), owner: vehicle.owner, vehicleIndex: vehicle.index, seat });
  };

  const { art, seatNames } = look(current?.type ?? '');

  /**
   * The diagram is sized to the vehicle rather than fixed.
   *
   * Seats pair off down the hull, so what sets the height is how many rows there are —
   * three for a car, eight for an APC. Sized off the crew, a car needs a fraction of the
   * room sixteen people do, and neither has to scroll: the window's content pane caps at
   * 300px and scrolls by default, which a square diagram the width of the window overran
   * every time.
   */
  const rows = seatRows(current?.seats.length ?? 5);
  const diagram = Math.min(540, Math.max(250, Math.round((rows * 34) / 0.6) + 60));

  return (
    <DraggableWindow
      title="VEHICLES"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      // The class sets max-width: 400px, and a max beats a width — so it has to be
      // raised here or the window simply never grows, whatever width it is given.
      windowStyle={{ width: `${Math.max(400, diagram + 56)}px`, maxWidth: '96vw' }}
      // Tall vehicles are still bounded by the viewport rather than running off it.
      contentStyle={{ maxHeight: '84vh' }}
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
            style={{ background: 'color-mix(in srgb, var(--black) 70%, transparent)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px' }}
          >
            {vehicles.map(v => (
              <option key={key(v)} value={key(v)}>
                {v.name.toUpperCase()} · {(v.ownerName || v.owner).toUpperCase()}{v.destroyed ? ' · WRECKED' : ''}
              </option>
            ))}
          </select>

          {current && (
            <>
              <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', letterSpacing: '1px', flexWrap: 'wrap' }}>
                <span>AC {current.ac}</span>
                <span>AR {current.armorRating}</span>
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

              {/* The hull, and the way to change it.
                  Combat writes this field on its own; what it never covered was the repair
                  afterwards, or a crash, or anything else the attack path does not model —
                  all of which meant opening the owner's sheet to edit a number. Only the
                  owner and the GM get the buttons, since taking someone else's car apart
                  is what shooting it is for. */}
              {(() => {
                const pct = current.hpMax > 0 ? Math.max(0, Math.min(1, current.hp / current.hpMax)) : 0;
                const color = hullColor(current.hp, current.hpMax);
                const mine = current.owner === userName || !!isAdmin;
                const send = (sign: number) => {
                  if (!amount) return;
                  act('setVehicleHp', {
                    owner: current.owner,
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
                    {mine && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                        {/* `.win95-window .upload-btn` carries a 15px top margin, which in
                            a flex row pushes both buttons down inside the stretched line
                            while the box fills it — so the box looked taller than the
                            buttons when it was simply the only one at full height. Cleared
                            here rather than in the stylesheet, where every other window
                            still wants the gap.

                            Zero vertical padding on the box for the same reason: the row
                            takes its height from the buttons and the box follows. */}
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Hull amount"
                          placeholder="0"
                          value={amount || ''}
                          // Digits only, and stripped rather than rejected so a pasted
                          // "12hp" still leaves you with 12. The sign belongs to the
                          // button pressed, so a typed minus is not a direction.
                          onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0)}
                          style={{
                            flex: 1, minWidth: 0, boxSizing: 'border-box',
                            background: 'color-mix(in srgb, var(--black) 70%, transparent)', color: 'var(--green)',
                            border: '1px solid var(--green)', fontFamily: 'inherit',
                            fontSize: '0.75rem', padding: '0 8px', textAlign: 'center',
                          }}
                        />
                        <button className="upload-btn" style={{ flex: 1, minWidth: 0, marginTop: 0 }} onClick={() => send(+1)}>REPAIR</button>
                        <button className="upload-btn danger-btn" style={{ flex: 1, minWidth: 0, marginTop: 0 }} onClick={() => send(-1)}>DAMAGE</button>
                      </div>
                    )}

                    {/* Two clicks, because a ram costs you the same damage it deals and a
                        misclick would wreck your own car. The label says whose. */}
                    {canRam && driving && (
                      <button
                        className="upload-btn danger-btn"
                        style={{ width: '100%', marginTop: 0, fontSize: '0.65rem' }}
                        title={`Drive ${driving.name} into ${current.name}. Both take the same damage, armour does not apply, and everyone aboard both takes a Critical Injury.`}
                        onClick={() => {
                          if (!ramArmed) return setRamArmed(true);
                          setRamArmed(false);
                          act('ramVehicle', { owner: current.owner, vehicleIndex: current.index });
                        }}
                      >
                        {ramArmed
                          ? `RAM ${current.name.toUpperCase()} — BOTH TAKE IT. SURE?`
                          : `RAM WITH ${driving.name.toUpperCase()}`}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Square and centred, so the art, its leader lines and the controls at
                  either edge all scale as one piece and cannot drift apart. */}
              <div style={{ position: 'relative', width: `${diagram}px`, height: `${diagram}px`, margin: '0 auto', color: 'var(--green)' }}>
                <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <VehicleArt layout={art} />
                  {current.seats.map((seatId, i) => {
                    const a = seatAnchor(i, current.seats.length);
                    const edge = a.side === 'left' ? 4 : 96;
                    return (
                      <g key={seatId}>
                        {/* Seat furniture is part of the diagram, so it is drawn in the
                            diagram's colour. The accent marks the one thing worth
                            calling out — that somebody is sitting there. */}
                        <path
                          d={`M${a.x} ${a.y} L${edge} ${a.y}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={0.4}
                          opacity={0.4}
                        />
                        <circle
                          cx={a.x}
                          cy={a.y}
                          r={2.4}
                          fill={current.occupants[seatId] ? 'var(--vehicle)' : 'var(--black)'}
                          stroke={current.occupants[seatId] ? 'var(--vehicle)' : 'currentColor'}
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
                  const guest = current.guests?.[seatId];
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
                      <span style={{ fontSize: '0.5rem', letterSpacing: '1px', color: 'var(--green)', opacity: 0.7 }}>
                        {seatLabel(seatNames?.[i], seatId, i)}
                      </span>
                      <select
                        aria-label={seatLabel(seatNames?.[i], seatId, i)}
                        value={sitting ? asPlayer(sitting) : guest ? asGuest(guest.locationId) : ''}
                        onChange={(e) => setSeat(current, seatId, e.target.value)}
                        style={{
                          background: 'color-mix(in srgb, var(--black) 85%, transparent)',
                          // A friendly rider is blue, a person is the vehicle accent. The
                          // seat says which without being read.
                          color: guest ? FRIENDLY : sitting ? 'var(--vehicle)' : 'var(--green)',
                          border: `1px solid ${guest ? FRIENDLY : sitting ? 'var(--vehicle)' : 'var(--dark-green)'}`,
                          fontFamily: 'inherit', fontSize: '0.6rem', padding: '1px 2px', maxWidth: '104px',
                        }}
                      >
                        {/* Every option states its own colour. The select is tinted by who
                            is sitting there, and an option with no colour of its own
                            inherits that — so seating a friendly turned the whole list
                            blue, players included. */}
                        <option value="" style={{ color: 'var(--green)' }}>— EMPTY —</option>
                        {players.map(p => (
                          <option key={p.username} value={asPlayer(p.username)} style={{ color: 'var(--green)' }}>
                            {p.name.toUpperCase()}
                          </option>
                        ))}
                        {/* A rider who has since left this map level keeps an option, or
                            their seat would read as empty and the next change would turn
                            them out without anyone meaning to. */}
                        {guest && !guestTokens.some(t => t.locationId === guest.locationId) && (
                          <option value={asGuest(guest.locationId)} style={{ color: FRIENDLY }}>
                            + {guest.name.toUpperCase()} (OFF MAP)
                          </option>
                        )}
                        {guestTokens.map(t => (
                          <option key={t.locationId} value={asGuest(t.locationId)} style={{ color: FRIENDLY }}>
                            + {t.name.toUpperCase()}
                          </option>
                        ))}
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
