import React, { useState } from 'react';
import type { Location } from '../types';
import { HitPointsPanel } from './HitPoints';
import { ModelHealthDescription } from './HealthModelPanels';
import { useHealthView } from '../hooks/useHealthView';
import { isCustomSystem } from '../sheets';
import { useWords } from '../sheets/words';
import { amountOf, healthBody, takesAnAmount, hasHealth, hasStim, type Defense, type SheetVitals, type VitalsAction } from '../sheets/vitals';
import { createPlayerTokenRow } from './tokenActions';
import { TokenConditions } from './TokenConditions';
import { TurnAskRolls } from './TurnAskRolls';
import { WaitingHits } from './WaitingHits';
import { DyingBox } from './DyingBox';
import type { DyingShown } from '../sheets/dyingBox';
import { useWaitingHits } from '../hooks/useWaitingHits';

// The vitals strip (8s3b; mockup docs/mockups/vitals-strip.html, approved 2026-11-17), in the sheet header on every tab of
// SHEET.EXE and the standalone tab alike. For one pool of hit points, a box under the HP bar (the user, 2026-11-17: the bar
// kept, the boxes laid out like D&D Beyond's): HEAL, the amount and DAMAGE stacked on the left; CURRENT / MAX and TEMP large beside them,
// TEMP set by clicking it; the system's word for hit points under them, opening the HEALTH window's own panel right here
// for everything else. The same route as HEALTH, so the token, the map and every open sheet move together; the map's
// HEALTH window is unchanged. Another health model has HEALTH ▾ to change it.
//
// 8s3c: under the box, the token's conditions as chips (+ puts one on, what each means on hover), and REST ▾ where there is
// a rest to take here, opening the sheet's own RESTS (asked first, dice spent, FINISH) in place. 8a6c: the chips in a row of
// their own over + CONDITION, two lines at most then "+N", each opening under the row with TAKE OFF where its × was.
// 8a9c2: right under the box, a roll a condition's EACH TURN asks of this token, POISONED · YOUR SAVE and ROLL SAVE, until rolled.
// 8s4a (the user, 2026-11-24: "make the MAX number editable"): MAX set by clicking it, as TEMP is, both typed in place, the
// size of the number and underlined, no box (the user: "that box just does not fit"). Where a formula works MAX out, the
// server keeps what was typed as an ADJUST over it.
// 8c3: under the box, the DYING box while the token is down under the game's dying rule (components/DyingBox.tsx).

const small: React.CSSProperties = {
  background: 'none', fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '2px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
};
const button = (color: string): React.CSSProperties => ({ ...small, color, border: `1px solid ${color}` });
const label: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '2px', opacity: 0.7 };
const big: React.CSSProperties = { fontSize: '1.6rem', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' };

export function VitalsStrip({ vitals, open, onToggle, rests, restCalled = false, maxNote, defense, dying, gm = false }: {
  vitals: SheetVitals; open: boolean; onToggle: () => void;
  /** The sheet's RESTS section, where there is a rest to take from here (8s3c); none otherwise. */
  rests?: React.ReactNode;
  /** The GM has called a rest that waits on this character. */
  restCalled?: boolean;
  /** What made the maximum ("20 → 26 (Tough +6)"): MAX in cyan, saying it on hover, as the HEALTH section did. */
  maxNote?: string;
  /** The token's armor class as the game has it (sheets/vitals.ts defenseOf): its name, and a ranged one's; none without. */
  defense?: Defense;
  /** The game's rule for when health runs out (8c3), for the DYING box; none without. */
  dying?: DyingShown;
  /** The GM looking: A TURN GOES BY in the DYING box. */
  gm?: boolean;
}) {
  const { token, system, authToken, socket, reload } = vitals;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  /** What the server said happened, for a model that says more than the numbers (a track spilling over, 8s3d1). */
  const [said, setSaid] = useState<string | null>(null);
  /** Two tracks: the one DAMAGE and HEAL hit, and the box shows (8s3d1); null is the first. */
  const [track, setTrack] = useState<string | null>(null);
  /** TEMP being typed, after a click on it; null while it shows. */
  const [tempText, setTempText] = useState<string | null>(null);
  /** MAX being typed, after a click on it (8s4a); null while it shows. */
  const [maxText, setMaxText] = useState<string | null>(null);
  const [restsOpen, setRestsOpen] = useState(restCalled);
  // Where + CONDITION's list opens: under the row, full width, as REST's drawer does.
  const [pickerHost, setPickerHost] = useState<HTMLDivElement | null>(null);
  // A rest the GM calls opens REST ▾ by itself (8s3c): it is the sheet's only RESTS now. Adjusted while rendering, as
  // React's docs do it for a prop that changed, rather than in an effect.
  const [callSeen, setCallSeen] = useState(restCalled);
  if (callSeen !== restCalled) {
    setCallSeen(restCalled);
    if (restCalled) setRestsOpen(true);
  }
  // A custom system's model, as HEALTH reads it: null for the built-in games, which are one pool.
  const view = useHealthView(socket, token?.id, isCustomSystem(system));
  // Hits waiting on this character under CONFIRM (8b6b2; mockup waiting-hits, section 4): under the box, folded past two.
  const waiting = useWaitingHits(socket, token?.id, isCustomSystem(system));
  const word = useWords(system);
  const hp = word('hp', 'short', 'HP').toUpperCase();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };

  // Under the box (8s3c): the token's conditions, and REST ▾.
  const restButton = rests && (
    <button type="button" aria-expanded={restsOpen} onClick={() => setRestsOpen((o) => !o)}
      title={restCalled ? 'The GM has called a rest: open it here' : 'Take a rest here, as on STATS'}
      style={{
        ...button(restCalled ? 'var(--warning)' : 'var(--green)'), marginLeft: 'auto',
        // Solid as the box's other buttons, filled while open (the user, 2026-11-17).
        ...(restsOpen ? { background: restCalled ? 'var(--warning)' : 'var(--green)', color: 'var(--black)' } : {}),
      }}>
      {restCalled ? 'REST · CALLED' : 'REST'} {restsOpen ? '▴' : '▾'}
    </button>
  );
  const restPanel = rests && restsOpen && (
    <div role="region" aria-label="Take a rest" style={{ border: '1px solid var(--dark-green)', padding: '8px 10px' }}>{rests}</div>
  );

  if (!token) {
    // As HEALTH's CREATE HEALTH RECORD: the player's token row, then the sheet asked for again with it.
    const create = () => createPlayerTokenRow({ fetch: (url, init) => fetch(url, init), authToken, refreshLocations: reload }, vitals.owner);
    return (
      <>
        <div role="group" aria-label="Vitals" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
          <span style={{ opacity: 0.7 }}>NO TOKEN ON THE MAP</span>
          <button type="button" onClick={() => { void create(); }} style={button('var(--green)')}>CREATE HEALTH RECORD</button>
          {restButton}
        </div>
        {restPanel}
      </>
    );
  }
  // The token's armor class for quick reference while playing (the user, 2026-11-17), read only, as the game has it:
  // one, two (CWN's melee and ranged, both always; an unset ranged is the melee one, as the token menu says) or none.
  // The token's own as its menu reads it: none set is 10 there (App's `melee_ac ?? 10`), so here too.
  const melee = defense?.rangedWhenSet ? (token.melee_ac ?? 10) : token.melee_ac;
  const ranged = token.ranged_ac ?? melee;
  // The token's own ranged one, as its menu: only where it was set apart from the melee one.
  const rangedShown = defense?.ranged && (!defense.rangedWhenSet || (token.ranged_ac !== null && token.ranged_ac !== undefined && token.ranged_ac !== melee))
    ? defense.ranged : undefined;
  const ac = defense && melee !== null && melee !== undefined && (
    <span role="note" aria-label={`${defense.label} ${melee}${rangedShown ? `, ${rangedShown} ${ranged}` : ''}`}
      title={`Your token's ${rangedShown ? `${defense.label} and ${rangedShown}` : defense.label}: what an attack has to reach.`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid var(--green)', padding: '2px 7px', fontSize: '0.6rem', letterSpacing: '1px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
      <span style={{ opacity: 0.7 }}>{defense.label}</span>
      <b style={{ fontSize: '0.8rem' }}>{melee}</b>
      {rangedShown && <><span style={{ opacity: 0.7 }}>{rangedShown}</span><b style={{ fontSize: '0.8rem' }}>{ranged}</b></>}
    </span>
  );
  // The token's conditions as chips, its armor class and REST ▾ beside them.
  const below = (
    <>
      <TurnAskRolls socket={socket} tokenId={token.id} />
      <WaitingHits view={waiting.view} act={waiting.act} gm={word('gm', 'short', 'GM')} fold />
      {/* The conditions in a row of their own over + CONDITION (8a6c), so that line stays put as they come and go; on it
          REST right, and the AC centered between (the user, 2026-11-17). Too narrow for all three (CWN's two ACs in
          SHEET.EXE), the AC wraps to a line of its own rather than overlapping. */}
      <TokenConditions compact pickerHost={pickerHost} location={token as unknown as Location} gameSystem={system} socket={socket} canChange authToken={authToken || undefined} onChanged={reload}
        beside={<><div style={{ flex: '1 0 auto', display: 'flex', justifyContent: 'center' }}>{ac}</div>{restButton}</>} />
      <div ref={setPickerHost} style={{ display: 'contents' }} />
    </>
  );
  // No health to change: the conditions and rests still.
  if (!hasHealth(view?.model)) return <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>{below}{restPanel}</div>;

  // Two tracks (a custom `tracks` model): the picked one, the first unless another was picked.
  const tracks = view?.model === 'tracks' && view.tracks?.length === 2 && view.second ? view.tracks : null;
  const picked = tracks ? (tracks.find((t) => t.id === track) ?? tracks[0]) : null;
  const send = async (action: VitalsAction, n: number) => {
    if (action !== 'set_temp' && n === 0) return;
    setBusy(true);
    setRefused(null);
    setSaid(null);
    try {
      const body = { ...healthBody(action, n), ...(picked && action !== 'set_temp' ? { track: picked.id } : {}) };
      const res = await fetch(`/api/locations/${token.id}/health`, { method: 'PUT', headers, body: JSON.stringify(body) });
      const answer = await res.json().catch(() => null);
      if (!res.ok) {
        setRefused(answer?.error ?? 'NOT CHANGED');
        return;
      }
      // As HEALTH says it: a full track's damage spilling into the other.
      if (tracks && answer?.overflow) setSaid(`${tracks[1].label.toUpperCase()} FULL · ${answer.overflow} SPILLED INTO ${tracks[0].label.toUpperCase()}`);
      // The server tells every open sheet (sheetUpdated), this one with them: the numbers follow.
      if (action === 'set_temp') setTempText(null); else if (action === 'set_max') setMaxText(null); else setAmount('');
    } catch {
      setRefused('NOT CHANGED: NO CONNECTION');
    } finally {
      setBusy(false);
    }
  };
  const byAmount = (action: VitalsAction) => { void send(action, amountOf(amount)); };

  const panel = open && (
    <div role="region" aria-label="Health" style={{ border: '1px solid var(--dark-green)', padding: '8px 10px' }}>
      {/* Without what the strip already has: one set of DAMAGE, HEAL and TEMP, not two. */}
      <HitPointsPanel target={token as unknown as Location} token={authToken} refreshLocations={reload} gameSystem={system} socket={socket} underStrip />
    </div>
  );
  // Down (8c3): the DYING box, right under the box, over everything else under it.
  const downBox = dying && <DyingBox rule={dying} dying={token.dying} locationId={token.id} gm={gm} socket={socket} />;
  const alert = refused
    ? <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.6rem', letterSpacing: '1px' }}>{refused}</span>
    : said && <span role="status" aria-label="What happened" style={{ color: 'var(--cyan)', fontSize: '0.6rem', letterSpacing: '1px' }}>{said}</span>;

  // Another model (wound boxes, harm, locations, typed damage): its own summary, as everyone sees it, and its editor in
  // HEALTH ▾ (8s3d1, decision 8 of the vitals mockup).
  if (!takesAnAmount(view?.model)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
        <div role="group" aria-label="Vitals" style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid var(--green)', padding: '6px 8px', background: 'color-mix(in srgb, var(--black) 40%, transparent)' }}>
          <div aria-label="Health now" style={{ flex: 1, minWidth: 0 }}>
            {view && <ModelHealthDescription view={view} target={token as unknown as Location} />}
          </div>
          <button type="button" aria-expanded={open} onClick={onToggle}
            style={{ ...button('var(--green)'), flexShrink: 0, background: open ? 'var(--green)' : 'none', color: open ? 'var(--black)' : 'var(--green)' }}>
            HEALTH {open ? '▴' : '▾'}
          </button>
        </div>
        {downBox}
        {alert}
        {below}
        {panel}
        {restPanel}
      </div>
    );
  }

  // The numbers the box shows: the token's, or with two tracks the picked one's (the second kept on the sheet).
  const onSecond = !!(tracks && picked && picked.id === tracks[1].id);
  const numbersOf = (second: boolean) => (second
    ? { cur: view?.second?.current ?? 0, max: view?.second?.max ?? 0 }
    : { cur: token.hp_current ?? 0, max: token.hp_max ?? 0 });
  const { cur, max } = numbersOf(onSecond);
  const temp = token.hp_temp ?? 0;
  // How much is left: the second track counts damage marked, so full is the worst there (STUN 4/4 had shown green).
  const filled = max > 0 ? Math.max(0, Math.min(cur, max)) / max : 0;
  const ratio = onSecond ? (max > 0 ? 1 - filled : 1) : filled;
  // As the header's bar colors it.
  const hpColor = ratio > 0.5 ? 'var(--green)' : ratio > 0.25 ? 'var(--warning)' : 'var(--danger)';
  const setTemp = () => { if (tempText !== null) void send('set_temp', amountOf(tempText)); };
  // Nothing typed, or the same, sets nothing: it goes back to the number.
  const setMax = () => {
    if (maxText === null) return;
    const n = amountOf(maxText);
    if (!maxText.trim() || n === max) setMaxText(null); else void send('set_max', n);
  };
  // Typed in place, the size of the number it stands for, with a line under it rather than a box (8s4a).
  const inPlace = (text: string, color: string): React.CSSProperties => ({
    ...big, width: `${Math.max(2, text.length) + 0.4}ch`, padding: 0, margin: 0, textAlign: 'center', background: 'none', color, border: 0,
    borderBottom: `2px solid ${color}`, outline: 'none', fontFamily: 'inherit',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
      {/* Two tracks: which one DAMAGE and HEAL hit and the box shows, each with its numbers (8s3d1). */}
      {tracks && (
        <div role="group" aria-label="Track" style={{ display: 'flex', border: '1px solid var(--green)' }}>
          {tracks.map((t, i) => {
            const on = t.id === picked?.id;
            const n = numbersOf(i === 1);
            return (
              <button key={t.id} type="button" aria-pressed={on} onClick={() => { setTrack(t.id); setSaid(null); }}
                style={{
                  flex: 1, border: 0, borderRight: i === 0 ? '1px solid var(--dark-green)' : 0, padding: '3px 6px', fontFamily: 'inherit',
                  fontSize: '0.6rem', letterSpacing: '1px', cursor: 'pointer',
                  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)',
                }}>
                {t.label.toUpperCase()} {n.cur}/{n.max}
              </button>
            );
          })}
        </div>
      )}
      <div role="group" aria-label="Vitals" style={{
        position: 'relative', display: 'flex', gap: '10px', alignItems: 'stretch', border: '1px solid var(--green)', padding: '6px 8px',
        background: 'color-mix(in srgb, var(--black) 40%, transparent)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '64px', flexShrink: 0 }}>
          <button type="button" disabled={busy} onClick={() => byAmount('heal')} style={button('var(--green)')}>HEAL</button>
          <input
            className="sheet-input" type="number" min={0} inputMode="numeric" placeholder="0" aria-label={`Amount of ${hp}`}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') byAmount('damage'); }}
            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '0.75rem', padding: '1px 4px', background: 'color-mix(in srgb, var(--black) 50%, transparent)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit' }}
          />
          <button type="button" disabled={busy} onClick={() => byAmount('damage')} style={button('var(--danger)')}>DAMAGE</button>
          {hasStim(system) && (
            // STIM on the button, as wide as HEAL and DAMAGE: the full name spilled out of the column into HP DETAILS ▾.
            <button type="button" disabled={busy} onClick={() => byAmount('stim_heal')} aria-label="STIM +1 STRAIN"
              title="STIM, +1 STRAIN. Field healing (stims, medkits): heals and adds +1 System Strain. Refused when strain is maxed. HEAL is natural or rest healing."
              style={button('var(--warning)')}>STIM</button>
          )}
        </div>
        {/* CURRENT / MAX in the middle column, TEMP in a right column as wide as the buttons' on the left: the box is
            symmetric, so the slash is centered on it, as HP DETAILS ▾ under it is (the user, 2026-11-17). */}
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gridTemplateRows: 'auto auto 1.25rem', alignItems: 'center', justifyItems: 'center', rowGap: '2px' }}>
          <span style={label}>CURRENT</span><span />
          <span style={label}>MAX</span>
          <span aria-label={`Current ${hp}`} style={{ ...big, color: hpColor, transition: 'color 0.3s' }}>{cur}</span>
          <span style={{ ...big, opacity: 0.6, padding: '0 2px' }}>/</span>
          {maxText === null ? (
            <button type="button" disabled={busy} onClick={() => setMaxText(String(max))} aria-label={`Max ${hp}`}
              title={[onSecond ? undefined : maxNote, `Click to set max ${hp}`].filter(Boolean).join('\n')}
              style={{ ...big, background: 'none', border: 0, padding: '0 2px', cursor: 'pointer', fontFamily: 'inherit', color: maxNote && !onSecond ? 'var(--cyan)' : 'var(--green)' }}>
              {max}
            </button>
          ) : (
            <input
              autoFocus className="sheet-input in-place-number" type="number" min={0} inputMode="numeric" aria-label={`Max ${hp}`}
              value={maxText} onChange={(e) => setMaxText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setMax(); if (e.key === 'Escape') setMaxText(null); }}
              onBlur={setMax} style={inPlace(maxText, 'var(--cyan)')}
            />
          )}
        </div>
        <div style={{ width: '64px', flexShrink: 0, display: 'grid', gridTemplateRows: 'auto auto 1.25rem', alignItems: 'center', justifyItems: 'center', rowGap: '2px' }}>
          <span style={label}>TEMP</span>
          {tempText === null ? (
            <button type="button" disabled={busy} onClick={() => setTempText(temp ? String(temp) : '')}
              aria-label={`Temp ${hp}: ${temp}. Click to set it`} title={`Click to set temp ${hp}`}
              style={{ ...big, background: 'none', border: '1px dashed transparent', color: 'var(--cyan)', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px' }}>
              {temp ? temp : '--'}
            </button>
          ) : (
            <input
              autoFocus className="sheet-input in-place-number" type="number" min={0} inputMode="numeric" aria-label={`Temp ${hp}`}
              value={tempText} onChange={(e) => setTempText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setTemp(); if (e.key === 'Escape') setTempText(null); }}
              onBlur={setTemp} style={inPlace(tempText, 'var(--cyan)')}
            />
          )}
        </div>
        {/* Its own small padding and line height: with the browser's, its pressed fill reached up into the numbers. */}
        <button type="button" aria-expanded={open} onClick={onToggle} title={`Open HEALTH here: injuries and resistances`}
          style={{
            position: 'absolute', left: '50%', bottom: '6px', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
            background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '2px', fontWeight: 'bold',
            padding: '2px 8px', lineHeight: 1.2, margin: 0, boxSizing: 'border-box',
          }}>
          {/* HP DETAILS (the user, 2026-11-24: "Hit Points is the issue"): what it opens, not the numbers above it; the game's
              own word for HP, and with two tracks the track buttons over the box say which. */}
          {hp} DETAILS {open ? '▴' : '▾'}
        </button>
      </div>
      {downBox}
      {alert}
      {below}
      {panel}
      {restPanel}
    </div>
  );
}
