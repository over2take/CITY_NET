// Hits waiting under APPLY DAMAGE CONFIRM, as a token's HEALTH and a sheet's vitals box show them (8b6b2; approved mockup
// docs/mockups/waiting-hits.html, sections 3 and 4, answered 2026-11-25). The server keeps them and says who sees what
// (backend tokens/waitingHits.js): whoever may APPLY each one with its words, the one who made some how many. Newest first;
// APPLY ALL (oldest first, the server's) where two or more wait. Pure; WaitingHits.tsx draws it.

/** One waiting hit as the server shows it to someone who may apply it. `taken` null where its numbers are kept from them. */
export interface WaitingHit { id: number; from: string; what: string; words: string; taken: number | null; at?: string }
/** A token's waiting hits as the server answers this viewer (sockets waitingHits). */
export type WaitingView =
  | { ok: true; may: true; hits: WaitingHit[] }
  | { ok: true; may: false; hits: WaitingHit[]; mine: number }
  | { ok: false; error: string };

/** A hit's words for its row: its notes, and what it would take, said last and larger ("WOULD TAKE 7 OF 10"). */
export const rowParts = (words: string): { notes: string[]; would: string | null } => {
  const parts = words.split(' · ').map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1);
  return last && last.startsWith('WOULD TAKE') ? { notes: parts.slice(0, -1), would: last } : { notes: parts, would: null };
};

/** Newest first, as the rows read (the server's are oldest first, as APPLY ALL takes them). */
export const newestFirst = (hits: WaitingHit[]): WaitingHit[] => [...hits].reverse();

const hits = (n: number) => `${n} HIT${n === 1 ? '' : 'S'} WAITING`;

/** What heads the box: to whoever may apply them, how many and in what order; to the one who made some, who applies them. */
export const headWords = (view: WaitingView | null, gm: string): string | null => {
  if (!view || !view.ok) return null;
  if (view.may) return view.hits.length ? `${hits(view.hits.length)} · NEWEST FIRST` : null;
  return view.mine > 0 ? `${hits(view.mine)} · THE ${gm.toUpperCase()} APPLIES ${view.mine === 1 ? 'IT' : 'THEM'}` : null;
};

/** The HEALTH folder's tab: how many wait, to whoever may apply them or made some; to anyone else nothing. */
export const badgeWords = (view: WaitingView | null): string | null => {
  if (!view || !view.ok) return null;
  const n = view.may ? view.hits.length : view.mine;
  return n > 0 ? `${n} WAITING` : null;
};

/** APPLY's button: with what it would take where they may know it. */
export const applyLabel = (hit: WaitingHit): string => (hit.taken === null ? 'APPLY' : `APPLY ${hit.taken}`);
