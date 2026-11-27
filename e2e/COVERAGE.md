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
| Parts switched off | bank, shops, initiative, combat, token health, sheet import, GIVE ITEM | `parts`, `parts_*` | `parts-off` (each shown, hidden in a version with it off, back when on: the player's BANK and HIT_POINTS, MAX HEALTH, ARMOR and SAVE_STATS, IMPORT on the sheet; the GM's INITIATIVE_TRACKER, PAY_PLAYERS, GIVE_ITEM, the buy-back rate), `builder-journey` (VEHICLES off, in the builder) | **AT THE TABLE** |
| Parts only built-in games have | vehicles, cyberware, death saves, luck, XP awards | `parts` | | Nothing to hide at a custom table: shown off and greyed in PARTS |
| NPC tiers off | | `parts_tiers` | | **GAP**, with family 8 (NPC tiers): the tier picker is on an NPC token in the 3D map |
| GIVE ITEM and shop catalogues | a catalogue typed in, an item given with a note | `shops_give`, `shop_catalogue_*` | `player-journey`, `shop-cart-items` (a catalogue saved while a player is online, bought by them through the cart, 8n1), `shop-cart` (CWN's book: bought and sold back, 8n1), `give-item` (a ring and two ropes given, on the sheet as bought ones are, in GIVEN, 8n2) | **AT THE TABLE** |
| Shop catalogues by item type | a section per item type (8a7a1), its columns checked, blanks kept | `shop_catalogue_types`, `catalogueTypes` | `catalogue-types`, `shop-typed-lines` (bought at the General Store and given, landing typed, 8a7a2) | **AT THE TABLE** |
| The shops under load | 1000+ lines on a shelf, 200 items, a full cart, a long gear list (8n3); a long shelf drawn 200 rows at a time | `shop_stress`, `ShopWindow` | `shop-stress` | **AT THE TABLE** |
| An item type's SOLD AT | the kinds of shop that sell its lines (8a7a2), the General Store where unsaid; ticked in the builder (8a7b2), each preset at its shop | `shop_typed_lines`, `typedShelves`, `gameShops`, `ItemsPage` | `shop-typed-lines` (unsaid: the General Store), `builder-sold-at` (ticked by clicks: a Pistol bought at a Gun Shop) | **AT THE TABLE** |
| The game's own shops, and what a shop BUYS | an Apothecary or a Fence of the game's own (8a7b1a), on or off; a shop's BUYS, WHAT IT SELLS or ANYTHING, every priced thing at the building's BUYBACK rate (8a7b1b) | `system_builder_own_shops`, `gameShops`, `system_builder_shop_buys`, `shopBuys`, `ownShopsTable`, `own_shops_per_game`, `own_shops_features`, `FeaturesPage`, `AdminPanel`, `ShopWindow` | `builder-sold-at` (an Apothecary made by + NEW SHOP, saved), `builder-own-shops` (on FEATURES: a Fence made to buy ANYTHING, the General Store too, a shop renamed and deleted, its building let go on publishing), `shop-own-kinds` (an Apothecary picked in BUILDING TYPE selling its draught; a Fence on ANYTHING opening on SELL and taking it back; per game, no SHOP in another game until picked there) | **AT THE TABLE** |
| An item type's ON THE SHEET band | EQUIPPED, USABLE or PACK (G1), PACK where unsaid; the sheet's GEAR tab in those bands plus STASH, closed to start, a band's head closing it, remembered (G2); a thing worn, attuned or installed in EQUIPPED whatever its type, a closed band something lands in lit until opened (G3) | `system_builder_item_types`, `itemTypes`, `ItemsPage`, `gearBands`, `GearTypeTables` | `builder-item-types` (the WEAPON preset EQUIPPED), `sheet-gear-bands` (a Sword, a Draught and a Rope in EQUIPPED, USABLE and PACK; the Sword stashed into STASH; USABLE kept closed; a Cloak of GEAR worn into a closed EQUIPPED, its head lit, taken off back into PACK) | **AT THE TABLE** |
| PLAYERS CHANGE GEAR | the GAME tab's switch, on to start, offered where a system makes its own item types (G6a, G6b): off, a player's gear columns are the GM's | `players_change_gear` setting, `switches.gear`, `uniqueLines.keepColumns`, `GearTypeTables` | `sheet-players-change-gear` (off: DAMAGE read only and said; the GM changes it, UNIQUE by the GM; on: the player changes it) | **AT THE TABLE** |
| An item's PRICE and IN SHOPS | priced and IN SHOPS, it sells itself at its type's shops (8a7a3a); off, never sold, not even from a file, but bought back at its price by a shop of its type (8a7a3c2); a type's PRICE column read as its price; set on ITEMS under TYPE, NOT SOLD in the list, a new item's price asked for (8a7a3b1); in the ITEMS import and downloads, price and in shops columns (8a7a3b2) | `shop_items_on_sale`, `itemPrice`, `ItemsPage`, `system_builder_items_import`, `itemsImport` | `shop-items-on-sale` (a type's PRICE column; a ring turned off; sold back from the window at 50%), `builder-item-price` (set by clicks), `builder-items-import` (imported priced and IN SHOPS) | **AT THE TABLE** |
| A catalogue file held against the game's items | an exact copy of an item left out, an item kept out of the shops left out, one of an item's name overruling it, ALSO ON SALE FROM ITEMS (8a7a3c1) | `shop_items_on_sale`, `CatalogueWindow` | `catalogue-and-items` | **AT THE TABLE** |
| ADD NEW LINES TO ITEMS | a catalogue's new lines made items in the draft (8a7a4a), off to start; on PUBLISH the lines now exactly an item leave the file (8a7a4b) | `catalogue_into_items`, `CatalogueWindow`, `catalogueItems`, `BuilderScreen` | `catalogue-and-items` (the Hand Cannon into the draft, then out of the file once published) | **AT THE TABLE** |
| EDIT CURRENT | what the shops sell now in the catalogue box to change, asked first over text there (8a7a5) | `CatalogueWindow` | `catalogue-and-items` | **AT THE TABLE** |
| Building types and catalogues renamed or off | | `buildings` | | **GAP** |
| Currencies | several, decimals, a catalogue's currency, the cart per currency, PAYROLL | `currencies`, `currency_icons`, `catalogue_currency`, `bank_currencies`, `shop_checkout_currencies` | | **GAP** |
| The bank's celebrations | on / off | `bank` | | **GAP** |

## Setup

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Health model | pool, two tracks, typed, harm levels, wounds, hit locations, none | `health`, `health_view`, `parts_health`, `try_health` | `health-models` (each one hurt and healed by its owner from HIT_POINTS, the GM setting a second track's maximum, another player watching from the chat; what that player is sent checked for numbers and notes; a model needing a sheet refused without one) | **AT THE TABLE** |
| Advancement | XP levels, milestone, spend XP, improve by use | `core` | | **GAP**, comes alive with 7d |
| Dice the game uses, distance unit | | `core` | | **GAP** |

## Stats and rules

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Stats and formulas | a formula from a stat, worked out on the sheet and saved by the server | `stats`, `engine`, `preview_values` | `builder-journey`, `player-journey` (Toughness = 10 + Grit) | **AT THE TABLE** |
| Formula conditions (IF / THEN / ELSE) | | `engine` | `builder-graph` | **BUILDER ONLY** |
| Lookup tables | | `engine` | `builder-graph` | **BUILDER ONLY** |
| The map (GRAPH) | wires, diamonds, + ADD, notes, groups, UNDO, PROBLEMS, hover, TRY ON THE MAP; a list's levels and a feature's bonus, read-only, GO TO CHOICES | `graph` | `builder-graph`, `builder-rolls`, `builder-graph-choices` | **BUILDER ONLY** (it is a builder tool) |

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
| Lists inside lists | a list picked ON ITS OWN, THROUGH FEATURES or BOTH; a feature's HOW MANY; a pick waiting when its feature locks; nested deeper | `nested_choices`, `picking` | `sheet-nested-choices` (THROUGH FEATURES set in the builder; picked under the feature, waiting when lowered, back) | **AT THE TABLE** (BOTH, HOW MANY above 1 and deeper nesting in component and server tests) |
| A list following its opener's level | a list without levels, picked through features from a levelled list (or one everyone has, or deeper), its features unlocking by the opener's level; opened by a feat, everything at once | `nested_choices` | `sheet-subclass-levels` (AT LEVEL set in the builder; Champion at Fighter 3, Remarkable Athlete at 7) | **AT THE TABLE** (deeper lists, an everyone's opener and a feat's in server tests) |
| A list everyone has | EVERYONE HAS IT: no picks, a requirement deciding, features by the character's level | `nested_choices` | `sheet-nested-choices` (set in the builder; every character's, a feature unlocking at level 2) | **AT THE TABLE** |
| has() | has(name) in a formula and a requirement, by an option or a feature | `has`, `choices_import` | `sheet-has` (MAGE off, needing SECOND WIND, until SOLDIER; GUARD 10, then 12) | **AT THE TABLE** |
| New character | GUIDED NEW CHARACTER on or off; the steps ordered and switched | `creation` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c2) for the switch and WHO THEY ARE, THE STATS and the lists; KITS (7c4b), MONEY (7c4d) |
| New character | The stats ONE WAY FOR ALL or GROUP BY GROUP; a group left out | `creation.statsBy`, `creation.off` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c3a) |
| New character | HOW THEY ARE SET: TYPED IN, A FIXED ARRAY and its numbers | `creation.ways` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c3b) |
| New character | HOW THEY ARE SET: ROLL, EACH IS, PLACED IN ORDER or ARRANGE | `creation.ways` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c3c) |
| New character | HOW THEY ARE SET: POINT BUY, its POINTS, FROM / TO and COSTS | `creation.ways` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c3d) |
| New character | KITS: name, items, EVERYONE GETS IT, A PLAYER MAY PICK IT, ONLY IF, THE GM GIVES IT | `creation.kits` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c4b, 7c4c) |
| New character | MONEY: NOTHING, A NUMBER, A ROLL, TYPED IN, per currency | `creation.money` | `builder-new-character`, `sheet-new-character` | Proven at the table (7c4d) for A ROLL; A NUMBER and TYPED IN **BACKEND AND COMPONENT TESTS** only |
| New character, the GM's side | The line on a player's sheet; SKIP IT; START OVER, taking back what FINISH gave | `_creating` | `sheet-new-character-gm` | Proven at the table (7c5a) |
| Levels | HOW THEY ADVANCE, HIGHEST LEVEL, LEVEL 2 COSTS, ranges and their multipliers, a level typed over | `core.advancement`, `levels` | `builder-levels`, `sheet-xp` | Proven at the table (7d2a) for XP LEVELS, the table and the word; going up on it, and MILESTONE, in `sheet-level-up` (7d2b) |
| Levels | XP on the form and in an upload (7d2c) | sheet import | `sheet-level-up` | Proven at the table |
| Levels | MAX HEALTH: A FORMULA (7d4) | `levels` | `builder-levels`, `sheet-health-formula` | Proven at the table |
| Levels | MAX HEALTH: PER LEVEL, ON EACH CLASS, AVERAGE (FIXED), EACH LEVEL ADDS (7d5a) | `levels` | `builder-levels`, `sheet-health-levels` | Proven at the table |
| Levels | MAX HEALTH: PER LEVEL, ONE FOR ALL (7d5a) | `levels` | `builder-levels` | **BUILDER AND SERVER TESTS**: the table's journey uses each class's die |
| Levels | MAX HEALTH: PER LEVEL, GAINED BY ROLL, and CLEAR THE ROLL (7d5b) | `levels` | `sheet-health-levels`, `sheet-level-record` | Proven at the table; a past level's roll cleared, rolled again and set in the record (7d7b2) |
| Levels | MAX HEALTH: PER LEVEL, GAINED BY THE PLAYER CHOOSES (7d5b) | `levels` | none yet | **COMPONENT AND SERVER TESTS**: TAKE and ROLL INSTEAD in the window |
| Levels | MAX HEALTH: PER LEVEL, GAINED BY REROLL ALL, KEEP HIGHER (7d5c) | `levels` | `sheet-health-levels` | Proven at the table |
| Levels | MAX HEALTH: PER LEVEL, GAINED BY ROLL TO BEAT, A POOL, its dice and the die gained (7d5d) | `levels` | `builder-levels`, `sheet-health-levels` | Proven at the table |
| Levels | MAX HEALTH: PER LEVEL, GAINED BY ROLL TO BEAT, A DIE PER LEVEL (7d5d) | `levels` | `builder-levels`, `sheet-health-levels` | Proven at the table |
| Levels | The XP part switched off | `parts`, `levels` | none yet | **BACKEND AND COMPONENT TESTS** only |
| Levels | SPEND XP: RAISE A STAT IN a group, COSTS, UP TO; AN OPTION FROM a list, COSTS (7f2a1, the builder 7f2b) | `spend.buys` | `builder-spend-xp`, `sheet-spend-xp` | Proven at the table (7f2c1): a stat raised at its cost, an option bought |
| Levels | SPEND XP: PURCHASES WAIT FOR THE GM (7f2a1), with APPROVE and DECLINE (7f2a2) | `spend.wait` | `builder-spend-xp`, `sheet-spend-xp` | Proven at the table (7f2c1): PENDING with its XP held, APPROVE, DECLINE, and UNDO |
| Levels | SPEND XP alone, no levels: XP given by AWARD XP, SET TO and an upload (7f2a1, the window 7f2c2) | `core.advancement` | `sheet-spend-xp` | Proven at the table (7f2c2): AWARD XP, with no level buttons |
| Levels | IMPROVE BY USE: STATS THAT IMPROVE, MARKED BY, AT, ROLL, IMPROVES IF OVER, THEN ADD, UP TO (7f3a1) | `improve` | `builder-improve-by-use`, `sheet-improve-by-use` | Proven at the table (7f3b): MARKED BY a successful roll, a mark by hand, AT END OF SESSION, the roll over its target and the gain; ANY ROLL OF IT, BY HAND ONLY and UP TO by **SERVER TESTS** |
| New character, uploads | A line per list on the form and template, read by name: one not met, one not found, one replacing a lock, one under a feature, one not named cleared, the inventory added to | `sheet_import`, `sheet_form` | `sheet-import-picks` | Proven at the table (7c6) through a pasted file; the PDF's round trip **BACKEND TESTS** only |
| New character, the GM's side | FILL IT IN FOR THEM, every limit off; CLEAR THE ROLL | `_creating` | `sheet-new-character-gm` | Proven at the table (7c5b) for stats; CLEAR THE ROLL on money and an option's money **BACKEND AND COMPONENT TESTS** only |
| Choices | What an option gives: GIVES, money per currency as A NUMBER or A ROLL | `choices[].options[].gives` | `builder-choices`, `sheet-new-character` | Proven at the table (7c4e2): items, A NUMBER and A ROLL, with KITS and MONEY off, nested picks included |
| Choices | A feature's INCREASE: POINTS, AT MOST ON ONE, FROM, STOPS AT (7d6a) | `choices[].options[].features[].increase` | `builder-choices`, `sheet-increases` | Proven at the table (7d6b2): points and STOPS AT; AT MOST ON ONE and FROM by component and server tests |
| Choices | A feature's INCREASE: OR INSTEAD, a list picked through features (7d6c) | `choices[].options[].features[].increase.instead` | `builder-choices`, `sheet-increases` | Proven at the table (7d6c2) |
| Choices | A modifier's AT LEAST (7e1) | `choices[].options[].features[].modifiers[].how` | `builder-choices`, `sheet-bonus-ways` | Proven at the table (7e1b): doing nothing when higher, lifting past ADDs; on a formula by server tests |
| Choices | A modifier's STOPS AT (7e1) | `choices[].options[].features[].modifiers[].cap` | `builder-choices`, `sheet-bonus-ways` | Proven at the table (7e1b): two +2s stopping at 20, the cut one named; on a formula by server tests |
| Items | SLOTS: a name, how many each character has (7e2) | `items.slots` | `builder-items`, `sheet-worn-items` | Proven at the table (7e3b): the counter, full with nothing to attune, the GM's ATTUNE ANYWAY and one character's own count |
| Items | ITEMS: a name, words, ITS FEATURES NEED (carried, worn, a slot), features without a level, list or increase (7e2) | `items.list` | `builder-items`, `sheet-worn-items` | Proven at the table (7e3b): NEEDS a slot, worn then attuned, a bonus counting only then, END, taken off still attuned; CARRIED and WORN, has() and uses by server tests (7e3a); given from GIVE.EXE's ITEMS and worn; sold from a catalogue started by DOWNLOAD ITEMS, the preview naming it (`shop-items-catalogue`) |
| Items | INSTALLS: a name, what each costs against, ADDS TO or TAKES FROM, the limit (7e4) | `items.installs` | `builder-items`, `sheet-installed-items` | Proven at the table (7e4c): ADDS TO with a formula limit, counted, a player refused past it, the GM's anyway; TAKES FROM by server and unit tests |
| Items | An item's INSTALLED AS and COST (7e4) | `items.list[].needs`, `items.list[].cost` | `builder-items`, `sheet-installed-items` | Proven at the table (7e4c): installed, its cost on Strain named by it, its line locked, removed; fractions by server and unit tests |
| Items | ITEM TYPES: a name, one of them, columns of NUMBER (a unit), TEXT, DAMAGE, DICE, COUNT (a button, a rest, items it reloads from) and PICK ONE (its words), from a preset or blank (8a1, 8a2) | `items.types` | `builder-item-types`, `builder-clicks`, `sheet-item-types`, `sheet-gear-counts`, `shop-quick-filters` | Made in the builder (8a2): WEAPONS from its preset, a COUNT's rest and reload, a PICK ONE's words. At the table (8a3a): a table per type on GEAR with its columns; DAMAGE rolled (8a3b): a stick's 1d4 in the dice tray's history; a COUNT at the table (8a4b): its button (FIRE) spending one, RELOAD from items it names (asked which of two carried, taken from the quantity, a line used up gone) and a rest it names refilling it A PICK ONE's words are its type's quick filters on a shop's shelf (8a7c3, `shop-quick-filters`): HEAVY pressed, the Rifle alone, bought with its grade. In GIVE.EXE too (8a7d, `shop-quick-filters`): HEAVY pressed, the Rifle given. |
| Items | The DEFAULT type: MAKE DEFAULT moves one to the top (8aL1) | `items.types` order | `builder-clicks` | Builder only so far (8aL1): the items that said nothing keep their type, held by tests; at the table, a line that is no item lands in the first type (8a3a) |
| Items | An item's TYPE and its VALUES, one per column (8a1, 8a2) | `items.list[].type`, `items.list[].values` | `builder-item-types`, `sheet-item-types` | Filled in the builder (8a2): a Pistol of WEAPONS with DAMAGE, RANGE, AMMO, WEIGHT and GRADE. At the table (8a3a): a line named like it shows them faint, its own typed over. A line with nothing filled in, on it or its item (G3): FILL IN, opening the card at its first box (`sheet-gear-bands`, the Draught's HEALS); a blank beside others filled doesn't apply and says nothing. A line changed from its item (G5a, G5b): UNIQUE on it with who changed it when, THE ITEM'S putting a column back (`sheet-item-types`, the Pistol's RANGE and DAMAGE) |
| Items | Uploading items: IMPORT, DOWNLOAD EXAMPLE (made from the system), DOWNLOAD THIS LIST (8aL3) | the draft's `items` | `builder-items-import` | Proven in the builder (8aL3b): the example downloaded, edited, imported with a mistake skipped by its line, saved; the list back unchanged held by tests |
| Items | A line of gear made by hand: its TYPE and its own VALUES (8a3a) | the sheet's `inventory[].type`, `inventory[].values` | `sheet-item-types` | Proven at the table (8a3a): + WEAPON made A stick with its own DAMAGE and GRADE, kept in its table after a reload |
| Items | ENCUMBRANCE: COUNTED BY a column, its unit, CAN CARRY, bands at a share of it and the word past them; an install's WEIGHS WHILE INSTALLED (8a5a, 8a5c) | `items.encumbrance`, `items.installs[].weighs` | `builder-encumbrance`, `builder-clicks`, `sheet-carrying` | Made in the builder (8a5c): counted by WEIGHT, CAN CARRY, bands renamed, moved and added, the word past them, an install that still weighs, saved and kept. Server tests (8a5a): @carried and @capacity on every save. At the table (8a6a): Might 5 carrying three 10 LB Packs reads CARRYING 30 / 50 LB, ENCUMBERED, its meter and LIGHT ≤ 25 · ENCUMBERED ≤ 50 · OVERLOADED; one stashed, 20 LB and LIGHT |
| Items | A band's WHAT IT MEANS and its CONDITION, and past them; the table's BAND CONDITIONS switch (8a5d1) | `items.encumbrance.bands[].says`, `.condition`, `past_says`, `past_condition`; setting `band_conditions` | `builder-encumbrance`, `sheet-carrying` | Made in the builder (8a5d2): ENCUMBERED's words and EXHAUSTED, past them their words, saved and kept. Server tests (8a5d1, `band_conditions`): on the token and off with the band, the GM's left alone, switched off, no token. The builder's boxes are 8a5d2's. At the table (8a6a): ENCUMBERED's Speed -10 ft. under the meter and SLOWED ON WHILE ENCUMBERED, both gone once LIGHT. **AT THE TABLE** (8a6b, `sheet-carrying`): BAND CONDITIONS off takes SLOWED off the token at once, on puts it back |
| Items | The GAME tab's SHOW ENCUMBRANCE, offered where a system counts encumbrance (8a6b) | setting `show_encumbrance` | `sheet-carrying`, `tableSwitchesGameTab` | **AT THE TABLE** (8a6b): off hides CARRYING on the player's GEAR, the gear still there; on brings it back. In the GAME tab (component test): offered only where the system counts encumbrance, on to start, APPLY writing it |
| Conditions | A modifier's way (ADD, TIMES, SET TO, AT MOST) and a formula amount; ITS MODIFIERS APPLIED; the table's APPLY CONDITION MODIFIERS (8a5e1) | `conditions.<id>.modifiers[].way`, `.amount` (formula), `conditions.<id>.applied`; setting `apply_condition_modifiers` | `builder-condition-modifiers`, `builder-clicks`, `sheet-condition-modifiers` | **AT THE TABLE** (8a5e3): SLOWED put on from the HP box halving Speed with SLOWED: Speed ×0.5 under it, gone when it comes off. Made in the builder (8a5e2): SLOWED APPLIED, TIMES 0.5 and a formula, saved and kept. Server tests (8a5e1, `condition_modifiers`): SLOWED halving Speed after a ring's +5, none stacking, worked out when the token's conditions change. The builder's row is 8a5e2's, the sheet's line 8a5e3's. The GAME tab's APPLY CONDITION MODIFIERS at the table (8a6b): off, Speed as typed and the note gone; on, halved again |
| Conditions | EACH TURN: WHEN, DOES (DAMAGE, HEAL, ROLL TO END, JUST ROLL), ROLL, ENDS ON, CHANGES HP, ROLLED BY; ENDS AT THE END OF ITS NEXT TURN (8a9a) | `conditions.<id>.each_turn[]`, `conditions.<id>.ends: next_turn` | `builder-condition-each-turn`, `builder-clicks`, `initiative-turn-effects` | Server tests (8a9a, `condition_turn_effects`): checked, read whole, fired by the real tracker on NEXT and BEGIN, HP changed or left to the GM, a save taking it off, the ending, the log lines, the system file out and back. ROLLED BY THE PLAYER (the GM for an NPC), server tests (8a9a2): asked, kept till rolled, who may roll, once, let go. At the table (8a9c): BEGIN ROUND 1, a DAMAGE on its own, an NPC's ROLL TO END rolled by the GM from its row; a player's, WAITING ON at the GM's tracker and rolled from under their HP box (8a9c2). Made in the builder (8a9b): BURNING's damage each turn, POISONED's save rolled by the player, STUNNED ending next turn, saved and kept |
| Conditions | The GAME tab's CONDITION TURN EFFECTS (8a9a) | setting `condition_turn_effects` | `initiative-turn-effects` | Server tests (8a9a): off, no rolls on turns, the endings going on. Its box on the GAME tab (8a9c, `tableSwitchesGameTab`): offered only where a condition has an EACH TURN, on to start, written when switched off. At the table: off, a whole round with nothing burned or asked |
| Items | What is worn, summed by column: each NUMBER column of a type read as @type_column (@armor_defense) (8a5b) | `items.types[].columns` (NUMBER) | (8a6) | Server tests only (8a5b, `worn_sums`): the worn items' values together on every save and in rolls. A journey with AC reading @armor_defense comes with 8a6 |
| Stats | RANKS: shared lists of named ranks, each worth a number or a formula (7f1) | `ranks` | `builder-ranks`, `sheet-ranks` | Proven at the table (7f1c1): picked by name, its formula worth shown and read by a formula |
| Stats | A stat HOLDS A RANK, and its highest at the start (7f1) | `stats[].stats[].rank`, `stats[].stats[].atStart` | `builder-ranks`, `sheet-ranks`, `sheet-ranks-start` | Proven at the table: HOLDS (7f1c1); AT START at NEW CHARACTER, the ranks past it off for a player (7f1c2) |
| A table to roll on | its dice; each option's roll or range; PLAYERS PICK BY HAND, BY HAND OR ROLL or BY ROLL ONLY | `choices`, `choices_import`, `roll_for_it` | `builder-roll-table` (d6, rolls checked, BY ROLL ONLY, kept); `sheet-roll-for-it` (BY ROLL ONLY: picking by hand off, ROLL FOR IT thrown in the tray, locked in, no second roll) | **AT THE TABLE** |
| A table to roll on | A roll locked in; the GM's CLEAR THE ROLL, ROLL AGAIN, or a pick by hand | `roll_for_it` | `sheet-roll-for-it` | Proven at the table (7c5b) |
| A feature on the token's maximum | a modifier on HP MAX or WOUNDS moving the token's real maximum and current | `token_max` | `sheet-token-max` (TOUGH picked at level 3: 20 to 26; a level down, 24; dropped by the GM, 20) | **AT THE TABLE** (a wound count's WOUNDS found as the maximum, a stat it reads, an import, a new token and a published version in server tests) |
| Features | at a level; modifiers, uses and their rest, rolls, roll changes, a list opened | `choices`, `choices_numbers` | `builder-choices` | **BUILDER ONLY**, at the table in 7a3 |
| What picks do to the numbers | a modifier reaching a formula, levels unlocking features | `choices_numbers` | `sheet-choices` (Defense +1 from Guard Stance; Veteran at level 2) | **AT THE TABLE** |
| Picking at the table | a player picks, one not met off with what it needs; sets a level; ticks a use | `picking` | `sheet-choices` | **AT THE TABLE** |
| Picking at the table, the GM | drops a pick, asked first; picks past a requirement | `picking` | `sheet-choices` (on the GM's own sheet; the window onto a player's sheet is unit-tested, as picking a token in the 3D map has no browser helper yet) | **AT THE TABLE** |
| A bonus named on the field it changes | a stat as typed and with it; a formula with it | `choices_numbers` | `sheet-choices` (10 → 11, Guard Stance +1) | **AT THE TABLE** |
| A rest refilling a feature's uses | the rest itself; one it counts as | `picking` | `sheet-choices` (a short rest) | **AT THE TABLE** (the rest itself) |
| A list filled from a file | IMPORT: new and changed options and features, empty cells and `-`, skipped lines, same-named features | `choices_import` | `builder-choices-import` (this list downloaded, changed with one wrong line, uploaded, warned of, applied; played on a sheet) | **AT THE TABLE** |
| Writing a formula | the formula box on REQUIRES, modifier amounts and USES, a roll's ADD and AGAINST, a rest's amounts, and STATS & RULES' formulas (words and fixes beside their own INSERT and VALUE): words and the sample's value, a mistake with its fix, SHAPE, INSERT | `formula_preview` | `builder-formula-box` | **BUILDER ONLY** (a builder aid: what it writes is played at the table by `sheet-choices`, `sheet-token-max`, `sheet-rolls` and the rests' own journeys) |

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
| Conditions | standard renamed or off, the system's own, icons (uploaded icons via `builder-share`), a drawing on the pad (8b1b, `condition-drawn`) | `conditions`, `table_conditions`, `token_conditions` | | **GAP**: never put on a token at the table A drawn one is seen on a player's sheet chip (`condition-drawn`, put on through the API). |
| Resistances | a RESISTANCE row on a feature (picked, worn, installed) and a condition: RESIST, IMMUNE or VULNERABLE to a type or ALL (8b3a) | `resistances` | `builder-resistances`, `health-resistances` | **BUILDER ONLY**: set by clicks on CHOICES, ITEMS and CONDITIONS (8b3b); those added by hand (the GM's, and a player's on their own) kept on the sheet, server only until the HEALTH rows (8b3c2); nothing at the table reads them until the HEALTH row (8b4) and a hit reaching its target (8b5) | AT THE TABLE (8b3c2b, `health-resistances`): shown on HEALTH and the sheet's drawer, added by hand by a player and the GM; worked into a hit from 8b5. REVEAL (8b4a, 8b4b): one chip and REVEAL ALL, proven at the table in `health-reveal`.
| MAX set by hand | MAX clicked on the strip, in a game whose MAX HEALTH is a formula or per level kept as an ADJUST (8s4a) | `_max_adjust` | `sheet-max-set` | At the table: set on SHEET.EXE and the tab, healed up to it, hurt, kept through the sheet worked out again |
| Damage types | starter ones renamed or off, the system's own, a drawn icon, an upload or a pad drawing, what RESIST, IMMUNE and VULNERABLE mean (8b1) | `damage_types` | `builder-damage-types`, `builder-clicks`, `sheet-typed-damage`, `builder-damage-rows` | **BUILDER ONLY**: nothing at the table reads them until a hit carries its type (8b2) and resistances show on the HEALTH page (8b4) A hit's type is at the table (8b2a, `sheet-typed-damage`): rolled from a line, the log saying each part. A DAMAGE column's MOST LINES ARE and an item's DAMAGE as rows (8b2b, `builder-damage-rows`): builder only until a line bought or given carries it to the table. On the sheet (8b2c, `sheet-typed-damage`): a line's DAMAGE as rows under ✎, its TYPE picked at the table. |
| What a hit does | RESIST, IMMUNE and VULNERABLE each WORKS OUT AS (HALF, NONE, DOUBLE, WORDS ONLY), WORK IT OUT, APPLY DAMAGE (AUTO, CONFIRM, OFF), and a table's APPLY DAMAGE and WORK OUT RESISTANCES over them (8b5a) | `damage_types`, `damage_taken`, `hit_on_target` | `builder-apply-damage`, `health-hit` | Set on DAMAGE TYPES and the GAME tab (8b5b, `builder-apply-damage`). AT THE TABLE (8b5c, `health-hit`): AUTO with RESIST worked out (HALF), and the table's APPLY DAMAGE OFF; NONE, DOUBLE, WORDS ONLY, WORK IT OUT off and CONFIRM in the socket tests only. CONFIRM AT THE TABLE (8b6b2, `health-confirm`): the hit waits, the player told only that it waits, the GM APPLYs and DISMISSes; APPLY ALL and a player applying on their own in the socket and component tests. |
| SEND TO, the GM's | FULL or HALF per token, under each APPLY DAMAGE; a gear DAMAGE and a plain sheet roll; each token once per roll (8b7a, 8b7b) | `send_to` | `send-to` | AT THE TABLE (8b7b, `send-to`): a gear DAMAGE sent HALF to a fire-resisting NPC under AUTO, the player told only SAVED, not sent there twice. FULL, CONFIRM, OFF, a plain sheet roll and the picker's groups in the socket and component tests only. |
| Luck | CALLED, THE MOST, EACH POINT ADDS +1 or A DIE, ON EVERY ROLL or ONLY THESE ROLLS, REFILLED BY, and the GAME tab's REFILL LUCK (8c5a) | `luck`, `luck_table` | | **GAP**: the server tests only (8c5a); the card 8c5b, the strip and REFILL LUCK 8c6 |
| When health runs out | THE SHEET SAYS, HOW IT GOES (SAVES COUNTED, ONE FAIL IS DEATH, TURNS LEFT, NO ROLL), THE SAVE (dice, AT LEAST or UNDER a target), SUCCESSES TO LIVE, FAILURES TO DIE, GETS HARDER, ON A NATURAL, TURNS LEFT, HURT WHILE DOWN, WHO GOES DOWN (friendly NPCs, enemy NPCs) (8c1a); STABILIZE: THE HELPER ROLLS, VS, THEN THEY ARE, AND GET, DOWN AGAIN WITH IT (8c4a; set in the builder 8c4b1, `builder-dying-card`; AT THE TABLE 8c4b2, `stabilize-health`: a player's STABILIZE made, STABLE; the GM's BY HAND DEAD. BACK WITH 1 HP, AND GET, DEAD AT ONCE and the GM's HELPED BY in the server and component tests) | `dying`, `dying_table` | `builder-dying-card`, `builder-clicks`, `dying-save`, `stabilize-health` | AT THE TABLE (8c3, `dying-save`): SAVES COUNTED, a player down by the GM's DAMAGE, the sheet's DYING box, DEATH SAVE rolled and counted, said in the tray, healed back up. Set in the builder (8c2, `builder-dying-card`). ONE FAIL IS DEATH, TURNS LEFT, NO ROLL, naturals, HURT WHILE DOWN, WHO GOES DOWN, the tracker's turns and A TURN GOES BY in the server and component tests only |
| A built-in game's APPLY DAMAGE | AUTO (SYSTEM'S) or OFF on a built-in game's GAME tab, for CWN, Cyberpunk RED and SR6's sheet attacks (8b5d) | `builtin_apply_damage`, `damage_types` | `builtin-apply-damage` | AT THE TABLE OFF on Cyberpunk RED (`builtin-apply-damage`); OFF on CWN (soak, SHOCK, a car) and SR6, and AUTO, in the socket tests only |
| Attack as | ATTACK AS on a builder game's map attack box: YOU or an NPC in the target's scene, a fight's first (8b6a) | `attack_as` | `attack-as` | AT THE TABLE the GM as two NPCs, each one's damage to its own target (`attack-as`); a player's NPCs, the scene refused, a MISS, CANCEL and a built-in game's sheet attack in the socket tests; the fight's groups in the component test |
| Hit totals on NPCs | HIT TOTALS ON NPCS: GM ONLY on the GAME tab, on to start (8b5c) | `hit_on_target` | `health-hit` | AT THE TABLE on (`health-hit`: the player told only that the NPC was hit, the GM all of it); off in the socket tests only |
| A condition's modifier | on a stat, a formula, every roll | `conditions`, `table_rolls` | | **GAP** |
| A condition's end | when removed, after rounds, at a rest | `condition_rounds`, `resting` | | **GAP** |
| Rests | a refill up to a value | `rests`, `resting`, `call_rest` | `player-journey` (LONG REST: Resolve up to Grit) | **AT THE TABLE** |
| Rests | an amount reading the levels and a stat with its features' modifiers | `rests`, `resting` | `sheet-rest-levels` (LONG REST: Resolve to Fighter level + Grit with Tough) | **AT THE TABLE** |
| Recovery dice | a class's die; how many, what one heals, where spent, what gives them back; spent any time or when the GM opens it; spent with a roll, ticked off; rests finished at the call or on each sheet: REST buttons asked first, a panel with the dice and FINISH, the GM's call opened on the sheets, who has finished it and FINISH FOR one or everyone (R4) | `recovery`, `recovery_pools`, `rest_on_sheet`, `rest_finish`, `call_rest`, `choices_import` | `builder-recovery`, `builder-clicks`, `sheet-recovery-dice` (spent, ticked, given back, waiting for the GM), `sheet-rest-on-sheet` (rests on each sheet, the GM's call opened there) | **AT THE TABLE** |
| Rests | a rest that rolls no dice: a quiet log line, no tray opened or flashed; one that rolls dice opens the tray | `call_rest` | `sheet-rest-levels` (LONG REST shut, SHORT REST 1d4 open) | **AT THE TABLE** |
| Rests | by an amount, to the max, full health, a section; counts as another; a standard rest off; the system's own | `rests`, `resting`, `try_rest` | | **GAP** |
| House rules | starts on / off, switched at the table | `house_rules`, `house_rules_routes` | `builder-graph` (TRY ON THE MAP only) | **GAP** |
| Under a house rule | a part, a sheet section, a condition, a formula's alternative | `house_rules`, `house_rules_routes` | | **GAP** |

## Sharing and running a system

| Option | Variants | Server tests | Browser test | Status |
|---|---|---|---|---|
| Publish, and publish again through the version preview | | `store`, `publish_preview`, `version_diff` | `builder-journey` | **AT THE TABLE** |
| Switch the game to a system | | `runtime` | `builder-journey` | **AT THE TABLE** |
| Export and install | .citysys, .zip with images, INSTALL A FILE, BRING IT BACK, START FRESH | `citysys`, `citysys_zip`, `hostile_files` | `builder-share`, `builder-clicks` | **AT THE TABLE** |
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
2. ~~**Health models**~~: done, `health-models.spec.ts`. It gave the journeys a token on the map without the 3D map too: the GM posts one to /api/locations, and HIT_POINTS opens it.
3. ~~**Parts switched off**~~: done, `parts-off.spec.ts`, but for NPC tiers, which waits for family 8. A new version published through the API (the draft, then PUBLISH) is how a journey changes a running system.
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
