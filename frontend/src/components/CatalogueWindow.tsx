import React, { useEffect, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { exampleFor, currentFor, type StoredEntry } from '../sheets/catalogueSchema';
import { catalogueLabel, type ShopStock } from '../data/buildingTypes';
import { downloadText } from '../utils/downloadText';
import { customTemplate } from '../sheets/customTemplates';
import { itemsInPreview, itemsCatalogue, ITEMS_ADDED_EVENT, type PreviewRow, type ItemsAdded } from '../sheets/catalogueItems';
import { ToggleSwitch } from './ToggleSwitch';

// Where a GM adds to what the shops sell.
//
// Everything behind this window already works - the parser, the store, buying and selling
// an uploaded item. This is only the way in: get a file, change it, see what it would do,
// and save it.
//
// **Preview is the same code as save.** The window never reads a catalogue itself; it
// sends the text to the server and shows what came back, so what a GM is shown is literally
// what would be stored. A second, friendlier reader here would be a preview that can lie.
//
// **Save is only offered for the exact text that was previewed.** Editing the box after a
// preview takes the SAVE button away until it is previewed again. Otherwise the thing
// stored could be something nobody ever looked at.
//
// A custom system's items (7e3c): DOWNLOAD ITEMS starts a catalogue from them, prices to fill in, and the preview says
// which lines are items (bought, each is that item, to WEAR and ATTUNE) and which are only nearly named as one.

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  system: string;
}

interface Problem { line: number; catalogue?: string; name?: string; message: string }
interface Summary { catalogue: string; count: number; overrides: string[]; label?: string }
/** `notes` (8a7a1): what a type's line left blank, nothing wrong. */
/** The file held against the game's own items (8a7a3c1): how many sell themselves, lines overruling one, lines left out. */
interface AgainstItems { onSale: number; overrules: (Omit<Problem, 'message'> & { from: number; to: number })[]; leftOut: Problem[] }
/** What ADD NEW LINES TO ITEMS would add to the draft (8a7a4a), and how many items it holds. */
interface ToItems { added: (Omit<Problem, 'message'> & { type: string; price?: number })[]; skipped: Problem[]; have: number; most: number }
interface Preview { problems: Problem[]; notes?: Problem[]; summary: Summary[]; format: string | null; sections?: Record<string, PreviewRow[]>; items?: AgainstItems; toItems?: ToItems }

/**
 * Socket.io refuses a message over a megabyte by default, and says nothing useful when it
 * does - the upload simply never arrives. Stopping short of it here means a GM gets a
 * sentence instead of a silence.
 */
const MAX_BYTES = 900_000;

const mono = (size: number): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: size, letterSpacing: 0,
});


export function CatalogueWindow({ pos, setPos, onClose, socket, system }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  /** The text that preview was of. SAVE is offered only while the box still matches it. */
  const [previewedText, setPreviewedText] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | 'current' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  /** ADD NEW LINES TO ITEMS (8a7a4a): off to start, afresh with each preview. */
  const [toItems, setToItems] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Set when this window asked for the current catalogues, so their arrival means "download". */
  const awaitingCurrent = useRef(false);

  useEffect(() => {
    if (!socket) return;

    const onPreview = (res: Preview) => {
      setBusy(null);
      setPreview(res);
      setToItems(false);
    };

    const onSaved = (res: { ok: boolean; reason?: string; saved?: { catalogue: string; count: number; label?: string }[]; toItems?: { ok: boolean; added: { name: string }[]; items: Record<string, unknown>[] } }) => {
      setBusy(null);
      if (!res.ok) {
        setMessage({ tone: 'bad', text: res.reason === 'empty' ? 'Nothing in that could be saved.' : 'The save did not go through. Nothing was changed.' });
        return;
      }
      const parts = (res.saved ?? []).map((s) => `${s.label ?? catalogueLabel(s.catalogue as ShopStock, system)} ×${s.count}`);
      // The lines made items in the draft (8a7a4a): said, and handed to a builder open on this system.
      const into = res.toItems;
      const added = into?.ok ? into.added.length : 0;
      const items = !into ? '' : !into.ok ? ' The new lines could not be added to ITEMS.'
        : added === 1 ? ` ${into.added[0].name} added to ITEMS in the builder's draft: PUBLISH the system to keep it.`
          : added ? ` ${added} lines added to ITEMS in the builder's draft: PUBLISH the system to keep them.` : '';
      if (into?.ok && into.items.length) window.dispatchEvent(new CustomEvent<ItemsAdded>(ITEMS_ADDED_EVENT, { detail: { systemId: system, items: into.items } }));
      setMessage({ tone: into && !into.ok ? 'bad' : 'ok', text: `Saved: ${parts.join(', ')}. The shops have it now.${items}` });
      setPreview(null);
      setPreviewedText(null);
    };

    /**
     * Only acted on while this window asked, so App's own copy of the catalogues arriving
     * does not trigger a download nobody requested.
     *
     * A ref rather than reading `busy`: the download is a side effect, and doing it inside
     * a state updater would run it twice wherever React calls updaters twice.
     */
    const onCatalogues = (payload: { entries?: Partial<Record<ShopStock, StoredEntry[]>> }) => {
      if (!awaitingCurrent.current) return;
      awaitingCurrent.current = false;
      downloadText(`${system}-storefronts-current.csv`, currentFor(system, payload?.entries ?? {}));
      setBusy(null);
    };

    socket.on('cataloguePreview', onPreview);
    socket.on('catalogueSaved', onSaved);
    socket.on('catalogues', onCatalogues);
    return () => {
      socket.off?.('cataloguePreview', onPreview);
      socket.off?.('catalogueSaved', onSaved);
      socket.off?.('catalogues', onCatalogues);
    };
  }, [socket, system]);

  const tooBig = new Blob([text]).size > MAX_BYTES;
  const stale = previewedText !== null && previewedText !== text;
  const rows = preview?.summary.reduce((n, s) => n + s.count, 0) ?? 0;
  /** A section as the GM wrote it: a type's by its name (8a7a1), a shelf's as before. */
  const sectionName = (catalogue: string) => preview?.summary.find((s) => s.catalogue === catalogue)?.label ?? catalogue;
  const canSave = !!preview && !stale && previewedText === text && rows > 0 && !busy;
  // The running game's items (7e3c), from its render copy: none on a built-in system.
  const items = customTemplate(system)?.items;
  const starter = itemsCatalogue(system, items);
  const itemRows = preview ? itemsInPreview(system, items, preview.sections) : { matched: [], near: [] };

  const runPreview = () => {
    if (!text.trim() || tooBig || !socket) return;
    setMessage(null);
    setBusy('preview');
    setPreviewedText(text);
    socket.emit('previewCatalogue', { text });
  };

  const runSave = () => {
    if (!canSave) return;
    setMessage(null);
    setBusy('save');
    socket.emit('saveCatalogue', { text, ...(toItems && preview?.toItems?.added.length ? { toItems: true } : {}) });
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setMessage({ tone: 'bad', text: `That file is ${Math.round(file.size / 1000)}KB. Split it into smaller files of under ${MAX_BYTES / 1000}KB.` });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setPreview(null);
      setPreviewedText(null);
      setMessage(null);
    };
    reader.readAsText(file);
  };

  const btn: React.CSSProperties = { ...mono(10), padding: '3px 8px', letterSpacing: 1 };

  return (
    <DraggableWindow
      title="CATALOGUES.EXE"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{
        width: '560px', height: '560px', minWidth: '380px', minHeight: '360px',
        maxWidth: '95vw', maxHeight: '92vh',
        resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
      contentStyle={{ flex: 1, minHeight: 0, maxHeight: 'none', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: 10, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...mono(9), color: 'var(--grid-section)', lineHeight: 1.5 }}>
          Add items to what the shops sell. Anything saved here sits alongside the items that
          come with the app; it never replaces them.
        </div>

        {/* Getting a file to start from. The example shows the shape; the current list is
            everything already on sale, with the built-in rows behind a # so re-uploading it
            unchanged changes nothing. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="utility-btn"
            style={btn}
            title="A file in the right shape for this system, with a few real rows to copy"
            onClick={() => downloadText(`${system}-storefronts-example.csv`, exampleFor(system))}
          >DOWNLOAD EXAMPLE</button>
          <button
            type="button"
            className="utility-btn"
            style={btn}
            disabled={busy !== null || !socket}
            title="Everything the shops sell now. Built-in rows are commented out, so re-uploading changes nothing unless you uncomment one."
            onClick={() => {
              awaitingCurrent.current = true;
              setBusy('current');
              socket?.emit('requestCatalogues');
            }}
          >{busy === 'current' ? 'FETCHING…' : 'DOWNLOAD CURRENT'}</button>
          {starter && (
            <button
              type="button"
              className="utility-btn"
              style={btn}
              title="This system's items as a catalogue to sell them in its shops, each price left for you to fill in"
              onClick={() => downloadText(`${system}-storefronts-items.csv`, starter)}
            >DOWNLOAD ITEMS</button>
          )}
          <button
            type="button"
            className="utility-btn"
            style={btn}
            onClick={() => fileRef.current?.click()}
          >UPLOAD FILE</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json"
            aria-label="Catalogue file"
            style={{ display: 'none' }}
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setMessage(null); }}
          placeholder={'Paste a table here, or upload a file.\n\n[weapons]\nname, price, dmg\nZip Gun, 15, 1d4'}
          aria-label="Catalogue text"
          spellCheck={false}
          style={{
            ...mono(11), flex: 1, minHeight: 120, resize: 'none', whiteSpace: 'pre',
            overflow: 'auto', lineHeight: 1.4,
          }}
        />

        {tooBig && (
          <div style={{ ...mono(10), color: 'var(--danger)' }}>
            That is too much to send at once. Split it into smaller pieces of under {MAX_BYTES / 1000}KB.
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="utility-btn"
            style={btn}
            disabled={!text.trim() || tooBig || busy !== null || !socket}
            onClick={runPreview}
          >{busy === 'preview' ? 'READING…' : 'PREVIEW'}</button>
          <button
            type="button"
            className="utility-btn"
            style={btn}
            disabled={!canSave}
            title={stale ? 'The text changed since it was previewed. Preview it again first.' : undefined}
            onClick={runSave}
          >{busy === 'save' ? 'SAVING…' : 'SAVE'}</button>
          {stale && (
            <span style={{ ...mono(9), color: 'var(--warning)' }}>
              CHANGED SINCE PREVIEW — PREVIEW AGAIN
            </span>
          )}
        </div>

        {message && (
          <div style={{ ...mono(10), color: message.tone === 'ok' ? 'var(--cyan)' : 'var(--danger)', lineHeight: 1.5 }}>
            {message.text}
          </div>
        )}

        {preview && (
          <div
            className="cyber-scroll"
            style={{ ...mono(10), maxHeight: 180, overflowY: 'auto', borderTop: '1px solid var(--dark-green)', paddingTop: 6, lineHeight: 1.5 }}
          >
            <div style={{ color: 'var(--cyan)', marginBottom: 4 }}>
              {rows} ROW{rows === 1 ? '' : 'S'} READ
              {preview.problems.length > 0 && (
                <span style={{ color: 'var(--warning)' }}>
                  {' '}· {preview.problems.length} PROBLEM{preview.problems.length === 1 ? '' : 'S'}
                </span>
              )}
            </div>

            {preview.summary.map((s) => (
              <div key={s.catalogue}>
                {(s.label ?? catalogueLabel(s.catalogue as ShopStock, system)).toUpperCase()} ×{s.count}
                {/* Overriding a book price is allowed - a GM house-ruling it means it -
                    but it should be a thing they chose, not a thing that happened. */}
                {s.overrides.length > 0 && (
                  <span style={{ color: 'var(--warning)' }}>
                    {' '}· REPLACES THE BUILT-IN {s.overrides.join(', ')}
                  </span>
                )}
                {s.count > 0 && ' · replaces anything you uploaded here before'}
              </div>
            ))}

            {/* The system's items among the lines (7e3c): bought, each is that item; one nearly named, never. */}
            {itemRows.matched.some((m) => m.lands) && (
              <div data-testid="catalogue-items" style={{ color: 'var(--cyan)' }}>
                ITEMS: {itemRows.matched.filter((m) => m.lands).map((m) => m.name.toUpperCase()).join(', ')}
                {' · bought, each is that item, to WEAR and ATTUNE'}
              </div>
            )}
            {itemRows.matched.filter((m) => !m.lands).map((m, i) => (
              <div key={`away-${i}`} style={{ color: 'var(--warning)' }}>
                {m.line ? `LINE ${m.line}` : 'FILE'} [{sectionName(m.catalogue)}] {m.name}: lands in its own rows, not the gear, so it is never worn as the item
              </div>
            ))}
            {itemRows.near.map((n, i) => (
              <div key={`near-${i}`} style={{ color: 'var(--warning)' }}>
                {n.line ? `LINE ${n.line}` : 'FILE'} [{sectionName(n.catalogue)}] {n.name}: nearly the item {n.item}. Name it exactly to sell that item
              </div>
            ))}

            {/* The game's own items (8a7a3c1; mockup types-in-shops.html): what sells itself besides, and lines it overrules
                or leaves out, so a GM sees why a Pistol is 260 and not 200. */}
            {preview.items && (() => {
              const where = (p: Omit<Problem, 'message'>) => `${p.line > 0 ? `LINE ${p.line}` : 'FILE'}${p.catalogue ? ` [${sectionName(p.catalogue)}]` : ''}${p.name ? ` ${p.name}` : ''}`;
              const own = preview.items;
              return <>
                {own.onSale > 0 && (
                  <div data-testid="catalogue-on-sale" style={{ color: 'var(--cyan)' }}>
                    ALSO ON SALE FROM ITEMS: {own.onSale}{own.overrules.length > 0 ? ` (${own.overrules.length} overruled by this file)` : ''}
                  </div>
                )}
                {own.overrules.map((p, i) => (
                  <div key={`over-${i}`} data-testid="catalogue-overrules" style={{ color: 'var(--cyan)' }}>
                    {where(p)}: overrules the item, {p.from === p.to ? 'its columns' : `${p.from} → ${p.to}`} in the shops
                  </div>
                ))}
                {own.leftOut.map((p, i) => (
                  <div key={`out-${i}`} data-testid="catalogue-left-out" style={{ color: 'var(--warning)' }}>{where(p)}: {p.message}</div>
                ))}
              </>;
            })()}

            {preview.problems.map((p, i) => (
              <div key={i} style={{ color: 'var(--warning)' }}>
                {p.line > 0 ? `LINE ${p.line}` : 'FILE'}
                {p.catalogue ? ` [${sectionName(p.catalogue)}]` : ''}
                {p.name ? ` ${p.name}` : ''}: {p.message}
              </div>
            ))}
            {/* A type's line with a column left blank (8a7a1): kept, and said, for the GM to fill in or leave to the player. */}
            {(preview.notes ?? []).map((p, i) => (
              <div key={`note-${i}`} data-testid="catalogue-note" style={{ color: 'var(--cyan)' }}>
                {p.line > 0 ? `LINE ${p.line}` : 'FILE'}
                {p.catalogue ? ` [${sectionName(p.catalogue)}]` : ''}
                {p.name ? ` ${p.name}` : ''}: {p.message}, kept; the player can fill it in
              </div>
            ))}

            {rows === 0 && (
              <div style={{ color: 'var(--danger)' }}>
                Nothing in that could be read, so there is nothing to save.
              </div>
            )}
          </div>
        )}
        {/* ADD NEW LINES TO ITEMS (8a7a4a; mockup types-in-shops.html, section 7): off to start; on, what it adds. Under the
        scrolling preview, so the switch that changes what SAVE does is always in sight. */}
        {preview && preview.toItems && preview.toItems.added.length > 0 && (() => {
          const into = preview.toItems;
          const shown = into.added.slice(0, 8);
          return (
            <div data-testid="catalogue-to-items" style={{ ...mono(10), border: '1px dashed var(--dark-green)', padding: '6px 8px', marginTop: 6, textAlign: 'left', lineHeight: 1.5, maxHeight: 140, overflowY: 'auto' }} className="cyber-scroll">
              <ToggleSwitch on={toItems} onChange={setToItems} label="ADD NEW LINES TO ITEMS" />
              {toItems && <>
                {shown.map((a, i) => (
                  <div key={`add-${i}`} style={{ color: 'var(--cyan)' }}>
                    {a.name} becomes an item of {a.type}{a.price !== undefined ? `, ${a.price}` : ''}
                  </div>
                ))}
                {into.added.length > shown.length && <div style={{ color: 'var(--cyan)' }}>and {into.added.length - shown.length} more</div>}
                <div style={{ color: 'var(--grid-section)' }}>
                  ITEMS · {into.have} OF {into.most} → {into.have + into.added.length} OF {into.most} · in the builder&apos;s draft, live once you PUBLISH
                </div>
              </>}
              {toItems && into.skipped.map((p, i) => (
                <div key={`skip-${i}`} style={{ color: 'var(--warning)' }}>{p.line > 0 ? `LINE ${p.line}` : 'FILE'} {p.name}: {p.message}</div>
              ))}
            </div>
          );
        })()}
      </div>
    </DraggableWindow>
  );
}
