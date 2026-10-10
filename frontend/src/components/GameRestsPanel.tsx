import React, { useEffect, useMemo, useState } from 'react';
import {
  restCalls, chosenOf, requestFor, changeText, keyOf, WHO_LABELS, type Rested, type Who,
} from '../sheets/restCalls';

// The GAME tab's RESTS panel under a custom game (4f5; approved mockup docs/mockups/builder-rests.html,
// 2026-10-09, stage 3): pick one of the game's rests and who rests, see what each one will get, and
// CALL it. The server rolls, writes and logs (backend/sheets/rests.js); everyone sees one dice-log
// line per character. Everyone the panel could choose is previewed once, so ticking who rests asks
// the server nothing. The GM and granted editors, as the route allows.

const label: React.CSSProperties = { fontSize: '0.65rem', opacity: 0.7, letterSpacing: '1px' };
const why: React.CSSProperties = { fontSize: '0.6rem', opacity: 0.6, margin: 0 };
const btn: React.CSSProperties = { fontSize: '0.65rem' };
const select: React.CSSProperties = { fontSize: '0.65rem', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', padding: '3px 4px' };

export function GameRestsPanel({ token, system, npcs }: {
  token: string;
  /** The running game, so the list is asked for again when it changes. */
  system: string;
  /** The NPC tokens on the map being viewed (restCalls.npcsOnMap). */
  npcs: { id: number; name: string }[];
}) {
  const api = useMemo(() => restCalls(token), [token]);
  const [rests, setRests] = useState<{ id: string; name: string }[]>([]);
  const [restId, setRestId] = useState('');
  const [who, setWho] = useState<Who>('players');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [everyone, setEveryone] = useState<Rested[]>([]);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const npcIds = npcs.map((n) => n.id);
  const npcKey = npcIds.join(',');

  useEffect(() => {
    let live = true;
    api.list().then((r) => {
      if (!live || !r.ok) return;
      // An answer without a list (an older server, a proxy's page) is no rests, not a crash.
      const list = r.value && Array.isArray(r.value.rests) ? r.value.rests : [];
      setRests(list);
      setRestId((id) => (list.some((x) => x.id === id) ? id : list[0]?.id ?? ''));
    });
    return () => { live = false; };
  }, [api, system]);

  // Everyone the panel could choose, previewed: every player character and the map's NPCs.
  useEffect(() => {
    if (!restId) { setEveryone([]); return undefined; }
    let live = true;
    api.preview(restId, true, npcIds).then((r) => {
      if (!live) return;
      if (r.ok) { setEveryone(r.value.characters); setError(null); } else setError(r.error);
    });
    return () => { live = false; };
  }, [api, restId, npcKey, round]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rests.length) return null;
  const rest = rests.find((r) => r.id === restId) ?? rests[0];
  const chosen = chosenOf(everyone, who, ticked);

  const pickWho = (next: Who) => {
    // CHOOSE starts with every player character ticked, as the default rests them.
    if (next === 'choose' && who !== 'choose') setTicked(new Set(everyone.filter((r) => r.kind === 'player').map(keyOf)));
    setWho(next);
  };
  const call = async () => {
    setBusy(true);
    setSaid(null);
    const { players, npcs: ids } = requestFor(who, chosen, npcIds);
    const r = await api.call(rest.id, players, ids);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    const n = r.value.characters.length;
    setSaid(`${rest.name.toUpperCase()} CALLED · ${n} CHARACTER${n === 1 ? '' : 'S'}`);
    setRound((x) => x + 1);
  };

  return (
    <section aria-label="Rests" style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--green)', paddingTop: '6px', marginTop: '2px' }}>
      <label style={label} htmlFor="game-rest">RESTS</label>
      <select id="game-rest" aria-label="Rest" value={rest.id} style={select} onChange={(e) => { setRestId(e.target.value); setSaid(null); }}>
        {rests.map((r) => <option key={r.id} value={r.id}>{r.name.toUpperCase()}</option>)}
      </select>
      <div role="radiogroup" aria-label="Who rests" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(Object.keys(WHO_LABELS) as Who[]).map((w) => (
          <button key={w} type="button" role="radio" aria-checked={who === w} onClick={() => pickWho(w)}
            style={{ background: 'none', border: 0, padding: '2px 0', textAlign: 'left', cursor: 'pointer', color: 'var(--green)', fontFamily: 'monospace', fontSize: '0.6rem', letterSpacing: '1px', opacity: who === w ? 1 : 0.6 }}>
            {who === w ? '◉' : '○'} {WHO_LABELS[w]}
          </button>
        ))}
      </div>
      {who === 'choose' && (
        <div role="group" aria-label="Characters" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {everyone.map((r) => {
            const k = keyOf(r);
            const on = ticked.has(k);
            return (
              <button key={k} type="button" role="checkbox" aria-checked={on} className={`utility-btn ${on ? 'active' : ''}`} style={btn}
                onClick={() => setTicked((t) => { const next = new Set(t); if (on) next.delete(k); else next.add(k); return next; })}>
                {r.name.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}
      <span style={label}>WHAT EACH ONE GETS</span>
      <ul aria-label="What each one gets" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {chosen.map((r) => (
          <li key={keyOf(r)} style={{ borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)', paddingTop: 4, fontSize: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <b style={{ color: 'var(--green)', letterSpacing: '1px' }}>{r.name.toUpperCase()}</b>
              <span style={{ opacity: 0.6 }}>{r.kind === 'npc' ? 'NPC' : 'PLAYER'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
              {r.changes.map((c) => <span key={c.what} style={{ color: 'var(--cyan)' }}>{changeText(c)}</span>)}
              {r.gone.map((g) => <span key={g} style={{ color: 'var(--warning)' }}>{g.toUpperCase()} WEARS OFF</span>)}
              {!r.changes.length && !r.gone.length && <span style={{ opacity: 0.6 }}>Nothing changes.</span>}
            </div>
          </li>
        ))}
      </ul>
      {!chosen.length && <p style={why}>Nobody chosen.</p>}
      <button type="button" className="utility-btn" style={btn} disabled={busy || !chosen.length} onClick={call}>
        {busy ? 'CALLING…' : `CALL ${rest.name.toUpperCase()}`}
      </button>
      <p style={why}>Dice are rolled for each character when it is called; everyone sees a line each in the dice log.</p>
      {said && <span role="status" style={{ fontSize: '0.6rem', color: 'var(--green)', letterSpacing: '1px' }}>{said}</span>}
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.6rem' }}>{error}</span>}
    </section>
  );
}
