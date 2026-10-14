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
  { at: 'features', title: 'FEATURES', text: 'Which parts of CITY_NET this game uses: the bank, shops, vehicles, GIVE ITEM, SHEET IMPORT... Off only hides; turn one back on and everything it held comes back.' },
  { at: 'rules', title: 'STATS & RULES', text: 'The numbers players fill in, the formulas worked out from them (Defense = 10 + @agility), and lookup tables. Each formula shows its value on a sample character as you type.' },
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
  { page: 'features', title: 'FEATURES', body: [
    'The parts of CITY_NET this game uses, as switches: the bank and its currencies, shops and their catalogues, GIVE ITEM, vehicles, cyberware, initiative, combat, token health, NPC tiers, SHEET IMPORT.',
    'Turning a part off only hides it. Nothing it holds is deleted, and turning it back on brings it all back.',
  ] },
  { page: 'rules', title: 'STATS & RULES', body: [
    'STATS are the numbers players fill in, in groups (abilities, skills...), each with a lowest and highest. FORMULAS work values out from them; TABLES turn a number into another, in bands.',
    'Every formula shows its value on the SAMPLE character as you type, and its mistakes under it. See FORMULAS for what a formula can say.',
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
  ] },
  { page: 'rests', title: 'RESTS', body: [
    'The moments a game refills things: a short rest, a long rest, the end of a scene or a session, and your own. Each says what it refills, in order, and a rest can count as another.',
    'The GM calls one from the GAME tab for everyone or chosen characters, with a preview first.',
  ] },
  { page: 'house_rules', title: 'HOUSE RULES', body: [
    'Rules the GM turns on or off for their table, like MAGIC or GRITTY WOUNDS: each with a name, what it means, and whether a game starts with it on.',
    'Things go under a rule on their own pages, with ONLY WITH: a FEATURES part, a sheet section, a condition, or a formula\'s alternative. While the rule is off they are hidden, never deleted. The GM switches the rules in the GAME tab\'s HOUSE RULES.',
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
  { id: 'dice', group: 'REFERENCE', title: 'DICE', body: [
    'Where a box takes dice (an NPC tier\'s HP and numbers, a rest\'s amounts), write them as 2d6, with numbers and @stats added or taken away: 1d8 + @con_mod.',
    'The number of dice can come from a stat: @level d8, with a space before the d. Dice are rolled with the game\'s own dice, and the result shows in the dice log; TRY IT rolls them too.',
  ] },
  { id: 'health', group: 'REFERENCE', title: 'HEALTH MODELS', body: HEALTH_MODELS.map((m) => `${m.label}: ${m.worksLike}. Like ${m.examples}.`) },
  { id: 'sharing', group: 'REFERENCE', title: 'SHARING AND VERSIONS', body: [
    'While you build, your work saves itself as a draft; SAVE saves it now. PUBLISH makes the draft the next version the game runs. From the second version on, PUBLISH first shows what will change for anyone playing, and nothing is ever deleted.',
    'EXPORT in MY SYSTEMS saves a system as a .citysys file to share. Installing one shows what it holds first; a system already here can be updated or kept beside the new one.',
  ] },
  { id: 'examples', group: 'REFERENCE', title: 'EXAMPLES', examples: true, body: [
    'The built-in games as systems you can look through, read-only, or copy to change: every page filled in by a real game.',
  ] },
];

/** Every topic on the HELP page, in order. */
export const TOPICS: HelpTopic[] = [
  { id: 'start', group: 'START', title: 'GETTING STARTED', tour: true, body: [
    'Build a system down the rail: SETUP, then WORDS, FEATURES, STATS & RULES, and the CHARACTER SHEET once you want your own layout. TRY IT to check it works, fix anything in PROBLEMS, then PUBLISH.',
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
  // FEATURES: the bank's currencies
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
  // HOUSE RULES
  'house.name': 'What the GM sees beside its checkbox in the GAME tab\'s HOUSE RULES, like MAGIC. Renaming keeps everything under it.',
  'house.description': 'A line on what the rule changes, shown with its checkbox so the GM knows what they are turning on.',
  'house.starts': 'Whether a game begins with the rule on, and how a copy installed from a file arrives. After that it is the GM\'s choice at the table.',
  // TRY IT
  'try.health': 'The health model from SETUP on a pretend token, through the game\'s own rules: what the HEALTH folder shows the GM and the token\'s owner.',
  'try.othersSee': 'What everyone else sees of the token\'s health: the heart monitor and words like WOUNDED, never the numbers or the notes.',
  'try.level': 'The level the NPC is made at, what @level reads in its tier\'s boxes. In play the GM picks it in ID.EXE.',
} as const;

export type HintKey = keyof typeof HINTS;

/** A topic by its id, or the first. */
export const topicById = (id: string | null | undefined): HelpTopic => TOPICS.find((t) => t.id === id) ?? TOPICS[0];
