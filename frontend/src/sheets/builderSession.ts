// The builder's saving, and what its sidebar holds (4a2a). Pure apart from the timer it is
// given, so the builder screen only draws it.
//
// Decided with the user, 2026-10-06: saving has two layers. Autosave writes the system's draft
// about five seconds after editing stops, and always on leaving; SAVE only saves now; PUBLISH
// makes the draft what the game runs. EXIT TO MAP leaves at once, saving first, and warns only
// when that save failed. There is no "autosaved but not saved" copy. (Autosave timing decided
// 2026-10-03; sidebar names proposed then, kept until the user has clicked around in them.)

/** How long after the last edit an autosave waits. */
export const AUTOSAVE_DELAY_MS = 5000;

export interface Problem { where: string; message: string }

/** Where the draft stands. */
export type SaveState =
  | { kind: 'saved'; at: Date }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'failed'; error: string };

/** What a save answers: the server's problem list for the draft, or why it wasn't saved. */
export type SaveAnswer = { ok: true; problems: Problem[] } | { ok: false; error: string };

export interface Autosave<D> {
  /** The definition changed: saved once editing pauses. */
  edit(definition: D): void;
  /** Save now if anything is unsaved, or a save failed. True once nothing is left unsaved. */
  flush(): Promise<boolean>;
  readonly state: SaveState;
  /** The draft's problems as of the last save. */
  readonly problems: Problem[];
  /** Stops the timer; an edit still unsaved stays unsaved. */
  dispose(): void;
}

interface Timers { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * Autosave for one system. `save` writes a definition; `onChange` hears every change of state
 * or problems. An edit made while a save is under way is saved straight after it, so the last
 * edit is always the one that ends up stored.
 */
export function createAutosave<D>({
  save, onChange = () => {}, initialProblems = [], delay = AUTOSAVE_DELAY_MS, now = () => new Date(), timers = realTimers,
}: {
  save: (definition: D) => Promise<SaveAnswer>;
  onChange?: () => void;
  initialProblems?: Problem[];
  delay?: number;
  now?: () => Date;
  timers?: Timers;
}): Autosave<D> {
  let state: SaveState = { kind: 'saved', at: now() };
  let problems = initialProblems;
  let latest: D | undefined;
  /** Whether `latest` is not yet stored. */
  let unsaved = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;

  const set = (next: SaveState) => { state = next; onChange(); };
  const stopTimer = () => { if (timer !== null) { timers.clear(timer); timer = null; } };

  /** One save of the latest definition, after any save already on its way. */
  const run = async (): Promise<void> => {
    if (running) await running;
    // Several may have waited on that save; the first to wake takes the edit, the rest find none.
    if (!unsaved) return;
    stopTimer();
    const sending = latest as D;
    unsaved = false;
    set({ kind: 'saving' });
    const failed = (error: string) => { unsaved = true; set({ kind: 'failed', error }); };
    running = save(sending).then((answer) => {
      running = null;
      if (!answer.ok) return failed(answer.error);
      problems = answer.problems;
      // Edited again while this one was on its way: that edit still waits for its pause.
      set(unsaved ? { kind: 'pending' } : { kind: 'saved', at: now() });
    }, () => { running = null; failed('Could not reach the server.'); });
    await running;
  };

  return {
    edit(definition) {
      latest = definition;
      unsaved = true;
      stopTimer();
      timer = timers.set(() => { timer = null; void run(); }, delay);
      if (state.kind !== 'saving') set({ kind: 'pending' });
    },
    async flush() {
      // Until nothing is left: an edit made during a save is saved straight after it.
      for (;;) {
        await run();
        if (state.kind === 'failed') return false;
        if (!unsaved && !running) return true;
      }
    },
    get state() { return state; },
    get problems() { return problems; },
    dispose: stopTimer,
  };
}

const two = (n: number) => String(n).padStart(2, '0');

/** The status line's words for the draft, and how loud they are. */
export const saveStatus = (s: SaveState): { text: string; tone: 'quiet' | 'warn' | 'bad' } => {
  switch (s.kind) {
    case 'saved': return { text: `DRAFT · SAVED ${two(s.at.getHours())}:${two(s.at.getMinutes())}`, tone: 'quiet' };
    case 'pending': return { text: 'DRAFT · UNSAVED CHANGES', tone: 'warn' };
    case 'saving': return { text: 'DRAFT · SAVING…', tone: 'warn' };
    case 'failed': return { text: `NOT SAVED: ${s.error}`, tone: 'bad' };
  }
};

/** The words when EXIT TO MAP couldn't save first. */
export const exitWarning = (systemName: string, error: string) => ({
  title: 'EXIT.EXE · UNSAVED WORK',
  text: `Your latest changes to ${systemName} couldn't be saved: ${error}`,
  hint: 'Leaving now loses them. Try again, or stay and keep working.',
});

/** Whether closing or reloading the browser tab should ask first. */
export const leaveNeedsAsking = (s: SaveState): boolean => s.kind !== 'saved';

// ─── Publishing ─────────────────────────────────────────────────────────────

/** What PUBLISH says before it is pressed: why it can't yet, or null when it can. */
export const publishBlocked = (problems: Problem[]): string | null =>
  (problems.length === 0 ? null : `Fix ${problems.length === 1 ? 'this problem' : `these ${problems.length} problems`} before publishing.`);

/** The line after PUBLISH. `running` says whether the game runs this system now. */
export const publishedMessage = (version: number, running: boolean): string =>
  (running ? `Published v${version}. The game runs it from now on.` : `Published v${version}. It's ready to pick in the game-system picker.`);

// ─── The sidebar ────────────────────────────────────────────────────────────

export type BuilderPage = 'setup' | 'words' | 'features' | 'rules' | 'sheet' | 'npcs' | 'conditions' | 'try' | 'problems';

/**
 * The builder's pages, in the sidebar's order, each with the line that says what it is for
 * (the user found the design's PARTS / VALUES / CHECK unclear, 2026-10-03). MY SYSTEMS, SAVE /
 * PUBLISH and EXIT TO MAP are the sidebar's own buttons, not pages.
 */
export const BUILDER_PAGES: { id: BuilderPage; label: string; what: string }[] = [
  { id: 'setup', label: 'SETUP', what: 'The questions a new system starts with.' },
  { id: 'words', label: 'WORDS', what: 'What the game calls things: HP, credits, skills.' },
  { id: 'features', label: 'FEATURES', what: 'Which parts of the app this game uses.' },
  { id: 'rules', label: 'STATS & RULES', what: 'Stats, formulas and tables.' },
  { id: 'sheet', label: 'CHARACTER SHEET', what: 'How a character sheet is laid out.' },
  { id: 'npcs', label: 'NPCS', what: 'NPC tiers and their sheets.' },
  { id: 'conditions', label: 'CONDITIONS', what: 'What can happen to a character besides losing health.' },
  { id: 'try', label: 'TRY IT', what: 'A test character, to see the rules work.' },
  { id: 'problems', label: 'PROBLEMS', what: 'What to fix before publishing.' },
];
