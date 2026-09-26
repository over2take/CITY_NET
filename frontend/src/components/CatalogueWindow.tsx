import React, { useEffect, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { exampleFor, currentFor, type StoredEntry } from '../sheets/catalogueSchema';
import { CATALOGUES, type ShopStock } from '../data/buildingTypes';

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

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  system: string;
}

interface Problem { line: number; catalogue?: string; name?: string; message: string }
interface Summary { catalogue: string; count: number; overrides: string[] }
interface Preview { problems: Problem[]; summary: Summary[]; format: string | null }

/**
 * Socket.io refuses a message over a megabyte by default, and says nothing useful when it
 * does - the upload simply never arrives. Stopping short of it here means a GM gets a
 * sentence instead of a silence.
 */
const MAX_BYTES = 900_000;

const mono = (size: number): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: size, letterSpacing: 0,
});

const labelOf = (id: string) => CATALOGUES.find((c) => c.id === id)?.label ?? id;

/** Hand the browser a text file to save. */
const download = (filename: string, text: string) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export function CatalogueWindow({ pos, setPos, onClose, socket, system }: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  /** The text that preview was of. SAVE is offered only while the box still matches it. */
  const [previewedText, setPreviewedText] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | 'current' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Set when this window asked for the current catalogues, so their arrival means "download". */
  const awaitingCurrent = useRef(false);

  useEffect(() => {
    if (!socket) return;

    const onPreview = (res: Preview) => {
      setBusy(null);
      setPreview(res);
    };

    const onSaved = (res: { ok: boolean; reason?: string; saved?: { catalogue: string; count: number }[] }) => {
      setBusy(null);
      if (!res.ok) {
        setMessage({ tone: 'bad', text: res.reason === 'empty' ? 'Nothing in that could be saved.' : 'The save did not go through. Nothing was changed.' });
        return;
      }
      const parts = (res.saved ?? []).map((s) => `${labelOf(s.catalogue)} ×${s.count}`);
      setMessage({ tone: 'ok', text: `Saved: ${parts.join(', ')}. The shops have it now.` });
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
      download(`${system}-storefronts-current.csv`, currentFor(system, payload?.entries ?? {}));
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
  const canSave = !!preview && !stale && previewedText === text && rows > 0 && !busy;

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
    socket.emit('saveCatalogue', { text });
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
            onClick={() => download(`${system}-storefronts-example.csv`, exampleFor(system))}
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
                {labelOf(s.catalogue).toUpperCase()} ×{s.count}
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

            {preview.problems.map((p, i) => (
              <div key={i} style={{ color: 'var(--warning)' }}>
                {p.line > 0 ? `LINE ${p.line}` : 'FILE'}
                {p.catalogue ? ` [${p.catalogue}]` : ''}
                {p.name ? ` ${p.name}` : ''}: {p.message}
              </div>
            ))}

            {rows === 0 && (
              <div style={{ color: 'var(--danger)' }}>
                Nothing in that could be read, so there is nothing to save.
              </div>
            )}
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
