# What the browser tests cover

Every option a GM can set in the System Builder, and where it is proven. The server's handling of
each one is tested on its own (`backend/__tests__`, named here without `system_builder_` and
`.test.js`); this map is about the browser: that an option survives the whole way, from the
builder, through PUBLISH, to what a player or the GM sees and does at the table. Those bugs only a
browser catches.

Kept since 2026-10-28 (an audit found most options built but never played in a browser). The rule:

- Every option is proven **at the table** in a browser at least once. One journey per family,
  covering the variants that change what people see, not every value.
- A piece that adds or changes an option adds or updates its row here in the same PR.
- A **GAP** is work to schedule, not a state to leave. Phase 7 closes the gaps found by the audit,
  one family between each of its pieces, riskiest first (the order in [Gaps, in order](#gaps-in-order)).

| Status | Means |
|---|---|
| **AT THE TABLE** | Built (or set up), published, and seen working on a player's or the GM's screen |
| **BUILDER ONLY** | Made and checked in the builder in a browser, never played |
| **GAP** | No browser test |

Every builder control also takes a real click (`builder-clicks.spec.ts`, every page, tab and open
panel), so a control that looks fine but does nothing is caught for all of them.

## Words and parts

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Words renamed | HP, the GM, any term; one / many / short | `words`, `initiative_words` | `builder-journey` (renamed on WORDS), `player-journey` (WOUNDS, "THE KEEPER GAVE YOU") | **AT THE TABLE** |
| Parts switched off | bank, shops, vehicles, cyberware, initiative, combat, token health, death, luck, XP, NPC tiers, sheet import, GIVE ITEM | `parts`, `parts_*` | `builder-journey` (VEHICLES off, in the builder) | **GAP**: never checked hidden at the table |
| GIVE ITEM and shop catalogues | a catalogue typed in, an item given with a note | `shops_give`, `shop_catalogue_*` | `player-journey` | **AT THE TABLE** |
| Building types and catalogues renamed or off | | `buildings` | | **GAP** |
| Currencies | several, decimals, a catalogue's currency, the cart per currency, PAYROLL | `currencies`, `currency_icons`, `catalogue_currency`, `bank_currencies`, `shop_checkout_currencies` | | **GAP** |
| The bank's celebrations | on / off | `bank` | | **GAP** |

## Setup

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Health model | pool, two tracks, typed, harm levels, wounds, hit locations, none | `health`, `health_view`, `parts_health`, `try_health` | `player-journey` and `sheet-rolls` run a pool, never hurt or healed | **GAP**: no model damaged, healed or shown at the table |
| Advancement | XP levels, milestone, spend XP, improve by use | `core` | | **GAP**, comes alive with 7d |
| Dice the game uses, distance unit | | `core` | | **GAP** |

## Stats and rules

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Stats and formulas | a formula from a stat, worked out on the sheet and saved by the server | `stats`, `engine`, `preview_values` | `builder-journey`, `player-journey` (Toughness = 10 + Grit) | **AT THE TABLE** |
| Formula conditions (IF / THEN / ELSE) | | `engine` | `builder-graph` | **BUILDER ONLY** |
| Lookup tables | | `engine` | `builder-graph` | **BUILDER ONLY** |
| The map (GRAPH) | wires, diamonds, + ADD, notes, groups, UNDO, PROBLEMS, hover, TRY ON THE MAP | `graph` | `builder-graph`, `builder-rolls` | **BUILDER ONLY** (it is a builder tool) |

## Dice and rolls

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| A system's own dice | faces with numbers and symbols, cancel, counts as, looks (mark, icon, upload, drawn) | `dice`, `system_dice` | `builder-dice`, `sheet-rolls` (the dice menu), `dice-tray` (drawn and marked, the danger color) | **AT THE TABLE** |
| Roll read as a sum, with bands | | `roll_styles`, `table_rolls` | `sheet-rolls` (Trait check: MISS / COST / HIT) | **AT THE TABLE** |
| Keep highest or lowest (ADVANTAGE) | | `roll_styles` | `sheet-rolls` | **AT THE TABLE** |
| A change that costs | ADDS | `roll_styles`, `table_rolls` | `sheet-rolls` (PUSH adds 2 Stress, refused past the highest) | **AT THE TABLE** |
| A change that costs | TAKES | `roll_styles`, `table_rolls` | | **GAP** |
| Rolled by a stats group | | `rolls_section` | `sheet-rolls` | **AT THE TABLE** |
| Against a target, who sees it | VERDICT ONLY over the system's GM ONLY | `target_seen` | `builder-journey` | **AT THE TABLE** |
| Against a target, who sees it | SHOWN; GM ONLY | `target_seen` | | **GAP** |
| Roll under | | `roll_styles` | | **GAP** |
| Count successes, symbols in a roll | | `roll_styles`, `dice` | `builder-rolls` (made, not rolled at the table) | **BUILDER ONLY** |
| Exploding dice, naturals | | `roll_styles` | `builder-rolls` (TEST ROLL) | **BUILDER ONLY** |
| Matches, named dice's effects, zero dice | | `roll_styles` | `builder-clicks` (made from the Blades and Vampire presets) | **BUILDER ONLY** |
| Cancelling, glitch | | `roll_styles` | | **GAP** |
| A condition on every roll | | `table_rolls`, `table_conditions` | `builder-rolls` (TEST ROLL under HURT) | **BUILDER ONLY** |

## Choices (Phase 7)

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Lists and options | one / several / any, MORE THAN ONCE, LEVELLED, a requirement | `choices` | `builder-choices`, `sheet-choices` | **AT THE TABLE** |
| Features | at a level; modifiers, uses and their rest, rolls, roll changes, a list opened | `choices`, `choices_numbers` | `builder-choices` | **BUILDER ONLY**, at the table in 7a3 |
| What picks do to the numbers | a modifier reaching a formula, levels unlocking features | `choices_numbers` | `sheet-choices` (Defense +1 from Guard Stance; Veteran at level 2) | **AT THE TABLE** |
| Picking at the table | a player picks, one not met off with what it needs; sets a level; ticks a use | `picking` | `sheet-choices` | **AT THE TABLE** |
| Picking at the table, the GM | drops a pick, asked first; picks past a requirement | `picking` | `sheet-choices` (on the GM's own sheet; the window onto a player's sheet is unit-tested, as picking a token in the 3D map has no browser helper yet) | **AT THE TABLE** |
| A bonus named on the field it changes | a stat as typed and with it; a formula with it | `choices_numbers` | `sheet-choices` (10 → 11, Guard Stance +1) | **AT THE TABLE** |
| A rest refilling a feature's uses | the rest itself; one it counts as | `picking` | `sheet-choices` (a short rest) | **AT THE TABLE** (the rest itself) |
| A list filled from a file | IMPORT: new and changed options and features, empty cells and `-`, skipped lines, same-named features | `choices_import` | | **GAP** until import 2, which brings the IMPORT panel and its journey (download, change, import, seen on a sheet) |

## Sheets and NPCs

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| The starter sheet | stats, formulas, the health section | `sheet_form`, `preview_sheet` | `player-journey`, `sheet-rolls` | **AT THE TABLE** |
| A customized sheet | its own tabs, sections and fields, drawn at the table | `sheet_form` | `sheet-visibility` | **AT THE TABLE** |
| Who sees and changes a field | public / private / combat; player / GM | `runtime`, `npc_privacy` | `sheet-visibility` (the owner, another player looking them up from the chat, the GM) | **AT THE TABLE**. Two guards stand behind the screen, each proven on the server: combat values are dropped from the public card even if counted public, and the server refuses an owner's write to a GM's field even past the screen's lock (`system_builder_npc_privacy`) |
| A section under a house rule | | `house_rules` | | **GAP** |
| NPC stat block | | `npc_sheets`, `npc_privacy` | | **GAP** |
| NPC tiers | GENERATE_SHEET at a level: numbers, formulas, dice | `tier_rolls`, `parts_tiers`, `npc_tiers` | | **GAP** |
| Sheet import (PDF) for a custom system | | `sheet_import`, `sheet_import_routes` | | **GAP** |

## Conditions, rests and house rules

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Conditions | standard renamed or off, the system's own, icons (uploaded icons via `builder-share`) | `conditions`, `table_conditions`, `token_conditions` | | **GAP**: never put on a token at the table |
| A condition's modifier | on a stat, a formula, every roll | `conditions`, `table_rolls` | | **GAP** |
| A condition's end | when removed, after rounds, at a rest | `condition_rounds`, `resting` | | **GAP** |
| Rests | a refill up to a value | `rests`, `resting`, `call_rest` | `player-journey` (LONG REST: Resolve up to Grit) | **AT THE TABLE** |
| Rests | by an amount, to the max, full health, a section; counts as another; a standard rest off; the system's own | `rests`, `resting`, `try_rest` | | **GAP** |
| House rules | starts on / off, switched at the table | `house_rules`, `house_rules_routes` | `builder-graph` (TRY ON THE MAP only) | **GAP** |
| Under a house rule | a part, a sheet section, a condition, a formula's alternative | `house_rules`, `house_rules_routes` | | **GAP** |

## Sharing and running a system

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Publish, and publish again through the version preview | | `store`, `publish_preview`, `version_diff` | `builder-journey` | **AT THE TABLE** |
| Switch the game to a system | | `runtime` | `builder-journey` | **AT THE TABLE** |
| Export and install | .citysys, .zip with images, INSTALL A FILE | `citysys`, `citysys_zip`, `hostile_files` | `builder-share`, `builder-clicks` | **AT THE TABLE** |
| Close and delete a system | | `store` | `builder-systems` | **AT THE TABLE** |
| The tour and HELP | | `tour` | `builder-smoke`, `builder-clicks` (WHO SEES THE TARGET) | **AT THE TABLE** |

## The dice tray

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| ANIMATION | on / off, kept on the account | (account settings) | `dice-tray` | **AT THE TABLE** |
| The bell | someone else's roll flashes a shut tray; off | | `dice-tray` | **AT THE TABLE** |
| The theme | every theme's colors | | `dice-tray` (Oceanic), `builder-graph` | **AT THE TABLE** |
| Rolls a moment apart land as one throw | | `dice_throw` | `dice-tray` | **AT THE TABLE** |

## Gaps, in order

Fitted into Phase 7, one family between each of its pieces, riskiest first:

1. ~~**Sheet visibility**~~: done, `sheet-visibility.spec.ts`. It also gave the journeys a way to reach another player's token without the 3D map: GLOBAL_CHAT, their name, VIEW_PLAYER_INFO.
2. **Health models**: each model damaged, healed and shown at the table, and what other players see.
3. **Parts switched off**: each part hidden at the table while off, and back when on.
4. **House rules at the table**: switched in the GAME tab, and what waits on them shown and hidden.
5. **Conditions on tokens**: put on, a modifier reaching a stat, a formula and every roll, ending after rounds and at a rest.
6. **Rest variants**: every kind of refill, a rest counting as another, one switched off, the system's own.
7. **Roll options at the table**: SHOWN and GM ONLY, roll under, count successes, symbols, glitch, effects, zero dice, a cost that TAKES.
8. **NPC tiers and the stat block**: GENERATE_SHEET at a level, and the NPC sheet the GM sees.
9. **Currencies**: several, a catalogue's own, the cart and PAYROLL.
10. **Sheet import (PDF)** for a custom system.

Also outside these lists: the built-in games (Cities Without Number, Cyberpunk RED, Shadowrun 6E)
have server tests but no browser tests. They are not builder options, so they are not counted
here, but they are worth a journey each before 2.0.
