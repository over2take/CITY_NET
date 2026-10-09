// The built-in examples in the builder (4d1b; approved mockup docs/mockups/builder-examples.html,
// 2026-10-08): Cities Without Number and Shadowrun as systems to copy under a name of the GM's
// own (+ NEW's START FROM A BUILT-IN EXAMPLE), or to look at first with every page locked but
// TRY IT. The examples themselves are the server's (backend/systemBuilder/examples.js).

import type { Definition } from './systemsApi';
import { setupOf, HEALTH_MODELS, ADVANCEMENT } from './setup';

/** What an example's card says it holds, as label and value. */
export const exampleFacts = (def: Definition): [string, string][] => {
  const setup = setupOf(def);
  const model = HEALTH_MODELS.find((m) => m.id === setup.health.model)?.label ?? 'One pool';
  const health = setup.health.model === 'tracks' && (setup.health as { overflow?: boolean }).overflow ? `${model}, overflow` : model;
  // In the system's own word for XP: Shadowrun spends KARMA.
  const words = def.words as { xp?: { singular?: string } } | undefined;
  const xp = typeof words?.xp?.singular === 'string' && words.xp.singular.trim() ? words.xp.singular : 'XP';
  const advances = setup.advancement.length
    ? setup.advancement.map((id) => (ADVANCEMENT.find((a) => a.id === id)?.label ?? id).replace('XP', xp)).join(', ')
    : 'None';
  const groups = Array.isArray(def.stats) ? def.stats as { stats?: unknown }[] : [];
  const stats = groups.reduce((n, g) => n + (g && Array.isArray(g.stats) ? g.stats.length : 0), 0);
  const formulas = Array.isArray(def.derived) ? def.derived.length : 0;
  return [
    ['HEALTH', health],
    ['ADVANCES', advances],
    ['STATS', `${stats} in ${groups.length} group${groups.length === 1 ? '' : 's'}`],
    ['FORMULAS', String(formulas)],
    ['DISTANCE', setup.distance.charAt(0).toUpperCase() + setup.distance.slice(1)],
  ];
};

/** The name box's suggestion for a copy. A suggestion only: the GM still types a name. */
export const suggestedName = (exampleName: string) => `${exampleName} (house rules)`;

/** Said when something tries to change an example the builder is looking at. */
export const LOCKED_MESSAGE = 'This is an example: copy it to change it.';

/**
 * Whether a control only moves around an example (a tab, something opening out, a view to look
 * through) rather than changing it, so it stays usable while every other control is locked.
 */
export const isBrowseControl = (el: Element): boolean =>
  el.getAttribute('role') === 'tab' || el.hasAttribute('aria-expanded') || el.hasAttribute('data-browse');

const CONTROLS = 'input, select, textarea, button';

/**
 * Lock every control under `root` that isn't for browsing. Only those not locked yet are touched,
 * so watching for changes and locking again never loops. Answers how many it locked.
 */
export const lockControls = (root: Element): number => {
  let locked = 0;
  root.querySelectorAll(CONTROLS).forEach((el) => {
    const control = el as HTMLInputElement;
    if (control.disabled || isBrowseControl(control)) return;
    control.disabled = true;
    locked += 1;
  });
  return locked;
};
