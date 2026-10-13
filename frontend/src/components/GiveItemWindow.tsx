import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TerminalWindow, TERMINAL_PREVIEW, type TerminalAction } from './TerminalWindow';
import {
  giveCalls, searchItems, itemKey, chipLabel, worthOf, recipientText, resultText, giveLabel, refusalText, givenAt,
  recipientKey, previewRequest, giveRequest, clampQty, NOTE_MAX, QTY_MAX,
  type AskSocket, type GivableCatalogue, type ListedItem, type Recipient, type GivenLine,
} from '../sheets/giveItems';

// GIVE.EXE (4g4b; approved mockup docs/mockups/give-item.html, 2026-10-12): the GM gives items to
// players for free. Laid out as the shop is (TerminalWindow): the item being given in the corner,
// ITEMS / TO / GIVEN down the left, the open one on the right, GIVE along the bottom. Search every
// catalogue the game has, pick an item and how many, tick who gets it and see where it would land
// on each sheet first. The server places it (the user's call: "it needs to show up when given, not
// after a login") and keeps the GIVEN list; the logic lives in sheets/giveItems.ts.

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: AskSocket | null;
  /** The running game. */
  system: string | null | undefined;
  /** The NPC tokens on the map being viewed (restCalls.npcsOnMap): the ones offered with a sheet. */
  npcs: { id: number }[];
  /** Who is signed in now, by name: a dot beside each player character. */
  online: string[];
  /** Ticked when the window opens (QUICK ACTIONS on a token): recipient keys (giveItems.recipientKey). */
  preselect?: string[];
}

type Folder = 'items' | 'to' | 'given';

const NO_ANSWER = 'No answer from the server.';

const mono = (size: number): React.CSSProperties => ({ fontFamily: 'monospace', fontSize: size, letterSpacing: 1 });
const cell: React.CSSProperties = { padding: '3px 6px', borderBottom: '1px solid var(--dark-green)', textAlign: 'left' };
const field: React.CSSProperties = {
  background: 'var(--black)', border: '1px solid var(--dark-green)', color: 'var(--green)', fontFamily: 'monospace',
  fontSize: 11, padding: '3px 5px', width: '100%', boxSizing: 'border-box',
};
const label: React.CSSProperties = { ...mono(9), color: 'var(--grid-section)', letterSpacing: 1 };

export function GiveItemWindow({ pos, setPos, onClose, socket, system, npcs, online, preselect = [] }: Props) {
  const calls = useMemo(() => (socket ? giveCalls(socket) : null), [socket]);
  const [folder, setFolder] = useState<Folder>('items');
  const [catalogues, setCatalogues] = useState<GivableCatalogue[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<string | null>(null);
  const [picked, setPicked] = useState<ListedItem | null>(null);
  const [qty, setQty] = useState(1);
  const [people, setPeople] = useState<Recipient[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(preselect));
  // Opened again from another token's GIVE_ITEM while already open: that character is ticked too.
  const preselectKey = preselect.join('|');
  useEffect(() => {
    setTicked((prev) => new Set([...prev, ...preselect]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectKey]);
  const [note, setNote] = useState('');
  const [results, setResults] = useState<{ recipients: Recipient[]; qty: number } | null>(null);
  const [given, setGiven] = useState<GivenLine[]>([]);
  const [givenNews, setGivenNews] = useState(false);
  const [busy, setBusy] = useState(false);

  // One question at a time: a preview and a GIVE answer on the same event, so they never overlap.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const ask = <T,>(question: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(question, question);
    queue.current = next.catch(() => undefined);
    return next;
  };
  // Which preview is wanted: an answer for an item or number since changed is dropped.
  const wanted = useRef('');

  const stows = system === 'cities_without_number';
  const npcIds = npcs.map((n) => n.id);
  const npcKey = npcIds.join(',');

  useEffect(() => {
    if (!calls) return;
    let live = true;
    ask(calls.givable).then((a) => {
      if (!live) return;
      if (!a) setProblem(NO_ANSWER);
      else if (!a.ok) setProblem(refusalText(a.reason));
      else setCatalogues(a.catalogues);
    });
    ask(calls.given).then((a) => { if (live && a && a.ok) setGiven(a.entries); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls]);

  const preview = (item: ListedItem, n: number) => {
    if (!calls) return;
    const key = `${itemKey(item)}x${n}:${npcKey}`;
    wanted.current = key;
    ask(() => calls.give(previewRequest(item, n, npcIds))).then((a) => {
      if (wanted.current !== key) return;
      if (!a) { setProblem(NO_ANSWER); return; }
      if (!a.ok) { setProblem(refusalText(a.reason)); return; }
      setProblem(null);
      setPeople(a.recipients);
    });
  };

  useEffect(() => {
    if (picked) preview(picked, qty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, qty, npcKey, calls]);

  const found = catalogues ? searchItems(catalogues, query, chip) : [];
  const total = catalogues ? catalogues.reduce((n, c) => n + c.items.length, 0) : 0;
  const onlineNames = new Set(online.map((u) => u.toLowerCase()));
  const chosen = people.filter((r) => ticked.has(recipientKey(r)));
  const getting = chosen.filter((r) => r.lands);

  /** Picking an item moves on to who gets it. */
  const pick = (item: ListedItem) => { setPicked(item); setResults(null); setFolder('to'); };
  const toggle = (r: Recipient) => setTicked((prev) => {
    const next = new Set(prev);
    const key = recipientKey(r);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const give = () => {
    if (!calls || !picked || !getting.length) return;
    setBusy(true);
    const n = qty;
    ask(() => calls.give(giveRequest(picked, n, getting, note))).then((a) => {
      setBusy(false);
      if (!a) { setProblem(NO_ANSWER); return; }
      if (!a.ok) { setProblem(refusalText(a.reason)); return; }
      setProblem(null);
      setResults({ recipients: [...chosen.filter((r) => !r.lands), ...a.recipients], qty: n });
      if (a.given) { setGiven(a.given); setGivenNews(true); }
      // Where the next one would land has moved on.
      preview(picked, n);
    });
  };

  const actions: TerminalAction[] = [{
    key: 'give',
    label: busy ? 'GIVING…' : picked ? giveLabel(qty, picked.name, getting.length) : 'GIVE',
    tone: 'primary',
    disabled: busy || !picked || !getting.length,
    title: picked ? (getting.length ? 'Free: nothing is charged' : 'Tick who gets it') : 'Pick an item first',
    onClick: give,
  }];

  // The item being given, where the shop has its building.
  const card = (
    <div data-testid="give-card" style={{
      ...mono(10), width: TERMINAL_PREVIEW.width, height: TERMINAL_PREVIEW.height, boxSizing: 'border-box', padding: 8,
      border: '1px solid var(--green)', color: 'var(--green)', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
    }}>
      <span style={label}>GIVING</span>
      {picked ? (
        <>
          <span style={{ ...mono(12), fontWeight: 'bold', overflowWrap: 'anywhere' }}>{picked.name.toUpperCase()}</span>
          <span style={{ color: 'var(--grid-section)' }}>{chipLabel(picked.catalogue, system)}</span>
          <span style={{ color: 'var(--cyan)' }}>WORTH {worthOf(system, picked.catalogue, picked.price)}</span>
          <span style={{ color: 'var(--grid-section)' }}>×{qty} · FREE</span>
        </>
      ) : <span style={{ color: 'var(--grid-section)', letterSpacing: 0 }}>Pick an item from ITEMS.</span>}
    </div>
  );

  const header = folder === 'items'
    ? `${found.length} OF ${total} ITEMS · NOTHING IS CHARGED`
    : folder === 'to'
      ? (picked ? `${chosen.length} TICKED · ${people.length} IN THIS GAME` : 'PICK AN ITEM FIRST')
      : `LAST ${given.length} GIVEN`;

  return (
    <TerminalWindow
      title="GIVE.EXE"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      preview={card}
      folders={[
        { id: 'items' as Folder, label: 'ITEMS' },
        { id: 'to' as Folder, label: chosen.length ? `TO · ${chosen.length}` : 'TO', name: 'TO' },
        { id: 'given' as Folder, label: 'GIVEN', attention: givenNews },
      ]}
      open={folder}
      onOpen={(id) => { setFolder(id); if (id === 'given') setGivenNews(false); }}
      panelMode="list"
      width={760}
      label="Give an item"
      header={<span style={{ color: 'var(--cyan)' }}>{header}</span>}
      actions={actions}
      footer={problem ? <div role="alert" style={{ ...mono(10), color: 'var(--danger)', letterSpacing: 0 }}>{problem}</div> : undefined}
    >
      {folder === 'items' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {(catalogues?.length ?? 0) > 1 && (
            <div role="tablist" aria-label="Catalogue" style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
              {[null, ...(catalogues ?? []).map((c) => c.catalogue)].map((c) => (
                <button key={c ?? 'all'} type="button" role="tab" className={`utility-btn ${chip === c ? 'active' : ''}`}
                  aria-selected={chip === c} onClick={() => setChip(c)} style={{ ...mono(10), padding: '2px 10px', flex: 1 }}>
                  {c ? chipLabel(c, system) : 'ALL'}
                </button>
              ))}
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search every catalogue by name"
            aria-label="Search every catalogue" style={{ ...field, marginBottom: 6 }} />
          <div className="cyber-scroll" style={{ flex: found.length ? 1 : '0 0 auto', minHeight: 0, overflowY: 'auto' }}>
            {found.length > 0 && (
              <table aria-label="Items" style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                <thead>
                  <tr style={{ color: 'var(--grid-section)' }}>
                    <th style={cell}>NAME</th>
                    <th style={cell}>CATALOGUE</th>
                    <th style={{ ...cell, textAlign: 'right' }}>WORTH</th>
                    <th style={{ ...cell, textAlign: 'right' }}>&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((i) => {
                    const current = picked !== null && itemKey(picked) === itemKey(i);
                    return (
                      <tr key={itemKey(i)} style={current ? { color: 'var(--cyan)' } : undefined}>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>{i.name}</td>
                        <td style={{ ...cell, color: 'var(--grid-section)' }}>{chipLabel(i.catalogue, system)}</td>
                        <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{worthOf(system, i.catalogue, i.price)}</td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          <button type="button" className={`utility-btn ${current ? 'active' : ''}`} aria-label={`Give ${i.name}`}
                            onClick={() => pick(i)} style={{ padding: '1px 6px', fontSize: 9 }}>GIVE</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {catalogues === null && !problem && <div style={{ ...mono(11), padding: '10px 0', letterSpacing: 0 }}>LOADING…</div>}
          {catalogues !== null && !found.length && (
            <div data-testid="give-empty" style={{ ...mono(11), padding: '10px 0', letterSpacing: 0 }}>
              {total ? 'NOTHING MATCHES THAT' : 'Nothing to give yet. Upload a catalogue first, in the GAME tab.'}
            </div>
          )}
        </div>
      )}

      {folder === 'to' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!picked ? (
            <div style={{ ...mono(11), letterSpacing: 0 }}>Pick an item in ITEMS first.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={label}>HOW MANY</span>
                <button type="button" className="utility-btn" aria-label="One fewer" disabled={qty <= 1}
                  onClick={() => setQty((q) => clampQty(q - 1))} style={{ ...mono(11), padding: '0 8px' }}>−</button>
                <span aria-label="How many" style={{ ...mono(12), minWidth: '2ch', textAlign: 'center' }}>{qty}</span>
                <button type="button" className="utility-btn" aria-label="One more" disabled={qty >= QTY_MAX}
                  onClick={() => setQty((q) => clampQty(q + 1))} style={{ ...mono(11), padding: '0 8px' }}>+</button>
              </div>
              <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {!people.length ? (
                  <div style={{ ...mono(11), letterSpacing: 0 }}>No characters in this game yet.</div>
                ) : (
                  <table aria-label="Who gets it" style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                    <thead>
                      <tr style={{ color: 'var(--grid-section)' }}>
                        <th style={cell}>&nbsp;</th>
                        <th style={cell}>WHO</th>
                        <th style={cell}>WHERE IT LANDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((r) => {
                        const key = recipientKey(r);
                        const on = ticked.has(key);
                        const isOnline = r.kind === 'player' && onlineNames.has(String(r.username).toLowerCase());
                        return (
                          <tr key={key} onClick={() => toggle(r)} style={{ cursor: 'pointer' }}>
                            <td style={{ ...cell, width: 18 }}>
                              <input type="checkbox" checked={on} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()}
                                aria-label={r.name} style={{ accentColor: 'var(--green)' }} />
                            </td>
                            <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                              {r.name.toUpperCase()}
                              <span style={{ color: r.kind === 'npc' ? 'var(--grid-section)' : isOnline ? 'var(--cyan)' : 'var(--grid-section)' }}>
                                {r.kind === 'npc' ? ' · NPC' : isOnline ? ' · ONLINE' : ' · OFFLINE'}
                              </span>
                            </td>
                            <td style={{ ...cell, color: r.lands ? 'var(--grid-section)' : 'var(--danger)' }}>{recipientText(r, qty, stows)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <label htmlFor="give-note" style={label}>NOTE TO THEM (OPTIONAL)</label>
              <textarea id="give-note" rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)}
                style={{ ...field, resize: 'vertical' }} />
              {!results && chosen.filter((r) => !r.lands).map((r) => (
                <div key={recipientKey(r)} style={{ ...mono(10), color: 'var(--danger)', letterSpacing: 0 }}>
                  {`${r.name.toUpperCase()} WON'T GET IT: ${recipientText(r, qty, stows).toUpperCase()}`}
                </div>
              ))}
              {results && (
                <div role="status" style={{ ...mono(10), letterSpacing: 0 }}>
                  {results.recipients.map((r) => (
                    <div key={recipientKey(r)} style={{ color: r.given ? 'var(--cyan)' : 'var(--danger)' }}>{resultText(r, results.qty, stows)}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {folder === 'given' && (
        <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {!given.length ? (
            <div style={{ ...mono(11), letterSpacing: 0 }}>Nothing given yet.</div>
          ) : (
            <table aria-label="Given" style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
              <thead>
                <tr style={{ color: 'var(--grid-section)' }}>
                  <th style={cell}>WHEN</th>
                  <th style={cell}>BY</th>
                  <th style={cell}>TO</th>
                  <th style={cell}>ITEM</th>
                  <th style={{ ...cell, textAlign: 'right' }}>QTY</th>
                </tr>
              </thead>
              <tbody>
                {given.map((l) => (
                  <tr key={l.id} title={l.note || undefined}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{givenAt(l.at)}</td>
                    <td style={cell}>{l.by}</td>
                    <td style={cell}>{l.to.join(', ')}</td>
                    <td style={cell}>{l.item}{l.note && <span style={{ color: 'var(--grid-section)' }}> · “{l.note}”</span>}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>×{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </TerminalWindow>
  );
}
