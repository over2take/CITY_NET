// What the builder's MY SYSTEMS says about a GM's own game systems (4a1b2, first for the SYSTEMS.EXE
// window, retired in 4a2c2b): the badges in its list, the facts
// beside the one picked, what an install preview offers, and the line after each action. Pure, so
// the window only draws it. The server's answers are shaped by backend/systemBuilder/store.js
// (listSystems, previewInstall, installSystem); its requests are in systemsApi.ts.
//
// Decided with the user: a system installed from a file is tagged INSTALLED (2026-10-06). A
// system already here is always offered UPDATE or KEEP BOTH; one changed here since it was
// installed is REPLACED only after a warning that those changes go, and an update keeps the name
// the system has here (2026-10-06).

/** One system in the list (GET /api/systems). */
export interface LibrarySystem {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  published: boolean;
  unpublishedChanges: boolean;
  installed: boolean;
  problemCount: number;
  /** The draft's description and author, '' when it has none. */
  description: string;
  author: string;
  /** Players' characters saved under it; NPCs aren't counted. */
  characterCount: number;
}

/**
 * The facts on a system's line in MY SYSTEMS, in order (approved mockup builder-my-systems,
 * 2026-10-06): who made it, when it changed, where it came from, how many characters play it.
 */
export const lineFacts = (s: LibrarySystem): string[] => [
  ...(s.author ? [`BY ${s.author.toUpperCase()}`] : []),
  `CHANGED ${changedFact(s.updatedAt)}`,
  s.installed ? 'INSTALLED FROM A FILE' : 'MADE HERE',
  plural(s.characterCount, 'CHARACTER'),
];

/** What a line says when the system has no description yet. */
export const NO_DESCRIPTION = 'No description yet. SETUP asks for one.';

export type BadgeTone = 'run' | 'plain' | 'warn' | 'bad';
export interface Badge { text: string; tone: BadgeTone }

const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`;

/** The badges under a system's name, in this order. `running` is the system the game runs. */
export const badgesFor = (s: LibrarySystem, running: string | null): Badge[] => {
  const badges: Badge[] = [];
  if (s.id === running) badges.push({ text: 'RUNNING', tone: 'run' });
  badges.push(s.published ? { text: `PUBLISHED v${s.version}`, tone: 'plain' } : { text: 'NEVER PUBLISHED', tone: 'warn' });
  if (s.published && s.unpublishedChanges) badges.push({ text: 'UNPUBLISHED CHANGES', tone: 'warn' });
  if (s.problemCount > 0) badges.push({ text: plural(s.problemCount, 'PROBLEM'), tone: 'bad' });
  if (s.installed) badges.push({ text: 'INSTALLED', tone: 'plain' });
  return badges;
};

/** Beside the name in the list: its version, or DRAFT before it is ever published. */
export const versionLabel = (s: LibrarySystem): string => (s.published ? `v${s.version}` : 'DRAFT');

/** The VERSION fact. */
export const versionFact = (s: LibrarySystem): string => {
  if (!s.published) return 'Never published';
  return `v${s.version} published${s.unpublishedChanges ? ', with changes not yet published' : ''}`;
};

/** The FROM fact. */
export const originFact = (s: LibrarySystem): string => (s.installed ? 'Installed from a file' : 'Made here');

/**
 * The CHANGED fact, in the GM's own time: the server stores UTC as "2026-10-06 14:10:00". Text
 * it can't read is shown as it came.
 */
export const changedFact = (updatedAt: string): string => {
  const at = new Date(`${updatedAt.replace(' ', 'T')}Z`);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(updatedAt) || Number.isNaN(at.getTime())) return updatedAt;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
};

/**
 * Sent on the window after the builder changes a system, so the game-system picker
 * fetches the list again: a renamed, copied or deleted system shows there at once.
 */
export const SYSTEMS_CHANGED_EVENT = 'citynet:systems-changed';

/** Why a button can't be used now, or null when it can. */
export const deleteBlocked = (s: LibrarySystem, running: string | null, openInBuilder: string | null = null): string | null => {
  if (s.id === running) return 'This is the system the game is running. Switch to another first.';
  if (s.id === openInBuilder) return 'It\'s open in the builder. Open another first.';
  return null;
};
export const exportBlocked = (s: LibrarySystem): string | null =>
  (s.published ? null : 'Publish it before sharing it. Only a published system is shared.');

// ─── Installing a file ──────────────────────────────────────────────────────

export type InstallMode = 'new' | 'update' | 'keep_both';

/** What the server says about a file before it is installed (POST /api/systems/install/preview). */
export interface InstallPreview {
  /** The file's cover, as backend/systemBuilder/citysys.js readFile keeps it; text is '' when absent. */
  manifest: { name: string; author: string; license: string; builder: string; version: number; origin: string };
  name: string;
  inside: {
    words: number; partsOff: number; currencies: number; derived: number; lookups: number;
    sheetFields: number; npcTiers: number; healthModel: string | null;
  };
  problems: { where: string; message: string }[];
  installed: { id: string; name: string; version: number; edited: boolean }[];
  restores: { id: string; name: string; replacesChanges: boolean } | null;
  installsAs: Record<InstallMode, string | null>;
}

/** The INSIDE badges: what the file holds, counted, leaving out what it doesn't have. */
export const insideBadges = (inside: InstallPreview['inside']): string[] => {
  const counts: [number, string, string?][] = [
    [inside.words, 'WORD RENAMED', 'WORDS RENAMED'],
    [inside.partsOff, 'PART OFF', 'PARTS OFF'],
    [inside.currencies, 'CURRENCY', 'CURRENCIES'],
    [inside.derived, 'FORMULA'],
    [inside.lookups, 'TABLE'],
    [inside.sheetFields, 'SHEET FIELD'],
    [inside.npcTiers, 'NPC TIER'],
  ];
  const badges = counts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  if (inside.healthModel) badges.push(`HEALTH: ${inside.healthModel.toUpperCase()}`);
  return badges;
};

export interface Notice { tone: 'good' | 'warn'; text: string }

/** One button under the preview. */
export interface InstallAction {
  label: string;
  mode: InstallMode;
  /** The name the system goes in under. */
  installsAs: string;
  /** Sent with an update that replaces changes made here. */
  replaceChanges?: true;
  primary?: true;
  /** Red, and asks this first. */
  confirm?: string;
  /** Why it can't be used, when it can't. */
  blocked?: string;
}

export interface InstallPlan { notices: Notice[]; actions: InstallAction[] }

/** What the preview says, and the buttons it offers. */
export const installPlan = (p: InstallPreview): InstallPlan => {
  const v = p.manifest.version;
  const hasProblems = p.problems.length > 0;
  const here = p.installed[0];
  const notices: Notice[] = [];
  const keepBoth = (): InstallAction => ({
    label: hasProblems ? 'KEEP BOTH, AS A DRAFT' : 'KEEP BOTH', mode: 'keep_both', installsAs: p.installsAs.keep_both!,
  });

  if (here) {
    const update: InstallAction = { label: `UPDATE TO v${v}`, mode: 'update', installsAs: p.installsAs.update! };
    if (hasProblems) {
      notices.push({ tone: 'warn', text: `${here.name} v${here.version} is installed here. This file has ${plural(p.problems.length, 'problem').toLowerCase()}, so it can't replace a system a game may be running. Keep both, and fix the copy in the builder.` });
      update.blocked = 'The file has problems';
    } else if (here.edited) {
      notices.push({ tone: 'warn', text: `${here.name} has been changed here since it was installed. Replacing it with v${v} loses those changes; keeping both installs the file beside it.` });
      update.label = `REPLACE WITH v${v}`;
      update.replaceChanges = true;
      update.confirm = `Your changes to ${here.name} since you installed it will be lost. Characters, banks and tokens are kept.`;
    } else {
      notices.push({ tone: 'good', text: `${here.name} v${here.version} is installed here and unchanged since. Updating replaces it with v${v}, keeping its name, characters, banks and tokens.` });
      update.primary = true;
    }
    notices.push({ tone: 'good', text: `Keeping both installs it beside ${here.name} as ${p.installsAs.keep_both}.` });
    return { notices, actions: [update, keepBoth()] };
  }

  const name = p.installsAs.new!;
  if (p.restores) {
    notices.push({ tone: 'good', text: `${p.restores.name} was deleted here. Installing brings it back under its old id, with every character, bank and token played in it.` });
    if (p.restores.replacesChanges) notices.push({ tone: 'warn', text: 'The deleted copy held changes made here that this file doesn\'t have. They are replaced.' });
  } else if (hasProblems) {
    notices.push({ tone: 'warn', text: `It has ${plural(p.problems.length, 'problem').toLowerCase()}, so it installs as a draft to fix in the builder. No game can run it until it's fixed and published.` });
  } else {
    notices.push({ tone: 'good', text: 'Not installed here. It installs as a new system, published and ready to run.' });
  }
  if (name !== p.name) notices.push({ tone: 'warn', text: `Another system is called ${p.name}, so this one installs as ${name}.` });
  const label = p.restores ? 'BRING IT BACK' : hasProblems ? 'INSTALL AS A DRAFT' : 'INSTALL';
  return { notices, actions: [{ label, mode: 'new', installsAs: name, primary: true }] };
};

/** What the server answers after an install (POST /api/systems/install). */
export interface InstallResult { id: string; name: string; published: boolean; restored?: boolean; problems: unknown[] }

/** The line under the preview after an install. `version` is the file's. */
export const installedMessage = (r: InstallResult, mode: InstallMode, version: number): string => {
  if (r.restored) return `${r.name} is back, with its characters.`;
  if (mode === 'update') return `Updated ${r.name} to v${version}. Its characters, banks and tokens are untouched.`;
  const draft = r.published ? '' : ` as a draft with ${plural(r.problems.length, 'problem').toLowerCase()} to fix`;
  if (mode === 'keep_both') return `Installed a second copy, ${r.name}, beside the first${draft}.`;
  return r.published ? `Installed ${r.name} v${version}. It's in the list and the game-system picker.` : `Installed ${r.name}${draft}.`;
};

// ─── The other actions ──────────────────────────────────────────────────────

export const renamedMessage = (name: string) => `Renamed to ${name}.`;
export const duplicatedMessage = (name: string) => `Copied as ${name}: a draft, its own system.`;
export const deletedMessage = (name: string) => `Deleted ${name}. Installing its file brings it back.`;
export const createdMessage = (name: string) => `Made ${name} as a draft.`;
