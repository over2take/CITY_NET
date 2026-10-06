/**
 * What SYSTEMS.EXE says (4a1b2): badges, facts, the install preview's notices and buttons, and the
 * line after each action. Decided with the user 2026-10-06: an INSTALLED tag; a system already
 * here is always offered UPDATE or KEEP BOTH, REPLACE (with a warning) when it was changed here,
 * and an update keeps its name here.
 */
import { describe, it, expect } from 'vitest';
import {
  badgesFor, versionLabel, versionFact, originFact, deleteBlocked, exportBlocked, insideBadges, installPlan,
  installedMessage, renamedMessage, duplicatedMessage, deletedMessage, createdMessage,
  type LibrarySystem, type InstallPreview,
} from '../systemsLibrary';

const sys = (over: Partial<LibrarySystem> = {}): LibrarySystem => ({
  id: 'sys_aaaaaaaaaaaaaaaa', name: 'Hearth', version: 3, updatedAt: '2026-10-06 08:00:00', publishedAt: '2026-10-05 20:00:00',
  published: true, unpublishedChanges: false, installed: false, problemCount: 0, ...over,
});
const text = (s: LibrarySystem, running: string | null = null) => badgesFor(s, running).map((b) => `${b.text}/${b.tone}`);

describe('badges', () => {
  it('a published system, as it is', () => {
    expect(text(sys())).toEqual(['PUBLISHED v3/plain']);
  });

  it('every badge at once, in order', () => {
    expect(text(sys({ unpublishedChanges: true, problemCount: 2, installed: true }), 'sys_aaaaaaaaaaaaaaaa'))
      .toEqual(['RUNNING/run', 'PUBLISHED v3/plain', 'UNPUBLISHED CHANGES/warn', '2 PROBLEMS/bad', 'INSTALLED/plain']);
  });

  it('one never published: no unpublished-changes badge, which it always has', () => {
    expect(text(sys({ published: false, version: 0, unpublishedChanges: true }))).toEqual(['NEVER PUBLISHED/warn']);
  });

  it('one problem, singular; running only for the system the game runs', () => {
    expect(text(sys({ problemCount: 1 }), 'sys_bbbbbbbbbbbbbbbb')).toEqual(['PUBLISHED v3/plain', '1 PROBLEM/bad']);
  });
});

describe('facts', () => {
  it('version beside the name, and in the facts', () => {
    expect(versionLabel(sys())).toBe('v3');
    expect(versionLabel(sys({ published: false }))).toBe('DRAFT');
    expect(versionFact(sys())).toBe('v3 published');
    expect(versionFact(sys({ unpublishedChanges: true }))).toBe('v3 published, with changes not yet published');
    expect(versionFact(sys({ published: false }))).toBe('Never published');
  });

  it('where it came from', () => {
    expect(originFact(sys({ installed: true }))).toBe('Installed from a file');
    expect(originFact(sys())).toBe('Made here');
  });

  it('why DELETE and EXPORT are off', () => {
    expect(deleteBlocked(sys(), 'sys_aaaaaaaaaaaaaaaa')).toBe('This is the system the game is running. Switch to another first.');
    expect(deleteBlocked(sys(), 'cities_without_number')).toBeNull();
    expect(exportBlocked(sys({ published: false }))).toBe('Publish it before sharing it. Only a published system is shared.');
    expect(exportBlocked(sys())).toBeNull();
  });
});

const INSIDE: InstallPreview['inside'] = { words: 0, partsOff: 0, currencies: 0, derived: 0, lookups: 0, sheetFields: 0, npcTiers: 0, healthModel: null };

describe('what the file holds', () => {
  it('counts each, singular or plural, leaving out what it lacks', () => {
    expect(insideBadges(INSIDE)).toEqual([]);
    expect(insideBadges({ words: 12, partsOff: 1, currencies: 2, derived: 1, lookups: 3, sheetFields: 41, npcTiers: 1, healthModel: 'wounds' }))
      .toEqual(['12 WORDS RENAMED', '1 PART OFF', '2 CURRENCIES', '1 FORMULA', '3 TABLES', '41 SHEET FIELDS', '1 NPC TIER', 'HEALTH: WOUNDS']);
    expect(insideBadges({ ...INSIDE, words: 1, partsOff: 2, currencies: 1, derived: 2, lookups: 1, sheetFields: 1, npcTiers: 3 }))
      .toEqual(['1 WORD RENAMED', '2 PARTS OFF', '1 CURRENCY', '2 FORMULAS', '1 TABLE', '1 SHEET FIELD', '3 NPC TIERS']);
  });
});

const preview = (over: Partial<InstallPreview> = {}): InstallPreview => ({
  manifest: { name: 'Vault Knights', author: 'R. Ade', license: '', builder: '1.15.0', version: 4, origin: 'org_vault' },
  name: 'Vault Knights', inside: INSIDE, problems: [], installed: [], restores: null,
  installsAs: { new: 'Vault Knights', update: null, keep_both: 'Vault Knights' }, ...over,
});
const PROBLEM = { where: 'derived armor', message: 'Depends on itself' };
const HERE = { id: 'sys_cccccccccccccccc', name: 'Vault Knights', version: 3, edited: false };
const installedHere = (over: Partial<typeof HERE> = {}, rest: Partial<InstallPreview> = {}) => preview({
  installed: [{ ...HERE, ...over }], installsAs: { new: null, update: over.name ?? 'Vault Knights', keep_both: 'Vault Knights copy' }, ...rest,
});

describe('the install preview', () => {
  it('a new system: one INSTALL', () => {
    expect(installPlan(preview())).toEqual({
      notices: [{ tone: 'good', text: 'Not installed here. It installs as a new system, published and ready to run.' }],
      actions: [{ label: 'INSTALL', mode: 'new', installsAs: 'Vault Knights', primary: true }],
    });
  });

  it('a new system whose name is taken: says the name it goes in under', () => {
    const plan = installPlan(preview({ installsAs: { new: 'Vault Knights copy', update: null, keep_both: 'Vault Knights copy' } }));
    expect(plan.notices[1]).toEqual({ tone: 'warn', text: 'Another system is called Vault Knights, so this one installs as Vault Knights copy.' });
    expect(plan.actions).toEqual([{ label: 'INSTALL', mode: 'new', installsAs: 'Vault Knights copy', primary: true }]);
  });

  it('a new system with problems: a draft to fix', () => {
    const plan = installPlan(preview({ problems: [PROBLEM, PROBLEM] }));
    expect(plan.notices).toEqual([{ tone: 'warn', text: 'It has 2 problems, so it installs as a draft to fix in the builder. No game can run it until it\'s fixed and published.' }]);
    expect(plan.actions[0].label).toBe('INSTALL AS A DRAFT');
    expect(installPlan(preview({ problems: [PROBLEM] })).notices[0].text).toMatch(/^It has 1 problem, so/);
  });

  it('one deleted here: brings it back, warning when that replaces changes made here', () => {
    const back = preview({ restores: { id: HERE.id, name: 'Vault Knights', replacesChanges: false } });
    expect(installPlan(back)).toEqual({
      notices: [{ tone: 'good', text: 'Vault Knights was deleted here. Installing brings it back under its old id, with every character, bank and token played in it.' }],
      actions: [{ label: 'BRING IT BACK', mode: 'new', installsAs: 'Vault Knights', primary: true }],
    });
    const lost = installPlan(preview({ restores: { id: HERE.id, name: 'Vault Knights', replacesChanges: true } }));
    expect(lost.notices[1]).toEqual({ tone: 'warn', text: 'The deleted copy held changes made here that this file doesn\'t have. They are replaced.' });
    // Brought back, even with problems: the label says what happens.
    expect(installPlan(preview({ problems: [PROBLEM], restores: { id: HERE.id, name: 'Vault Knights', replacesChanges: false } })).actions[0].label).toBe('BRING IT BACK');
  });

  it('installed and unchanged: UPDATE first, or KEEP BOTH as a copy', () => {
    expect(installPlan(installedHere())).toEqual({
      notices: [
        { tone: 'good', text: 'Vault Knights v3 is installed here and unchanged since. Updating replaces it with v4, keeping its name, characters, banks and tokens.' },
        { tone: 'good', text: 'Keeping both installs it beside Vault Knights as Vault Knights copy.' },
      ],
      actions: [
        { label: 'UPDATE TO v4', mode: 'update', installsAs: 'Vault Knights', primary: true },
        { label: 'KEEP BOTH', mode: 'keep_both', installsAs: 'Vault Knights copy' },
      ],
    });
  });

  it('changed here: REPLACE, red, asking first; nothing pre-picked', () => {
    const plan = installPlan(installedHere({ edited: true, name: 'Vault Knights (ours)' }));
    expect(plan.notices[0]).toEqual({ tone: 'warn', text: 'Vault Knights (ours) has been changed here since it was installed. Replacing it with v4 loses those changes; keeping both installs the file beside it.' });
    expect(plan.actions[0]).toEqual({
      label: 'REPLACE WITH v4', mode: 'update', installsAs: 'Vault Knights (ours)', replaceChanges: true,
      confirm: 'Your changes to Vault Knights (ours) since you installed it will be lost. Characters, banks and tokens are kept.',
    });
    expect(plan.actions[1]).toEqual({ label: 'KEEP BOTH', mode: 'keep_both', installsAs: 'Vault Knights copy' });
  });

  it('installed, and the file has problems: UPDATE is off, saying why; KEEP BOTH as a draft', () => {
    const plan = installPlan(installedHere({ edited: true }, { problems: [PROBLEM] }));
    expect(plan.notices[0]).toEqual({ tone: 'warn', text: 'Vault Knights v3 is installed here. This file has 1 problem, so it can\'t replace a system a game may be running. Keep both, and fix the copy in the builder.' });
    expect(plan.actions).toEqual([
      { label: 'UPDATE TO v4', mode: 'update', installsAs: 'Vault Knights', blocked: 'The file has problems' },
      { label: 'KEEP BOTH, AS A DRAFT', mode: 'keep_both', installsAs: 'Vault Knights copy' },
    ]);
  });
});

describe('the line after each action', () => {
  const result = (over = {}) => ({ id: HERE.id, name: 'Vault Knights', published: true, problems: [], ...over });

  it('after an install', () => {
    expect(installedMessage(result(), 'new', 4)).toBe('Installed Vault Knights v4. It\'s in the list and the game-system picker.');
    expect(installedMessage(result({ published: false, problems: [PROBLEM, PROBLEM] }), 'new', 4)).toBe('Installed Vault Knights as a draft with 2 problems to fix.');
    expect(installedMessage(result({ restored: true }), 'new', 4)).toBe('Vault Knights is back, with its characters.');
    expect(installedMessage(result(), 'update', 4)).toBe('Updated Vault Knights to v4. Its characters, banks and tokens are untouched.');
    expect(installedMessage(result({ name: 'Vault Knights copy' }), 'keep_both', 4)).toBe('Installed a second copy, Vault Knights copy, beside the first.');
    expect(installedMessage(result({ name: 'Vault Knights copy', published: false, problems: [PROBLEM] }), 'keep_both', 4))
      .toBe('Installed a second copy, Vault Knights copy, beside the first as a draft with 1 problem to fix.');
  });

  it('after the others', () => {
    expect(renamedMessage('Emberhold')).toBe('Renamed to Emberhold.');
    expect(duplicatedMessage('Hearth copy')).toBe('Copied as Hearth copy: a draft, its own system.');
    expect(deletedMessage('Hearth')).toBe('Deleted Hearth. Installing its file brings it back.');
    expect(createdMessage('Hearth')).toBe('Made Hearth as a draft.');
  });
});
