// The standalone sheet tab asking the main app to open one of its windows (8s1d; the user, 2026-11-17: rather than a
// second copy on the tab, "push a request to just open them in the main app"). BANK, HEALTH and VEHICLES lean on the
// map and the main app's state, so the tab asks and the main app opens its own, as a click in SHEET.EXE would. The two
// are the same browser, the tab opened by the main app, so they talk over a BroadcastChannel; nothing goes by the server.
// The main app answers each ask it acts on: no answer in a moment means it isn't open, and the tab says so.

export const MAIN_WINDOW_CHANNEL = 'citynet-sheet-tab';
/** How long the tab waits for the main app's answer. */
export const ASK_WAIT_MS = 1500;

export type MainWindowAsk = 'bank' | 'health' | 'vehicles';
const ASKS: MainWindowAsk[] = ['bank', 'health', 'vehicles'];
/** What each is called where the tab says it. */
export const ASK_WORDS: Record<MainWindowAsk, string> = { bank: 'BANK', health: 'HEALTH', vehicles: 'VEHICLES' };

interface Ask { kind: 'open'; what: MainWindowAsk; user: string; id: string }
interface Answer { kind: 'opened'; id: string }

/** The window a linked field opens: the bank's for the balance, the character's health for the rest. */
export const askOfLink = (source: string): MainWindowAsk => (source === 'bank_balance' ? 'bank' : 'health');

const channelOf = (): BroadcastChannel | null => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(MAIN_WINDOW_CHANNEL));

/** The tab: ask the main app to open `what` for `user`; true once it says it did, false if nothing answers in time. */
export const askMainWindow = (what: MainWindowAsk, user: string, wait = ASK_WAIT_MS): Promise<boolean> => new Promise((resolve) => {
  const channel = channelOf();
  if (!channel) { resolve(false); return; }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const done = (answered: boolean) => { clearTimeout(timer); channel.close(); resolve(answered); };
  const timer = setTimeout(() => done(false), wait);
  channel.onmessage = (e: MessageEvent) => {
    const a = e.data as Partial<Answer> | null;
    if (a && a.kind === 'opened' && a.id === id) done(true);
  };
  channel.postMessage({ kind: 'open', what, user, id } satisfies Ask);
});

/**
 * The main app: answer the tab's asks while it is open. `open(what)` opens the window as SHEET.EXE's own link would; an
 * ask for another user, or for something not asked for here, is passed over. The returned function stops listening.
 */
export const answerMainWindowAsks = (userName: string, open: (what: MainWindowAsk) => void): (() => void) => {
  const channel = channelOf();
  if (!channel) return () => {};
  channel.onmessage = (e: MessageEvent) => {
    const a = e.data as Partial<Ask> | null;
    if (!a || a.kind !== 'open' || a.user !== userName || !ASKS.includes(a.what as MainWindowAsk) || typeof a.id !== 'string') return;
    open(a.what as MainWindowAsk);
    channel.postMessage({ kind: 'opened', id: a.id } satisfies Answer);
  };
  return () => channel.close();
};
