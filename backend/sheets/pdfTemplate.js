// A blank fillable PDF matching what the importer reads back.
//
// The import dialog took a filled PDF from the start, but there was nowhere to get one:
// you needed a sheet that happened to use field names our aliases recognised. This
// generates that sheet, so the round trip is download → fill → upload rather than
// download-from-somewhere-else and hope.
//
// **The names are the contract.** Every text field here is named with a label the
// importer maps back to the field it came from, and a test walks the whole layout through
// `mapFields` to prove it. Anything that stops round-tripping fails there rather than in
// somebody's game — which is the whole reason this lives beside the importer rather than
// being drawn by hand once and left to drift.
//
// Layout only, no publisher's content: these are stat names and dice math, the same bar
// the sheet templates hold themselves to. It is deliberately a plain form rather than a
// reproduction of anyone's character sheet design.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * What the form asks for, in reading order.
 *
 * Labels are what the field is *called on the PDF*, and the importer has to recognise
 * every one of them. Where a system's own vocabulary differs from our storage — Cyberpunk
 * writes SDP where we store a damage pool — the label is the system's, since that is what
 * the player is copying from.
 */
/** How many cyberware lines the printed form offers. The app has no such limit. */
const CYBER_ROWS = Array.from({ length: 12 }, (_, i) => i + 1);

const LAYOUTS = {
  cyberpunk_red: [
    { title: 'IDENTITY', fields: ['Handle', 'Role', 'IP', 'Reputation', 'Description', 'Aliases'] },
    {
      title: 'STATS',
      fields: ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'MOVE', 'BODY', 'EMP', 'LUCK', 'Humanity'],
    },
    {
      title: 'COMBAT',
      fields: ['SP Head', 'SP Body', 'SP Shield', 'Armor Penalty', 'Seriously Wounded', 'Death Save'],
    },
    {
      title: 'WEAPONS',
      fields: [
        'Weapon1Name', 'Weapon1Dmg', 'Weapon1Skill', 'Weapon1Rof',
        'Weapon2Name', 'Weapon2Dmg', 'Weapon2Skill', 'Weapon2Rof',
        'Weapon3Name', 'Weapon3Dmg', 'Weapon3Skill', 'Weapon3Rof',
        'Weapon4Name', 'Weapon4Dmg', 'Weapon4Skill', 'Weapon4Rof',
      ],
    },
    {
      // Columns chosen from what the Companion export actually carries — a name, a
      // humanity cost and an effect — plus the two things it never carries: where the
      // piece is installed, and what it cost in eddies.
      //
      // Twelve rows because paper has to stop somewhere, which the app does not: chrome
      // is stored as a list whose length is a property of the character. A form with more
      // pieces than lines is a form, not a limit.
      title: 'CYBERWARE',
      fields: CYBER_ROWS.flatMap((n) => [
        `Cyber${n}Name`, `Cyber${n}Type`, `Cyber${n}HL`, `Cyber${n}Eddies`, `Cyber${n}Effect`,
      ]),
    },
    {
      // The section with no preset picker behind it, so the one players most want to
      // arrive already filled in.
      title: 'VEHICLES',
      fields: [
        'Vehicle1Name', 'Vehicle1SDP', 'Vehicle1SP', 'Vehicle1Seats', 'Vehicle1Hull', 'Vehicle1Speed', 'Vehicle1Cost',
        'Vehicle2Name', 'Vehicle2SDP', 'Vehicle2SP', 'Vehicle2Seats', 'Vehicle2Hull', 'Vehicle2Speed', 'Vehicle2Cost',
        'Vehicle3Name', 'Vehicle3SDP', 'Vehicle3SP', 'Vehicle3Seats', 'Vehicle3Hull', 'Vehicle3Speed', 'Vehicle3Cost',
        'Vehicle4Name', 'Vehicle4SDP', 'Vehicle4SP', 'Vehicle4Seats', 'Vehicle4Hull', 'Vehicle4Speed', 'Vehicle4Cost',
      ],
    },
    {
      title: 'NOTES',
      fields: ['Ammunition', 'Gear', 'Cyberware', 'Lifepath', 'Critical Injuries', 'Addictions'],
    },
  ],

  cities_without_number: [
    { title: 'IDENTITY', fields: ['Name', 'Background', 'Class', 'Level', 'Description', 'Faction'] },
    { title: 'ATTRIBUTES', fields: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'] },
    {
      title: 'COMBAT',
      fields: ['AC', 'Base Hit Bonus', 'Trauma Target', 'System Strain', 'System Strain Max',
        'Lifestyle', 'Armor Name', 'Armor AC', 'Max Dex', 'Damage Soak', 'TT Mod', 'Shield'],
    },
    { title: 'SAVES', fields: ['Save Physical', 'Save Evasion', 'Save Mental', 'Save Luck'] },
    {
      title: 'WEAPONS',
      fields: [1, 2, 3, 4].flatMap(i =>
        ['Name', 'Dmg', 'Skill', 'Trauma', 'Shock', 'Atk'].map(p => `Weapon${i}${p}`)),
    },
    {
      // Picking a book type fills these in on the sheet, so the form is for a car that has
      // been edited away from its preset — or one arriving from somewhere else entirely.
      title: 'VEHICLES',
      fields: [1, 2, 3].flatMap(i =>
        ['Name', 'Type', 'HP', 'HPMax', 'AR', 'AC', 'Spd', 'TT', 'Crew', 'Hrdpt', 'Cost'].map(p => `Vehicle${i}${p}`)),
    },
    { title: 'NOTES', fields: ['Weapons Notes', 'Gear', 'Cyberware', 'Foci', 'Contacts', 'Injuries'] },
  ],

  shadowrun_6e: [
    { title: 'IDENTITY', fields: ['Name', 'Metatype', 'Role', 'Description', 'Aliases'] },
    {
      title: 'ATTRIBUTES',
      fields: ['Body', 'Agility', 'Reaction', 'Strength', 'Willpower', 'Logic', 'Intuition',
        'Charisma', 'Edge', 'Essence', 'Magic', 'Resonance'],
    },
    { title: 'COMBAT', fields: ['Armor'] },
  ],
};

/** Whether a blank form can be offered for a system at all. */
const hasTemplate = (system) => Object.prototype.hasOwnProperty.call(LAYOUTS, String(system || ''));

const layoutFor = (system) => LAYOUTS[String(system || '')] || null;

/** Every label on the form, flat — what the round-trip test walks. */
const labelsFor = (system) => (layoutFor(system) || []).flatMap(g => g.fields);

const PAGE = { w: 595, h: 842 };          // A4, so it prints wherever the table is
const MARGIN = 40;
const COLS = 3;
const COL_W = (PAGE.w - MARGIN * 2) / COLS;
const ROW_H = 42;

/**
 * Render the blank form.
 *
 * Two columns of pale label text with a box under each, laid out in reading order and
 * broken onto a new page when it runs out of room. Plain on purpose: this is a data entry
 * form, not a character sheet to play from.
 */
async function buildTemplate(system) {
  const layout = layoutFor(system);
  if (!layout) return null;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`CITY_NET import form — ${system}`);
  pdf.setSubject('Fill this in and upload it on the IMPORT_SHEET dialog.');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();

  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;

  const newPage = () => { page = pdf.addPage([PAGE.w, PAGE.h]); y = PAGE.h - MARGIN; };

  page.drawText('CITY_NET — IMPORT FORM', { x: MARGIN, y: y - 12, size: 14, font: bold });
  page.drawText(`${system} · fill in what you have and upload it; blanks are ignored`,
    { x: MARGIN, y: y - 28, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 56;

  for (const group of layout) {
    if (y < MARGIN + ROW_H * 2) newPage();
    page.drawText(group.title, { x: MARGIN, y: y - 10, size: 10, font: bold });
    y -= 24;

    group.fields.forEach((label, i) => {
      const col = i % COLS;
      if (col === 0 && i > 0) y -= ROW_H;
      if (y < MARGIN + ROW_H) {
        newPage();
        page.drawText(`${group.title} (cont.)`, { x: MARGIN, y: y - 10, size: 10, font: bold });
        y -= 24;
      }
      const x = MARGIN + col * COL_W;
      page.drawText(label, { x, y: y - 9, size: 7, font, color: rgb(0.35, 0.35, 0.35) });

      const field = form.createTextField(label);
      field.setText('');
      field.addToPage(page, {
        x, y: y - 26, width: COL_W - 12, height: 14,
        borderWidth: 0.5, borderColor: rgb(0.6, 0.6, 0.6), backgroundColor: rgb(1, 1, 1),
      });
    });
    y -= ROW_H + 8;
  }

  return Buffer.from(await pdf.save());
}

module.exports = { LAYOUTS, hasTemplate, layoutFor, labelsFor, buildTemplate };
