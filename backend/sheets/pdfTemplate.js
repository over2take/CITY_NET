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
const { CWN_SKILLS } = require('./rolls');
const { WEAPON_ROWS: CWN_WEAPON_ROWS } = require('./attackCwn');

/**
 * Every CWN skill, by the label the importer already maps.
 *
 * Read off the roll table rather than retyped, so a skill added to the game gets a box
 * without anybody remembering to add one here.
 */
const CWN_SKILL_LABELS = Object.values(CWN_SKILLS).map(([label]) => label);

/** Weapon rows, counted from the resolver so the form cannot print fewer than the sheet. */
const CWN_FORM_WEAPON_ROWS = Array.from({ length: CWN_WEAPON_ROWS }, (_, i) => i + 1);

/**
 * Stash rows on paper.
 *
 * The sheet's stash grows without limit; a printed form cannot, so this is a judgement:
 * four is more weapons than most characters own and leaves the form a page shorter than
 * six would.
 */
const CWN_FORM_STASH_ROWS = [1, 2, 3, 4];

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
      // Inventory beside Gear rather than instead of it: the sheet has retired the Gear box
      // in favour of countable rows, but a paper form cannot print rows, and one line of
      // "2x Airhypo, Grapple gun" is read straight into them on the way in.
      fields: ['Ammunition', 'Inventory', 'Gear', 'Cyberware', 'Lifepath', 'Critical Injuries', 'Addictions'],
    },
  ],

  cities_without_number: [
    { title: 'IDENTITY', fields: ['Name', 'Background', 'Class', 'Level', 'XP', 'Aliases', 'Description', 'Faction', 'Languages'] },
    { title: 'ATTRIBUTES', fields: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'] },
    {
      title: 'COMBAT',
      fields: ['AC', 'Base Hit Bonus', 'Trauma Target', 'System Strain', 'System Strain Max',
        'Lifestyle', 'Armor Name', 'Armor AC', 'Armor Melee AC', 'Max Dex', 'Damage Soak',
        'TT Mod', 'Shield', 'Shield Melee', 'Armor Mods', 'Armor Enc', 'Move Mod',
        'Frail', 'Auto Initiative'],
    },
    { title: 'SAVES', fields: ['Save Physical', 'Save Evasion', 'Save Mental', 'Save Luck'] },
    {
      // The whole skill list, which this form has never had. Every one of them has resolved
      // in the importer since it was written; there was simply nowhere to write them down,
      // so a filled-in form produced a character who could not roll anything.
      title: 'SKILLS',
      fields: CWN_SKILL_LABELS,
    },
    {
      // Six rows, matching the sheet. It printed four, so a character with a full rack lost
      // two weapons on the way in and nothing said so.
      title: 'WEAPONS',
      fields: CWN_FORM_WEAPON_ROWS.flatMap(i =>
        ['Name', 'Dmg', 'Skill', 'Attr', 'Trauma', 'Shock', 'Atk', 'Mods', 'Carry', 'Enc']
          .map(p => `Weapon${i}${p}`)),
    },
    {
      // Weapons you own but are not carrying. Numbered boxes gathered into the array on
      // the way in, the same shape Cyberpunk's cyberware table uses - a paper form cannot
      // print a growable list, and one line cannot hold a location per weapon.
      title: 'WEAPON STASH',
      fields: CWN_FORM_STASH_ROWS.flatMap(i =>
        ['Name', 'Dmg', 'Skill', 'Attr', 'Trauma', 'Shock', 'Enc', 'Location']
          .map(p => `Stash${i}${p}`)),
    },
    {
      // Picking a book type fills these in on the sheet, so the form is for a car that has
      // been edited away from its preset — or one arriving from somewhere else entirely.
      //
      // Mounts are deliberately NOT printed: three per vehicle across six vehicles is 108
      // boxes, which would more than double this form for a case the preset already fills.
      title: 'VEHICLES',
      fields: [1, 2, 3, 4, 5, 6].flatMap(i =>
        ['Name', 'Type', 'HP', 'HPMax', 'AR', 'AC', 'Spd', 'TT', 'Crew', 'Hrdpt', 'Pow', 'Mass', 'Cost']
          .map(p => `Vehicle${i}${p}`)),
    },
    {
      // Only drawn on a sheet with the DELUXE house rule on, but a form cannot ask, and a
      // box nobody fills costs nothing.
      title: 'MAGIC',
      fields: ['Cast Skill', 'Mage Effort', 'Mage Effort Max', 'Spells Prepared Max',
        ...[1, 2, 3, 4].flatMap(i => ['Name', 'Effect', 'Dmg', 'Cost'].map(p => `Spell${i}${p}`)),
        'Summon Skill', 'Summoner Effort', 'Summoner Effort Max', 'Spirits'],
    },
    {
      // The chrome table, ported from Cyberpunk's rather than invented: both games store
      // a piece as the same kind of row, so the same gatherer reads both forms.
      //
      // Two columns differ, and the labels say which game you are in. STRAIN is what
      // Cyberpunk calls Humanity Loss - one column, two names - and CONC is CWN's alone,
      // because its chrome carries a concealment rating and Cyberpunk's does not.
      //
      // Twelve lines because paper has to stop somewhere, which the app does not.
      title: 'CYBERWARE',
      fields: CYBER_ROWS.flatMap((n) => [
        `Cyber${n}Name`, `Cyber${n}Type`, `Cyber${n}Strain`, `Cyber${n}Cost`,
        `Cyber${n}Conc`, `Cyber${n}Effect`,
      ]),
    },
    // Inventory is one line here and rows on the sheet - see the CP:R note above. The
    // Cyberware box stays beside the table: CWN's sheet still draws a CYBERWARE NOTES
    // section, so a line about your chrome has somewhere to live that is not a row.
    { title: 'NOTES', fields: ['Weapons Notes', 'Inventory', 'Gear', 'Cyberware', 'Foci', 'Contacts', 'Injuries'] },
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

// ─── A custom system's form (4h2b) ──────────────────────────────────────────
//
// Made from the system's own sheet (approved mockup docs/mockups/sheet-import.html, 2026-10-13):
// every field a player fills in (systemBuilder/sheetImport.js sheetFields), tabs as headings,
// sections as they are on the sheet, each box named by the field's id so the custom importer maps
// it straight back. A choice is a dropdown of its options; long text a tall box; a stat's range
// and a choice's options printed under the box; the inventory as numbered lines. What is not on
// the form, and why, is said at the foot.

/** The PDF's standard font draws Latin-1 only: anything else a GM typed becomes a question mark. */
const printable = (s) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** What a box is for, printed small under it. */
const hintOf = (f) => {
  if (f.type === 'select') return `One of: ${f.options.map((o) => o.label).join(', ')}`;
  if (f.min !== undefined && f.max !== undefined) return `${f.min} to ${f.max}`;
  if (f.min !== undefined) return `At least ${f.min}`;
  if (f.max !== undefined) return `At most ${f.max}`;
  return '';
};

const LEFT_SAYS = { worked_out: 'worked out by the game', elsewhere: 'kept elsewhere in CITY_NET', gm_only: 'filled in by the GM' };

/** The form's last line: what is not on it, and why. Empty when everything is. */
const leftLine = (left) => {
  const parts = Object.entries(LEFT_SAYS)
    .map(([why, says]) => [left.filter((l) => l.why === why).map((l) => l.label), says])
    .filter(([labels]) => labels.length)
    .map(([labels, says]) => `${labels.join(', ')} (${says})`);
  return parts.length ? printable(`Not on this form: ${parts.join('; ')}.`) : '';
};

/**
 * The blank form for a custom system's `definition`, named `name` at version `version`. Each box is
 * named by its field's id (inventory_<n>_name and _qty for the inventory's lines), the contract the
 * round-trip test walks.
 */
async function buildCustomTemplate(definition, { name, version } = {}) {
  // Required here rather than at the top: it is a builder module, and this file loads first.
  const { sheetFields, INVENTORY_ROWS } = require('../systemBuilder/sheetImport');
  const { ask, left } = sheetFields(definition);
  const title = printable(name || (definition && definition.name) || 'System').toUpperCase();

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} character sheet`);
  pdf.setSubject('Fill this in, save it, and upload it in CITY_NET: your sheet, IMPORT.');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const grey = rgb(0.35, 0.35, 0.35);

  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  const room = (h) => { if (y - h < MARGIN) { page = pdf.addPage([PAGE.w, PAGE.h]); y = PAGE.h - MARGIN; } };

  page.drawText(title, { x: MARGIN, y: y - 14, size: 16, font: bold });
  page.drawText(`CHARACTER SHEET${Number.isSafeInteger(version) ? ` - v${version}` : ''} - fill in, save, and upload in CITY_NET: your sheet, IMPORT`,
    { x: MARGIN, y: y - 28, size: 8, font, color: grey });
  y -= 44;

  const box = (id, x, width, height, multiline) => {
    const field = form.createTextField(id);
    if (multiline) field.enableMultiline();
    field.setText('');
    field.addToPage(page, { x, y: y - 12 - height, width, height, borderWidth: 0.5, borderColor: rgb(0.55, 0.55, 0.55), backgroundColor: rgb(0.93, 0.95, 1) });
  };

  let tab;
  let section;
  let col = 0;
  const rowH = (items) => 16 + Math.max(...items.map((f) => (f.type === 'textarea' ? 48 : 14))) + (items.some((f) => hintOf(f)) ? 12 : 4);
  let row = [];
  const flush = () => {
    if (!row.length) return;
    const h = rowH(row.map((r) => r.f));
    room(h);
    row.forEach(({ f, at, span }) => {
      const x = MARGIN + at * COL_W;
      const width = span * COL_W - 12;
      page.drawText(printable(f.label).toUpperCase(), { x, y: y - 9, size: 7, font, color: grey });
      const height = f.type === 'textarea' ? 48 : 14;
      if (f.type === 'select') {
        const field = form.createDropdown(f.id);
        field.addOptions(f.options.map((o) => printable(o.label)));
        field.addToPage(page, { x, y: y - 12 - height, width, height, borderWidth: 0.5, borderColor: rgb(0.55, 0.55, 0.55), backgroundColor: rgb(0.93, 0.95, 1) });
      } else box(f.id, x, width, height, f.type === 'textarea');
      const hint = hintOf(f);
      if (hint) page.drawText(printable(hint).slice(0, 90), { x, y: y - 22 - height, size: 6, font, color: grey });
    });
    y -= h;
    row = [];
    col = 0;
  };
  // A heading keeps what follows it close: a section its first row, a tab its first section's
  // heading and row too, so neither is left alone at the foot of a page.
  const heading = (text, size, keep) => {
    flush();
    room(size + keep);
    page.drawText(printable(text).toUpperCase(), { x: MARGIN, y: y - size, size, font: bold });
    if (size < 12) page.drawLine({ start: { x: MARGIN, y: y - size - 3 }, end: { x: PAGE.w - MARGIN, y: y - size - 3 }, thickness: 0.5 });
    y -= size + 12;
  };

  for (const f of ask) {
    if (f.tab !== tab) { tab = f.tab; section = undefined; if (tab) heading(tab, 12, 120); }
    if (f.section !== section) { section = f.section; heading(section, 9, 72); }
    if (f.type === 'inventory') {
      flush();
      const columns = () => {
        page.drawText('ITEM', { x: MARGIN, y: y - 9, size: 7, font, color: grey });
        page.drawText('HOW MANY', { x: MARGIN + COL_W * 2, y: y - 9, size: 7, font, color: grey });
        y -= 4;
      };
      columns();
      for (let n = 1; n <= INVENTORY_ROWS; n += 1) {
        if (y - 34 < MARGIN) { room(PAGE.h); columns(); }
        box(`inventory_${n}_name`, MARGIN, COL_W * 2 - 12, 14, false);
        box(`inventory_${n}_qty`, MARGIN + COL_W * 2, COL_W - 12, 14, false);
        y -= 20;
      }
      room(20);
      page.drawText('One item per line.', { x: MARGIN, y: y - 14, size: 6, font, color: grey });
      y -= 22;
      continue;
    }
    // Long text takes a whole row; a select two columns; anything else one.
    const span = f.type === 'textarea' ? COLS : f.type === 'select' ? 2 : 1;
    if (col + span > COLS) flush();
    row.push({ f, at: col, span });
    col += span;
    if (col >= COLS) flush();
  }
  flush();

  const text = leftLine(left);
  if (text) {
    const words = text.split(' ');
    const wrapped = [];
    let line = '';
    for (const w of words) {
      if (font.widthOfTextAtSize(`${line} ${w}`, 7) > PAGE.w - MARGIN * 2 && line) { wrapped.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    wrapped.push(line);
    room(12 + wrapped.length * 10);
    page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: PAGE.w - MARGIN, y: y - 2 }, thickness: 0.5, color: grey });
    wrapped.forEach((l, i) => page.drawText(l, { x: MARGIN, y: y - 12 - i * 10, size: 7, font, color: grey }));
  }

  return Buffer.from(await pdf.save());
}

module.exports = { LAYOUTS, hasTemplate, layoutFor, labelsFor, buildTemplate, buildCustomTemplate, printable, hintOf, leftLine };
