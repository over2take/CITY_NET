// The GAME tab's three switches for a custom system's encumbrance and conditions (8a6b; approved mockup
// docs/mockups/carrying-on-sheet.html, 2026-11-19, the user: "yes to all"): SHOW ENCUMBRANCE, BAND CONDITIONS and APPLY
// CONDITION MODIFIERS, all on to start, each offered only where the system has what it switches (the render copy's
// `switches`, backend systemBuilder/runtime.js). Kept in the table's settings as the other house rules are; the last two the
// server reads (sheets/bandConditions.js, sheets/conditionsOnSheet.js), the first the sheet.

/** CARRYING on the sheet's GEAR tab: '0' hides it at this table. */
export const SHOW_ENCUMBRANCE = 'show_encumbrance';
/** A band's condition put on the token (backend BAND_SETTING): '0' switches it off. */
export const BAND_CONDITIONS = 'band_conditions';
/** A condition APPLIED changing the sheet's numbers (backend CONDITIONS_SETTING): '0' keeps them all reminders. */
export const APPLY_CONDITION_MODIFIERS = 'apply_condition_modifiers';

/** What a system has for each switch to switch. */
export interface TableSwitches { encumbrance: boolean; band_conditions: boolean; applied_conditions: boolean }

export interface SwitchRule { settingKey: string; label: string; title: string; defaultOn: true }

/** The switches a system is offered, in order; none for a built-in game or one not loaded yet. */
export const switchRules = (has: TableSwitches | null | undefined): SwitchRule[] => [
  ...(has?.encumbrance ? [{
    settingKey: SHOW_ENCUMBRANCE, label: 'SHOW ENCUMBRANCE', defaultOn: true as const,
    title: 'CARRYING at the top of GEAR: what each character carries against what they can, the band they are in and what it means. Off: hidden on the players\' sheets. Nothing is enforced either way.',
  }] : []),
  ...(has?.band_conditions ? [{
    settingKey: BAND_CONDITIONS, label: 'BAND CONDITIONS', defaultOn: true as const,
    title: 'A band\'s condition goes on a character\'s token while they are in that band, and comes off when they leave it. Off: the bands still say what they mean, but put nothing on, and what they had put on comes off.',
  }] : []),
  ...(has?.applied_conditions ? [{
    settingKey: APPLY_CONDITION_MODIFIERS, label: 'APPLY CONDITION MODIFIERS', defaultOn: true as const,
    title: 'A condition marked APPLIED changes the numbers on the sheet while it is on the token, like SLOWED: Speed ×0.5. Off: every condition is a reminder, its change said but not made.',
  }] : []),
];

/** Whether CARRYING shows at this table, from its settings: on unless switched off. */
export const carryingShown = (settings: { key: string; value: string }[]): boolean =>
  settings.find((s) => s.key === SHOW_ENCUMBRANCE)?.value !== '0';
