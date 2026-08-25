// What a cyberware modifier is allowed to point at, per game system.
//
// Derived from the sheet template rather than listed here, because the template already
// is the list: it knows every stat and every skill for the system in front of you, and a
// second copy would be one more thing to keep in step when a skill is renamed. The
// Companion can hardcode its own because it is a Cyberpunk tool; this app runs three
// systems and the SR6 skill list is not the CP:R one.
//
// The exception is roll types, which the templates do not describe — see ROLL_TARGETS.

import type { SheetTemplate, SheetField, SheetOption } from './types';
import type { ModKind } from './cyberwareRows';

/**
 * Roll categories, which are the one thing not derivable from a template.
 *
 * A template knows which *fields* can be rolled — every skill has a formula — but a roll
 * type is a kind of action rather than a field, and nothing in the app enumerates those.
 * So this is a short, deliberately generic list of things every system in the app has a
 * notion of, rather than one system's table of manoeuvres.
 *
 * A value that is not on it still survives: an imported modifier keeps whatever the
 * Companion called it, and `targetOptions` adds the current value to the list rather than
 * silently dropping a piece's effect on the first edit.
 */
const ROLL_TARGETS = ['Initiative', 'Attack', 'Damage', 'Aimed Shot', 'Autofire'];

const sectionsWith = (template: SheetTemplate, layout: string) =>
  template.sections.filter((s) => s.layout === layout);

/** Every skill on the sheet, which is every field in a section laid out as skills. */
export const skillFields = (template: SheetTemplate): SheetField[] =>
  sectionsWith(template, 'skills').flatMap((s) => s.fields);

/**
 * Every stat on the sheet.
 *
 * Found through the skills rather than by looking for a section called "stats": each skill
 * names the stat it keys off, so the stats are whatever those names resolve to, and the
 * section holding them is the stat block. That works unchanged for CWN, whose skills key
 * off `int_mod` rather than `int`.
 *
 * Taking the whole section rather than only the referenced fields catches the stats no
 * skill happens to use — MOVE and LUCK on a Cyberpunk sheet are stats a piece of chrome
 * can plausibly modify, and neither is any skill's key.
 *
 * Maximums and derived fields are left out. `EMP MAX` is the ceiling for `EMP`, not a stat
 * of its own, and offering both invites a modifier on the wrong one; CWN's `STR MOD` is
 * recomputed from STR on every save, so a modifier aimed at it could never hold.
 */
export function statFields(template: SheetTemplate): SheetField[] {
  const keys = new Set(skillFields(template).map((f) => f.stat).filter(Boolean));
  if (!keys.size) return [];

  const block = template.sections.find((s) => s.fields.some((f) => keys.has(f.id)));
  if (!block) return [];

  const maxima = new Set(block.fields.map((f) => f.maxField).filter(Boolean));
  return block.fields.filter((f) => f.type === 'number' && !maxima.has(f.id) && !f.derived);
}

const asOptions = (fields: SheetField[]): SheetOption[] =>
  fields.map((f) => ({ value: f.label, label: f.label }));

/**
 * The choices for one modifier, given what it modifies.
 *
 * Stored by label rather than by field id, because that is what an import carries: the
 * Companion writes `{ "Business": 6 }`, not a field id, and a list keyed on ids would
 * match none of it.
 *
 * `current` is included even when it is not otherwise on the list, so opening the form on
 * an imported piece cannot quietly change what it does. A modifier naming something this
 * system does not have is still that piece's modifier.
 */
export function targetOptions(
  kind: ModKind,
  template: SheetTemplate | undefined,
  current = '',
): SheetOption[] {
  const base: SheetOption[] = !template
    ? []
    : kind === 'skill' || kind === 'skillSet'
      ? asOptions(skillFields(template))
      : kind === 'roll'
        ? ROLL_TARGETS.map((t) => ({ value: t, label: t }))
        : asOptions(statFields(template));

  const has = base.some((o) => o.value === current);
  return current && !has ? [{ value: current, label: current }, ...base] : base;
}
