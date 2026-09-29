// Built-in systems' derived values, written as data.
//
// Each is a word-for-word restatement of a hand-written recompute function in
// sheets/templates.js - cwnRecompute and sr6Recompute - and is held to it by
// __tests__/system_builder_parity.test.js, which runs both over thousands of sheets and
// requires the same values and the same list of changed fields.
//
// NOT used by the app. Every sheet is still worked out by the hand-written functions. These
// exist to prove the engine can carry a real system before anything is moved onto it, and to
// be the first examples a GM sees in the builder. Entries are listed in the order the
// hand-written functions write them, because the list of changed fields follows that order.

/** Cities Without Number (CWN QRD v2.2, CC BY-NC 4.0), as cwnRecompute has it. */
const CITIES_WITHOUT_NUMBER = {
  lookups: {
    // The attribute modifier table: 3 -> -2, 4-7 -> -1, 8-13 -> 0, 14-17 -> +1, 18+ -> +2.
    // The first band keeps an unset stat (read as 0) neutral rather than "a 3", so a
    // half-filled sheet does not roll at -2 everywhere.
    attribute_mod: {
      bands: [
        { upTo: 0, value: 0 },
        { upTo: 3, value: -2 },
        { upTo: 7, value: -1 },
        { upTo: 13, value: 0 },
        { upTo: 17, value: 1 },
        { value: 2 },
      ],
    },
  },
  derived: [
    { id: 'str_mod', formula: 'attribute_mod(@str)' },
    { id: 'dex_mod', formula: 'attribute_mod(@dex)' },
    { id: 'con_mod', formula: 'attribute_mod(@con)' },
    { id: 'int_mod', formula: 'attribute_mod(@int)' },
    { id: 'wis_mod', formula: 'attribute_mod(@wis)' },
    { id: 'cha_mod', formula: 'attribute_mod(@cha)' },
    { id: 'save_physical', formula: '16 - (@level + max(@str_mod, @con_mod))' },
    { id: 'save_evasion', formula: '16 - (@level + max(@dex_mod, @int_mod))' },
    { id: 'save_mental', formula: '16 - (@level + max(@wis_mod, @cha_mod))' },
    { id: 'save_luck', formula: '16 - @level' },
    { id: 'system_strain_max', formula: 'max(0, @con + @strain_mod)' },
    { id: 'trauma_target', formula: '6 + @armor_trauma_mod + $cwn_armor_trauma' },
    { id: 'armor_soak_total', formula: 'max(0, @armor_soak + $cwn_armor_soak)' },
    { id: 'move', formula: 'max(0, 10 + @move_mod + $cwn_move_bonus)' },
    { id: 'mage_effort_max', formula: 'max(1, max(@int_mod, @wis_mod) + @cast_skill)' },
    { id: 'spells_prepared_max', formula: 'ceil(@level / 2) + @cast_skill' },
    { id: 'summoner_effort_max', formula: 'max(1, max(@con_mod, @cha_mod) + @summon_skill)' },
  ],
};

/** Shadowrun 6E, as sr6Recompute has it. */
const SHADOWRUN_6E = {
  derived: [
    { id: 'physical_monitor', formula: '8 + ceil(@body / 2)' },
    { id: 'stun_monitor', formula: '8 + ceil(@willpower / 2)' },
    { id: 'initiative_score', formula: '@reaction + @intuition' },
    { id: 'composure', formula: '@willpower + @charisma' },
    { id: 'power_points_spent', formula: '$sr6_power_points_spent' },
    { id: 'power_points_remaining', formula: 'round((@magic - @power_points_spent) * 100) / 100' },
  ],
};

module.exports = { CITIES_WITHOUT_NUMBER, SHADOWRUN_6E };
