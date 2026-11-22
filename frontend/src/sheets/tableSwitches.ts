// The GAME tab's switches for a custom system's encumbrance and conditions (8a6b; approved mockup
// docs/mockups/carrying-on-sheet.html, 2026-11-19, the user: "yes to all"): SHOW ENCUMBRANCE, BAND CONDITIONS and APPLY
// CONDITION MODIFIERS; and CONDITION TURN EFFECTS (8a9c; approved mockup docs/mockups/condition-turn-effects.html, "I love
// it"). All on to start, each offered only where the system has what it switches (the render copy's
// `switches`, backend systemBuilder/runtime.js). Kept in the table's settings as the other house rules are; the last two the
// server reads (sheets/bandConditions.js, sheets/conditionsOnSheet.js), the first the sheet.

/** CARRYING on the sheet's GEAR tab: '0' hides it at this table. */
export const SHOW_ENCUMBRANCE = 'show_encumbrance';
/** A band's condition put on the token (backend BAND_SETTING): '0' switches it off. */
export const BAND_CONDITIONS = 'band_conditions';
/** A condition APPLIED changing the sheet's numbers (backend CONDITIONS_SETTING): '0' keeps them all reminders. */
export const APPLY_CONDITION_MODIFIERS = 'apply_condition_modifiers';
/** A condition's EACH TURN rolled on NEXT and BEGIN (backend TURN_EFFECTS_SETTING): '0' leaves them to the GM. */
export const CONDITION_TURN_EFFECTS = 'condition_turn_effects';
/** Players changing their gear lines' columns (G6; backend uniqueLines.js PLAYERS_GEAR_SETTING): '0' leaves them to the GM. */
export const PLAYERS_CHANGE_GEAR = 'players_change_gear';

/** What a system has for each switch to switch. */
export interface TableSwitches { encumbrance: boolean; band_conditions: boolean; applied_conditions: boolean; turn_effects?: boolean; gear?: boolean }

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
  ...(has?.turn_effects ? [{
    settingKey: CONDITION_TURN_EFFECTS, label: 'CONDITION TURN EFFECTS', defaultOn: true as const,
    title: 'Each condition\'s EACH TURN is rolled on NEXT and BEGIN, burning, healing or a save, said in the log. Off: nothing is rolled on turns; the conditions stay on the tokens as reminders and the GM rolls by hand. One that ends at the end of its next turn still comes off.',
  }] : []),
  // PLAYERS CHANGE GEAR (G6; decided 2026-11-20): where the system makes its own item types.
  ...(has?.gear ? [{
    settingKey: PLAYERS_CHANGE_GEAR, label: 'PLAYERS CHANGE GEAR', defaultOn: true as const,
    title: 'Players change the columns of their own gear, a weapon\'s DAMAGE or a potion\'s HEALS, each change marked UNIQUE. Off: only the GM changes them; players still name, count, move and add their things.',
  }] : []),
];

/** Whether players change their gear's columns at this table (G6b), from its settings: on unless switched off. */
export const gearByPlayers = (settings: { key: string; value: string }[]): boolean =>
  settings.find((s) => s.key === PLAYERS_CHANGE_GEAR)?.value !== '0';

/** Whether CARRYING shows at this table, from its settings: on unless switched off. */
export const carryingShown = (settings: { key: string; value: string }[]): boolean =>
  settings.find((s) => s.key === SHOW_ENCUMBRANCE)?.value !== '0';
