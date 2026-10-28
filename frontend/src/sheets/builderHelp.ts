// Help for GMs in the system builder (4i; approved mockup docs/mockups/builder-help.html,
// 2026-10-13): one place for every word of it, so the first-time tour, the HELP page and the "?"
// beside each setting can't say different things. A test holds it to the builder's pages, the
// formula engine's functions and the health models, so it can't fall behind them.

import type { BuilderPage } from './builderSession';
import { HEALTH_MODELS } from './setup';

/** Where on the rail a tour step points: a page, SAVE and PUBLISH, or nowhere (the welcome). */
export type TourPlace = BuilderPage | 'publish' | null;
export interface TourStep { at: TourPlace; title: string; text: string }

/** The tour, the first time the builder opens: what a system is, then the rail, top to bottom. */
export const TOUR: TourStep[] = [
  { at: null, title: 'WELCOME TO THE SYSTEM BUILDER', text: 'A system is a game: what it calls things, which parts of CITY_NET it uses, its stats and rules, and its character sheet. You build it page by page down this rail. Nothing reaches your players until you PUBLISH.' },
  { at: 'setup', title: 'SETUP', text: 'Start here: how characters get hurt (one pool of HP, two tracks, harm levels...), how they advance, and how the ruler measures. The rest builds on these answers.' },
  { at: 'words', title: 'WORDS', text: 'What your game calls things. Call HP "Wounds" and credits "Gold", and every window your players see says so. Leave a word blank to keep the app\'s.' },
  { at: 'features', title: 'PARTS', text: 'Which parts of CITY_NET this game uses: the bank, shops, vehicles, GIVE ITEM, SHEET IMPORT... Off only hides; turn one back on and everything it held comes back.' },
  { at: 'rules', title: 'STATS & RULES', text: 'The numbers players fill in, the formulas worked out from them (Defense = 10 + @agility), lookup tables, and the game\'s own dice and rolls. Each formula shows its value on a sample character as you type; GRAPH at the top shows it all as a map of wires instead. Optional rules for the table, like MAGIC, are made on HOUSE RULES, further down.' },
  { at: 'choices', title: 'CHOICES', text: 'What characters pick from, in your game\'s words: classes, backgrounds, feats. Each option gives features, like a bonus, uses that a rest refills, or a roll, unlocked by level. Taking a class more than once is multiclassing.' },
  { at: 'sheet', title: 'CHARACTER SHEET', text: 'How a sheet is laid out. It arranges itself from your stats at first; CUSTOMIZE to move tabs, sections and fields, and to say who sees and changes each one.' },
  { at: 'try', title: 'TRY IT', text: 'A test character, to see your rules work: change a stat, take some damage, call a rest, make an NPC. Nothing here is saved to any player.' },
  { at: 'publish', title: 'SAVE AND PUBLISH', text: 'Your work saves itself as a draft while you build. PUBLISH makes it the version the game runs; from the second version on, it shows what will change for anyone playing first.' },
];

export type TopicGroup = 'START' | 'PAGES' | 'REFERENCE';
/** One topic on the HELP page: its words, and the page GO TO opens, or the examples it can open. */
export interface HelpTopic { id: string; group: TopicGroup; title: string; body: string[]; page?: BuilderPage; tour?: true; examples?: true }

/** Each builder page, as its HELP topic explains it. */
const PAGE_TOPICS: { page: BuilderPage; title: string; body: string[] }[] = [
  { page: 'setup', title: 'SETUP', body: [
    'The questions a system starts with: its name, how characters get hurt (the health model), how they advance, and how the map\'s ruler reads distances.',
    'Changing the health model once characters play the system changes their sheets when you publish; the numbers on their tokens are kept.',
  ] },
  { page: 'words', title: 'WORDS', body: [
    'What your game calls the app\'s things: HP, credits, skills, the GM, a shop... Each word has a singular, a plural and a short form, used wherever players see it.',
    'A word left blank keeps the app\'s own, so nothing changes until you choose one.',
  ] },
  { page: 'features', title: 'PARTS', body: [
    'The parts of CITY_NET this game uses, as switches: the bank and its currencies, shops and their catalogues, GIVE ITEM, vehicles, cyberware, initiative, combat, token health, NPC tiers, SHEET IMPORT.',
    'Turning a part off only hides it. Nothing it holds is deleted, and turning it back on brings it all back.',
  ] },
  { page: 'rules', title: 'STATS & RULES', body: [
    'STATS are the numbers players fill in, in groups (abilities, skills...), each with a lowest and highest. FORMULAS work values out from them; TABLES turn a number into another, in bands.',
    'DICE are the game\'s own dice: faces with numbers, signs or symbols that cancel and count. ROLLS are its rolls, in five steps: the dice, how they are read, what is added and compared, special results, and the choices asked before rolling. Each roll gets a die button on the sheet beside what it is rolled by, and TEST ROLL tries it on the sample.',
    'Every formula shows its value on the SAMPLE character as you type, and its mistakes under it. See FORMULAS for what a formula can say.',
    'A formula can be worked out another way while a house rule is on: WITH A RULE, then USE INSTEAD. See HOUSE RULES.',
    'FORMS / GRAPH at the top switches between the boxes and a map of the same system: every stat, formula, table and roll a node, every name a formula reads a wire. Anything changed on one is changed on the other. See THE MAP for what you can do on it.',
  ] },
  { page: 'choices', title: 'CHOICES', body: [
    'The lists a character picks from, in your game\'s words: classes, backgrounds, feats, playbooks, clans. Each list says how many a character picks, whether picks have levels, and whether more can be added later, which is how multiclassing works.',
    'Each option in a list has a name, words for the table, and can have a requirement, a formula like @int >= 13: one that isn\'t met is shown greyed with the reason, and the GM can pick it anyway.',
    'In a levelled list, formulas read each option\'s level as @soldier_level (0 when not taken), the list\'s total as @classes_level, and @level as every levelled list together, unless your system has a stat called level of its own.',
    'Features, what each pick gives (a bonus, uses that a rest refills, a roll, another list to pick from), are made on each option.',
  ] },
  { page: 'sheet', title: 'CHARACTER SHEET', body: [
    'The layout players see. Until you CUSTOMIZE it, it arranges itself from your stats, formulas and health model.',
    'Customized, you move tabs, sections and fields, and say who sees each field and who changes it: the player, or only the GM. DOWNLOAD FORM gives the blank PDF players can fill in and upload.',
  ] },
  { page: 'npcs', title: 'NPCS', body: [
    'NPC tiers are difficulties GENERATE_SHEET rolls an NPC from, at a level: HP, defense and any number, each a number, a formula or dice.',
    'An NPC can have a stat block of its own, shorter than the character sheet; only the GM ever sees it.',
  ] },
  { page: 'conditions', title: 'CONDITIONS', body: [
    'What can happen to a character besides losing health: the ten standard conditions, renamed or switched off, and your own, up to sixty.',
    'Each has an icon, a description, how it ends (when removed, after rounds, or at a rest) and modifiers on a stat, a formula or every roll.',
    'A modifier on every roll changes each of the system\'s own rolls made by a character with the condition on their token, named in the log: 4 5 = 9 + 3 - 1 (HURT). TEST ROLL on the ROLLS tab has a switch for each, to see a roll under it.',
  ] },
  { page: 'rests', title: 'RESTS', body: [
    'The moments a game refills things: a short rest, a long rest, the end of a scene or a session, and your own. Each says what it refills, in order, and a rest can count as another.',
    'The GM calls one from the GAME tab for everyone or chosen characters, with a preview first.',
  ] },
  { page: 'house_rules', title: 'HOUSE RULES', body: [
    'Rules the GM turns on or off for their table, like MAGIC or GRITTY WOUNDS: each with a name, what it means, and whether a game starts with it on.',
    'Things go under a rule on their own pages, with ONLY WITH: a part on PARTS, a sheet section, a condition, or a formula\'s alternative. While the rule is off they are hidden, never deleted. The GM switches the rules in the GAME tab\'s HOUSE RULES.',
  ] },
  { page: 'try', title: 'TRY IT', body: [
    'A test character for the draft as it stands: change its stats and watch the formulas, hurt and heal it, call a rest, make an NPC from a tier.',
    'Nothing here reaches any player. SAVE AS SAMPLE keeps the test character as the one STATS & RULES checks formulas against.',
  ] },
  { page: 'problems', title: 'PROBLEMS', body: [
    'Everything that would stop the system working: a formula that reads nothing, a loop, a field defined twice... PUBLISH waits until the list is empty.',
    'Each problem says where it is, so you can go and fix it.',
  ] },
];

/** One function a formula can call, as the reference lists it. */
export interface FormulaFunction { name: string; args: string; gives: string; example: string }

/** Every function the formula engine knows (backend systemBuilder/expression.js BUILTINS; a test holds the two together). */
export const FORMULA_FUNCTIONS: FormulaFunction[] = [
  { name: 'min', args: 'a, b, ...', gives: 'The smallest', example: 'min(@str, @dex)' },
  { name: 'max', args: 'a, b, ...', gives: 'The largest', example: 'max(1, @level - 2)' },
  { name: 'floor', args: 'x', gives: 'Rounded down', example: 'floor(@str / 2)' },
  { name: 'ceil', args: 'x', gives: 'Rounded up', example: 'ceil(@level / 3)' },
  { name: 'round', args: 'x', gives: 'The nearest whole number, halves up', example: 'round(@wis * 1.5)' },
  { name: 'abs', args: 'x', gives: 'Without its sign', example: 'abs(@karma)' },
  { name: 'clamp', args: 'x, lowest, highest', gives: 'Kept between lowest and highest', example: 'clamp(@dex - 10, -3, 3)' },
  { name: 'if', args: 'test, then, else', gives: 'One of two, by a test', example: 'if(@level >= 5, 2, 1)' },
];

const REFERENCE: HelpTopic[] = [
  { id: 'formulas', group: 'REFERENCE', title: 'FORMULAS', body: [
    'A formula works a value out from the sheet. @agility reads a stat or another formula; $cwn_soak reads one of the app\'s built-in rules; a table is used like a function, mod(@str).',
    'Numbers, + - * / and brackets; comparisons < <= > >= == != ; and, or, not. A test is true when it isn\'t 0.',
  ] },
  { id: 'map', group: 'REFERENCE', title: 'THE MAP', body: [
    'GRAPH, at the top of STATS & RULES, draws the system as nodes and wires, read left to right: stats on the left, formulas worked out from them, rolls at the end. Every value is the sample character\'s, as the server works it out. Hover a node to light everything it reads and everything that reads it.',
    'Click a node to change it in a panel beside it, with the same boxes FORMS has. + ADD, or the A key, adds a formula, stat, group, table, condition, roll or note where you are looking; Delete removes the node picked.',
    'Drag from a dot onto a formula to make it read that value; drag onto a roll to have it rolled by it. Click a wire, then CUT, to take the name out. A diamond on a wire (×6, ÷2) is something done to a value on its way in, changed in the formula\'s panel.',
    'NOTES are for you only, pinned to a node. Formulas can go into MAP GROUPS of your own, folded and lined up with LINE UP. UNDO and REDO (Ctrl+Z, Ctrl+Y) take back what was done on the map. FIT, the minimap and AUTO-LAYOUT help find your way.',
    'The corner counts PROBLEMS, and a node with one is outlined red. A house rule\'s TRY ON THE MAP shows the numbers with it on, never saved and never changing the game.',
  ] },
  { id: 'dice', group: 'REFERENCE', title: 'DICE', body: [
    'Where a box takes dice (an NPC tier\'s HP and numbers, a rest\'s amounts), write them as 2d6, with numbers and @stats added or taken away: 1d8 + @con_mod.',
    'The number of dice can come from a stat: @level d8, with a space before the d. Dice are rolled on the server, and the result shows in the dice log; TRY IT rolls them too.',
    'A game can have dice of its own, made on STATS & RULES\' DICE tab: any number of faces, each with a number, symbols, or both. Its rolls can use them, and while the game runs they are in the dice menu under THIS GAME\'S DICE.',
  ] },
  { id: 'health', group: 'REFERENCE', title: 'HEALTH MODELS', body: HEALTH_MODELS.map((m) => `${m.label}: ${m.worksLike}. Like ${m.examples}.`) },
  { id: 'sharing', group: 'REFERENCE', title: 'SHARING AND VERSIONS', body: [
    'While you build, your work saves itself as a draft; SAVE saves it now. PUBLISH makes the draft the next version the game runs. From the second version on, PUBLISH first shows what will change for anyone playing, and nothing is ever deleted.',
    'EXPORT in MY SYSTEMS saves a system as a .citysys file to share, or as a .zip with the images uploaded for it. Installing either shows what it holds first; a system already here can be updated or kept beside the new one.',
  ] },
  { id: 'target', group: 'REFERENCE', title: 'WHO SEES THE TARGET', body: [
    'Some games say the number you roll against out loud; most GMs keep it to themselves. A system picks how much of a roll\'s target its players see, at the top of STATS & RULES\' ROLLS tab, and one roll can pick otherwise in its step 3.',
    'Whatever is picked, you see everything, with HIDDEN FROM PLAYERS on the line when something was kept back. The players, a granted editor and the streamer overlay see their version, live and in the history after a reload. A new system starts on GM ONLY.',
    'Below: KES rolls STEALTH, a d20 + 3 against 12, as a player and as you see it. Pick a setting and roll again.',
  ] },
  { id: 'examples', group: 'REFERENCE', title: 'EXAMPLES', examples: true, body: [
    'The built-in games as systems you can look through, read-only, or copy to change: every page filled in by a real game.',
  ] },
];

/** Every topic on the HELP page, in order. */
export const TOPICS: HelpTopic[] = [
  { id: 'start', group: 'START', title: 'GETTING STARTED', tour: true, body: [
    'Build a system down the rail: SETUP, then WORDS, PARTS, STATS & RULES, CHOICES, and the CHARACTER SHEET once you want your own layout. TRY IT to check it works, fix anything in PROBLEMS, then PUBLISH.',
    'Or start from one of the EXAMPLES and change it.',
  ] },
  ...PAGE_TOPICS.map(({ page, title, body }) => ({ id: page, group: 'PAGES' as const, title, body, page })),
  ...REFERENCE,
];

/** The built-in games HELP's EXAMPLES opens to look at (backend systemBuilder/examples.js). */
export const EXAMPLES: { id: string; name: string }[] = [
  { id: 'cwn', name: 'CITIES WITHOUT NUMBER' },
  { id: 'cpr', name: 'CYBERPUNK RED' },
  { id: 'sr6', name: 'SHADOWRUN 6E' },
];

/**
 * The "?" beside each builder setting (components/HelpHint.tsx), by page and setting. Each page's
 * test checks its own are all on screen, so a setting can't lose its "?" unnoticed.
 */
export const HINTS = {
  // SETUP
  'setup.name': 'What players see in the system picker and on every sheet. Two systems can\'t share a name. RENAME changes it at once, in the draft and the published version.',
  'setup.description': 'Shown under the name in MY SYSTEMS, and to anyone installing the system from a file.',
  'setup.author': 'Who made it. It travels with the .citysys file when you share the system.',
  'setup.license': 'The terms others may use it under if you share it, like CC BY 4.0. Leave it blank for a game only your table plays.',
  'setup.health': 'The chosen model\'s own settings: what its pool, tracks, types, levels or locations are called, and how many. The preview beside them is the HEALTH section every sheet starts with.',
  'setup.die': 'A die your game uses that isn\'t listed: d7, or a handful rolled together like 3d8. The dice you pick are offered first whenever a roll is added.',
  // WORDS
  'words.one': 'The word for one of it: 1 Wound, 1 Gold.',
  'words.many': 'The word for more than one: 3 Wounds. Often the same word with an s.',
  'words.short': 'A short form for tight spaces: bars, chips and buttons. HP, GP.',
  'words.readsAs': 'How the term reads in the game with your words, or the app\'s where you left a box empty.',
  // PARTS: the bank's currencies
  'bank.main': 'The main currency is what every bank account\'s balance is in. Prices are in it unless a catalogue names another. MAKE MAIN swaps which one it is.',
  'bank.countedIn': 'Whole numbers (40 Gold), decimals (4.34 credits) or coins (2 gp 5 sp). Amounts are kept in the smallest unit, so nothing is lost to rounding.',
  'bank.symbol': 'A sign written with amounts, like $ or €, before or after the number. Left empty, amounts show the short name, or the name.',
  'bank.decimals': 'How many places after the decimal mark: 2 for dollars and cents.',
  'bank.short': 'A short name written after amounts, like gp. Left empty, the currency\'s name is used.',
  'bank.worth': 'How many of the smallest coin this coin is worth. With copper the smallest, a silver worth 10 copper is 10, and a gold worth 10 silver is 100.',
  'bank.icon': 'Shown beside amounts in BANK.EXE and the shops: one of the five built in, or a PNG, WebP or SVG you upload.',
  'bank.readsAs': 'How an amount looks in the game with these settings.',
  'bank.whale': 'The balance in the main currency at which a player earns the whale celebration. Empty: never.',
  // STATS & RULES
  'rules.id': 'What formulas call this stat, like @str. It is set when the stat is added and never changes, so renaming the stat never breaks a formula.',
  'rules.lowest': 'The lowest it should be. The sheet shows the range under the box, like 3 to 18. Empty: no lowest.',
  'rules.highest': 'The highest it should be, shown with the lowest under the box on the sheet. Empty: no highest.',
  'rules.tiedTo': 'The stat this one goes with, like a skill with its ability (Shoot with Dexterity). A formula still names every stat it reads.',
  'rules.sample': 'A made-up character\'s value, for checking formulas: FORMULAS works every value out from these. Saved with the draft; players never see it.',
  'rules.formula': 'Written the way the rulebook says it: @ and an id for a stat or another formula, a table by its id like mod(@str), and the functions under INSERT.',
  'rules.value': 'What the formula comes to for the sample character, worked out by the game\'s own engine a moment after you stop typing.',
  'rules.upTo': 'The highest number this row covers. Rows are read top to bottom, and the last one catches anything higher.',
  'rules.gives': 'What a number in this row turns into: the table\'s answer.',
  'rules.tryTable': 'Type a number to see what the table gives for it. Only for checking: nothing is saved.',
  // STATS & RULES: DICE
  'dice.preset': 'Ready-made dice with their symbols: Fate dice, GOOD / GREAT / BAD with symbols that cancel, a d6 with a word. They are added to the dice here, to change as you like.',
  'dice.copy': 'One of the table\'s dice from CUSTOM_DIE.EXE, copied into the system: its numbers kept, its words made symbols. The table\'s own die stays as it was.',
  'dice.name': 'What the dice menu, the rolls and the log call the die, like Good or Omen. Rolls find it by its id, so renaming never breaks one.',
  'dice.faces': 'How many faces the die has, 2 to 100. Faces added to a die of plain numbers carry on the count; on any other die they start blank.',
  'dice.color': 'How the die is drawn in the dice menu: the theme\'s color, or the danger color for a die that works against the roller, like a Bad die.',
  'dice.number': 'What the face adds when a roll sums the dice. On a die with any face below 0, the others show their sign, like +1. Blank: the face adds nothing.',
  'dice.symbols': 'What the face shows, up to 6, the same symbol twice if it shows two. A roll that COUNTS THE SYMBOLS adds them up across its dice.',
  'dice.look': 'How the symbol is drawn on the dice: its MARK, one of the drawn ICONs, your own drawing on a 16 by 16 pad, or a picture you UPLOAD. The log always writes its mark.',
  'dice.mark': 'One or two characters for the symbol, like ✶, written in the log wherever a face shows it. Empty: the first letter of its name.',
  'dice.cancels': 'The symbol this one cancels one for one, like a Hit against a Miss; the other cancels it back. A roll counting the symbols takes the pairs away first.',
  'dice.countsAs': 'Another symbol this one counts as too, like a Crit that is also a Hit. It goes one step only, so a symbol another counts as can\'t count as anything itself.',
  'dice.test': 'A handful of the die thrown on the server, as the table throws it, and its symbols counted. Nothing is saved or written in the log.',
  // STATS & RULES: ROLLS
  // CHOICES (7a2b1)
  'choices.lists': 'The lists a character picks from: classes, backgrounds, feats, playbooks. Each is named in your game\'s words.',
  'choices.names': 'What the list is called, one and many: CLASS and CLASSES. Players see these on their sheet.',
  'choices.picks': 'How many options a character picks from this list: ONE (a class), a number (two backgrounds), or ANY (feats).',
  'choices.again': 'More can be added later, past what was picked first. With levels, this is multiclassing: a second class, each with its own level.',
  'choices.levelled': 'Each pick has a level, and its features unlock by it, like a class. Formulas read it as @<option>_level.',
  'choices.options': 'What a character can pick from this list. A big list, like forty feats, is fine: up to a hundred.',
  'choices.optionName': 'What players see for this option: SOLDIER, DOCKHAND, TOUGH.',
  'choices.description': 'Words for the table about this option, shown when a player picks.',
  'choices.requires': 'Optional. A formula that must not be 0 for this to be picked, like @int >= 13. One not met shows greyed with the reason; the GM can pick it anyway.',
  'rolls.preset': 'A ready-made roll from a game, like a PbtA move or a Blades action, put into the five steps. The roll\'s name and ROLLED BY stay; change anything after.',
  'rolls.dice': 'What is rolled: how many, as a number or a formula like @this, and of which size, or the system\'s own dice. Name a kind, like Hunger, to show it apart and give it effects.',
  'rolls.read': 'How the dice become a number: SUM them, KEEP the HIGHEST or LOWEST few, COUNT SUCCESSES at or over a face, or COUNT THE SYMBOLS on the system\'s own dice.',
  'rolls.compare': 'What is added to the dice, the target the total is held against, and words for where it lands. Each is optional: with none, the roll is its total.',
  'rolls.add': 'A formula added to what the dice come to, like @this + @tie_mod. At the table, conditions that change every roll are added on top.',
  'rolls.against': 'The target the total must meet or beat to succeed, like 13 or @this. ROLL UNDER turns it round: at or under succeeds. Empty: no success or failure.',
  'rolls.seen': 'How much of a roll\'s target your players see, for every roll in the system. SHOWN: "vs 12: SUCCESS". VERDICT ONLY: "SUCCESS", never the number. GM ONLY: their total alone; you see it all. HELP\'s WHO SEES THE TARGET shows each.',
  'rolls.rollSeen': 'This roll\'s own, when it shouldn\'t follow the system\'s: a save whose number is on the player\'s sheet anyway can be SHOWN in a GM ONLY game. Needs a target to keep.',
  'rolls.bands': 'Words for the total, read top to bottom like a table: the first band the total isn\'t above is the one shown, like 6− MISS, 7–9 A COST, 10+ A HIT.',
  'rolls.special': 'What the faces themselves can mean: dice that explode, naturals, matches, cancelling, a glitch, a named kind\'s effects, and what happens with no dice.',
  'rolls.explode': 'A die on its highest face, or the face you give, rolls another that is added. ONLY ONCE stops a new die exploding again; FIRST DIE ONLY lets one die explode.',
  'rolls.natural': 'A face that counts before anything is added, like a natural 20: its words show with the result, and it can be a critical success or failure.',
  'rolls.matches': 'Dice showing the same face, like doubles: how many, which face (any, left blank), what it adds and its words. It can be a critical too.',
  'rolls.cancel': 'While counting successes, each die showing this face takes a success away, as a 1 does in some dice pools.',
  'rolls.glitch': 'Too many dice on one face, like 1s on half the dice in SR6: its words show with the result, and other words when there is no success either.',
  'rolls.named': 'Effects for a kind of dice named in step 1, like Hunger: one of them showing a face, on a critical, a success, a failure or any roll, adds its words.',
  'rolls.zero': 'When the dice come to none, like a Blades action with no dots: roll a few anyway and keep the lowest or the highest. It is never a critical.',
  'rolls.changes': 'Choices the player is asked before rolling, like PUSH YOURSELF: each can add dice, add to the total, and cost something. With none, the die button rolls at once.',
  'rolls.cost': 'What the change costs when it is rolled: TAKES from a stat, never below 0, like a Fate point, or ADDS to one, never past its highest, like Blades\' Stress.',
  'rolls.rolledBy': 'The stats, stat groups and formulas this roll goes with. Each gets a die button beside it on the sheet, and @this reads the one rolled.',
  'rolls.test': 'The roll made by the game\'s own engine for the sample character, as the table makes it. Try its changes and conditions here; nothing is saved or logged.',
  'rolls.testFor': 'Which of the stats or formulas it is rolled by to roll for: what @this reads on the sample character.',
  // CHARACTER SHEET
  'sheet.looksLike': 'How the section sets out its fields. LIST: one under another. GRID: side by side in columns. NOTES: a list meant for long text. ITEMS: the character\'s items, where shops and GIVE put what they hand over.',
  'sheet.columns': 'How many fields sit side by side in the grid, 1 to 8.',
  'sheet.kind': 'What the field holds. NUMBER and TEXT take one line, LONG TEXT a box for paragraphs, and PICK ONE a list of choices you write.',
  'sheet.whoSees': 'OWNER AND GM: only the character\'s player and the GM. EVERYONE: other players too, on the card they open from the token.',
  'sheet.whoChanges': 'THE PLAYER fills it in. ONLY THE GM: the player sees it, but only the GM changes it, like XP or awards.',
  'sheet.hint': 'A short line under the field on the sheet, like where a number comes from.',
  // NPCS
  'npcs.hp': 'The NPC token\'s HP: a number, a formula reading @level, or dice, rolled fresh for each NPC made from the tier. Blank: the token keeps its own.',
  'npcs.defense': 'The NPC token\'s armor, worked out the same way as HP. Blank: the token keeps its own.',
  'npcs.level': 'The level to try the tier at, what @level reads. In play the GM picks the level in ID.EXE, beside GENERATE_SHEET.',
  // CONDITIONS
  'conditions.chip': 'The short word on the condition\'s chip in a token\'s HEALTH folder, up to 8 letters.',
  'conditions.icon': 'Drawn on the chip beside its word: one of the drawn icons, or one you upload.',
  'conditions.description': 'What it means at the table, shown under the chips in the token\'s HEALTH folder to everyone who sees them.',
  'conditions.ends': 'WHEN REMOVED: it stays until someone who may change the token\'s health takes it off. AFTER ROUNDS: it counts down with the initiative rounds. AT A REST: it comes off at the rests you pick.',
  // RESTS
  'rests.refills': 'What the rest puts back, line by line in order: health, a number on the sheet, or a whole section, to its maximum, by an amount or to a number. Rolled for each character.',
  'rests.sample': 'This rest on the sample character, its token hurt to half, worked out the way the game would. Nothing is saved.',
  // ONLY WITH, on PARTS, CHARACTER SHEET (and the NPC stat block) and CONDITIONS
  'only.alternative': 'A house rule under which this formula is worked out another way, like fewer hit points with GRITTY WOUNDS. Off, it is worked out as written.',
  'only.instead': 'The formula used while the rule is on, written like any other. The sample character\'s value with the rule on shows under it.',
  'only.with': 'The house rule this waits on. While the GM has the rule off it is hidden in the game, never deleted; always means it is always there.',
  // HOUSE RULES
  'house.name': 'What the GM sees beside its checkbox in the GAME tab\'s HOUSE RULES, like MAGIC. Renaming keeps everything under it.',
  'house.description': 'A line on what the rule changes, shown with its checkbox so the GM knows what they are turning on.',
  'house.starts': 'Whether a game begins with the rule on, and how a copy installed from a file arrives. After that it is the GM\'s choice at the table.',
  // TRY IT
  'try.health': 'The health model from SETUP on a pretend token, through the game\'s own rules: what the HEALTH folder shows the GM and the token\'s owner.',
  'try.othersSee': 'What everyone else sees of the token\'s health: the heart monitor and words like WOUNDED, never the numbers or the notes.',
  'try.rules': 'Try the draft with each house rule on or off. Only here: the game keeps the GM\'s choice. Each starts as its STARTS says.',
  'try.level': 'The level the NPC is made at, what @level reads in its tier\'s boxes. In play the GM picks it in ID.EXE.',
} as const;

export type HintKey = keyof typeof HINTS;

/** A topic by its id, or the first. */
export const topicById = (id: string | null | undefined): HelpTopic => TOPICS.find((t) => t.id === id) ?? TOPICS[0];
