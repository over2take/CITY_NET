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

/** APPLY DAMAGE and WORK OUT RESISTANCES at this table (8b5b; backend damageTypes.js APPLY_DAMAGE_SETTING, WORK_OUT_SETTING): blank, the system's. */
export const APPLY_DAMAGE = 'apply_damage';
export const WORK_OUT_RESISTANCES = 'work_out_resistances';
/** HIT TOTALS ON NPCS: GM ONLY (8b5c; backend HIT_TOTALS_SETTING): on unless '0', what a hit took from an NPC the GM's alone. */
export const HIT_TOTALS_GM_ONLY = 'hit_totals_gm_only';

/** What a system has for each switch to switch; `damage` what the system itself says of a hit (8b5b). */
export interface TableSwitches {
  encumbrance: boolean; band_conditions: boolean; applied_conditions: boolean; turn_effects?: boolean; gear?: boolean;
  damage?: { apply: 'auto' | 'confirm' | 'off'; work_out: boolean };
}

/** A house rule picked from a few (8b5b), kept as its value; '' follows the system, the option marked (SYSTEM'S). */
export interface ChoiceRule { settingKey: string; label: string; title: string; options: { value: string; label: string }[] }

const APPLY_SAID = { auto: 'AUTO', confirm: 'CONFIRM', off: 'OFF' } as const;
/** One option a house rule offers: the system's own marked and kept as '' (following the system, the user's pick 2026-11-25). */
const option = (value: string, label: string, systems: boolean) => (systems ? { value: '', label: `${label} (SYSTEM'S)` } : { value, label });

/** APPLY DAMAGE and WORK OUT RESISTANCES for a game made in the builder, each starting as the system says; none for another. */
export const choiceRules = (has: TableSwitches | null | undefined): ChoiceRule[] => (has?.damage ? [
  {
    settingKey: APPLY_DAMAGE, label: 'APPLY DAMAGE',
    title: 'How a hit reaches its target. AUTO: taken off its health at once. CONFIRM: it waits on the target\'s HEALTH until applied or dismissed. OFF: rolled and logged only, the table does the rest.',
    options: (['auto', 'confirm', 'off'] as const).map((a) => option(a, APPLY_SAID[a], a === has.damage!.apply)),
  },
  {
    settingKey: WORK_OUT_RESISTANCES, label: 'WORK OUT RESISTANCES',
    title: 'Whether RESIST, IMMUNE and VULNERABLE change a hit\'s number as the system says (half, none, double). Off: every hit is taken as rolled, its resistances said beside it.',
    options: [option('1', 'ON', has.damage.work_out), option('0', 'OFF', !has.damage.work_out)],
  },
] : []);

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
  // HIT TOTALS ON NPCS: GM ONLY (8b5c; the user, 2026-11-25, "on by default"): where hits reach their targets.
  ...(has?.damage ? [{
    settingKey: HIT_TOTALS_GM_ONLY, label: 'HIT TOTALS ON NPCS: GM ONLY', defaultOn: true as const,
    title: 'Players see a hit\'s roll and that it reached an NPC, never what the NPC took or what it resisted; you see all of it. Off: they see what it took, and the resistances you have revealed.',
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
