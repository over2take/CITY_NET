import type { SheetTemplate } from './types';

// What a player can roll from their token's QUICK ACTIONS, read off the sheet's own template
// so it is the same list the sheet rolls from and follows each system without a table here:
// CWN's saves, CP:R's stats, SR6's initiative and composure as buttons, and every skill in a
// picker. Rolling goes through the sheet's roll path by field id, so the server applies the
// same wound penalties, skillplugs and the rest as the sheet's own roll buttons.

export interface QuickRoll {
  fieldId: string;
  label: string;
}

export interface QuickRollGroup {
  label: string;
  rolls: QuickRoll[];
}

export function quickRolls(template: SheetTemplate | null | undefined, hiddenTabs?: string[]): {
  /** Rolls that stand on their own - saves, stats - one button each. */
  checks: QuickRoll[];
  /** Skills, grouped as the sheet groups them. */
  skills: QuickRollGroup[];
} {
  const checks: QuickRoll[] = [];
  const skills: QuickRollGroup[] = [];
  const hidden = new Set(hiddenTabs ?? []);
  for (const section of template?.sections ?? []) {
    // A tab switched off by a house rule (CWN Deluxe's casting) is not on the sheet either.
    if (section.tab && hidden.has(section.tab)) continue;
    const rolls = (section.fields ?? [])
      .filter((f) => f.roll)
      .map((f) => ({ fieldId: f.id, label: f.roll!.label.toUpperCase() }));
    if (rolls.length === 0) continue;
    if (section.layout === 'skills') skills.push({ label: section.label, rolls });
    else checks.push(...rolls);
  }
  return { checks, skills };
}
